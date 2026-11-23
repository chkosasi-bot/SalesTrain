import { toFile } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getAuthUser, hasAuthCookie } from "@/lib/supabase/server-auth";
import {
  CHAT_MODEL,
  MAX_CONTEXT_MESSAGES,
  STT_MODEL_FALLBACK,
  STT_MODEL_PRIMARY,
  TTS_MODEL,
  DEFAULT_CUSTOMER_VOICE,
  DEFAULT_TTS_SPEED,
  getOpenAI,
  resolveTtsSpeed,
  resolveTtsVoice,
  type TtsVoice,
} from "@/lib/openai-server";
import { errorMessage, isValidId, jsonError, jsonOk } from "@/lib/api-utils";
import { COMPETITOR_COLUMNS, OWN_PRODUCT_COLUMNS } from "@/lib/mastery";
import { CUSTOMER_COLUMNS, isChallengeMode, isScenarioFocus, type CustomerRow } from "@/lib/simulation";
import { buildCustomerPersonaPrompt } from "@/lib/persona";
import type { CompetitorProduct, OwnProduct, VoiceTurnResponse } from "@/lib/types";

export const maxDuration = 60;

const MAX_AUDIO_BYTES = 24 * 1024 * 1024; // batas OpenAI 25MB
const MIN_AUDIO_BYTES = 1_000;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface ScenarioContext {
  system_prompt: string | null;
  customer_name: string | null;
  title: string | null;
  voice_id: string | null;
}

interface DbMessage {
  role: string;
  content: string;
  turn_order: number;
}

function extensionForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "mp4";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  return "webm";
}

async function transcribe(buffer: Buffer, mimeType: string, signal: AbortSignal): Promise<string> {
  const openai = getOpenAI();
  const filename = `ucapan.${extensionForMime(mimeType)}`;
  const baseType = mimeType.split(";")[0] || "audio/webm";

  const run = async (model: string) => {
    const file = await toFile(buffer, filename, { type: baseType });
    const result = await openai.audio.transcriptions.create(
      {
        file,
        model,
        language: "id",
        response_format: "json",
        prompt: "Percakapan penjualan antara salesman dan pelanggan dalam Bahasa Indonesia.",
      },
      { signal }
    );
    return (result as { text?: string }).text?.trim() ?? "";
  };

  try {
    return await run(STT_MODEL_PRIMARY);
  } catch (err) {
    if (signal.aborted) throw err;
    console.warn(`[voice-turn] STT ${STT_MODEL_PRIMARY} gagal, fallback ke ${STT_MODEL_FALLBACK}:`, errorMessage(err));
    return await run(STT_MODEL_FALLBACK);
  }
}

interface TurnContext {
  ownerId: string | null;
  systemPrompt: string;
  voice: TtsVoice;
  speed: number;
  history: DbMessage[];
  lastTurn: number;
}

/**
 * Memuat semua yang dibutuhkan satu giliran dalam 2 putaran query paralel:
 * (1) baris sesi, (2) pelanggan + produk + kompetitor + riwayat pesan — atau skenario lama + riwayat.
 */
async function loadContext(sessionId: string): Promise<TurnContext> {
  const supabase = getSupabaseAdmin();

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, scenario_id, status, user_id, own_product_id, customer_id, scenario_focus, challenge_mode")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) throw sessionError;
  if (!session) throw new HttpError(404, "Sesi tidak ditemukan.");
  if (session.status === "completed") {
    throw new HttpError(409, "Sesi ini sudah selesai dinilai. Mulai sesi baru untuk berlatih lagi.");
  }

  const historyQuery = supabase
    .from("messages")
    .select("role, content, turn_order")
    .eq("session_id", sessionId)
    .order("turn_order", { ascending: false })
    .limit(MAX_CONTEXT_MESSAGES - 1);

  const finish = (historyRes: { data: unknown; error: unknown }) => {
    if (historyRes.error) throw historyRes.error;
    const recentDesc = (historyRes.data ?? []) as DbMessage[];
    return { history: [...recentDesc].reverse(), lastTurn: recentDesc.length ? Number(recentDesc[0].turn_order) || 0 : 0 };
  };

  // Sesi baru: persona dinamis dari customers + own_products + competitor_products.
  if (session.customer_id && session.own_product_id) {
    const [customerRes, productRes, competitorsRes, historyRes] = await Promise.all([
      supabase.from("customers").select(CUSTOMER_COLUMNS).eq("id", session.customer_id).maybeSingle(),
      supabase.from("own_products").select(OWN_PRODUCT_COLUMNS).eq("id", session.own_product_id).maybeSingle(),
      supabase
        .from("competitor_products")
        .select(COMPETITOR_COLUMNS)
        .eq("compared_own_product_id", session.own_product_id)
        .eq("is_active", true)
        .order("competitor_code"),
      historyQuery,
    ]);
    if (customerRes.error) throw customerRes.error;
    if (productRes.error) throw productRes.error;
    if (competitorsRes.error) throw competitorsRes.error;
    if (!customerRes.data) throw new HttpError(404, "Profil pelanggan untuk sesi ini tidak ditemukan.");
    if (!productRes.data) throw new HttpError(404, "Produk untuk sesi ini tidak ditemukan.");

    const customer = customerRes.data as unknown as CustomerRow;
    return {
      ownerId: (session.user_id as string | null) ?? null,
      systemPrompt: buildCustomerPersonaPrompt({
        customer,
        product: productRes.data as unknown as OwnProduct,
        competitors: (competitorsRes.data ?? []) as unknown as CompetitorProduct[],
        focus: isScenarioFocus(session.scenario_focus) ? session.scenario_focus : null,
        challengeMode: isChallengeMode(session.challenge_mode) ? session.challenge_mode : null,
      }),
      voice: resolveTtsVoice(customer.tts_voice, DEFAULT_CUSTOMER_VOICE),
      speed: resolveTtsSpeed(customer.tts_speed),
      ...finish(historyRes),
    };
  }

  // Sesi lama berbasis tabel scenarios (kompatibilitas).
  if (!session.scenario_id) throw new HttpError(404, "Sesi ini tidak memiliki produk/pelanggan.");
  const [scenarioRes, historyRes] = await Promise.all([
    supabase.from("scenarios").select("system_prompt, customer_name, title, voice_id").eq("id", session.scenario_id).maybeSingle(),
    historyQuery,
  ]);
  if (scenarioRes.error) throw scenarioRes.error;
  if (!scenarioRes.data) throw new HttpError(404, "Skenario untuk sesi ini tidak ditemukan.");
  const scenario = scenarioRes.data as ScenarioContext;
  return {
    ownerId: (session.user_id as string | null) ?? null,
    systemPrompt: buildSystemPrompt(scenario),
    voice: resolveTtsVoice(scenario.voice_id),
    speed: DEFAULT_TTS_SPEED,
    ...finish(historyRes),
  };
}

function buildSystemPrompt(scenario: ScenarioContext) {
  const persona = scenario.customer_name ? `Nama karaktermu: ${scenario.customer_name}.` : "";
  return [
    scenario.system_prompt?.trim() || "Kamu adalah calon pelanggan yang sedang didatangi seorang salesman.",
    "",
    "ATURAN PERAN (wajib dipatuhi):",
    persona,
    "- Kamu adalah PELANGGAN dalam simulasi roleplay penjualan; lawan bicaramu adalah salesman yang sedang berlatih.",
    "- Selalu tetap dalam karakter. Jangan pernah mengaku sebagai AI dan jangan memberi tips penjualan.",
    "- Jawab singkat: 2–3 kalimat natural dalam Bahasa Indonesia lisan sehari-hari, seperti orang sungguhan berbicara.",
    "- Jangan gunakan emoji, markdown, daftar, atau deskripsi tindakan dalam tanda kurung/asterisk — jawabanmu akan diubah menjadi suara.",
    "- Bersikap realistis: ajukan keberatan atau pertanyaan yang wajar, dan hanya setuju bila salesman meyakinkan.",
  ]
    .filter(Boolean)
    .join("\n");
}

function cleanReply(text: string): string {
  return text
    .replace(/\*+/g, "")
    .replace(/[_#`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRole(role: string): "user" | "assistant" {
  return role === "assistant" ? "assistant" : "user";
}

// POST /api/voice-turn — STT → simpan → LLM → TTS → simpan, dalam satu request.
export async function POST(request: Request) {
  const startedAt = Date.now();

  // Tolak segera (tanpa membaca audio / memanggil OpenAI) bila tidak ada cookie login sama sekali.
  if (!(await hasAuthCookie())) return jsonError("Sesi login berakhir. Silakan masuk kembali.", 401);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Request harus berupa multipart/form-data.", 400);
  }

  const sessionId = form.get("session_id");
  const audio = form.get("audio");

  if (!isValidId(sessionId)) return jsonError("session_id tidak valid.", 400);
  if (!audio || typeof audio === "string") return jsonError("File audio tidak ditemukan.", 400);
  if (audio.size < MIN_AUDIO_BYTES) {
    return jsonError("Rekaman terlalu pendek. Tahan tombol lebih lama saat berbicara.", 422);
  }
  if (audio.size > MAX_AUDIO_BYTES) return jsonError("Rekaman terlalu besar (maks. 24MB).", 413);

  try {
    const buffer = Buffer.from(await audio.arrayBuffer());
    const mimeType = audio.type || "audio/webm";

    // 1) STT, verifikasi login, dan pengambilan konteks berjalan paralel (tanpa tambahan latensi).
    //    Bila login/kepemilikan sesi gagal, STT dibatalkan agar tidak menghabiskan kuota OpenAI.
    const sttAbort = new AbortController();
    const sttPromise = transcribe(buffer, mimeType, sttAbort.signal);
    sttPromise.catch(() => undefined); // dicegah jadi unhandled rejection bila dibatalkan

    let user: Awaited<ReturnType<typeof getAuthUser>>;
    let context: Awaited<ReturnType<typeof loadContext>>;
    try {
      [user, context] = await Promise.all([getAuthUser(), loadContext(String(sessionId))]);
    } catch (err) {
      sttAbort.abort();
      throw err;
    }
    if (!user) {
      sttAbort.abort();
      return jsonError("Sesi login berakhir. Silakan masuk kembali.", 401);
    }
    if (context.ownerId !== user.id) {
      sttAbort.abort();
      return jsonError("Sesi latihan ini bukan milik akun Anda.", 403);
    }

    const userTranscript = await sttPromise;

    if (!userTranscript) {
      return jsonError("Suara tidak terdengar jelas. Silakan coba bicara lagi.", 422);
    }

    const supabase = getSupabaseAdmin();
    const openai = getOpenAI();
    const userTurn = context.lastTurn + 1;

    const llmMessages: ChatCompletionMessageParam[] = [
      { role: "system", content: context.systemPrompt },
      ...context.history.map(
        (m): ChatCompletionMessageParam => ({ role: normalizeRole(m.role), content: m.content })
      ),
      { role: "user", content: userTranscript },
    ];

    // 2) Simpan ucapan salesman & panggil LLM secara paralel.
    const [userInsert, completion] = await Promise.all([
      supabase.from("messages").insert({
        session_id: String(sessionId),
        role: "user",
        content: userTranscript,
        turn_order: userTurn,
      }),
      openai.chat.completions.create({
        model: CHAT_MODEL,
        messages: llmMessages,
        temperature: 0.8,
        max_tokens: 180,
      }),
    ]);

    if (userInsert.error) throw userInsert.error;

    const assistantReply =
      cleanReply(completion.choices[0]?.message?.content ?? "") ||
      "Maaf, saya kurang menangkap maksud Anda. Bisa diulang?";

    // Suara per pelanggan: customers.tts_voice & tts_speed (fallback "nova" & 1.0); sesi lama: scenarios.voice_id.
    const { voice, speed } = context;

    // 3) TTS & simpan balasan AI secara paralel.
    const [speechResult, assistantInsert] = await Promise.all([
      openai.audio.speech
        .create({
          model: TTS_MODEL,
          voice,
          speed,
          input: assistantReply,
          response_format: "mp3",
        })
        .then(async (res) => Buffer.from(await res.arrayBuffer()).toString("base64"))
        .catch((err: unknown) => {
          console.error("[voice-turn] TTS gagal:", errorMessage(err));
          return null;
        }),
      supabase.from("messages").insert({
        session_id: String(sessionId),
        role: "assistant",
        content: assistantReply,
        turn_order: userTurn + 1,
      }),
    ]);

    if (assistantInsert.error) throw assistantInsert.error;

    console.info(`[voice-turn] sesi ${sessionId} giliran ${userTurn} (voice: ${voice}, speed: ${speed}) selesai dalam ${Date.now() - startedAt}ms`);

    const body: VoiceTurnResponse = {
      userTranscript,
      assistantReply,
      audioBase64: speechResult,
      audioMimeType: "audio/mpeg",
      voice,
      speed,
    };
    return jsonOk(body);
  } catch (err) {
    if (err instanceof HttpError) return jsonError(err.message, err.status);
    console.error("[POST /api/voice-turn]", err);
    return jsonError(`Gagal memproses giliran bicara: ${errorMessage(err)}`, 500);
  }
}

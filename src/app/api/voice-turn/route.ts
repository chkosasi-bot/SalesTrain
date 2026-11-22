import { toFile } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import {
  CHAT_MODEL,
  MAX_CONTEXT_MESSAGES,
  STT_MODEL_FALLBACK,
  STT_MODEL_PRIMARY,
  TTS_MODEL,
  getOpenAI,
  resolveTtsVoice,
} from "@/lib/openai-server";
import { errorMessage, isValidId, jsonError, jsonOk } from "@/lib/api-utils";
import type { VoiceTurnResponse } from "@/lib/types";

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

async function transcribe(buffer: Buffer, mimeType: string): Promise<string> {
  const openai = getOpenAI();
  const filename = `ucapan.${extensionForMime(mimeType)}`;
  const baseType = mimeType.split(";")[0] || "audio/webm";

  const run = async (model: string) => {
    const file = await toFile(buffer, filename, { type: baseType });
    const result = await openai.audio.transcriptions.create({
      file,
      model,
      language: "id",
      response_format: "json",
      prompt: "Percakapan penjualan antara salesman dan pelanggan dalam Bahasa Indonesia.",
    });
    return (result as { text?: string }).text?.trim() ?? "";
  };

  try {
    return await run(STT_MODEL_PRIMARY);
  } catch (err) {
    console.warn(`[voice-turn] STT ${STT_MODEL_PRIMARY} gagal, fallback ke ${STT_MODEL_FALLBACK}:`, errorMessage(err));
    return await run(STT_MODEL_FALLBACK);
  }
}

async function loadContext(sessionId: string) {
  const supabase = getSupabaseAdmin();

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select("id, scenario_id, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) throw sessionError;
  if (!session) throw new HttpError(404, "Sesi tidak ditemukan.");
  if (session.status === "completed") {
    throw new HttpError(409, "Sesi ini sudah selesai dinilai. Mulai sesi baru untuk berlatih lagi.");
  }

  const [scenarioRes, historyRes] = await Promise.all([
    supabase
      .from("scenarios")
      .select("system_prompt, customer_name, title, voice_id")
      .eq("id", session.scenario_id)
      .maybeSingle(),
    supabase
      .from("messages")
      .select("role, content, turn_order")
      .eq("session_id", sessionId)
      .order("turn_order", { ascending: false })
      .limit(MAX_CONTEXT_MESSAGES - 1),
  ]);

  if (scenarioRes.error) throw scenarioRes.error;
  if (historyRes.error) throw historyRes.error;
  if (!scenarioRes.data) throw new HttpError(404, "Skenario untuk sesi ini tidak ditemukan.");

  const recentDesc = (historyRes.data ?? []) as DbMessage[];
  const lastTurn = recentDesc.length ? Number(recentDesc[0].turn_order) || 0 : 0;

  return {
    scenario: scenarioRes.data as ScenarioContext,
    history: [...recentDesc].reverse(),
    lastTurn,
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

    // 1) STT dan pengambilan konteks berjalan paralel untuk menekan latensi.
    const [userTranscript, context] = await Promise.all([
      transcribe(buffer, mimeType),
      loadContext(String(sessionId)),
    ]);

    if (!userTranscript) {
      return jsonError("Suara tidak terdengar jelas. Silakan coba bicara lagi.", 422);
    }

    const supabase = getSupabaseAdmin();
    const openai = getOpenAI();
    const userTurn = context.lastTurn + 1;

    const llmMessages: ChatCompletionMessageParam[] = [
      { role: "system", content: buildSystemPrompt(context.scenario) },
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

    // 3) TTS & simpan balasan AI secara paralel.
    const [speechResult, assistantInsert] = await Promise.all([
      openai.audio.speech
        .create({
          model: TTS_MODEL,
          voice: resolveTtsVoice(context.scenario.voice_id),
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

    console.info(`[voice-turn] sesi ${sessionId} giliran ${userTurn} (voice: ${resolveTtsVoice(context.scenario.voice_id)}) selesai dalam ${Date.now() - startedAt}ms`);

    const body: VoiceTurnResponse = {
      userTranscript,
      assistantReply,
      audioBase64: speechResult,
      audioMimeType: "audio/mpeg",
    };
    return jsonOk(body);
  } catch (err) {
    if (err instanceof HttpError) return jsonError(err.message, err.status);
    console.error("[POST /api/voice-turn]", err);
    return jsonError(`Gagal memproses giliran bicara: ${errorMessage(err)}`, 500);
  }
}

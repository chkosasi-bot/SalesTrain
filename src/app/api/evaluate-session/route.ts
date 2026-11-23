import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getAuthUser } from "@/lib/supabase/server-auth";
import { CHAT_MODEL, getOpenAI } from "@/lib/openai-server";
import { errorMessage, isValidId, jsonError, jsonOk } from "@/lib/api-utils";
import { COMPETITOR_COLUMNS, OWN_PRODUCT_COLUMNS } from "@/lib/mastery";
import {
  CUSTOMER_COLUMNS,
  MIN_SALESMAN_TURNS_TO_PASS,
  SIMULATION_PASSING_SCORE,
  isChallengeMode,
  isScenarioFocus,
  type CustomerRow,
} from "@/lib/simulation";
import { buildEvaluationContext } from "@/lib/persona";
import type { CompetitorProduct, EvaluateSessionResponse, Evaluation, OwnProduct } from "@/lib/types";

export const maxDuration = 60;

const EVALUATOR_PROMPT = `Kamu adalah pelatih penjualan (sales coach) senior FMCG di Indonesia.
Tugasmu menilai performa SALESMAN dalam transkrip roleplay penjualan berikut (lawan bicaranya adalah pelanggan AI).

Kriteria umum: pembukaan & membangun rapport, menggali kebutuhan (bertanya), penyampaian manfaat produk,
penanganan keberatan, kejelasan & sopan santun komunikasi, serta upaya closing / langkah selanjutnya.
Bila KONTEKS memuat data produk, nilai juga KETEPATAN fakta yang disampaikan salesman (harga/margin, bonus,
syarat promo, diskon tambahan, strategi menghadapi kompetitor) dan kriteria khusus sesuai fokus skenario.
Salesman yang menyebut fakta keliru atau memberi diskon/bonus di luar skema harus mendapat pengurangan nilai.
Percakapan yang terlalu singkat (hanya sapaan/pembukaan, belum menjawab keberatan, belum ada upaya closing) maksimal 50.
Skor ${SIMULATION_PASSING_SCORE} ke atas berarti siap menghadapi pelanggan sungguhan.

Balas HANYA dengan JSON valid berformat persis:
{
  "score": <bilangan bulat 1-100>,
  "strengths": ["<kelebihan 1>", "<kelebihan 2>"],
  "improvements": ["<saran perbaikan 1>", "<saran perbaikan 2>"],
  "summary": "<ringkasan singkat 2-3 kalimat>"
}
Gunakan Bahasa Indonesia yang jelas, spesifik, dan merujuk pada isi percakapan. Tepat 2 poin strengths dan 2 poin improvements.`;

function toStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim())
    .slice(0, 2);
  while (items.length < 2) items.push(fallback[items.length] ?? "-");
  return items;
}

function parseEvaluation(raw: string): Evaluation {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Model evaluasi mengembalikan format yang tidak valid.");
  }
  const scoreNum = Math.round(Number(data.score));
  const score = Number.isFinite(scoreNum) ? Math.min(100, Math.max(1, scoreNum)) : 50;
  return {
    score,
    strengths: toStringArray(data.strengths, ["Berani memulai percakapan.", "Tetap sopan selama sesi."]),
    improvements: toStringArray(data.improvements, [
      "Gali kebutuhan pelanggan dengan lebih banyak pertanyaan terbuka.",
      "Akhiri percakapan dengan ajakan closing yang jelas.",
    ]),
    summary: typeof data.summary === "string" && data.summary.trim() ? data.summary.trim() : "Sesi latihan telah dinilai.",
    passed: score >= SIMULATION_PASSING_SCORE,
    passing_score: SIMULATION_PASSING_SCORE,
  };
}

function formatFeedbackSummary(e: Evaluation): string {
  return [
    e.summary,
    "",
    "Kelebihan:",
    ...e.strengths.map((s) => `- ${s}`),
    "",
    "Saran Perbaikan:",
    ...e.improvements.map((s) => `- ${s}`),
  ].join("\n");
}

// POST /api/evaluate-session — menilai seluruh transkrip sesi, mengisi score/passed & menandai sesi selesai.
export async function POST(request: Request) {
  let body: { session_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Body request harus berupa JSON.", 400);
  }

  const sessionId = body.session_id;
  if (!isValidId(sessionId)) return jsonError("session_id tidak valid.", 400);

  try {
    const supabase = getSupabaseAdmin();

    const [user, sessionRes] = await Promise.all([
      getAuthUser(),
      supabase
        .from("sessions")
        .select("id, scenario_id, salesman_name, user_id, status, own_product_id, customer_id, scenario_focus, challenge_mode")
        .eq("id", String(sessionId))
        .maybeSingle(),
    ]);
    if (!user) return jsonError("Sesi login berakhir. Silakan masuk kembali.", 401);
    const { data: session, error: sessionError } = sessionRes;
    if (sessionError) throw sessionError;
    if (!session) return jsonError("Sesi tidak ditemukan.", 404);
    if (session.user_id !== user.id) return jsonError("Sesi latihan ini bukan milik akun Anda.", 403);
    // Kelulusan membuka profil opsional → satu sesi hanya boleh dinilai sekali.
    if (session.status === "completed") return jsonError("Sesi ini sudah dinilai. Mulai sesi baru untuk mencoba lagi.", 409);

    const [messagesRes, customerRes, productRes, competitorsRes, scenarioRes] = await Promise.all([
      supabase.from("messages").select("role, content, turn_order").eq("session_id", String(sessionId)).order("turn_order"),
      session.customer_id
        ? supabase.from("customers").select(CUSTOMER_COLUMNS).eq("id", session.customer_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      session.own_product_id
        ? supabase.from("own_products").select(OWN_PRODUCT_COLUMNS).eq("id", session.own_product_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      session.own_product_id
        ? supabase
            .from("competitor_products")
            .select(COMPETITOR_COLUMNS)
            .eq("compared_own_product_id", session.own_product_id)
            .eq("is_active", true)
        : Promise.resolve({ data: [], error: null }),
      session.scenario_id
        ? supabase.from("scenarios").select("title, description, customer_name").eq("id", session.scenario_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    for (const r of [messagesRes, customerRes, productRes, competitorsRes, scenarioRes]) if (r.error) throw r.error;

    const messages = messagesRes.data ?? [];
    if (!messages.some((m) => m.role !== "assistant")) {
      return jsonError("Belum ada percakapan untuk dinilai. Bicaralah minimal satu kali.", 400);
    }

    const customer = customerRes.data as unknown as CustomerRow | null;
    const scenario = scenarioRes.data as { title: string; description: string | null; customer_name: string | null } | null;
    const counterpart = customer?.owner_name || scenario?.customer_name || "Pelanggan";
    const salesman = session.salesman_name || "Salesman";
    const transcript = messages.map((m) => `${m.role === "assistant" ? counterpart : salesman}: ${m.content}`).join("\n");

    const contextBlock = customer
      ? buildEvaluationContext({
          customer,
          product: productRes.data as unknown as OwnProduct | null,
          competitors: (competitorsRes.data ?? []) as unknown as CompetitorProduct[],
          focus: isScenarioFocus(session.scenario_focus) ? session.scenario_focus : null,
          challengeMode: isChallengeMode(session.challenge_mode) ? session.challenge_mode : null,
        })
      : [`Skenario: ${scenario?.title ?? "-"}`, scenario?.description ? `Deskripsi: ${scenario.description}` : ""].filter(Boolean).join("\n");

    const completion = await getOpenAI().chat.completions.create({
      model: CHAT_MODEL,
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 600,
      messages: [
        { role: "system", content: EVALUATOR_PROMPT },
        { role: "user", content: `KONTEKS:\n${contextBlock}\n\nTRANSKRIP:\n${transcript}` },
      ],
    });

    const evaluation = parseEvaluation(completion.choices[0]?.message?.content ?? "");

    // Pengaman kelulusan: skor tetap dicatat, tetapi sesi yang terlalu singkat tidak boleh lulus.
    const salesmanTurns = messages.filter((m) => m.role !== "assistant").length;
    if (evaluation.passed && salesmanTurns < MIN_SALESMAN_TURNS_TO_PASS) {
      evaluation.passed = false;
      evaluation.improvements = [
        `Percakapan baru ${salesmanTurns} giliran — lanjutkan minimal ${MIN_SALESMAN_TURNS_TO_PASS} giliran (gali kebutuhan, jawab keberatan, closing) agar bisa dinyatakan lulus.`,
        evaluation.improvements[0],
      ];
    }

    const { error: updateError } = await supabase
      .from("sessions")
      .update({
        status: "completed",
        score: evaluation.score,
        passed: evaluation.passed,
        feedback_summary: formatFeedbackSummary(evaluation),
        completed_at: new Date().toISOString(),
      })
      .eq("id", String(sessionId))
      .neq("status", "completed");
    if (updateError) throw updateError;

    const responseBody: EvaluateSessionResponse = { sessionId: String(sessionId), evaluation };
    return jsonOk(responseBody);
  } catch (err) {
    console.error("[POST /api/evaluate-session]", err);
    return jsonError(`Gagal menilai sesi: ${errorMessage(err)}`, 500);
  }
}

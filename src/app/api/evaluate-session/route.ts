import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getAuthUser } from "@/lib/supabase/server-auth";
import { CHAT_MODEL, getOpenAI } from "@/lib/openai-server";
import { errorMessage, isValidId, jsonError, jsonOk } from "@/lib/api-utils";
import type { EvaluateSessionResponse, Evaluation } from "@/lib/types";

export const maxDuration = 60;

const EVALUATOR_PROMPT = `Kamu adalah pelatih penjualan (sales coach) senior di Indonesia.
Tugasmu menilai performa SALESMAN dalam transkrip roleplay penjualan berikut (lawan bicaranya adalah pelanggan AI).

Kriteria penilaian: pembukaan & membangun rapport, menggali kebutuhan (bertanya), penyampaian manfaat produk,
penanganan keberatan, kejelasan & sopan santun komunikasi, serta upaya closing / langkah selanjutnya.

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
    summary:
      typeof data.summary === "string" && data.summary.trim()
        ? data.summary.trim()
        : "Sesi latihan telah dinilai.",
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

// POST /api/evaluate-session — menilai seluruh transkrip sesi & menandai sesi selesai.
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
        .select("id, scenario_id, salesman_name, user_id")
        .eq("id", String(sessionId))
        .maybeSingle(),
    ]);
    if (!user) return jsonError("Sesi login berakhir. Silakan masuk kembali.", 401);
    const { data: session, error: sessionError } = sessionRes;
    if (sessionError) throw sessionError;
    if (!session) return jsonError("Sesi tidak ditemukan.", 404);
    if (session.user_id !== user.id) return jsonError("Sesi latihan ini bukan milik akun Anda.", 403);

    const [scenarioRes, messagesRes] = await Promise.all([
      supabase
        .from("scenarios")
        .select("title, description, customer_name")
        .eq("id", session.scenario_id)
        .maybeSingle(),
      supabase
        .from("messages")
        .select("role, content, turn_order")
        .eq("session_id", String(sessionId))
        .order("turn_order", { ascending: true }),
    ]);
    if (scenarioRes.error) throw scenarioRes.error;
    if (messagesRes.error) throw messagesRes.error;

    const messages = messagesRes.data ?? [];
    if (!messages.some((m) => m.role !== "assistant")) {
      return jsonError("Belum ada percakapan untuk dinilai. Bicaralah minimal satu kali.", 400);
    }

    const customer = scenarioRes.data?.customer_name || "Pelanggan";
    const salesman = session.salesman_name || "Salesman";
    const transcript = messages
      .map((m) => `${m.role === "assistant" ? customer : salesman}: ${m.content}`)
      .join("\n");

    const context = [
      `Skenario: ${scenarioRes.data?.title ?? "-"}`,
      scenarioRes.data?.description ? `Deskripsi: ${scenarioRes.data.description}` : "",
      "",
      "TRANSKRIP:",
      transcript,
    ]
      .filter((line, i) => line !== "" || i === 2)
      .join("\n");

    const completion = await getOpenAI().chat.completions.create({
      model: CHAT_MODEL,
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 600,
      messages: [
        { role: "system", content: EVALUATOR_PROMPT },
        { role: "user", content: context },
      ],
    });

    const evaluation = parseEvaluation(completion.choices[0]?.message?.content ?? "");

    const { error: updateError } = await supabase
      .from("sessions")
      .update({
        status: "completed",
        score: evaluation.score,
        feedback_summary: formatFeedbackSummary(evaluation),
        completed_at: new Date().toISOString(),
      })
      .eq("id", String(sessionId));
    if (updateError) throw updateError;

    const responseBody: EvaluateSessionResponse = { sessionId: String(sessionId), evaluation };
    return jsonOk(responseBody);
  } catch (err) {
    console.error("[POST /api/evaluate-session]", err);
    return jsonError(`Gagal menilai sesi: ${errorMessage(err)}`, 500);
  }
}

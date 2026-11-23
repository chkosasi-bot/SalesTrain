import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getAuthUser } from "@/lib/supabase/server-auth";
import { getProfile, upsertProfile } from "@/lib/profiles";
import { errorMessage, jsonError, jsonOk } from "@/lib/api-utils";
import {
  MASTERY_ATTEMPT_TYPE,
  MASTERY_MODULE,
  PASSING_THRESHOLD,
  isProductId,
  listMasteryAttempts,
  statusFromAttempts,
} from "@/lib/mastery";
import { openQuizToken } from "@/lib/quiz";
import type { QuizReviewItem, QuizTopic, SubmitQuizResponse } from "@/lib/types";

// POST /api/mastery/[id]/submit-quiz — nilai jawaban, simpan ke assessment_attempts, kembalikan pembahasan.
export async function POST(request: Request, ctx: RouteContext<"/api/mastery/[id]/submit-quiz">) {
  const { id } = await ctx.params;
  if (!isProductId(id)) return jsonError("ID produk tidak valid.", 400);

  const user = await getAuthUser();
  if (!user) return jsonError("Silakan masuk terlebih dahulu.", 401);

  let body: { quizToken?: unknown; answers?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Body request harus berupa JSON.", 400);
  }

  const quiz = openQuizToken(body.quizToken);
  if (!quiz || quiz.product_id !== id || quiz.user_id !== user.id) {
    return jsonError("Kuis tidak valid. Silakan buat kuis baru.", 400);
  }
  if (new Date(quiz.expires_at).getTime() < Date.now()) {
    return jsonError("Waktu kuis habis (60 menit). Silakan buat kuis baru.", 410);
  }

  const answers = Array.isArray(body.answers) ? body.answers : [];
  if (answers.length !== quiz.questions.length) {
    return jsonError(`Jawab semua ${quiz.questions.length} soal terlebih dahulu.`, 400);
  }

  const supabase = getSupabaseAdmin();

  try {
    // Satu kuis hanya boleh disubmit sekali (mencegah submit ulang setelah melihat pembahasan).
    const { data: dup, error: dupError } = await supabase
      .from("assessment_attempts")
      .select("id")
      .eq("user_id", user.id)
      .eq("details_json->>quiz_id", quiz.quiz_id)
      .limit(1);
    if (dupError) throw dupError;
    if (dup && dup.length > 0) return jsonError("Kuis ini sudah pernah dinilai. Buat kuis baru untuk mencoba lagi.", 409);

    const review: QuizReviewItem[] = quiz.questions.map((q, i) => {
      const raw = answers[i];
      const selected = Number.isInteger(raw) && (raw as number) >= 0 && (raw as number) < q.options.length ? (raw as number) : null;
      return {
        id: q.id,
        question: q.question,
        options: q.options,
        topic: q.topic,
        selected_index: selected,
        correct_index: q.correct_index,
        is_correct: selected === q.correct_index,
        explanation: q.explanation,
      };
    });

    const correctCount = review.filter((r) => r.is_correct).length;
    const score = Math.round((correctCount / review.length) * 100);
    const passed = score >= PASSING_THRESHOLD;
    const weakTopics = [...new Set(review.filter((r) => !r.is_correct).map((r) => r.topic))] as QuizTopic[];

    // assessment_attempts.user_id → FK ke profiles.id
    if (!(await getProfile(user.id))) await upsertProfile(user.id, { email: user.email });

    const { data: inserted, error: insertError } = await supabase
      .from("assessment_attempts")
      .insert({
        user_id: user.id,
        attempt_type: MASTERY_ATTEMPT_TYPE,
        related_product_id: id,
        score,
        passing_threshold: PASSING_THRESHOLD,
        passed,
        weak_topics_json: weakTopics,
        details_json: {
          module: MASTERY_MODULE,
          quiz_id: quiz.quiz_id,
          product_code: quiz.product_code,
          model: quiz.model,
          issued_at: quiz.issued_at,
          submitted_at: new Date().toISOString(),
          correct_count: correctCount,
          total: review.length,
          questions: review,
        },
      })
      .select("id")
      .single();
    if (insertError) throw insertError;

    const attempts = await listMasteryAttempts(user.id, id);
    const res: SubmitQuizResponse = {
      attemptId: inserted.id,
      score,
      passed,
      passing_threshold: PASSING_THRESHOLD,
      correct_count: correctCount,
      total: review.length,
      weak_topics: weakTopics,
      review,
      status: statusFromAttempts(attempts),
    };
    return jsonOk(res, 201);
  } catch (err) {
    console.error("[POST /api/mastery/[id]/submit-quiz]", errorMessage(err));
    return jsonError(`Gagal menyimpan hasil kuis: ${errorMessage(err)}`, 500);
  }
}

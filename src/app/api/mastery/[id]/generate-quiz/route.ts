import { getAuthUser } from "@/lib/supabase/server-auth";
import { errorMessage, jsonError, jsonOk } from "@/lib/api-utils";
import { getActiveProduct, isProductId, listCompetitors } from "@/lib/mastery";
import { generateQuiz } from "@/lib/quiz";
import type { GenerateQuizResponse } from "@/lib/types";

export const maxDuration = 60;

// POST /api/mastery/[id]/generate-quiz — 5 soal pilihan ganda berbasis skenario dari data produk & kompetitor.
// Kunci jawaban & pembahasan disegel di quizToken (terenkripsi), tidak pernah dikirim terbuka ke browser.
export async function POST(_request: Request, ctx: RouteContext<"/api/mastery/[id]/generate-quiz">) {
  const { id } = await ctx.params;
  if (!isProductId(id)) return jsonError("ID produk tidak valid.", 400);

  const user = await getAuthUser();
  if (!user) return jsonError("Silakan masuk terlebih dahulu.", 401);

  try {
    const [product, competitors] = await Promise.all([getActiveProduct(id), listCompetitors(id)]);
    if (!product) return jsonError("Produk tidak ditemukan atau tidak aktif.", 404);

    const quiz = await generateQuiz(user.id, product, competitors);
    const body: GenerateQuizResponse = {
      quizToken: quiz.token,
      questions: quiz.publicQuestions,
      expiresAt: quiz.expiresAt,
    };
    return jsonOk(body);
  } catch (err) {
    console.error("[POST /api/mastery/[id]/generate-quiz]", errorMessage(err));
    return jsonError("Gagal menyusun kuis. Silakan coba lagi.", 502);
  }
}

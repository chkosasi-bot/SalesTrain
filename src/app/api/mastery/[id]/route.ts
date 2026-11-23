import { getAuthUser } from "@/lib/supabase/server-auth";
import { errorMessage, jsonError, jsonOk } from "@/lib/api-utils";
import {
  PASSING_THRESHOLD,
  getActiveProduct,
  isProductId,
  listCompetitors,
  listMasteryAttempts,
  statusFromAttempts,
} from "@/lib/mastery";
import type { MasteryDetailResponse } from "@/lib/types";

const toTopics = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

// GET /api/mastery/[id] — materi lengkap produk + battlecard kompetitor + riwayat kuis user.
export async function GET(_request: Request, ctx: RouteContext<"/api/mastery/[id]">) {
  const { id } = await ctx.params;
  if (!isProductId(id)) return jsonError("ID produk tidak valid.", 400);

  const user = await getAuthUser();
  if (!user) return jsonError("Silakan masuk terlebih dahulu.", 401);

  try {
    const [product, competitors, attempts] = await Promise.all([
      getActiveProduct(id),
      listCompetitors(id),
      listMasteryAttempts(user.id, id),
    ]);
    if (!product) return jsonError("Produk tidak ditemukan atau tidak aktif.", 404);

    const body: MasteryDetailResponse = {
      product,
      competitors,
      status: statusFromAttempts(attempts),
      history: attempts.slice(0, 10).map((a) => ({
        id: a.id,
        score: a.score,
        passed: a.passed,
        created_at: a.created_at,
        weak_topics: toTopics(a.weak_topics_json),
      })),
      passing_threshold: PASSING_THRESHOLD,
    };
    return jsonOk(body);
  } catch (err) {
    console.error("[GET /api/mastery/[id]]", err);
    return jsonError(`Gagal memuat materi produk: ${errorMessage(err)}`, 500);
  }
}

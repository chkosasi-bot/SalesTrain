import { getAuthUser } from "@/lib/supabase/server-auth";
import { errorMessage, jsonError, jsonOk } from "@/lib/api-utils";
import {
  PASSING_THRESHOLD,
  countCompetitorsByProduct,
  groupAttemptsByProduct,
  listActiveProducts,
  listMasteryAttempts,
  statusFromAttempts,
} from "@/lib/mastery";
import type { MasteryListResponse } from "@/lib/types";

// GET /api/mastery — katalog produk aktif + status kuis user yang login.
export async function GET() {
  const user = await getAuthUser();
  if (!user) return jsonError("Silakan masuk terlebih dahulu.", 401);

  try {
    const [products, attempts] = await Promise.all([listActiveProducts(), listMasteryAttempts(user.id)]);
    const competitorCounts = await countCompetitorsByProduct(products.map((p) => p.id));
    const byProduct = groupAttemptsByProduct(attempts);

    const cards = products.map((p) => ({
      id: p.id,
      product_code: p.product_code,
      name: p.name,
      category: p.category,
      brand: p.brand,
      sales_bonus_scheme: p.sales_bonus_scheme,
      sales_promo_terms: p.sales_promo_terms,
      competitor_count: competitorCounts[p.id] ?? 0,
      status: statusFromAttempts(byProduct[p.id] ?? []),
    }));
    const passed = cards.filter((c) => c.status.passed).length;

    const body: MasteryListResponse = {
      products: cards,
      summary: {
        total: cards.length,
        passed,
        all_passed: cards.length > 0 && passed === cards.length,
        passing_threshold: PASSING_THRESHOLD,
      },
    };
    return jsonOk(body);
  } catch (err) {
    console.error("[GET /api/mastery]", err);
    return jsonError(`Gagal memuat materi produk: ${errorMessage(err)}`, 500);
  }
}

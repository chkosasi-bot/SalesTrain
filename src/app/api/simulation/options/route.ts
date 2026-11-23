import { getAuthUser } from "@/lib/supabase/server-auth";
import { errorMessage, jsonError, jsonOk } from "@/lib/api-utils";
import { countCompetitorsByProduct, listActiveProducts } from "@/lib/mastery";
import {
  CHALLENGE_MODES,
  SCENARIO_FOCUSES,
  SIMULATION_PASSING_SCORE,
  buildCustomerCards,
  getCustomerPassStatus,
  listActiveCustomers,
} from "@/lib/simulation";
import type { ChallengeMode, ScenarioFocus, SimulationOptionsResponse } from "@/lib/types";

// GET /api/simulation/options — data konfigurator sesi: produk aktif, pelanggan aktif (+ status kunci), fokus.
export async function GET() {
  const user = await getAuthUser();
  if (!user) return jsonError("Silakan masuk terlebih dahulu.", 401);

  try {
    const [products, customers, status] = await Promise.all([
      listActiveProducts(),
      listActiveCustomers(),
      getCustomerPassStatus(user.id),
    ]);
    const competitorCounts = await countCompetitorsByProduct(products.map((p) => p.id));

    const body: SimulationOptionsResponse = {
      products: products.map((p) => ({
        id: p.id,
        product_code: p.product_code,
        name: p.name,
        brand: p.brand,
        category: p.category,
        competitor_count: competitorCounts[p.id] ?? 0,
      })),
      customers: buildCustomerCards(customers, status),
      focuses: (Object.keys(SCENARIO_FOCUSES) as ScenarioFocus[]).map((id) => ({
        id,
        label: SCENARIO_FOCUSES[id].label,
        short: SCENARIO_FOCUSES[id].short,
        description: SCENARIO_FOCUSES[id].description,
      })),
      challenge_modes: (Object.keys(CHALLENGE_MODES) as ChallengeMode[]).map((id) => ({ id, label: CHALLENGE_MODES[id].label })),
      passing_score: SIMULATION_PASSING_SCORE,
    };
    return jsonOk(body);
  } catch (err) {
    console.error("[GET /api/simulation/options]", err);
    return jsonError(`Gagal memuat data simulasi: ${errorMessage(err)}`, 500);
  }
}

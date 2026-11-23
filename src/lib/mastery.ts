import { getSupabaseAdmin } from "./supabase-server";
import type { CompetitorProduct, MasteryStatus, OwnProduct } from "./types";

/**
 * Product Mastery — akses data own_products, competitor_products & assessment_attempts.
 *
 * Catatan skema: check constraint `assessment_attempts_attempt_type_check` di database hanya
 * menerima nilai tertentu; kuis produk disimpan sebagai `post_test` dengan `related_product_id`
 * terisi dan `details_json.module = "product_mastery"`.
 */
export const MASTERY_ATTEMPT_TYPE = "post_test";
export const MASTERY_MODULE = "product_mastery";
export const PASSING_THRESHOLD = 80;
export const QUIZ_QUESTION_COUNT = 5;

export const OWN_PRODUCT_COLUMNS =
  "id, product_code, name, category, brand, specifications_summary, key_selling_points, pricing_and_margin_notes, " +
  "target_customer_notes, marketing_product_strategy, marketing_price_strategy, marketing_place_strategy, " +
  "marketing_promotion_strategy, sales_additional_discount_rate, sales_bonus_scheme, sales_promo_terms, is_active";

export const COMPETITOR_COLUMNS =
  "id, competitor_code, competitor_brand, product_name, compared_own_product_id, specifications_summary, " +
  "perceived_strengths, perceived_weaknesses, counter_strategy, is_active";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isProductId = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

export async function listActiveProducts(): Promise<OwnProduct[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("own_products")
    .select(OWN_PRODUCT_COLUMNS)
    .eq("is_active", true)
    .order("product_code", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as OwnProduct[];
}

export async function getActiveProduct(id: string): Promise<OwnProduct | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("own_products")
    .select(OWN_PRODUCT_COLUMNS)
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as OwnProduct | null) ?? null;
}

export async function listCompetitors(productId: string): Promise<CompetitorProduct[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("competitor_products")
    .select(COMPETITOR_COLUMNS)
    .eq("compared_own_product_id", productId)
    .eq("is_active", true)
    .order("competitor_code", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as CompetitorProduct[];
}

export async function countCompetitorsByProduct(productIds: string[]): Promise<Record<string, number>> {
  if (productIds.length === 0) return {};
  const { data, error } = await getSupabaseAdmin()
    .from("competitor_products")
    .select("compared_own_product_id")
    .in("compared_own_product_id", productIds)
    .eq("is_active", true);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const id = row.compared_own_product_id as string;
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

export interface AttemptRow {
  id: string;
  related_product_id: string | null;
  score: number;
  passing_threshold: number;
  passed: boolean;
  weak_topics_json: unknown;
  created_at: string;
}

export async function listMasteryAttempts(userId: string, productId?: string): Promise<AttemptRow[]> {
  let q = getSupabaseAdmin()
    .from("assessment_attempts")
    .select("id, related_product_id, score, passing_threshold, passed, weak_topics_json, created_at")
    .eq("user_id", userId)
    .eq("attempt_type", MASTERY_ATTEMPT_TYPE)
    .not("related_product_id", "is", null)
    .order("created_at", { ascending: false });
  if (productId) q = q.eq("related_product_id", productId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AttemptRow[];
}

export function statusFromAttempts(attempts: AttemptRow[]): MasteryStatus {
  if (attempts.length === 0) {
    return { attempts: 0, best_score: null, last_score: null, passed: false, last_attempt_at: null };
  }
  return {
    attempts: attempts.length,
    best_score: Math.max(...attempts.map((a) => a.score)),
    last_score: attempts[0].score,
    passed: attempts.some((a) => a.passed),
    last_attempt_at: attempts[0].created_at,
  };
}

export function groupAttemptsByProduct(attempts: AttemptRow[]): Record<string, AttemptRow[]> {
  const map: Record<string, AttemptRow[]> = {};
  for (const a of attempts) {
    if (!a.related_product_id) continue;
    (map[a.related_product_id] ??= []).push(a);
  }
  return map;
}

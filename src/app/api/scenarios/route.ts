import { connection } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getAuthUser } from "@/lib/supabase/server-auth";
import { errorMessage, jsonError, jsonOk } from "@/lib/api-utils";
import type { ScenarioSummary, ScenariosResponse } from "@/lib/types";

// GET /api/scenarios — daftar skenario aktif (tanpa system_prompt agar tidak bocor ke browser).
export async function GET() {
  await connection(); // selalu dijalankan saat request, bukan saat build

  if (!(await getAuthUser())) return jsonError("Silakan masuk terlebih dahulu.", 401);

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("scenarios")
      .select("id, title, description, customer_name")
      .eq("is_active", true)
      .order("title", { ascending: true });

    if (error) throw error;

    const body: ScenariosResponse = { scenarios: (data ?? []) as ScenarioSummary[] };
    return jsonOk(body);
  } catch (err) {
    console.error("[GET /api/scenarios]", err);
    return jsonError(`Gagal memuat skenario: ${errorMessage(err)}`, 500);
  }
}

import { createSupabaseAuthClient } from "@/lib/supabase/server-auth";
import { jsonOk } from "@/lib/api-utils";

// POST /api/auth/logout — akhiri sesi & hapus cookie auth.
export async function POST() {
  const supabase = await createSupabaseAuthClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) console.warn("[POST /api/auth/logout]", error.message);
  return jsonOk({ ok: true });
}

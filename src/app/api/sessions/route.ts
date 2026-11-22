import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getAuthUser } from "@/lib/supabase/server-auth";
import { getProfile, profileDisplayName, upsertProfile } from "@/lib/profiles";
import { errorMessage, isValidId, jsonError, jsonOk } from "@/lib/api-utils";
import type { CreateSessionResponse, ScenarioSummary, SessionInfo } from "@/lib/types";

// POST /api/sessions — membuat sesi latihan baru untuk skenario terpilih, terikat ke user yang login.
export async function POST(request: Request) {
  let body: { scenario_id?: unknown; salesman_name?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Body request harus berupa JSON.", 400);
  }

  const scenarioId = body.scenario_id;
  if (!isValidId(scenarioId)) {
    return jsonError("scenario_id tidak valid.", 400);
  }

  const rawName = typeof body.salesman_name === "string" ? body.salesman_name.trim() : "";

  try {
    const supabase = getSupabaseAdmin();

    const [user, scenarioRes] = await Promise.all([
      getAuthUser(),
      supabase
        .from("scenarios")
        .select("id, title, description, customer_name, is_active")
        .eq("id", String(scenarioId))
        .maybeSingle(),
    ]);

    if (!user) return jsonError("Silakan masuk terlebih dahulu.", 401);

    const { data: scenario, error: scenarioError } = scenarioRes;
    if (scenarioError) throw scenarioError;
    if (!scenario || !scenario.is_active) {
      return jsonError("Skenario tidak ditemukan atau sudah tidak aktif.", 404);
    }

    // sessions.user_id → FK ke profiles.id, jadi pastikan baris profil ada.
    const profile = (await getProfile(user.id)) ?? (await upsertProfile(user.id, { email: user.email }));
    const salesmanName = (rawName || profileDisplayName(profile, user.email)).slice(0, 80);

    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .insert({
        scenario_id: scenario.id,
        salesman_name: salesmanName,
        status: "in_progress",
        user_id: user.id,
      })
      .select("id, scenario_id, salesman_name, status")
      .single();

    if (sessionError) throw sessionError;

    const responseBody: CreateSessionResponse = {
      session: session as SessionInfo,
      scenario: {
        id: scenario.id,
        title: scenario.title,
        description: scenario.description,
        customer_name: scenario.customer_name,
      } as ScenarioSummary,
    };
    return jsonOk(responseBody, 201);
  } catch (err) {
    console.error("[POST /api/sessions]", err);
    return jsonError(`Gagal membuat sesi: ${errorMessage(err)}`, 500);
  }
}

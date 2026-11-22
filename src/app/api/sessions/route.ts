import { getSupabaseAdmin } from "@/lib/supabase-server";
import { errorMessage, isValidId, jsonError, jsonOk } from "@/lib/api-utils";
import type { CreateSessionResponse, ScenarioSummary, SessionInfo } from "@/lib/types";

// POST /api/sessions — membuat sesi latihan baru untuk skenario terpilih.
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
  const salesmanName = rawName ? rawName.slice(0, 80) : null;

  try {
    const supabase = getSupabaseAdmin();

    const { data: scenario, error: scenarioError } = await supabase
      .from("scenarios")
      .select("id, title, description, customer_name, is_active")
      .eq("id", String(scenarioId))
      .maybeSingle();

    if (scenarioError) throw scenarioError;
    if (!scenario || !scenario.is_active) {
      return jsonError("Skenario tidak ditemukan atau sudah tidak aktif.", 404);
    }

    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .insert({
        scenario_id: scenario.id,
        salesman_name: salesmanName,
        status: "in_progress",
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

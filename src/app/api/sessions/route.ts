import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getAuthUser } from "@/lib/supabase/server-auth";
import { getProfile, profileDisplayName, upsertProfile } from "@/lib/profiles";
import { errorMessage, jsonError, jsonOk } from "@/lib/api-utils";
import { getActiveProduct, isProductId } from "@/lib/mastery";
import { DEFAULT_CUSTOMER_VOICE, resolveTtsSpeed, resolveTtsVoice } from "@/lib/openai-server";
import {
  SCENARIO_FOCUSES,
  checkCustomerUnlocked,
  getActiveCustomer,
  isChallengeMode,
  isScenarioFocus,
} from "@/lib/simulation";
import type { CreateSessionResponse, SessionInfo } from "@/lib/types";

// POST /api/sessions — buat sesi simulasi untuk produk + pelanggan + fokus skenario, terikat ke user yang login.
export async function POST(request: Request) {
  let body: {
    own_product_id?: unknown;
    customer_id?: unknown;
    scenario_focus?: unknown;
    challenge_mode?: unknown;
    salesman_name?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return jsonError("Body request harus berupa JSON.", 400);
  }

  if (!isProductId(body.own_product_id)) return jsonError("Pilih produk terlebih dahulu.", 400);
  if (!isProductId(body.customer_id)) return jsonError("Pilih profil pelanggan terlebih dahulu.", 400);
  if (!isScenarioFocus(body.scenario_focus)) return jsonError("Pilih fokus skenario terlebih dahulu.", 400);
  const challengeMode = body.challenge_mode == null ? "standard" : body.challenge_mode;
  if (!isChallengeMode(challengeMode)) return jsonError("Tingkat tantangan tidak valid.", 400);
  const rawName = typeof body.salesman_name === "string" ? body.salesman_name.trim() : "";
  const focus = body.scenario_focus;

  try {
    const [user, product, customer] = await Promise.all([
      getAuthUser(),
      getActiveProduct(body.own_product_id),
      getActiveCustomer(body.customer_id),
    ]);
    if (!user) return jsonError("Silakan masuk terlebih dahulu.", 401);
    if (!product) return jsonError("Produk tidak ditemukan atau tidak aktif.", 404);
    if (!customer) return jsonError("Profil pelanggan tidak ditemukan atau tidak aktif.", 404);

    // Aturan wajib → opsional divalidasi di server (bukan hanya di UI).
    const unlock = await checkCustomerUnlocked(user.id, customer);
    if (!unlock.unlocked) {
      return jsonError(
        `Profil ${customer.customer_code} masih terkunci. Luluskan dulu profil wajib: ${unlock.pending.join(", ")}.`,
        403
      );
    }

    // sessions.user_id → FK ke profiles.id
    const profile = (await getProfile(user.id)) ?? (await upsertProfile(user.id, { email: user.email }));
    const salesmanName = (rawName || profileDisplayName(profile, user.email)).slice(0, 80);

    const { data: session, error: sessionError } = await getSupabaseAdmin()
      .from("sessions")
      .insert({
        user_id: user.id,
        own_product_id: product.id,
        customer_id: customer.id,
        scenario_focus: focus,
        challenge_mode: challengeMode,
        salesman_name: salesmanName,
        status: "in_progress",
      })
      .select("id, salesman_name, status")
      .single();
    if (sessionError) throw sessionError;

    const responseBody: CreateSessionResponse = {
      session: session as SessionInfo,
      context: {
        title: `${SCENARIO_FOCUSES[focus].short} · ${product.name}`,
        product: { id: product.id, product_code: product.product_code, name: product.name, brand: product.brand },
        customer: {
          id: customer.id,
          customer_code: customer.customer_code,
          owner_name: customer.owner_name,
          store_name: customer.store_name,
          store_scale: customer.store_scale,
          area_name: customer.area_name,
          is_mandatory: customer.is_mandatory,
          tts_voice: resolveTtsVoice(customer.tts_voice, DEFAULT_CUSTOMER_VOICE),
          tts_speed: resolveTtsSpeed(customer.tts_speed),
        },
        focus: { id: focus, label: SCENARIO_FOCUSES[focus].label },
        challenge_mode: challengeMode,
        description: SCENARIO_FOCUSES[focus].description,
        counterpart_name: customer.owner_name,
      },
    };
    return jsonOk(responseBody, 201);
  } catch (err) {
    console.error("[POST /api/sessions]", err);
    return jsonError(`Gagal membuat sesi: ${errorMessage(err)}`, 500);
  }
}

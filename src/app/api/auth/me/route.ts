import { getAuthUser } from "@/lib/supabase/server-auth";
import { getProfile, isTelegramInternalEmail, profileDisplayName, upsertProfile } from "@/lib/profiles";
import { errorMessage, jsonError, jsonOk } from "@/lib/api-utils";
import type { MeResponse } from "@/lib/types";

// GET /api/auth/me — identitas pengguna yang sedang login + profilnya.
export async function GET() {
  const user = await getAuthUser();
  if (!user) return jsonError("Belum login.", 401);

  try {
    const profile = (await getProfile(user.id)) ?? (await upsertProfile(user.id, { email: user.email }));
    const body: MeResponse = {
      user: {
        id: user.id,
        email: isTelegramInternalEmail(user.email) ? null : user.email,
        full_name: profile.full_name,
        telegram_username: profile.telegram_username,
        telegram_chat_id: profile.telegram_chat_id,
        display_name: profileDisplayName(profile, user.email),
        login_method: isTelegramInternalEmail(user.email) ? "telegram" : "email",
      },
    };
    return jsonOk(body);
  } catch (err) {
    console.error("[GET /api/auth/me]", err);
    return jsonError(`Gagal memuat profil: ${errorMessage(err)}`, 500);
  }
}

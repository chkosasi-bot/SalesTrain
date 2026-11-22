import { createSupabaseAuthClient } from "@/lib/supabase/server-auth";
import { getSiteUrl, safeNextPath } from "@/lib/site-url";
import { errorMessage, jsonError, jsonOk } from "@/lib/api-utils";
import { isTelegramInternalEmail } from "@/lib/profiles";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// POST /api/auth/email — kirim Magic Link via Supabase Auth (signInWithOtp).
export async function POST(request: Request) {
  let body: { email?: unknown; full_name?: unknown; next?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Body request harus berupa JSON.", 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email) || email.length > 254) return jsonError("Alamat email tidak valid.", 400);
  if (isTelegramInternalEmail(email)) return jsonError("Gunakan tab Telegram untuk akun Telegram.", 400);

  const fullName = typeof body.full_name === "string" ? body.full_name.trim().slice(0, 120) : "";
  const next = safeNextPath(typeof body.next === "string" ? body.next : null);

  const callbackUrl = new URL("/auth/callback", getSiteUrl(request));
  if (next !== "/") callbackUrl.searchParams.set("next", next);

  try {
    const supabase = await createSupabaseAuthClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callbackUrl.toString(),
        shouldCreateUser: true,
        data: fullName ? { full_name: fullName } : undefined,
      },
    });

    if (error) {
      if (error.status === 429 || /rate limit/i.test(error.message)) {
        return jsonError("Terlalu banyak permintaan. Tunggu sebentar sebelum meminta tautan baru.", 429);
      }
      throw error;
    }
    return jsonOk({ ok: true });
  } catch (err) {
    console.error("[POST /api/auth/email]", err);
    return jsonError(`Gagal mengirim tautan masuk: ${errorMessage(err)}`, 500);
  }
}

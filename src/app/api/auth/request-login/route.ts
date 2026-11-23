import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getPublicSupabaseEnv } from "@/lib/supabase/server-auth";
import { errorMessage, jsonError, jsonOk } from "@/lib/api-utils";
import { getSiteUrl } from "@/lib/site-url";
import { isTelegramInternalEmail } from "@/lib/profiles";
import { CHAT_ID_RE, TelegramApiError, canUseInlineButton, escapeHtml, sendTelegramMessage } from "@/lib/telegram";
import {
  LOGIN_REQUEST_TTL_MINUTES,
  createVerifySecret,
  matchCodeFor,
  setPollCookie,
  type LoginChannel,
} from "@/lib/login-requests";
import type { RequestLoginResponse } from "@/lib/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const COOLDOWN_SECONDS = 45;
const MAX_PER_HOUR = 6;

/**
 * Klien Supabase Auth tanpa PKCE (implicit flow) khusus untuk MENGIRIM email magic link.
 * Setelah tautan diklik, Supabase mengarahkan ke /auth/confirm dengan token di fragment URL,
 * sehingga verifikasi berhasil di perangkat mana pun — tidak butuh code verifier dari laptop.
 */
function createEmailSenderClient() {
  const { url, anonKey } = getPublicSupabaseEnv();
  return createClient(url, anonKey, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// POST /api/auth/request-login — buat tiket login lintas perangkat & kirim tautan konfirmasi.
export async function POST(request: Request) {
  let body: { channel?: unknown; identifier?: unknown; full_name?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Body request harus berupa JSON.", 400);
  }

  const channel = body.channel as LoginChannel;
  if (channel !== "email" && channel !== "telegram") return jsonError("channel harus 'email' atau 'telegram'.", 400);

  let identifier = typeof body.identifier === "string" ? body.identifier.trim() : String(body.identifier ?? "").trim();
  if (channel === "email") {
    identifier = identifier.toLowerCase();
    if (!EMAIL_RE.test(identifier) || identifier.length > 254) return jsonError("Alamat email tidak valid.", 400);
    if (isTelegramInternalEmail(identifier)) return jsonError("Gunakan tab Telegram untuk akun Telegram.", 400);
  } else {
    identifier = identifier.replace(/\s+/g, "");
    if (!CHAT_ID_RE.test(identifier)) {
      return jsonError("Telegram Chat ID harus berupa angka. Kirim /start ke bot untuk melihatnya.", 400);
    }
  }
  const fullName = typeof body.full_name === "string" ? body.full_name.trim().slice(0, 120) || null : null;

  const supabase = getSupabaseAdmin();

  try {
    // Batasi frekuensi per identitas (mencegah spam email/Telegram ke orang lain).
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recent, error: recentError } = await supabase
      .from("login_requests")
      .select("created_at")
      .eq("channel", channel)
      .eq("identifier", identifier)
      .gte("created_at", hourAgo)
      .order("created_at", { ascending: false });
    if (recentError) throw recentError;
    if (recent && recent.length > 0) {
      const waitSec = Math.ceil((new Date(recent[0].created_at).getTime() + COOLDOWN_SECONDS * 1000 - Date.now()) / 1000);
      if (waitSec > 0) return jsonError(`Tunggu ${waitSec} detik sebelum meminta tautan baru.`, 429);
      if (recent.length >= MAX_PER_HOUR) return jsonError("Terlalu banyak permintaan tautan. Coba lagi dalam satu jam.", 429);
    }

    // Tandai tiket pending lama milik identitas ini sebagai kedaluwarsa (hanya tautan terbaru yang berlaku).
    await supabase
      .from("login_requests")
      .update({ status: "expired" })
      .eq("channel", channel)
      .eq("identifier", identifier)
      .eq("status", "pending");

    const { secret, hash } = createVerifySecret();
    const expiresAt = new Date(Date.now() + LOGIN_REQUEST_TTL_MINUTES * 60 * 1000);
    const { data: row, error: insertError } = await supabase
      .from("login_requests")
      .insert({ channel, identifier, full_name: fullName, verify_secret: hash, status: "pending", expires_at: expiresAt.toISOString() })
      .select("id")
      .single();
    if (insertError) throw insertError;

    const confirmUrl = new URL("/auth/confirm", getSiteUrl(request));
    confirmUrl.searchParams.set("req_id", row.id);
    confirmUrl.searchParams.set("secret", secret);
    const confirmLink = confirmUrl.toString();
    const matchCode = matchCodeFor(row.id);

    try {
      if (channel === "telegram") {
        await sendTelegramMessage(
          identifier,
          "🔐 <b>Konfirmasi masuk SalesTrain</b>\n\n" +
            `Kode pencocokan: <b>${matchCode}</b> (harus sama dengan yang tampil di layar login Anda).\n\n` +
            `Ketuk tautan berikut untuk mengonfirmasi (berlaku ${LOGIN_REQUEST_TTL_MINUTES} menit, sekali pakai):\n` +
            `${escapeHtml(confirmLink)}\n\n` +
            "Abaikan pesan ini jika Anda tidak sedang mencoba masuk.",
          {
            html: true,
            buttonUrl: canUseInlineButton(confirmLink) ? { text: "Konfirmasi Masuk", url: confirmLink } : undefined,
          }
        );
      } else {
        const { error } = await createEmailSenderClient().auth.signInWithOtp({
          email: identifier,
          options: {
            emailRedirectTo: confirmLink,
            shouldCreateUser: true,
            data: fullName ? { full_name: fullName } : undefined,
          },
        });
        if (error) throw error;
      }
    } catch (err) {
      // Tautan tidak terkirim → hapus tiket agar tidak ada tiket aktif yatim.
      await supabase.from("login_requests").delete().eq("id", row.id);
      if (err instanceof TelegramApiError && (err.status === 400 || err.status === 403)) {
        return jsonError(
          "Bot tidak dapat mengirim pesan ke Chat ID ini. Pastikan Chat ID benar dan Anda sudah membuka bot lalu mengirim /start.",
          400
        );
      }
      const e = err as { status?: number; message?: string };
      if (channel === "email" && (e.status === 429 || /rate limit/i.test(e.message ?? ""))) {
        return jsonError("Batas pengiriman email tercapai. Tunggu beberapa saat lalu coba lagi.", 429);
      }
      throw err;
    }

    // Ikat tiket ke browser ini (cookie httpOnly) agar hanya browser ini yang bisa mengambil sesinya.
    await setPollCookie(row.id);

    const responseBody: RequestLoginResponse = {
      requestId: row.id,
      matchCode,
      expiresAt: expiresAt.toISOString(),
      channel,
    };
    return jsonOk(responseBody, 201);
  } catch (err) {
    console.error("[POST /api/auth/request-login]", errorMessage(err));
    return jsonError(`Gagal mengirim tautan masuk: ${errorMessage(err)}`, 500);
  }
}

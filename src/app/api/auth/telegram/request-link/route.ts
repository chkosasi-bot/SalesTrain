import { getSupabaseAdmin } from "@/lib/supabase-server";
import { errorMessage, jsonError, jsonOk } from "@/lib/api-utils";
import { getSiteUrl } from "@/lib/site-url";
import {
  CHAT_ID_RE,
  MAGIC_LINK_TTL_MINUTES,
  TelegramApiError,
  canUseInlineButton,
  createMagicToken,
  escapeHtml,
  sendTelegramMessage,
} from "@/lib/telegram";

const COOLDOWN_SECONDS = 45;
const MAX_PER_HOUR = 6;

// POST /api/auth/telegram/request-link — buat token sekali pakai & kirim tautan login via bot.
export async function POST(request: Request) {
  let body: { telegram_chat_id?: unknown; full_name?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Body request harus berupa JSON.", 400);
  }

  const chatId = String(body.telegram_chat_id ?? "").trim();
  if (!CHAT_ID_RE.test(chatId)) {
    return jsonError("Telegram Chat ID harus berupa angka. Kirim /start ke bot untuk melihatnya.", 400);
  }
  const fullName = typeof body.full_name === "string" ? body.full_name.trim().slice(0, 120) || null : null;

  const supabase = getSupabaseAdmin();

  try {
    // Batasi frekuensi agar bot tidak bisa dipakai untuk spam ke Chat ID orang lain.
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recent, error: recentError } = await supabase
      .from("telegram_magic_links")
      .select("created_at")
      .eq("telegram_chat_id", chatId)
      .gte("created_at", hourAgo)
      .order("created_at", { ascending: false });
    if (recentError) throw recentError;

    if (recent && recent.length > 0) {
      const lastMs = new Date(recent[0].created_at).getTime();
      const waitSec = Math.ceil((lastMs + COOLDOWN_SECONDS * 1000 - Date.now()) / 1000);
      if (waitSec > 0) return jsonError(`Tunggu ${waitSec} detik sebelum meminta tautan baru.`, 429);
      if (recent.length >= MAX_PER_HOUR) {
        return jsonError("Terlalu banyak permintaan tautan. Coba lagi dalam satu jam.", 429);
      }
    }

    const { token, tokenHash } = createMagicToken();
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MINUTES * 60 * 1000);

    const { data: row, error: insertError } = await supabase
      .from("telegram_magic_links")
      .insert({ token: tokenHash, telegram_chat_id: chatId, full_name: fullName, expires_at: expiresAt.toISOString() })
      .select("id")
      .single();
    if (insertError) throw insertError;

    const link = new URL("/auth/telegram", getSiteUrl(request));
    link.searchParams.set("token", token);
    const linkStr = link.toString();

    try {
      await sendTelegramMessage(
        chatId,
        "🔐 <b>Tautan masuk SalesTrain</b>\n\n" +
          `Ketuk tautan berikut untuk masuk (berlaku ${MAGIC_LINK_TTL_MINUTES} menit, sekali pakai):\n` +
          `${escapeHtml(linkStr)}\n\n` +
          "Abaikan pesan ini jika Anda tidak meminta tautan masuk.",
        {
          html: true,
          buttonUrl: canUseInlineButton(linkStr) ? { text: "Masuk ke SalesTrain", url: linkStr } : undefined,
        }
      );
    } catch (err) {
      // Token tidak terkirim → hapus agar tidak ada token aktif yatim.
      await supabase.from("telegram_magic_links").delete().eq("id", row.id);
      if (err instanceof TelegramApiError && (err.status === 400 || err.status === 403)) {
        return jsonError(
          "Bot tidak dapat mengirim pesan ke Chat ID ini. Pastikan Chat ID benar dan Anda sudah membuka bot lalu mengirim /start.",
          400
        );
      }
      throw err;
    }

    return jsonOk({ ok: true, expires_in_minutes: MAGIC_LINK_TTL_MINUTES });
  } catch (err) {
    console.error("[POST /api/auth/telegram/request-link]", errorMessage(err));
    return jsonError(`Gagal mengirim tautan via Telegram: ${errorMessage(err)}`, 500);
  }
}

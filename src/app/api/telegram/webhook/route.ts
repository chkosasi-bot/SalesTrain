import { errorMessage } from "@/lib/api-utils";
import { escapeHtml, isValidWebhookSecret, sendTelegramMessage } from "@/lib/telegram";

interface TelegramUpdate {
  update_id?: number;
  message?: {
    text?: string;
    chat?: { id: number; type?: string };
    from?: { first_name?: string; username?: string };
  };
}

const ok = () => Response.json({ ok: true });

// POST /api/telegram/webhook — menerima update dari Telegram Bot API.
export async function POST(request: Request) {
  if (!isValidWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"))) {
    return Response.json({ ok: false }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    return ok();
  }

  const message = update.message;
  const chatId = message?.chat?.id;
  const text = message?.text?.trim() ?? "";
  if (!chatId || !text) return ok();

  // Bot hanya melayani chat pribadi (Chat ID grup tidak bisa dipakai untuk login).
  if (message.chat?.type && message.chat.type !== "private") return ok();

  try {
    if (/^\/start(@\w+)?(\s|$)/i.test(text) || /^\/(id|chatid)(@\w+)?$/i.test(text)) {
      const name = message.from?.first_name ? ` ${escapeHtml(message.from.first_name)}` : "";
      await sendTelegramMessage(
        chatId,
        `Halo${name}! Telegram Chat ID Anda adalah: <code>${chatId}</code>\n\n` +
          "Masukkan angka ini di halaman login SalesTrain untuk menerima tautan masuk.",
        { html: true }
      );
    } else {
      await sendTelegramMessage(
        chatId,
        `Kirim /start untuk melihat Telegram Chat ID Anda.\nChat ID Anda: <code>${chatId}</code>`,
        { html: true }
      );
    }
  } catch (err) {
    // Tetap balas 200 agar Telegram tidak mengirim ulang update yang sama berkali-kali.
    console.error("[telegram/webhook] gagal membalas:", errorMessage(err));
  }

  return ok();
}

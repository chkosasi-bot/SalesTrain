import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const MAGIC_LINK_TTL_MINUTES = 15;

/** Chat ID pribadi Telegram berupa bilangan bulat positif. */
export const CHAT_ID_RE = /^\d{4,20}$/;

/** Token mentah hanya dikirim ke pengguna; di database disimpan hash SHA-256-nya. */
export function createMagicToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashMagicToken(token) };
}

export function hashMagicToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isWellFormedToken(token: string | null): token is string {
  return !!token && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function botToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN belum diset.");
  return token;
}

export class TelegramApiError extends Error {
  constructor(
    public status: number,
    public description: string
  ) {
    super(`Telegram API ${status}: ${description}`);
  }
}

async function callTelegram<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!res.ok || !data?.ok) {
    throw new TelegramApiError(res.status, data?.description ?? "Unknown error");
  }
  return data.result as T;
}

export interface SendMessageOptions {
  html?: boolean;
  buttonUrl?: { text: string; url: string };
}

export async function sendTelegramMessage(chatId: string | number, text: string, opts: SendMessageOptions = {}) {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    // Pratinjau tautan dimatikan agar crawler Telegram tidak "membuka" tautan sekali pakai.
    link_preview_options: { is_disabled: true },
  };
  if (opts.html) payload.parse_mode = "HTML";
  if (opts.buttonUrl) {
    payload.reply_markup = { inline_keyboard: [[{ text: opts.buttonUrl.text, url: opts.buttonUrl.url }]] };
  }
  return callTelegram<{ message_id: number }>("sendMessage", payload);
}

export interface TelegramChatInfo {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export async function getTelegramChat(chatId: string | number): Promise<TelegramChatInfo | null> {
  try {
    return await callTelegram<TelegramChatInfo>("getChat", { chat_id: chatId });
  } catch {
    return null;
  }
}

/** Tombol inline Telegram menolak URL http/localhost — tombol hanya dipakai untuk URL https publik. */
export function canUseInlineButton(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !["localhost", "127.0.0.1"].includes(u.hostname);
  } catch {
    return false;
  }
}

/** Validasi header X-Telegram-Bot-Api-Secret-Token bila TELEGRAM_WEBHOOK_SECRET diset. */
export function isValidWebhookSecret(header: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return true;
  if (!header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

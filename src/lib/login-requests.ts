import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "./supabase-server";

/**
 * Tiket login lintas perangkat (public.login_requests).
 *
 * - verify_secret  : rahasia di dalam tautan (email/Telegram). Disimpan sebagai hash SHA-256.
 * - poll token     : HMAC(req_id) yang hanya disimpan di cookie httpOnly browser peminta (laptop).
 *                    Tanpa cookie ini, polling ditolak — jadi siapa pun yang hanya memegang tautan
 *                    (HP, pemindai email) tidak bisa "mengambil" sesi laptop.
 * - match code     : 2 digit turunan HMAC(req_id), tampil di laptop & HP agar pengguna bisa
 *                    memastikan sedang mengonfirmasi permintaan miliknya sendiri.
 */

export const LOGIN_REQUEST_TTL_MINUTES = 15;
/** Batas waktu laptop mengambil sesi setelah HP mengonfirmasi. */
export const CONSUME_WINDOW_MINUTES = 10;
export const POLL_COOKIE = "st_login_req";

export type LoginChannel = "email" | "telegram";
export type LoginStatus = "pending" | "verified" | "consumed" | "expired";

export interface LoginRequestRow {
  id: string;
  channel: LoginChannel;
  identifier: string;
  full_name: string | null;
  verify_secret: string;
  status: LoginStatus;
  verified_user_id: string | null;
  verified_email: string | null;
  expires_at: string;
  verified_at: string | null;
  created_at: string;
}

const ROW_COLUMNS =
  "id, channel, identifier, full_name, verify_secret, status, verified_user_id, verified_email, expires_at, verified_at, created_at";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function hmacKey(): string {
  const key = process.env.LOGIN_REQUEST_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("LOGIN_REQUEST_SECRET / SUPABASE_SERVICE_ROLE_KEY belum diset.");
  return key;
}

function hmac(purpose: string, reqId: string): string {
  return createHmac("sha256", hmacKey()).update(`${purpose}:${reqId}`).digest("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function createVerifySecret(): { secret: string; hash: string } {
  const secret = randomBytes(32).toString("base64url");
  return { secret, hash: sha256(secret) };
}

export function isWellFormedSecret(s: unknown): s is string {
  return typeof s === "string" && /^[A-Za-z0-9_-]{43}$/.test(s);
}

export function verifySecretMatches(row: Pick<LoginRequestRow, "verify_secret">, secret: string): boolean {
  return safeEqual(row.verify_secret, sha256(secret));
}

export function matchCodeFor(reqId: string): string {
  const n = createHmac("sha256", hmacKey()).update(`code:${reqId}`).digest().readUInt32BE(0);
  return String(10 + (n % 90));
}

// ---------- Cookie pengikat browser peminta ----------

export async function setPollCookie(reqId: string) {
  const store = await cookies();
  store.set(POLL_COOKIE, `${reqId}.${hmac("poll", reqId)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: (LOGIN_REQUEST_TTL_MINUTES + CONSUME_WINDOW_MINUTES) * 60,
  });
}

export async function clearPollCookie() {
  const store = await cookies();
  store.set(POLL_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

/** True bila browser ini adalah browser yang membuat tiket `reqId`. */
export async function isRequestingBrowser(reqId: string): Promise<boolean> {
  const value = (await cookies()).get(POLL_COOKIE)?.value;
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot < 0) return false;
  const id = value.slice(0, dot);
  const token = value.slice(dot + 1);
  return id === reqId && safeEqual(token, hmac("poll", reqId));
}

// ---------- Akses data ----------

export async function getLoginRequest(id: string): Promise<LoginRequestRow | null> {
  const { data, error } = await getSupabaseAdmin().from("login_requests").select(ROW_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as LoginRequestRow | null) ?? null;
}

export function isExpired(row: Pick<LoginRequestRow, "expires_at">, now = Date.now()): boolean {
  return new Date(row.expires_at).getTime() <= now;
}

export function canStillConsume(row: Pick<LoginRequestRow, "verified_at">, now = Date.now()): boolean {
  return !!row.verified_at && new Date(row.verified_at).getTime() + CONSUME_WINDOW_MINUTES * 60_000 > now;
}

/** Tandai tiket kedaluwarsa (hanya bila masih pending). */
export async function markExpired(id: string) {
  await getSupabaseAdmin().from("login_requests").update({ status: "expired" }).eq("id", id).eq("status", "pending");
}

/** pending → verified secara atomik. Mengembalikan baris bila berhasil. */
export async function markVerified(id: string, userId: string, authEmail: string): Promise<LoginRequestRow | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("login_requests")
    .update({ status: "verified", verified_user_id: userId, verified_email: authEmail, verified_at: nowIso })
    .eq("id", id)
    .eq("status", "pending")
    .gt("expires_at", nowIso)
    .select(ROW_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return (data as LoginRequestRow | null) ?? null;
}

/** verified → consumed secara atomik (hanya satu browser yang bisa mengambil sesi). */
export async function markConsumed(id: string): Promise<LoginRequestRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("login_requests")
    .update({ status: "consumed" })
    .eq("id", id)
    .eq("status", "verified")
    .select(ROW_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return (data as LoginRequestRow | null) ?? null;
}

/** Kembalikan consumed → verified bila pembuatan sesi gagal, agar laptop bisa mencoba lagi. */
export async function revertConsumed(id: string) {
  await getSupabaseAdmin().from("login_requests").update({ status: "verified" }).eq("id", id).eq("status", "consumed");
}

export function maskIdentifier(channel: LoginChannel, identifier: string): string {
  if (channel === "telegram") {
    return identifier.length <= 4 ? identifier : `${"•".repeat(Math.max(0, identifier.length - 4))}${identifier.slice(-4)}`;
  }
  const [local, domain] = identifier.split("@");
  if (!domain) return identifier;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}

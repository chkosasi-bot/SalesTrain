import { createClient, type User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { getPublicSupabaseEnv } from "@/lib/supabase/server-auth";
import { errorMessage, jsonError, jsonOk } from "@/lib/api-utils";
import { createCookieSessionForEmail, ensureEmailUserProfile, ensureTelegramUser } from "@/lib/auth-session";
import {
  canStillConsume,
  clearPollCookie,
  getLoginRequest,
  isExpired,
  isRequestingBrowser,
  isUuid,
  isWellFormedSecret,
  markConsumed,
  markExpired,
  markVerified,
  maskIdentifier,
  matchCodeFor,
  revertConsumed,
  verifySecretMatches,
  type LoginRequestRow,
} from "@/lib/login-requests";
import type { ConfirmInfoResponse, ConfirmResultResponse } from "@/lib/types";

class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

async function loadAndCheck(reqId: unknown, secret: unknown): Promise<LoginRequestRow> {
  if (!isUuid(reqId) || !isWellFormedSecret(secret)) throw new HttpError(400, "Tautan konfirmasi tidak valid.");
  const row = await getLoginRequest(reqId);
  if (!row || !verifySecretMatches(row, secret)) throw new HttpError(404, "Tautan konfirmasi tidak valid.");
  return row;
}

/** Bukti kepemilikan email: access_token (implicit flow) atau token_hash (template email kustom). */
async function verifyEmailProof(accessToken: unknown, tokenHash: unknown): Promise<User> {
  const admin = getSupabaseAdmin();

  if (typeof accessToken === "string" && accessToken.length > 20) {
    const { data, error } = await admin.auth.getUser(accessToken);
    if (error || !data.user) throw new HttpError(401, "Tautan email sudah kedaluwarsa. Minta tautan baru dari layar login.");
    // Sesi sementara di HP tidak dibutuhkan — cabut agar tidak tertinggal.
    await admin.auth.admin.signOut(accessToken, "local").catch(() => undefined);
    return data.user;
  }

  if (typeof tokenHash === "string" && tokenHash.length > 10) {
    const { url, anonKey } = getPublicSupabaseEnv();
    const temp = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await temp.auth.verifyOtp({ type: "email", token_hash: tokenHash });
    if (error || !data.user) throw new HttpError(401, "Tautan email sudah kedaluwarsa. Minta tautan baru dari layar login.");
    if (data.session) await admin.auth.admin.signOut(data.session.access_token, "local").catch(() => undefined);
    return data.user;
  }

  throw new HttpError(400, "Tautan email tidak lengkap atau sudah dipakai. Minta tautan baru dari layar login.");
}

async function signInThisBrowser(row: LoginRequestRow): Promise<boolean> {
  const consumed = await markConsumed(row.id);
  if (!consumed?.verified_email) return false;
  try {
    await createCookieSessionForEmail(consumed.verified_email);
    await clearPollCookie();
    return true;
  } catch (err) {
    await revertConsumed(row.id);
    throw err;
  }
}

// GET /api/auth/confirm-login?req_id&secret — info tiket untuk halaman konfirmasi (tanpa mengubah apa pun).
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const row = await loadAndCheck(url.searchParams.get("req_id"), url.searchParams.get("secret"));
    let status = row.status;
    if (status === "pending" && isExpired(row)) {
      await markExpired(row.id);
      status = "expired";
    }
    const body: ConfirmInfoResponse = {
      channel: row.channel,
      identifier: maskIdentifier(row.channel, row.identifier),
      matchCode: matchCodeFor(row.id),
      status,
      sameDevice: await isRequestingBrowser(row.id),
      expiresAt: row.expires_at,
    };
    return jsonOk(body);
  } catch (err) {
    if (err instanceof HttpError) return jsonError(err.message, err.status);
    console.error("[GET /api/auth/confirm-login]", errorMessage(err));
    return jsonError("Gagal memuat permintaan masuk.", 500);
  }
}

// POST /api/auth/confirm-login — konfirmasi tiket dari perangkat mana pun (mis. HP).
export async function POST(request: Request) {
  let body: { req_id?: unknown; secret?: unknown; access_token?: unknown; token_hash?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Body request harus berupa JSON.", 400);
  }

  try {
    let row = await loadAndCheck(body.req_id, body.secret);
    const sameDevice = await isRequestingBrowser(row.id);

    if (row.status === "consumed") throw new HttpError(409, "Permintaan masuk ini sudah digunakan.");
    if (row.status === "expired" || (row.status === "pending" && isExpired(row))) {
      await markExpired(row.id);
      throw new HttpError(410, "Tautan sudah kedaluwarsa. Minta tautan baru dari layar login.");
    }

    if (row.status === "pending") {
      let userId: string;
      let authEmail: string;

      if (row.channel === "telegram") {
        // Bukti: tautan rahasia hanya dikirim ke chat Telegram pemilik Chat ID.
        const user = await ensureTelegramUser(row.identifier, row.full_name);
        userId = user.id;
        authEmail = user.authEmail;
      } else {
        const user = await verifyEmailProof(body.access_token, body.token_hash);
        if ((user.email ?? "").toLowerCase() !== row.identifier.toLowerCase()) {
          throw new HttpError(403, "Tautan email ini bukan untuk permintaan masuk tersebut.");
        }
        const metaName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;
        await ensureEmailUserProfile(user.id, row.identifier, row.full_name ?? metaName);
        userId = user.id;
        authEmail = user.email ?? row.identifier;
      }

      const verified = await markVerified(row.id, userId, authEmail);
      if (!verified) {
        const fresh = await getLoginRequest(row.id);
        if (!fresh || fresh.status !== "verified") throw new HttpError(409, "Permintaan masuk ini sudah tidak aktif.");
        row = fresh;
      } else {
        row = verified;
      }
    }

    // Browser yang sama dengan peminta → langsung masuk di sini.
    if (sameDevice && row.status === "verified" && canStillConsume(row)) {
      if (await signInThisBrowser(row)) {
        const res: ConfirmResultResponse = { result: "signed_in" };
        return jsonOk(res);
      }
    }

    const res: ConfirmResultResponse = { result: "verified" };
    return jsonOk(res);
  } catch (err) {
    if (err instanceof HttpError) return jsonError(err.message, err.status);
    console.error("[POST /api/auth/confirm-login]", errorMessage(err));
    return jsonError(`Gagal mengonfirmasi: ${errorMessage(err)}`, 500);
  }
}

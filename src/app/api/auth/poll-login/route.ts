import { errorMessage, jsonError, jsonOk } from "@/lib/api-utils";
import { createCookieSessionForEmail } from "@/lib/auth-session";
import {
  canStillConsume,
  clearPollCookie,
  getLoginRequest,
  isExpired,
  isRequestingBrowser,
  isUuid,
  markConsumed,
  markExpired,
  revertConsumed,
} from "@/lib/login-requests";
import type { PollLoginResponse } from "@/lib/types";

const respond = (body: PollLoginResponse) => jsonOk(body);

// GET /api/auth/poll-login?req_id=... — dipanggil laptop tiap 2,5 detik.
// Begitu tiket "verified", sesi Supabase dibuat langsung di browser ini (cookie) dan tiket menjadi "consumed".
export async function GET(request: Request) {
  const reqId = new URL(request.url).searchParams.get("req_id");
  if (!isUuid(reqId)) return jsonError("req_id tidak valid.", 400);

  // Hanya browser yang membuat tiket (punya cookie httpOnly pengikat) yang boleh mengambil sesi.
  if (!(await isRequestingBrowser(reqId))) {
    return jsonError("Permintaan masuk ini tidak dibuat dari browser ini. Silakan minta tautan baru.", 403);
  }

  try {
    const row = await getLoginRequest(reqId);
    if (!row) return respond({ status: "expired" });

    if (row.status === "pending") {
      if (isExpired(row)) {
        await markExpired(row.id);
        await clearPollCookie();
        return respond({ status: "expired" });
      }
      return respond({ status: "pending", expiresAt: row.expires_at });
    }

    if (row.status === "verified") {
      if (!canStillConsume(row)) {
        await clearPollCookie();
        return respond({ status: "expired" });
      }
      const consumed = await markConsumed(row.id);
      if (!consumed?.verified_email) return respond({ status: "consumed" });
      try {
        await createCookieSessionForEmail(consumed.verified_email);
      } catch (err) {
        await revertConsumed(row.id);
        throw err;
      }
      await clearPollCookie();
      return respond({ status: "signed_in" });
    }

    await clearPollCookie();
    return respond({ status: row.status === "consumed" ? "consumed" : "expired" });
  } catch (err) {
    console.error("[GET /api/auth/poll-login]", errorMessage(err));
    return jsonError("Gagal memeriksa status masuk.", 500);
  }
}

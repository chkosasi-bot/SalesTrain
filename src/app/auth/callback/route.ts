import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseAuthClient } from "@/lib/supabase/server-auth";
import { upsertProfile } from "@/lib/profiles";
import { errorMessage } from "@/lib/api-utils";
import { safeNextPath } from "@/lib/site-url";

const OTP_TYPES: EmailOtpType[] = ["magiclink", "email", "signup", "invite", "recovery", "email_change"];

function redirectTo(request: Request, path: string) {
  const res = NextResponse.redirect(new URL(path, request.url));
  res.headers.set("Cache-Control", "no-store");
  return res;
}

// GET /auth/callback — menukar kode PKCE (?code=) atau token_hash (?token_hash=&type=) menjadi sesi.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(url.searchParams.get("next"));

  const providerError = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (providerError) {
    const expired = /expired|invalid/i.test(providerError);
    return redirectTo(request, `/login?error=${expired ? "link_expired" : "auth_failed"}`);
  }

  try {
    const supabase = await createSupabaseAuthClient();

    let user = null;
    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        console.warn("[auth/callback] exchangeCodeForSession:", error.message);
        // Code verifier hilang = tautan dibuka di browser/perangkat lain.
        const reason = /code verifier|verifier/i.test(error.message) ? "other_browser" : "link_expired";
        return redirectTo(request, `/login?error=${reason}`);
      }
      user = data.user;
    } else if (tokenHash && type && OTP_TYPES.includes(type)) {
      const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      if (error) {
        console.warn("[auth/callback] verifyOtp:", error.message);
        return redirectTo(request, "/login?error=link_expired");
      }
      user = data.user;
    } else {
      return redirectTo(request, "/login?error=link_invalid");
    }

    if (!user) return redirectTo(request, "/login?error=auth_failed");

    const fullName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null;
    await upsertProfile(user.id, { email: user.email ?? null, full_name: fullName });

    return redirectTo(request, next);
  } catch (err) {
    console.error("[GET /auth/callback]", errorMessage(err));
    return redirectTo(request, "/login?error=auth_failed");
  }
}

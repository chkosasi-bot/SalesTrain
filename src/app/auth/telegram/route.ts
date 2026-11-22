import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { createSupabaseAuthClient } from "@/lib/supabase/server-auth";
import { telegramInternalEmail, upsertProfile } from "@/lib/profiles";
import { getTelegramChat, hashMagicToken, isWellFormedToken } from "@/lib/telegram";
import { errorMessage } from "@/lib/api-utils";

function redirectTo(request: Request, path: string) {
  const res = NextResponse.redirect(new URL(path, request.url));
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}

/** Mencari email akun Supabase Auth untuk Chat ID ini, atau membuat akun baru. */
async function resolveAuthEmail(chatId: string, fullName: string | null, username: string | null): Promise<string> {
  const supabase = getSupabaseAdmin();

  // 1) Akun yang sudah terhubung ke Chat ID ini (mis. akun email yang kemudian menautkan Telegram).
  const { data: linked, error: linkedError } = await supabase
    .from("profiles")
    .select("id")
    .eq("telegram_chat_id", chatId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (linkedError) throw linkedError;
  if (linked) {
    const { data, error } = await supabase.auth.admin.getUserById(linked.id);
    if (!error && data.user?.email) return data.user.email;
  }

  // 2) Akun internal Telegram: <chat_id>@telegram.salestrain.local
  const email = telegramInternalEmail(chatId);
  const { error: createError } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      full_name: fullName ?? undefined,
      telegram_chat_id: chatId,
      telegram_username: username ?? undefined,
      provider: "telegram",
    },
  });
  if (createError && createError.code !== "email_exists" && !/already (been )?registered/i.test(createError.message)) {
    throw createError;
  }
  return email;
}

// GET /auth/telegram?token=... — validasi token sekali pakai lalu buat sesi Supabase standar.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!isWellFormedToken(token)) return redirectTo(request, "/login?error=link_invalid");

  const supabase = getSupabaseAdmin();
  let claimedHash: string | null = null;

  try {
    // Klaim token secara atomik: hanya berhasil bila belum dipakai & belum kedaluwarsa.
    const nowIso = new Date().toISOString();
    const { data: link, error: claimError } = await supabase
      .from("telegram_magic_links")
      .update({ used_at: nowIso })
      .eq("token", hashMagicToken(token))
      .is("used_at", null)
      .gt("expires_at", nowIso)
      .select("telegram_chat_id, full_name")
      .maybeSingle();
    if (claimError) throw claimError;

    if (!link) {
      const { data: stale } = await supabase
        .from("telegram_magic_links")
        .select("used_at")
        .eq("token", hashMagicToken(token))
        .maybeSingle();
      return redirectTo(request, `/login?error=${stale ? (stale.used_at ? "link_used" : "link_expired") : "link_invalid"}`);
    }

    claimedHash = hashMagicToken(token);
    const chatId = String(link.telegram_chat_id);
    const chat = await getTelegramChat(chatId);
    const username = chat?.username ?? null;
    const telegramName = [chat?.first_name, chat?.last_name].filter(Boolean).join(" ") || null;
    const fullName = link.full_name || null;

    const email = await resolveAuthEmail(chatId, fullName ?? telegramName, username);

    // Buat magic link di server, lalu verifikasi langsung → cookie sesi identik dengan login email.
    const { data: generated, error: generateError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (generateError) throw generateError;
    const tokenHash = generated.properties?.hashed_token;
    if (!tokenHash || !generated.user) throw new Error("generateLink tidak mengembalikan token.");

    const authClient = await createSupabaseAuthClient();
    const { data: verified, error: verifyError } = await authClient.auth.verifyOtp({
      type: "magiclink",
      token_hash: tokenHash,
    });
    if (verifyError || !verified.session) throw verifyError ?? new Error("Sesi tidak terbentuk.");
    claimedHash = null; // sesi sudah terbentuk → token resmi terpakai

    const profile = await upsertProfile(generated.user.id, {
      telegram_chat_id: chatId,
      telegram_username: username,
      full_name: fullName,
    });
    // Isi nama dari profil Telegram hanya bila pengguna belum punya nama sama sekali.
    if (!profile.full_name && telegramName) {
      await upsertProfile(generated.user.id, { full_name: telegramName });
    }

    return redirectTo(request, "/");
  } catch (err) {
    console.error("[GET /auth/telegram]", errorMessage(err));
    if (claimedHash) {
      // Login gagal sebelum sesi terbentuk → kembalikan token agar bisa dicoba lagi (selama belum kedaluwarsa).
      await supabase
        .from("telegram_magic_links")
        .update({ used_at: null })
        .eq("token", claimedHash)
        .then(({ error }) => error && console.error("[GET /auth/telegram] gagal melepas token:", error.message));
    }
    return redirectTo(request, "/login?error=auth_failed");
  }
}

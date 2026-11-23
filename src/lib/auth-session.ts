import { getSupabaseAdmin } from "./supabase-server";
import { createSupabaseAuthClient } from "./supabase/server-auth";
import { telegramInternalEmail, upsertProfile } from "./profiles";
import { getTelegramChat } from "./telegram";

/**
 * Membuat sesi Supabase Auth standar (cookie) di browser yang sedang memanggil route handler ini,
 * untuk akun dengan email `authEmail`. Dipakai untuk menyerahkan login ke laptop (poll) atau
 * ke browser yang sama saat konfirmasi. Tidak bergantung pada PKCE code verifier.
 */
export async function createCookieSessionForEmail(authEmail: string): Promise<string> {
  const { data, error } = await getSupabaseAdmin().auth.admin.generateLink({ type: "magiclink", email: authEmail });
  if (error) throw error;
  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash || !data.user) throw new Error("generateLink tidak mengembalikan token.");

  const authClient = await createSupabaseAuthClient();
  const { data: verified, error: verifyError } = await authClient.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (verifyError || !verified.session) throw verifyError ?? new Error("Sesi tidak terbentuk.");
  return data.user.id;
}

export interface ResolvedUser {
  id: string;
  authEmail: string;
}

function isAlreadyRegistered(err: { code?: string; message: string } | null) {
  return !!err && (err.code === "email_exists" || /already (been )?registered/i.test(err.message));
}

/** Pastikan akun Telegram ada di Supabase Auth & public.profiles. */
export async function ensureTelegramUser(chatId: string, fullName: string | null): Promise<ResolvedUser> {
  const supabase = getSupabaseAdmin();
  const chat = await getTelegramChat(chatId);
  const username = chat?.username ?? null;
  const telegramName = [chat?.first_name, chat?.last_name].filter(Boolean).join(" ") || null;

  let user: ResolvedUser | null = null;

  // 1) Akun yang sudah terhubung ke Chat ID ini.
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
    if (!error && data.user?.email) user = { id: data.user.id, authEmail: data.user.email };
  }

  // 2) Akun internal Telegram: <chat_id>@telegram.salestrain.local (buat bila belum ada).
  if (!user) {
    const email = telegramInternalEmail(chatId);
    const { data: createdUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        full_name: fullName ?? telegramName ?? undefined,
        telegram_chat_id: chatId,
        telegram_username: username ?? undefined,
        provider: "telegram",
      },
    });
    if (createError && !isAlreadyRegistered(createError)) throw createError;
    if (createdUser?.user) {
      user = { id: createdUser.user.id, authEmail: email };
    } else {
      // Sudah terdaftar tetapi profil belum tertaut: ambil id lewat generateLink (tanpa mengirim apa pun).
      const { data: link, error: linkError } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
      if (linkError || !link.user) throw linkError ?? new Error("Akun Telegram tidak ditemukan.");
      user = { id: link.user.id, authEmail: email };
    }
  }

  const profile = await upsertProfile(user.id, { telegram_chat_id: chatId, telegram_username: username, full_name: fullName });
  if (!profile.full_name && telegramName) await upsertProfile(user.id, { full_name: telegramName });
  return user;
}

/** Pastikan akun email (yang sudah terverifikasi kepemilikannya) tersinkron ke public.profiles. */
export async function ensureEmailUserProfile(userId: string, email: string, fullName: string | null) {
  await upsertProfile(userId, { email, full_name: fullName });
}

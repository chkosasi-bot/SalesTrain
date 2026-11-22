import { getSupabaseAdmin } from "./supabase-server";

export const TELEGRAM_EMAIL_DOMAIN = "telegram.salestrain.local";

export function telegramInternalEmail(chatId: string): string {
  return `${chatId}@${TELEGRAM_EMAIL_DOMAIN}`;
}

export function isTelegramInternalEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${TELEGRAM_EMAIL_DOMAIN}`);
}

export interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  telegram_chat_id: string | null;
  telegram_username: string | null;
}

export interface ProfileUpdate {
  email?: string | null;
  full_name?: string | null;
  telegram_chat_id?: string | null;
  telegram_username?: string | null;
}

const PROFILE_COLUMNS = "id, full_name, email, role, telegram_chat_id, telegram_username";

function clean(value: string | null | undefined, max = 120): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().replace(/\s+/g, " ");
  return v ? v.slice(0, max) : null;
}

export async function getProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await getSupabaseAdmin().from("profiles").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle();
  if (error) throw error;
  return (data as ProfileRow | null) ?? null;
}

/**
 * Membuat baris profiles bila belum ada, atau memperbarui kolom yang diberikan.
 * Nilai kosong tidak pernah menimpa data yang sudah ada (mis. full_name yang diisi sebelumnya).
 */
export async function upsertProfile(userId: string, update: ProfileUpdate = {}): Promise<ProfileRow> {
  const supabase = getSupabaseAdmin();
  const fields: Record<string, string> = {};
  const email = clean(update.email, 254);
  if (email && !isTelegramInternalEmail(email)) fields.email = email.toLowerCase();
  const fullName = clean(update.full_name);
  if (fullName) fields.full_name = fullName;
  const chatId = clean(update.telegram_chat_id, 32);
  if (chatId) fields.telegram_chat_id = chatId;
  const username = clean(update.telegram_username, 64);
  if (username) fields.telegram_username = username.replace(/^@/, "");

  const existing = await getProfile(userId);

  if (!existing) {
    const { data, error } = await supabase
      .from("profiles")
      .insert({ id: userId, ...fields })
      .select(PROFILE_COLUMNS)
      .single();
    if (!error) return data as ProfileRow;
    // Bisa saja trigger database sudah membuat baris yang sama secara bersamaan.
    if (error.code !== "23505") throw error;
  }

  if (Object.keys(fields).length === 0 && existing) return existing;

  const { data, error } = await supabase
    .from("profiles")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", userId)
    .select(PROFILE_COLUMNS)
    .single();
  if (error) throw error;
  return data as ProfileRow;
}

/** Nama tampilan: full_name → @telegram_username → bagian lokal email. */
export function profileDisplayName(profile: Pick<ProfileRow, "full_name" | "telegram_username" | "email"> | null, fallbackEmail?: string | null): string {
  if (profile?.full_name) return profile.full_name;
  if (profile?.telegram_username) return `@${profile.telegram_username}`;
  const email = profile?.email || (isTelegramInternalEmail(fallbackEmail) ? null : fallbackEmail);
  if (email) return email.split("@")[0];
  return "Pengguna";
}

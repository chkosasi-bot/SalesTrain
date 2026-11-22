import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function getPublicSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY wajib diset.");
  }
  return { url, anonKey };
}

export { getPublicSupabaseEnv };

/**
 * Klien Supabase Auth berbasis cookie untuk Route Handler.
 * Dipakai HANYA untuk operasi sesi pengguna (signInWithOtp, verifyOtp, exchangeCode, getClaims, signOut).
 * Akses data tabel tetap lewat klien service-role di `supabase-server.ts`.
 */
export async function createSupabaseAuthClient() {
  const { url, anonKey } = getPublicSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Dipanggil dari konteks read-only; proxy yang akan memperbarui cookie.
        }
      },
    },
  });
}

export interface AuthUser {
  id: string;
  email: string | null;
}

/**
 * Identitas pengguna dari cookie sesi, diverifikasi lewat getClaims()
 * (verifikasi JWT lokal bila proyek memakai signing key asimetris; selain itu dicek ke server Auth).
 */
/** Cek murah (tanpa jaringan): apakah request membawa cookie sesi Supabase sama sekali. */
export async function hasAuthCookie(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore
    .getAll()
    .some((c) => c.name.startsWith("sb-") && /-auth-token(\.\d+)?$/.test(c.name) && c.value.length > 0);
}

export async function getAuthUser(): Promise<AuthUser | null> {
  // Jalur cepat: tanpa cookie sesi Supabase sama sekali → pasti belum login, tanpa panggilan jaringan.
  if (!(await hasAuthCookie())) return null;
  const supabase = await createSupabaseAuthClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return {
    id: String(data.claims.sub),
    email: typeof data.claims.email === "string" && data.claims.email ? data.claims.email : null,
  };
}

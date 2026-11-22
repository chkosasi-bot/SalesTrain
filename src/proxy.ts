import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/** Halaman yang wajib login. API routes memeriksa sesi sendiri (lihat getAuthUser). */
const PROTECTED_PATHS = ["/"];

function isProtected(pathname: string) {
  return PROTECTED_PATHS.includes(pathname);
}

/**
 * Proxy (pengganti middleware di Next.js 16):
 * - memperbarui cookie sesi Supabase bila token perlu di-refresh,
 * - mengarahkan pengguna yang belum login dari halaman simulasi ke /login,
 * - mengarahkan pengguna yang sudah login dari /login ke halaman utama.
 * Tidak dijalankan untuk /api/*, aset statis, sw.js & manifest (lihat matcher) agar
 * latensi /api/voice-turn dan PWA tidak terpengaruh.
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = !!data?.claims?.sub;
  const { pathname, search } = request.nextUrl;

  const redirectWithCookies = (target: URL) => {
    const redirect = NextResponse.redirect(target);
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
    redirect.headers.set("Cache-Control", "no-store");
    return redirect;
  };

  if (!isLoggedIn && isProtected(pathname)) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/" || search) loginUrl.searchParams.set("next", `${pathname}${search}`);
    return redirectWithCookies(loginUrl);
  }

  if (isLoggedIn && pathname === "/login") {
    return redirectWithCookies(new URL("/", request.url));
  }

  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/", "/login"],
};

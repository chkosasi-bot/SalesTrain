export const FALLBACK_SITE_URL = "https://salestrain-xi.vercel.app";

function normalize(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
}

/**
 * Origin publik aplikasi untuk tautan login (email & Telegram).
 *
 * Urutan: NEXT_PUBLIC_SITE_URL → origin request (hanya bila host-nya tepercaya:
 * localhost atau domain Vercel milik proyek ini) → fallback produksi.
 * Header Host/Origin dari request tidak dipercaya begitu saja, agar penyerang tidak bisa
 * membuat tautan login berisi token yang mengarah ke domain lain.
 */
export function getSiteUrl(request?: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL ? normalize(process.env.NEXT_PUBLIC_SITE_URL) : null;
  if (fromEnv) return fromEnv;

  if (request) {
    const url = new URL(request.url);
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const host = forwardedHost || url.host;
    const proto = forwardedProto || url.protocol.replace(":", "");
    const candidate = normalize(`${proto}://${host}`);

    if (candidate) {
      const hostname = new URL(candidate).hostname;
      const trustedVercelHosts = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
        .filter((h): h is string => !!h)
        .map((h) => h.replace(/^https?:\/\//, "").split("/")[0]);
      if (isLocalHost(hostname) || trustedVercelHosts.includes(new URL(candidate).host)) return candidate;
    }
  }

  return FALLBACK_SITE_URL;
}

/** Hanya izinkan path internal (mencegah open redirect lewat ?next=). */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (next.startsWith("/login") || next.startsWith("/auth/")) return fallback;
  return next;
}

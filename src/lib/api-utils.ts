import type { ApiError } from "./types";

export function jsonError(message: string, status = 400): Response {
  const body: ApiError = { error: message };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function jsonOk<T>(body: T, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return "Terjadi kesalahan yang tidak diketahui.";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validasi ringan id (UUID atau bilangan bulat) agar input liar tidak diteruskan ke DB. */
export function isValidId(value: unknown): value is string {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const s = String(value).trim();
  return UUID_RE.test(s) || /^\d{1,18}$/.test(s);
}

import { NextResponse } from "next/server";

// GET /api/auth/telegram/verify?token=... — alias dari /auth/telegram (verifikasi dilakukan di sana).
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const target = new URL("/auth/telegram", request.url);
  if (token) target.searchParams.set("token", token);
  const res = NextResponse.redirect(target, 307);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

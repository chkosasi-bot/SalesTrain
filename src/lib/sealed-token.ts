import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Token tersegel (AES-256-GCM): isinya terenkripsi & tidak bisa diubah oleh browser.
 * Dipakai untuk menyimpan kunci jawaban kuis di sisi klien tanpa membocorkannya.
 */
function key(purpose: string): Buffer {
  const secret = process.env.LOGIN_REQUEST_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("LOGIN_REQUEST_SECRET / SUPABASE_SERVICE_ROLE_KEY belum diset.");
  return createHash("sha256").update(`${purpose}:${secret}`).digest();
}

export function seal(purpose: string, payload: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(purpose), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString("base64url");
}

export function unseal<T>(purpose: string, token: string): T | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(purpose), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

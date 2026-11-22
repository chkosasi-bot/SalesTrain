// Helper fetch sisi browser: melempar Error berisi pesan dari server bila gagal.
export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, { cache: "no-store", ...init });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new Error("Tidak dapat terhubung ke server. Periksa koneksi internet Anda.");
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // respons bukan JSON
  }

  if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    // Sesi login habis → kembali ke halaman login.
    // Navigasi penuh (bukan router.push) agar proxy & cookie diproses ulang oleh server.
    window.location.assign(new URL("/login?error=session_expired", window.location.origin).href);
  }

  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Permintaan gagal (HTTP ${res.status}).`;
    throw new Error(message);
  }
  return data as T;
}

/* Service Worker - AI Sales Roleplay Simulator
 * - Precache app shell & icons
 * - Cache-first untuk aset statis (/_next/static, /icons, font, gambar)
 * - Network-first untuk navigasi halaman (fallback ke cache / halaman offline)
 * - Tidak pernah meng-cache /api/* (data sesi & audio selalu dari jaringan)
 * - Tidak pernah meng-cache /login, /auth/* dan /api/auth/* (alur login & cookie sesi)
 */
const VERSION = "v3";
const STATIC_CACHE = `sales-roleplay-static-${VERSION}`;
const PAGE_CACHE = `sales-roleplay-pages-${VERSION}`;

// "/" sengaja tidak di-precache: halaman utama dilindungi login (bisa redirect ke /login).
const PRECACHE_URLS = [
  "/manifest.json",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png",
];

const OFFLINE_HTML = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#f6f7fb;color:#111827;padding:16px;text-align:center}
button{margin-top:16px;padding:12px 20px;border:0;border-radius:12px;background:#4f46e5;color:#fff;font-size:16px}</style></head>
<body><div><h1 style="font-size:20px">Anda sedang offline</h1>
<p style="color:#6b7280">Simulasi suara membutuhkan koneksi internet. Periksa jaringan lalu coba lagi.</p>
<button onclick="location.reload()">Coba Lagi</button></div></body></html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== PAGE_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/** Rute yang tidak boleh pernah disajikan dari cache. */
function isNeverCached(url) {
  const p = url.pathname;
  return (
    p.startsWith("/api/") || // termasuk /api/auth/* dan /api/voice-turn
    p === "/login" ||
    p.startsWith("/login/") ||
    p.startsWith("/auth/")
  );
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.json" ||
    /\.(?:js|css|woff2?|ttf|otf|png|jpg|jpeg|gif|svg|webp|ico)$/i.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isNeverCached(url)) return; // langsung ke jaringan, tanpa cache sama sekali
  if (url.pathname === "/sw.js") return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Jangan simpan hasil redirect (mis. "/" → "/login") agar halaman login tidak tersimpan sebagai "/".
          if (response.ok && !response.redirected && response.type === "basic") {
            const copy = response.clone();
            caches.open(PAGE_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = (await caches.match(request)) || (await caches.match("/"));
          return (
            cached ||
            new Response(OFFLINE_HTML, {
              status: 503,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            })
          );
        })
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
  }
});

# AI Sales Roleplay Simulator (MVP)

PWA mobile-first untuk latihan roleplay penjualan berbasis suara. Salesman menahan tombol mikrofon, berbicara,
lalu "pelanggan" AI menjawab dengan suara. Di akhir sesi, AI coach memberi skor & feedback.

Stack: Next.js 16 (App Router, TypeScript, Tailwind CSS v4) · Supabase · OpenAI (STT, Chat, TTS) · lucide-react.

## Menjalankan

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm start
```

Variabel lingkungan (`.env.local`):

| Variabel | Keterangan |
| --- | --- |
| `OPENAI_API_KEY` | Kunci OpenAI (server saja) |
| `NEXT_PUBLIC_SUPABASE_URL` | URL proyek Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key — hanya untuk cookie sesi Supabase Auth (`@supabase/ssr`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — hanya dipakai di API routes, tidak pernah dikirim ke browser |
| `NEXT_PUBLIC_SITE_URL` | Opsional: origin publik untuk tautan login (default: origin request tepercaya, lalu `https://salestrain-xi.vercel.app`) |
| `TELEGRAM_BOT_TOKEN` | Token bot Telegram (server saja) |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | Username bot (tanpa `@`) untuk tombol `t.me/...` di halaman login |
| `TELEGRAM_WEBHOOK_SECRET` | Opsional tapi disarankan: rahasia webhook, divalidasi lewat header `X-Telegram-Bot-Api-Secret-Token` |

> Mikrofon hanya bisa diakses lewat **HTTPS** atau `localhost`. Untuk uji di HP, deploy (mis. Vercel) atau gunakan tunnel HTTPS.

## Struktur

```
public/manifest.json        Web App Manifest (display: standalone)
public/sw.js                Service Worker: precache shell, cache-first aset statis, network-first halaman, /api tidak di-cache
public/icons/*              Ikon placeholder (dibuat oleh scripts/generate-icons.mjs)
src/app/layout.tsx          Meta PWA (Apple/Android), viewport, registrasi SW
src/app/page.tsx            State machine layar: Pilih Skenario → Sesi → Hasil
src/components/*            ScenarioPicker, SessionScreen (push-to-talk), ResultScreen
src/lib/supabase-server.ts  Klien Supabase service-role (server only)
src/lib/openai-server.ts    Klien OpenAI + konstanta model
src/app/api/scenarios       GET  — skenario aktif (tanpa system_prompt)
src/app/api/sessions        POST — buat sesi (status: in_progress)
src/app/api/voice-turn      POST — FormData(audio, session_id) → STT → LLM → TTS → JSON
src/app/api/evaluate-session POST — nilai transkrip, simpan skor, status: completed
```

## Autentikasi (Magic Link tanpa password)

```
src/proxy.ts                         Refresh cookie sesi; "/" wajib login → /login; /login saat sudah login → "/"
src/app/login                        Halaman login 2 tab (Email / Telegram) + layar "Menunggu konfirmasi" (polling 2,5 dtk)
src/app/api/auth/request-login       POST — buat tiket public.login_requests (pending, 15 menit) + cookie httpOnly pengikat
                                            browser; kirim tautan /auth/confirm?req_id&secret via Telegram Bot / email Supabase
src/app/auth/confirm                 Halaman konfirmasi (HP / perangkat mana pun): kode pencocokan + tombol konfirmasi
src/app/api/auth/confirm-login       GET info tiket | POST verifikasi → status 'verified' (+ langsung login bila browser sama)
src/app/api/auth/poll-login          GET  — laptop: 'verified' → 'consumed' + generateLink/verifyOtp → cookie sesi di laptop
src/app/auth/callback                GET  — kompatibilitas: tukar ?code= / ?token_hash= → sesi
src/app/api/telegram/webhook         POST — balas /start dengan Telegram Chat ID
src/app/api/auth/me | logout         Profil user aktif | keluar
supabase/migrations/*.sql            Perbaikan trigger auth.users → profiles (jalankan di SQL Editor)
scripts/set-telegram-webhook.mjs     Daftarkan webhook bot ke domain produksi
```

- Semua API (kecuali `/api/auth/*` & webhook) mewajibkan login; `/api/voice-turn` & `/api/evaluate-session` juga memastikan sesi latihan milik user tersebut.
- Pengecekan login di `/api/voice-turn` berjalan **paralel** dengan STT (tanpa tambahan latensi); STT dibatalkan bila login tidak valid.
- Proxy hanya berjalan di `/` dan `/login` — tidak di `/api/*`, aset statis, `sw.js` atau manifest.
- **Login lintas perangkat:** mulai di laptop, konfirmasi di HP, laptop masuk otomatis. Tidak memakai PKCE:
  email dikirim lewat implicit flow (token di fragment URL dibaca halaman `/auth/confirm`, lalu sesi sementara di HP dicabut),
  Telegram dibuktikan oleh tautan rahasia yang hanya dikirim ke chat pemilik. Sesi laptop dibuat server-side
  (`generateLink` + `verifyOtp`) saat polling.
- Keamanan tiket: `verify_secret` disimpan sebagai hash SHA-256; polling hanya diterima dari browser yang punya cookie
  httpOnly `st_login_req` (HMAC dari `req_id`, kunci `LOGIN_REQUEST_SECRET` atau service role key); konfirmasi dari perangkat lain
  wajib menekan tombol dan menampilkan **kode pencocokan** 2 digit yang sama dengan layar laptop (melindungi dari pemindai
  tautan email & phishing). Status: `pending → verified → consumed` (atau `expired`).
- Supabase Dashboard → Authentication → URL Configuration → **Redirect URLs**: tambahkan `https://<domain>/**` dan
  `http://localhost:3000/**` (tautan email berisi query `req_id` & `secret`).
- Template email bawaan Supabase sudah cukup. Template kustom dengan `{{ .TokenHash }}` juga didukung:
  `{{ .RedirectTo }}&token_hash={{ .TokenHash }}`.
- Butuh trigger `auth.users → profiles` yang sehat: lihat `supabase/migrations/20261122_fix_auth_user_trigger.sql`.

## Product Mastery (`/mastery`)

```
src/app/mastery                      Katalog produk aktif + progres kelulusan
src/app/mastery/[id]                 Tab: 4P & Promo | Kompetitor (Battlecard) | Kuis Pemahaman
src/app/api/mastery                  GET  — own_products aktif + jumlah kompetitor + status kuis user
src/app/api/mastery/[id]             GET  — materi lengkap + competitor_products (compared_own_product_id) + riwayat
src/app/api/mastery/[id]/generate-quiz POST — 5 soal pilihan ganda (gpt-4o-mini) dari data produk & kompetitor
src/app/api/mastery/[id]/submit-quiz   POST — skor 0–100 (lulus ≥ 80), simpan ke assessment_attempts, kembalikan pembahasan
src/components/AppTopBar.tsx         Navigasi utama Simulasi ↔ Materi Produk + identitas user
src/components/MasteryStatusBanner   Indikator kelulusan di halaman simulasi (tidak memblokir simulasi)
```

- Kunci jawaban & pembahasan **tidak pernah dikirim ke browser sebelum submit**: soal disegel dalam `quizToken`
  (AES-256-GCM, terikat user & produk, berlaku 60 menit). Satu kuis hanya bisa dinilai sekali; posisi jawaban benar diacak.
- `assessment_attempts`: `attempt_type = 'post_test'` (satu-satunya nilai yang diterima check constraint saat ini),
  `related_product_id`, `score`, `passing_threshold = 80`, `passed`, `weak_topics_json` (topik yang salah),
  `details_json` (`module: "product_mastery"`, `quiz_id`, soal, jawaban, pembahasan).
- Status lulus per produk = pernah lulus minimal sekali; Product Mastery lulus bila semua produk aktif lulus.

## Simulasi berbasis Pelanggan & Produk (`/`)

```
supabase/migrations/20261124_sessions_product_customer.sql  sessions + own_product_id, customer_id, scenario_focus, challenge_mode
src/components/SessionConfigurator.tsx  Konfigurator: Produk (pre-select ?product_id=) → Pelanggan (Wajib/Opsional + briefing) → Fokus → Tantangan
src/app/api/simulation/options          GET  — produk aktif, pelanggan aktif (+ status lulus & kunci), daftar fokus
src/app/api/sessions                    POST — validasi produk/pelanggan/fokus + aturan kunci di server, simpan relasi ke sessions
src/lib/simulation.ts                   Fokus skenario, getCustomerPassStatus(), buildCustomerCards(), checkCustomerUnlocked()
src/lib/persona.ts                      System prompt persona dinamis (customers + own_products + competitor_products)
```

- **Lulus per pelanggan** = sesi milik user untuk `customer_id` tsb dengan `status = 'completed'` dan `passed = true`
  (`/api/evaluate-session` mengisi `passed` bila skor ≥ 80). Satu sesi hanya bisa dinilai sekali.
- **Aturan kunci:** profil `is_mandatory = false` terkunci sampai semua profil `is_mandatory = true` aktif lulus — dicek di UI dan
  di `POST /api/sessions` (403).
- **Suara:** `customers.tts_voice` (fallback `nova`) & `customers.tts_speed` (rentang 0.75–1.30, fallback 1.0) → OpenAI TTS `voice` & `speed`.
- Persona memakan data rahasia (margin, bonus, counter strategy) hanya untuk menilai argumen salesman; AI diinstruksikan tidak membocorkannya.
- Sesi lama berbasis tabel `scenarios` tetap bisa dilanjutkan & dinilai (jalur kompatibilitas di voice-turn/evaluate).

## Alur `/api/voice-turn`

1. STT (`gpt-4o-mini-transcribe`, fallback `whisper-1`, bahasa `id`) **paralel** dengan pengambilan sesi, skenario & 11 pesan terakhir.
2. Simpan ucapan salesman **paralel** dengan panggilan `gpt-4o-mini` (konteks maks. 12 pesan, jawaban 2–3 kalimat).
3. TTS (`tts-1`, mp3) **paralel** dengan penyimpanan balasan AI.
4. Respons: `{ userTranscript, assistantReply, audioBase64, audioMimeType }`.

## Catatan

- Nilai `status` sesi yang dipakai: `in_progress` dan `completed`.
- `feedback_summary` disimpan sebagai teks: ringkasan + daftar kelebihan + saran perbaikan.
- Suara pelanggan AI diambil dari kolom `scenarios.voice_id` (voice `tts-1`: alloy, ash, coral, echo, fable, nova, onyx, sage, shimmer). Kosong atau tidak valid → `onyx`.
- Desktop: tahan tombol **Spasi** untuk berbicara.
- Ikon dapat dibuat ulang dengan `node scripts/generate-icons.mjs`.

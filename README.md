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
src/app/login                        Halaman login 2 tab (Email / Telegram)
src/app/api/auth/email               POST — signInWithOtp, emailRedirectTo = <origin>/auth/callback
src/app/auth/callback                GET  — tukar ?code= (PKCE) atau ?token_hash=&type= → sesi, sinkron ke profiles
src/app/api/telegram/webhook         POST — balas /start dengan Telegram Chat ID
src/app/api/auth/telegram/request-link POST — token acak sekali pakai (15 menit, disimpan sebagai hash SHA-256) → kirim via bot
src/app/auth/telegram                GET  — klaim token atomik, buat/cari user (<chat_id>@telegram.salestrain.local),
                                            generateLink(magiclink) + verifyOtp → cookie sesi standar Supabase
src/app/api/auth/telegram/verify     GET  — alias ke /auth/telegram
src/app/api/auth/me | logout         Profil user aktif | keluar
supabase/migrations/*.sql            Perbaikan trigger auth.users → profiles (jalankan di SQL Editor)
scripts/set-telegram-webhook.mjs     Daftarkan webhook bot ke domain produksi
```

- Semua API (kecuali `/api/auth/*` & webhook) mewajibkan login; `/api/voice-turn` & `/api/evaluate-session` juga memastikan sesi latihan milik user tersebut.
- Pengecekan login di `/api/voice-turn` berjalan **paralel** dengan STT (tanpa tambahan latensi); STT dibatalkan bila login tidak valid.
- Proxy hanya berjalan di `/` dan `/login` — tidak di `/api/*`, aset statis, `sw.js` atau manifest.
- Supabase Dashboard → Authentication → URL Configuration: tambahkan `https://<domain>/auth/callback` dan `http://localhost:3000/auth/callback` ke **Redirect URLs**.
- Tautan email (PKCE) harus dibuka di browser yang sama dengan tempat meminta. Agar bisa dibuka di browser mana saja, ubah template email Magic Link menjadi
  `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=magiclink` (callback mendukung keduanya).

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

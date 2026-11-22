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
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — hanya dipakai di API routes, tidak pernah dikirim ke browser |

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

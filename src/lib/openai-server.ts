import OpenAI from "openai";

let openaiClient: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (typeof window !== "undefined") {
    throw new Error("OpenAI client hanya boleh dipakai di server.");
  }
  if (openaiClient) return openaiClient;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY belum diset di .env.local.");
  }
  openaiClient = new OpenAI({ apiKey, maxRetries: 1, timeout: 45_000 });
  return openaiClient;
}

export const STT_MODEL_PRIMARY = "gpt-4o-mini-transcribe";
export const STT_MODEL_FALLBACK = "whisper-1";
export const CHAT_MODEL = "gpt-4o-mini";
export const TTS_MODEL = "tts-1";

/** Voice yang didukung model `tts-1`. */
export const TTS_VOICES = [
  "alloy",
  "ash",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
] as const;
export type TtsVoice = (typeof TTS_VOICES)[number];

/** Fallback sesi lama berbasis `scenarios.voice_id`. */
export const DEFAULT_TTS_VOICE: TtsVoice = "onyx";
/** Fallback sesi berbasis pelanggan (`customers.tts_voice`). */
export const DEFAULT_CUSTOMER_VOICE: TtsVoice = "nova";

export const TTS_SPEED_MIN = 0.75;
export const TTS_SPEED_MAX = 1.3;
export const DEFAULT_TTS_SPEED = 1.0;

export function isTtsVoice(v: unknown): v is TtsVoice {
  return typeof v === "string" && (TTS_VOICES as readonly string[]).includes(v.trim().toLowerCase());
}

/**
 * Mengubah nilai voice dari database menjadi voice TTS yang valid.
 * Kosong / null / tidak dikenal → `fallback` (default "onyx" untuk sesi lama).
 */
export function resolveTtsVoice(voiceId: unknown, fallback: TtsVoice = DEFAULT_TTS_VOICE): TtsVoice {
  if (typeof voiceId !== "string") return fallback;
  const v = voiceId.trim().toLowerCase();
  return (TTS_VOICES as readonly string[]).includes(v) ? (v as TtsVoice) : fallback;
}

/** `customers.tts_speed` (numeric) → kecepatan valid 0.75–1.30, selain itu 1.0. */
export function resolveTtsSpeed(speed: unknown): number {
  const n = typeof speed === "string" ? Number(speed) : typeof speed === "number" ? speed : NaN;
  if (!Number.isFinite(n) || n < TTS_SPEED_MIN || n > TTS_SPEED_MAX) return DEFAULT_TTS_SPEED;
  return Math.round(n * 100) / 100;
}

/** Jumlah maksimum pesan riwayat yang dikirim ke LLM (termasuk ucapan terbaru). */
export const MAX_CONTEXT_MESSAGES = 12;

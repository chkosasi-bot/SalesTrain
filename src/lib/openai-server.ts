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

export const DEFAULT_TTS_VOICE: TtsVoice = "onyx";

/**
 * Mengubah `scenarios.voice_id` menjadi voice TTS yang valid.
 * Kosong / null / tidak dikenal → fallback ke "onyx".
 */
export function resolveTtsVoice(voiceId: unknown): TtsVoice {
  if (typeof voiceId !== "string") return DEFAULT_TTS_VOICE;
  const v = voiceId.trim().toLowerCase();
  return (TTS_VOICES as readonly string[]).includes(v) ? (v as TtsVoice) : DEFAULT_TTS_VOICE;
}

/** Jumlah maksimum pesan riwayat yang dikirim ke LLM (termasuk ucapan terbaru). */
export const MAX_CONTEXT_MESSAGES = 12;

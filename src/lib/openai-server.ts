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

const ALLOWED_VOICES = ["onyx", "alloy"] as const;
type AllowedVoice = (typeof ALLOWED_VOICES)[number];

export function getTtsVoice(): AllowedVoice {
  const v = process.env.OPENAI_TTS_VOICE?.toLowerCase();
  return (ALLOWED_VOICES as readonly string[]).includes(v ?? "") ? (v as AllowedVoice) : "onyx";
}

/** Jumlah maksimum pesan riwayat yang dikirim ke LLM (termasuk ucapan terbaru). */
export const MAX_CONTEXT_MESSAGES = 12;

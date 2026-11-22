// Tipe data bersama antara API routes (server) dan UI (client).

export interface ScenarioSummary {
  id: string;
  title: string;
  description: string | null;
  customer_name: string | null;
}

export interface SessionInfo {
  id: string;
  scenario_id: string;
  salesman_name: string | null;
  status: string;
}

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
}

export interface Evaluation {
  score: number;
  strengths: string[];
  improvements: string[];
  summary: string;
}

export interface ScenariosResponse {
  scenarios: ScenarioSummary[];
}

export interface CreateSessionResponse {
  session: SessionInfo;
  scenario: ScenarioSummary;
}

export interface VoiceTurnResponse {
  userTranscript: string;
  assistantReply: string;
  audioBase64: string | null;
  audioMimeType: string;
  /** Voice TTS yang benar-benar dipakai (hasil dari scenarios.voice_id atau fallback "onyx"). */
  voice: string;
}

export interface EvaluateSessionResponse {
  sessionId: string;
  evaluation: Evaluation;
}

export interface ApiError {
  error: string;
}

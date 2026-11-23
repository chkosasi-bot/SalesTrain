// Tipe data bersama antara API routes (server) dan UI (client).

export interface SessionInfo {
  id: string;
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
  /** Lulus bila skor ≥ passing_score (mengisi sessions.passed). */
  passed: boolean;
  passing_score: number;
}

export interface CreateSessionResponse {
  session: SessionInfo;
  context: SessionContext;
}

export interface VoiceTurnResponse {
  userTranscript: string;
  assistantReply: string;
  audioBase64: string | null;
  audioMimeType: string;
  /** Voice TTS yang benar-benar dipakai (customers.tts_voice / scenarios.voice_id, atau fallback). */
  voice: string;
  /** Kecepatan TTS yang dipakai (customers.tts_speed, rentang 0.75–1.30, fallback 1.0). */
  speed: number;
}

export interface EvaluateSessionResponse {
  sessionId: string;
  evaluation: Evaluation;
}

export interface CurrentUser {
  id: string;
  email: string | null;
  full_name: string | null;
  telegram_username: string | null;
  telegram_chat_id: string | null;
  display_name: string;
  login_method: "email" | "telegram";
}

export interface MeResponse {
  user: CurrentUser;
}

export interface RequestLoginResponse {
  requestId: string;
  matchCode: string;
  expiresAt: string;
  channel: "email" | "telegram";
}

export interface PollLoginResponse {
  status: "pending" | "signed_in" | "expired" | "consumed";
  expiresAt?: string;
}

export interface ConfirmInfoResponse {
  channel: "email" | "telegram";
  identifier: string;
  matchCode: string;
  status: "pending" | "verified" | "consumed" | "expired";
  sameDevice: boolean;
  expiresAt: string;
}

export interface ConfirmResultResponse {
  result: "signed_in" | "verified";
}

// ---------- Product Mastery ----------

export interface OwnProduct {
  id: string;
  product_code: string;
  name: string;
  category: string | null;
  brand: string | null;
  specifications_summary: string;
  key_selling_points: string | null;
  pricing_and_margin_notes: string | null;
  target_customer_notes: string | null;
  marketing_product_strategy: string | null;
  marketing_price_strategy: string | null;
  marketing_place_strategy: string | null;
  marketing_promotion_strategy: string | null;
  sales_additional_discount_rate: string | null;
  sales_bonus_scheme: string | null;
  sales_promo_terms: string | null;
  is_active: boolean;
}

export interface CompetitorProduct {
  id: string;
  competitor_code: string;
  competitor_brand: string;
  product_name: string;
  compared_own_product_id: string | null;
  specifications_summary: string | null;
  perceived_strengths: string | null;
  perceived_weaknesses: string | null;
  counter_strategy: string;
  is_active: boolean;
}

export interface MasteryStatus {
  attempts: number;
  best_score: number | null;
  last_score: number | null;
  passed: boolean;
  last_attempt_at: string | null;
}

export interface MasteryProductCard {
  id: string;
  product_code: string;
  name: string;
  category: string | null;
  brand: string | null;
  sales_bonus_scheme: string | null;
  sales_promo_terms: string | null;
  competitor_count: number;
  status: MasteryStatus;
}

export interface MasteryListResponse {
  products: MasteryProductCard[];
  summary: { total: number; passed: number; all_passed: boolean; passing_threshold: number };
}

export interface MasteryAttemptSummary {
  id: string;
  score: number;
  passed: boolean;
  created_at: string;
  weak_topics: string[];
}

export interface MasteryDetailResponse {
  product: OwnProduct;
  competitors: CompetitorProduct[];
  status: MasteryStatus;
  history: MasteryAttemptSummary[];
  passing_threshold: number;
}

export type QuizTopic = "Product" | "Price" | "Place" | "Promotion" | "Kompetitor";

export interface QuizQuestionPublic {
  id: number;
  question: string;
  options: string[];
  topic: QuizTopic;
}

export interface GenerateQuizResponse {
  quizToken: string;
  questions: QuizQuestionPublic[];
  expiresAt: string;
}

export interface QuizReviewItem extends QuizQuestionPublic {
  selected_index: number | null;
  correct_index: number;
  is_correct: boolean;
  explanation: string;
}

export interface SubmitQuizResponse {
  attemptId: string;
  score: number;
  passed: boolean;
  passing_threshold: number;
  correct_count: number;
  total: number;
  weak_topics: QuizTopic[];
  review: QuizReviewItem[];
  status: MasteryStatus;
}

// ---------- Simulasi berbasis pelanggan & produk ----------

export type ScenarioFocus = "initial_offer" | "price_negotiation" | "bonus_terms" | "competitor_h2h";
export type ChallengeMode = "standard" | "tough";

export interface CustomerPassStatus {
  attempts: number;
  best_score: number | null;
  passed: boolean;
  last_completed_at: string | null;
}

export interface SimulationCustomer {
  id: string;
  customer_code: string;
  owner_name: string;
  store_name: string;
  store_scale: string | null;
  area_name: string | null;
  individual_assessment: string;
  payment_performance: string | null;
  historical_transactions: string | null;
  is_mandatory: boolean;
  tts_voice: string;
  tts_speed: number;
  status: CustomerPassStatus;
  locked: boolean;
  required_customers: { id: string; customer_code: string; owner_name: string }[];
}

export interface SimulationProduct {
  id: string;
  product_code: string;
  name: string;
  brand: string | null;
  category: string | null;
  competitor_count: number;
}

export interface SimulationOptionsResponse {
  products: SimulationProduct[];
  customers: SimulationCustomer[];
  focuses: { id: ScenarioFocus; label: string; short: string; description: string }[];
  challenge_modes: { id: ChallengeMode; label: string }[];
  passing_score: number;
}

/** Konteks sesi yang ditampilkan di header sesi & layar hasil. */
export interface SessionContext {
  title: string;
  product: { id: string; product_code: string; name: string; brand: string | null } | null;
  customer: {
    id: string;
    customer_code: string;
    owner_name: string;
    store_name: string;
    store_scale: string | null;
    area_name: string | null;
    is_mandatory: boolean;
    tts_voice: string;
    tts_speed: number;
  } | null;
  focus: { id: ScenarioFocus; label: string } | null;
  challenge_mode: ChallengeMode | null;
  description: string | null;
  /** Nama lawan bicara AI (pemilik toko). */
  counterpart_name: string;
}

export interface ApiError {
  error: string;
}

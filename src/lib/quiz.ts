import { randomBytes, randomInt } from "node:crypto";
import { CHAT_MODEL, getOpenAI } from "./openai-server";
import { QUIZ_QUESTION_COUNT } from "./mastery";
import { seal, unseal } from "./sealed-token";
import type { CompetitorProduct, OwnProduct, QuizQuestionPublic, QuizTopic } from "./types";

export const QUIZ_TOKEN_PURPOSE = "mastery-quiz:v1";
export const QUIZ_TTL_MINUTES = 60;
const TOPICS: QuizTopic[] = ["Product", "Price", "Place", "Promotion", "Kompetitor"];

export interface SealedQuestion extends QuizQuestionPublic {
  correct_index: number;
  explanation: string;
}

export interface SealedQuiz {
  quiz_id: string;
  user_id: string;
  product_id: string;
  product_code: string;
  issued_at: string;
  expires_at: string;
  model: string;
  questions: SealedQuestion[];
}

function section(label: string, value: string | null | undefined) {
  const v = value?.trim();
  return v ? `${label}: ${v}` : null;
}

function productBrief(p: OwnProduct, competitors: CompetitorProduct[]): string {
  const lines = [
    `PRODUK SENDIRI — ${p.name} (${p.product_code})`,
    section("Brand", p.brand),
    section("Kategori", p.category),
    section("Spesifikasi", p.specifications_summary),
    section("Keunggulan utama (key selling points)", p.key_selling_points),
    section("Strategi Product", p.marketing_product_strategy),
    section("Strategi Price", p.marketing_price_strategy),
    section("Catatan harga & margin", p.pricing_and_margin_notes),
    section("Strategi Place", p.marketing_place_strategy),
    section("Target pelanggan", p.target_customer_notes),
    section("Strategi Promotion", p.marketing_promotion_strategy),
    section("Skema bonus sales", p.sales_bonus_scheme),
    section("Syarat promo", p.sales_promo_terms),
    section("Diskon tambahan", p.sales_additional_discount_rate),
    "",
    competitors.length ? "KOMPETITOR:" : "KOMPETITOR: (tidak ada data)",
    ...competitors.flatMap((c, i) => [
      `${i + 1}. ${c.competitor_brand} — ${c.product_name} (${c.competitor_code})`,
      section("   Spesifikasi", c.specifications_summary),
      section("   Kekuatan menurut pasar", c.perceived_strengths),
      section("   Kelemahan menurut pasar", c.perceived_weaknesses),
      section("   Strategi menghadapi (counter)", c.counter_strategy),
    ]),
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

const SYSTEM_PROMPT = `Kamu adalah trainer penjualan FMCG di Indonesia yang menyusun kuis pemahaman produk untuk salesman lapangan.
Susun TEPAT ${QUIZ_QUESTION_COUNT} soal pilihan ganda berbasis SKENARIO LAPANGAN (mis. pemilik toko mengajukan keberatan,
membandingkan dengan kompetitor, menanyakan margin/promo) yang jawabannya bisa dipastikan dari data produk & kompetitor yang diberikan.

Aturan:
- Bahasa Indonesia yang jelas dan singkat. Setiap soal punya tepat 4 opsi yang masuk akal; hanya 1 yang benar.
- Jangan mengarang angka, harga, atau fakta yang tidak ada di data. Pengecoh boleh berupa praktik penjualan yang keliru.
- Sebar topik: Product, Price, Place, Promotion, dan minimal 1 soal Kompetitor bila data kompetitor tersedia.
- "explanation": 1–2 kalimat yang menjelaskan mengapa jawaban benar, merujuk ke data.
- Jangan menulis huruf opsi (A/B/C/D) di dalam teks opsi.

Balas HANYA JSON:
{"questions":[{"topic":"Product|Price|Place|Promotion|Kompetitor","question":"...","options":["...","...","...","..."],"correct_index":0,"explanation":"..."}]}`;

function normalizeTopic(t: unknown): QuizTopic {
  const s = String(t ?? "").trim().toLowerCase();
  return TOPICS.find((x) => x.toLowerCase() === s) ?? (s.startsWith("komp") || s.startsWith("comp") ? "Kompetitor" : "Product");
}

function parseQuestions(raw: string): Omit<SealedQuestion, "id">[] {
  const data = JSON.parse(raw) as { questions?: unknown };
  if (!Array.isArray(data.questions)) throw new Error("Format kuis tidak valid.");
  const out: Omit<SealedQuestion, "id">[] = [];
  for (const q of data.questions as Record<string, unknown>[]) {
    const options = Array.isArray(q.options) ? q.options.map((o) => String(o ?? "").trim()).filter(Boolean) : [];
    const correct = Number(q.correct_index);
    const question = String(q.question ?? "").trim();
    if (!question || options.length !== 4 || new Set(options).size !== 4 || !Number.isInteger(correct) || correct < 0 || correct > 3) {
      continue;
    }
    out.push({
      topic: normalizeTopic(q.topic),
      question,
      options,
      correct_index: correct,
      explanation: String(q.explanation ?? "").trim() || "Lihat kembali materi produk pada tab 4P & Kompetitor.",
    });
  }
  if (out.length < QUIZ_QUESTION_COUNT) throw new Error("Kuis yang dihasilkan kurang lengkap.");
  return out.slice(0, QUIZ_QUESTION_COUNT);
}

/** Acak urutan opsi agar posisi jawaban benar tidak selalu sama (LLM cenderung memilih A). */
function shuffleOptions(q: Omit<SealedQuestion, "id">): Omit<SealedQuestion, "id"> {
  const order = [0, 1, 2, 3];
  for (let i = order.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { ...q, options: order.map((i) => q.options[i]), correct_index: order.indexOf(q.correct_index) };
}

export async function generateQuiz(userId: string, product: OwnProduct, competitors: CompetitorProduct[]) {
  const openai = getOpenAI();
  let questions: Omit<SealedQuestion, "id">[] | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2 && !questions; attempt++) {
    try {
      const completion = await openai.chat.completions.create({
        model: CHAT_MODEL,
        response_format: { type: "json_object" },
        temperature: 0.8,
        max_tokens: 1800,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: productBrief(product, competitors) },
        ],
      });
      questions = parseQuestions(completion.choices[0]?.message?.content ?? "");
    } catch (err) {
      lastError = err;
    }
  }
  if (!questions) throw lastError instanceof Error ? lastError : new Error("Gagal membuat kuis.");

  const now = new Date();
  const sealed: SealedQuiz = {
    quiz_id: randomBytes(12).toString("base64url"),
    user_id: userId,
    product_id: product.id,
    product_code: product.product_code,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + QUIZ_TTL_MINUTES * 60_000).toISOString(),
    model: CHAT_MODEL,
    questions: questions.map((q, i) => ({ ...shuffleOptions(q), id: i + 1 })),
  };

  return {
    token: seal(QUIZ_TOKEN_PURPOSE, sealed),
    expiresAt: sealed.expires_at,
    publicQuestions: sealed.questions.map(({ id, question, options, topic }) => ({ id, question, options, topic })),
  };
}

export function openQuizToken(token: unknown): SealedQuiz | null {
  if (typeof token !== "string" || token.length < 40 || token.length > 20_000) return null;
  return unseal<SealedQuiz>(QUIZ_TOKEN_PURPOSE, token);
}

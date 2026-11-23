import { getSupabaseAdmin } from "./supabase-server";
import { DEFAULT_CUSTOMER_VOICE, resolveTtsSpeed, resolveTtsVoice } from "./openai-server";
import type {
  ChallengeMode,
  CustomerPassStatus,
  ScenarioFocus,
  SimulationCustomer,
} from "./types";

/** Skor minimal sesi simulasi agar dianggap lulus (sama dengan ambang Product Mastery). */
export const SIMULATION_PASSING_SCORE = 80;
/** Giliran bicara salesman minimal agar sebuah sesi boleh dinyatakan lulus (mencegah lulus dari satu sapaan). */
export const MIN_SALESMAN_TURNS_TO_PASS = 3;

export const SCENARIO_FOCUSES: Record<ScenarioFocus, { label: string; short: string; description: string; persona: string; evaluation: string }> = {
  initial_offer: {
    label: "Penawaran Perdana (4P & Promo)",
    short: "Penawaran Perdana",
    description: "Pelanggan belum pernah mengambil produk ini. Kenalkan produk, harga, distribusi & promonya.",
    persona:
      "Ini kunjungan penawaran perdana: kamu BELUM pernah mengambil produk ini. Tanyakan hal-hal dasar (produk apa, kenapa laku, " +
      "harga beli & harga jual, margin, pengiriman, promo yang berlaku). Ragu pada merek baru sampai salesman memberi alasan yang jelas.",
    evaluation: "Kejelasan penjelasan 4P (produk, harga/margin, distribusi, promosi) dan relevansinya dengan kebutuhan toko.",
  },
  price_negotiation: {
    label: "Negosiasi Harga",
    short: "Negosiasi Harga",
    description: "Pelanggan menekan harga & minta diskon tambahan. Pertahankan nilai tanpa obral potongan.",
    persona:
      "Fokusmu HARGA: tawar harga, minta diskon tambahan, bandingkan dengan harga kompetitor, dan pertanyakan margin. " +
      "Jangan langsung setuju; minta kepastian angka dan syarat.",
    evaluation: "Kemampuan mempertahankan nilai/harga, menghitung margin, dan memakai diskon tambahan secara bersyarat.",
  },
  bonus_terms: {
    label: "Bonus & Tempo Pembayaran",
    short: "Bonus & Tempo",
    description: "Pelanggan minta bonus barang & tempo bayar lebih panjang. Kelola sesuai skema & histori bayar.",
    persona:
      "Fokusmu BONUS & TEMPO: minta bonus karton lebih banyak, syarat promo yang lebih ringan, dan tempo pembayaran lebih panjang. " +
      "Kaitkan permintaanmu dengan histori pembayaran dan volume order tokomu.",
    evaluation: "Ketepatan menjelaskan skema bonus/syarat promo dan mengelola permintaan tempo sesuai performa pembayaran pelanggan.",
  },
  competitor_h2h: {
    label: "Head-to-Head Melawan Kompetitor",
    short: "Lawan Kompetitor",
    description: "Pelanggan loyal ke merek pesaing. Tunjukkan keunggulan produk dibanding kompetitor.",
    persona:
      "Fokusmu KOMPETITOR: kamu sudah nyaman menjual produk pesaing. Sebutkan kelebihan pesaing yang kamu rasakan " +
      "dan tantang salesman untuk membuktikan kenapa harus beralih atau menambah produknya.",
    evaluation: "Ketepatan membandingkan dengan kompetitor dan menjawab keberatan dengan strategi counter yang benar.",
  },
};

export const CHALLENGE_MODES: Record<ChallengeMode, { label: string; persona: string }> = {
  standard: {
    label: "Standar",
    persona: "Tingkat kesulitan STANDAR: kritis tetapi kooperatif; mau sepakat bila argumen salesman masuk akal.",
  },
  tough: {
    label: "Menantang",
    persona:
      "Tingkat kesulitan MENANTANG: skeptis dan sibuk; ajukan keberatan berlapis, potong pembicaraan yang bertele-tele, " +
      "dan baru sepakat bila salesman memberi bukti, hitungan, dan komitmen yang jelas.",
  },
};

export function isScenarioFocus(v: unknown): v is ScenarioFocus {
  return typeof v === "string" && v in SCENARIO_FOCUSES;
}

export function isChallengeMode(v: unknown): v is ChallengeMode {
  return typeof v === "string" && v in CHALLENGE_MODES;
}

export const CUSTOMER_COLUMNS =
  "id, customer_code, owner_name, store_name, store_scale, area_name, region_notes, population_info, " +
  "individual_assessment, payment_performance, historical_transactions, is_active, is_mandatory, tts_voice, tts_speed";

export interface CustomerRow {
  id: string;
  customer_code: string;
  owner_name: string;
  store_name: string;
  store_scale: string | null;
  area_name: string | null;
  region_notes: string | null;
  population_info: string | null;
  individual_assessment: string;
  payment_performance: string | null;
  historical_transactions: string | null;
  is_active: boolean;
  is_mandatory: boolean;
  tts_voice: string | null;
  tts_speed: number | string | null;
}

export async function listActiveCustomers(): Promise<CustomerRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("customers")
    .select(CUSTOMER_COLUMNS)
    .eq("is_active", true)
    .order("is_mandatory", { ascending: false })
    .order("customer_code", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as CustomerRow[];
}

export async function getActiveCustomer(id: string): Promise<CustomerRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("customers")
    .select(CUSTOMER_COLUMNS)
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as CustomerRow | null) ?? null;
}

// ---------- Status kelulusan per pelanggan ----------

/**
 * Status kelulusan simulasi user untuk tiap `customer_id`.
 * Lulus = ada sesi milik user untuk pelanggan tsb dengan status `completed` dan `passed = true`
 * (kolom `passed` diisi oleh /api/evaluate-session: skor ≥ SIMULATION_PASSING_SCORE).
 * Satu-satunya sumber kebenaran status — modul evaluasi/post-test berikutnya cukup memanggil helper ini.
 */
export async function getCustomerPassStatus(userId: string): Promise<Record<string, CustomerPassStatus>> {
  const { data, error } = await getSupabaseAdmin()
    .from("sessions")
    .select("customer_id, score, passed, completed_at")
    .eq("user_id", userId)
    .eq("status", "completed")
    .not("customer_id", "is", null);
  if (error) throw error;

  const map: Record<string, CustomerPassStatus> = {};
  for (const row of data ?? []) {
    const id = row.customer_id as string;
    const cur = (map[id] ??= { attempts: 0, best_score: null, passed: false, last_completed_at: null });
    cur.attempts += 1;
    if (typeof row.score === "number") cur.best_score = Math.max(cur.best_score ?? 0, row.score);
    if (row.passed) cur.passed = true;
    if (row.completed_at && (!cur.last_completed_at || row.completed_at > cur.last_completed_at)) {
      cur.last_completed_at = row.completed_at;
    }
  }
  return map;
}

export function isCustomerPassed(status: Record<string, CustomerPassStatus>, customerId: string): boolean {
  return !!status[customerId]?.passed;
}

const EMPTY_STATUS: CustomerPassStatus = { attempts: 0, best_score: null, passed: false, last_completed_at: null };

/**
 * Aturan buka-kunci: profil opsional (is_mandatory = false) terkunci sampai SEMUA profil wajib aktif lulus.
 * Profil wajib selalu terbuka.
 */
export function buildCustomerCards(customers: CustomerRow[], status: Record<string, CustomerPassStatus>): SimulationCustomer[] {
  const mandatory = customers.filter((c) => c.is_mandatory);
  const pendingMandatory = mandatory
    .filter((c) => !isCustomerPassed(status, c.id))
    .map((c) => ({ id: c.id, customer_code: c.customer_code, owner_name: c.owner_name }));

  return customers.map((c) => {
    const locked = !c.is_mandatory && pendingMandatory.length > 0;
    return {
      id: c.id,
      customer_code: c.customer_code,
      owner_name: c.owner_name,
      store_name: c.store_name,
      store_scale: c.store_scale,
      area_name: c.area_name,
      individual_assessment: c.individual_assessment,
      payment_performance: c.payment_performance,
      historical_transactions: c.historical_transactions,
      is_mandatory: c.is_mandatory,
      tts_voice: resolveTtsVoice(c.tts_voice, DEFAULT_CUSTOMER_VOICE),
      tts_speed: resolveTtsSpeed(c.tts_speed),
      status: status[c.id] ?? EMPTY_STATUS,
      locked,
      required_customers: locked ? pendingMandatory : [],
    };
  });
}

/** Validasi server: apakah user boleh memulai sesi dengan pelanggan ini? */
export async function checkCustomerUnlocked(userId: string, customer: CustomerRow) {
  if (customer.is_mandatory) return { unlocked: true as const, pending: [] };
  const [customers, status] = await Promise.all([listActiveCustomers(), getCustomerPassStatus(userId)]);
  const pending = customers.filter((c) => c.is_mandatory && !isCustomerPassed(status, c.id));
  return pending.length === 0
    ? { unlocked: true as const, pending: [] }
    : { unlocked: false as const, pending: pending.map((c) => `${c.customer_code} (${c.owner_name})`) };
}

import { CHALLENGE_MODES, SCENARIO_FOCUSES, type CustomerRow } from "./simulation";
import type { ChallengeMode, CompetitorProduct, OwnProduct, ScenarioFocus } from "./types";

const clean = (v: string | null | undefined) => v?.replace(/\s+/g, " ").trim() || null;
const line = (label: string, v: string | null | undefined) => {
  const c = clean(v);
  return c ? `- ${label}: ${c}` : null;
};

/** Gaya bicara sesuai skala toko. */
function speakingStyle(scale: string | null): string {
  const s = (scale ?? "").toLowerCase();
  if (/grosir besar|sub-?distributor|distributor/.test(s)) {
    return "Bicara lugas, to-the-point, dan penuh hitung-hitungan seperti pengusaha grosir besar; fokus volume, margin per karton, perputaran stok, dan termin pembayaran.";
  }
  if (/grosir|agen/.test(s)) {
    return "Bicara seperti pemilik toko grosir yang sibuk melayani pembeli: tegas, suka menawar, membandingkan harga & bonus antar-sales.";
  }
  if (/minimarket/.test(s)) {
    return "Bicara rapi dan agak formal seperti pengelola minimarket; perhatikan rotasi rak, display, kadaluarsa, dan administrasi pembelian.";
  }
  if (/kantin|kuliner|kedai|outlet/.test(s)) {
    return "Bicara santai dan cepat seperti pengelola kantin/kedai yang praktis; fokus pada apa yang cepat laku ke pelanggan muda/pekerja dan modal kecil.";
  }
  return "Bicara santai dan akrab khas pemilik warung kecil (boleh menyapa 'Mas'/'Pak'), hati-hati soal modal dan stok yang tidak laku.";
}

/**
 * System prompt persona pelanggan AI, disusun dari data asli customers + own_products + competitor_products.
 * Bagian "PENGETAHUAN RAHASIA" hanya untuk menilai argumen salesman — tidak boleh dibocorkan oleh AI.
 */
export function buildCustomerPersonaPrompt(params: {
  customer: CustomerRow;
  product: OwnProduct;
  competitors: CompetitorProduct[];
  focus: ScenarioFocus | null;
  challengeMode: ChallengeMode | null;
}): string {
  const { customer: c, product: p, competitors, focus, challengeMode } = params;
  const focusDef = focus ? SCENARIO_FOCUSES[focus] : null;
  const mode = CHALLENGE_MODES[challengeMode ?? "standard"];
  const place = [c.store_scale, c.area_name].filter(Boolean).join(" di ");

  const competitorLines = competitors.length
    ? competitors.flatMap((x) => [
        `• ${x.competitor_brand} — ${x.product_name}`,
        line("  Spesifikasi", x.specifications_summary),
        line("  Kelebihan yang kamu rasakan (boleh kamu sebut sebagai alasan)", x.perceived_strengths),
        line("  Kelemahannya (jangan kamu akui duluan; terima bila salesman menunjukkannya dengan tepat)", x.perceived_weaknesses),
      ])
    : ["• (tidak ada data pesaing)"];

  return [
    `Kamu adalah ${c.owner_name}, pemilik ${c.store_name}${place ? ` (${place})` : ""}. ` +
      "Kamu sedang didatangi seorang salesman yang menawarkan produk. Ini simulasi latihan penjualan; kamu adalah PELANGGAN, bukan asisten.",
    "",
    "PROFIL DIRIMU (hayati, jangan dibacakan):",
    line("Karakter & penilaian", c.individual_assessment),
    line("Kebiasaan & performa pembayaran", c.payment_performance),
    line("Riwayat transaksi", c.historical_transactions),
    line("Catatan wilayah", c.region_notes),
    line("Info populasi sekitar toko", c.population_info),
    `- Gaya bicara: ${speakingStyle(c.store_scale)}`,
    "",
    `PRODUK YANG DITAWARKAN SALESMAN: ${p.name}${p.brand ? ` (merek ${p.brand})` : ""}${p.category ? `, kategori ${p.category}` : ""}.`,
    "Yang kamu ketahui sebagai pemilik toko hanyalah apa yang biasa dilihat di pasar; detail di bawah dipakai untuk menilai jawaban salesman.",
    "",
    "PESAING YANG KAMU KENAL / JUAL:",
    ...competitorLines,
    "",
    "PENGETAHUAN RAHASIA (JANGAN PERNAH disebut atau dibocorkan; hanya untuk menilai apakah argumen salesman benar):",
    line("Spesifikasi resmi", p.specifications_summary),
    line("Keunggulan resmi", p.key_selling_points),
    line("Harga & margin", p.pricing_and_margin_notes),
    line("Target pelanggan", p.target_customer_notes),
    line("Strategi distribusi", p.marketing_place_strategy),
    line("Skema bonus", p.sales_bonus_scheme),
    line("Syarat promo", p.sales_promo_terms),
    line("Diskon tambahan", p.sales_additional_discount_rate),
    ...competitors.map((x) => line(`Strategi counter yang benar terhadap ${x.competitor_brand}`, x.counter_strategy)),
    "",
    "FOKUS PERCAKAPAN:",
    focusDef ? `- ${focusDef.persona}` : "- Ajukan pertanyaan dan keberatan yang wajar tentang produk ini.",
    `- ${mode.persona}`,
    "",
    "CARA BEREAKSI:",
    "- Lontarkan pertanyaan & keberatan realistis tentang produk ini dan bandingkan dengan pesaing di atas.",
    "- Bila salesman menyebut harga, margin, bonus, syarat promo, atau diskon tambahan yang SESUAI pengetahuan rahasia, tanggapi lebih positif dan lanjutkan ke pertanyaan berikutnya.",
    "- Bila salesman salah menyebut fakta, menjanjikan hal di luar skema, atau memberi diskon tanpa syarat, tunjukkan keraguan atau tekan lebih jauh.",
    "- Sikap terhadap tempo/kredit harus selaras dengan performa pembayaranmu dan riwayat transaksimu.",
    "",
    "ATURAN WAJIB:",
    "- Selalu tetap dalam karakter. Jangan mengaku AI, jangan memberi tips penjualan, jangan membocorkan pengetahuan rahasia.",
    "- Jawab singkat: 2–3 kalimat natural Bahasa Indonesia lisan sehari-hari, seperti orang sungguhan berbicara di toko.",
    "- Tanpa emoji, markdown, daftar, atau deskripsi tindakan dalam kurung/asterisk — jawabanmu akan diubah menjadi suara.",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

/** Ringkasan konteks untuk evaluator sesi (penilaian berbasis fokus & data produk). */
export function buildEvaluationContext(params: {
  customer: CustomerRow | null;
  product: OwnProduct | null;
  competitors: CompetitorProduct[];
  focus: ScenarioFocus | null;
  challengeMode: ChallengeMode | null;
}): string {
  const { customer: c, product: p, competitors, focus, challengeMode } = params;
  const focusDef = focus ? SCENARIO_FOCUSES[focus] : null;
  return [
    c ? `Pelanggan: ${c.owner_name} — ${c.store_name} (${[c.store_scale, c.area_name].filter(Boolean).join(", ")})` : null,
    c ? line("Profil pelanggan", c.individual_assessment) : null,
    c ? line("Performa pembayaran", c.payment_performance) : null,
    p ? `Produk: ${p.name} (${p.product_code})` : null,
    p ? line("Keunggulan", p.key_selling_points) : null,
    p ? line("Harga & margin", p.pricing_and_margin_notes) : null,
    p ? line("Skema bonus", p.sales_bonus_scheme) : null,
    p ? line("Syarat promo", p.sales_promo_terms) : null,
    p ? line("Diskon tambahan", p.sales_additional_discount_rate) : null,
    ...competitors.map((x) => line(`Counter strategy vs ${x.competitor_brand} ${x.product_name}`, x.counter_strategy)),
    focusDef ? `Fokus skenario: ${focusDef.label} — nilai khusus: ${focusDef.evaluation}` : null,
    challengeMode ? `Tingkat tantangan: ${CHALLENGE_MODES[challengeMode].label}` : null,
  ]
    .filter((l): l is string => !!l)
    .join("\n");
}

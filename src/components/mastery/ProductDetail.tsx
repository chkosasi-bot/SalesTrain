"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CircleExclamationPoint,
  ClipboardList,
  Megaphone,
  MapPin,
  Mic,
  Package,
  Percent,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Swords,
  Target,
  Wallet,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { MasteryDetailResponse, MasteryStatus } from "@/lib/types";
import StatusPill from "./StatusPill";
import QuizPanel from "./QuizPanel";

type Tab = "4p" | "competitor" | "quiz";

const TABS: { id: Tab; label: string; short: string }[] = [
  { id: "4p", label: "4P & Promo", short: "4P & Promo" },
  { id: "competitor", label: "Kompetitor (Battlecard)", short: "Kompetitor" },
  { id: "quiz", label: "Kuis Pemahaman", short: "Kuis" },
];

function Field({ label, value, icon }: { label: string; value: string | null | undefined; icon?: ReactNode }) {
  if (!value?.trim()) return null;
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        {icon}
        {label}
      </p>
      <p className="mt-1 whitespace-pre-line text-[15px] leading-relaxed">{value.trim()}</p>
    </div>
  );
}

function PCard({ letter, title, icon, children }: { letter: string; title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 md:p-5">
      <h3 className="flex items-center gap-2.5 font-semibold">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand text-sm font-bold text-on-brand">{letter}</span>
        <span className="flex items-center gap-1.5">
          {icon}
          {title}
        </span>
      </h3>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

export default function ProductDetail() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [data, setData] = useState<MasteryDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("4p");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    apiFetch<MasteryDetailResponse>(`/api/mastery/${encodeURIComponent(id)}`, { signal: controller.signal })
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Gagal memuat produk.");
      });
    return () => controller.abort();
  }, [id, reloadKey]);

  const onStatusChange = useCallback((status: MasteryStatus) => {
    setData((d) => (d ? { ...d, status } : d));
    // Muat ulang riwayat di latar belakang.
    setReloadKey((k) => k + 1);
  }, []);

  if (error) {
    return (
      <main className="px-4 py-6 md:px-8">
        <Link href="/mastery" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Semua produk
        </Link>
        <div className="mt-4 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm">
          <p className="flex items-start gap-2 text-danger">
            <CircleExclamationPoint className="mt-0.5 h-5 w-5 shrink-0" aria-hidden /> {error}
          </p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setReloadKey((k) => k + 1);
            }}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-surface px-3 py-2 font-medium text-ink ring-1 ring-line"
          >
            <RotateCcw className="h-4 w-4" aria-hidden /> Coba Lagi
          </button>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="space-y-3 px-4 py-6 md:px-8" aria-busy="true" aria-label="Memuat produk">
        <div className="h-6 w-40 animate-pulse rounded bg-surface-2" />
        <div className="h-24 animate-pulse rounded-2xl border border-line bg-surface" />
        <div className="h-64 animate-pulse rounded-2xl border border-line bg-surface" />
      </main>
    );
  }

  const p = data.product;

  return (
    <main className="px-4 py-5 md:px-8 md:py-6">
      <Link href="/mastery" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Semua produk
      </Link>

      <header className="mt-3">
        <p className="text-xs font-medium text-muted">
          <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">{p.product_code}</span>
          {p.brand && <span className="ml-1.5">{p.brand}</span>}
          {p.category && <span className="ml-1.5">· {p.category}</span>}
        </p>
        <h1 className="mt-1.5 text-xl font-bold leading-snug">{p.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusPill status={data.status} threshold={data.passing_threshold} />
          <Link
            href={`/?product_id=${p.id}`}
            className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1 text-xs font-semibold text-on-brand transition hover:bg-brand-strong"
          >
            <Mic className="h-3.5 w-3.5" aria-hidden /> Latih di Simulasi
          </Link>
        </div>
      </header>

      <div role="tablist" aria-label="Materi produk" className="sticky top-0 z-10 -mx-4 mt-4 bg-bg/95 px-4 py-2 backdrop-blur md:-mx-8 md:px-8">
        <div className="grid grid-cols-3 gap-1 rounded-2xl bg-surface-2 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`rounded-xl px-2 py-2.5 text-xs font-semibold transition sm:text-sm ${
                tab === t.id ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              <span className="sm:hidden">{t.short}</span>
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {tab === "4p" && (
        <div id="panel-4p" role="tabpanel" aria-labelledby="tab-4p" className="mt-3 space-y-3">
          <PCard letter="P" title="Product" icon={<Package className="h-4 w-4 text-muted" aria-hidden />}>
            <Field label="Strategi Produk" value={p.marketing_product_strategy} />
            <Field label="Spesifikasi" value={p.specifications_summary} />
            <Field label="Keunggulan Utama (Selling Points)" value={p.key_selling_points} />
          </PCard>
          <PCard letter="P" title="Price" icon={<Wallet className="h-4 w-4 text-muted" aria-hidden />}>
            <Field label="Strategi Harga" value={p.marketing_price_strategy} />
            <Field label="Harga & Margin" value={p.pricing_and_margin_notes} />
          </PCard>
          <PCard letter="P" title="Place" icon={<MapPin className="h-4 w-4 text-muted" aria-hidden />}>
            <Field label="Strategi Distribusi" value={p.marketing_place_strategy} />
            <Field label="Target Pelanggan" value={p.target_customer_notes} icon={<Target className="h-3.5 w-3.5" aria-hidden />} />
          </PCard>
          <PCard letter="P" title="Promotion" icon={<Megaphone className="h-4 w-4 text-muted" aria-hidden />}>
            <Field label="Strategi Promosi" value={p.marketing_promotion_strategy} />
            <Field label="Skema Bonus Sales" value={p.sales_bonus_scheme} />
            <Field label="Syarat Promo" value={p.sales_promo_terms} />
            <Field label="Diskon Tambahan" value={p.sales_additional_discount_rate} icon={<Percent className="h-3.5 w-3.5" aria-hidden />} />
          </PCard>
          <button
            type="button"
            onClick={() => setTab("competitor")}
            className="w-full rounded-2xl border border-line bg-surface px-4 py-3 text-sm font-semibold text-brand transition hover:bg-surface-2"
          >
            Lanjut: Battlecard Kompetitor →
          </button>
        </div>
      )}

      {tab === "competitor" && (
        <div id="panel-competitor" role="tabpanel" aria-labelledby="tab-competitor" className="mt-3 space-y-3">
          {data.competitors.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface p-6 text-center text-sm text-muted">
              Belum ada data kompetitor aktif untuk produk ini.
            </div>
          ) : (
            data.competitors.map((c) => (
              <article key={c.id} className="overflow-hidden rounded-2xl border border-line bg-surface">
                <header className="border-b border-line bg-surface-2 px-4 py-3">
                  <p className="text-xs font-medium text-muted">
                    <span className="font-mono">{c.competitor_code}</span> · {c.competitor_brand}
                  </p>
                  <h3 className="mt-0.5 flex items-center gap-1.5 font-semibold">
                    <Swords className="h-4 w-4 text-brand" aria-hidden /> {c.product_name}
                  </h3>
                </header>
                <div className="space-y-4 p-4">
                  <Field label="Spesifikasi" value={c.specifications_summary} icon={<ClipboardList className="h-3.5 w-3.5" aria-hidden />} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    {c.perceived_strengths?.trim() && (
                      <div className="rounded-xl bg-danger-soft p-3">
                        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-danger">
                          <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Kekuatan mereka
                        </p>
                        <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{c.perceived_strengths.trim()}</p>
                      </div>
                    )}
                    {c.perceived_weaknesses?.trim() && (
                      <div className="rounded-xl bg-success-soft p-3">
                        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-success">
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Kelemahan mereka
                        </p>
                        <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{c.perceived_weaknesses.trim()}</p>
                      </div>
                    )}
                  </div>
                  <div className="rounded-xl border border-brand/30 bg-brand-soft p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-brand-strong">Strategi Menghadapi (Counter)</p>
                    <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">{c.counter_strategy}</p>
                  </div>
                </div>
              </article>
            ))
          )}
          <button
            type="button"
            onClick={() => setTab("quiz")}
            className="w-full rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-on-brand transition hover:bg-brand-strong"
          >
            Siap? Uji Pemahaman dengan Kuis →
          </button>
        </div>
      )}

      {/* Panel kuis tetap ter-mount saat berpindah tab agar jawaban yang sedang dikerjakan tidak hilang. */}
      <div id="panel-quiz" role="tabpanel" aria-labelledby="tab-quiz" className="mt-3" hidden={tab !== "quiz"}>
          <QuizPanel
            productId={p.id}
            productName={p.name}
            passingThreshold={data.passing_threshold}
            status={data.status}
            history={data.history}
            onStatusChange={onStatusChange}
          />
      </div>
    </main>
  );
}

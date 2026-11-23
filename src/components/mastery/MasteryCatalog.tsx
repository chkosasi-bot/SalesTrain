"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpenCheck, ChevronRight, CircleExclamationPoint, Gift, Mic, RotateCcw, Swords, Tag } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { MasteryListResponse } from "@/lib/types";
import StatusPill from "./StatusPill";

function excerpt(text: string | null, max = 140) {
  if (!text) return null;
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

export default function MasteryCatalog() {
  const [data, setData] = useState<MasteryListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<MasteryListResponse>("/api/mastery", { signal: controller.signal })
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Gagal memuat materi produk.");
      });
    return () => controller.abort();
  }, [reloadKey]);

  const summary = data?.summary;
  const progress = summary && summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : 0;

  return (
    <main className="space-y-5 px-4 py-5 md:px-8 md:py-6">
      <section>
        <h1 className="flex items-center gap-2 text-lg font-bold md:text-xl">
          <BookOpenCheck className="h-6 w-6 text-brand" aria-hidden /> Product Mastery
        </h1>
        <p className="mt-1 text-sm text-muted">
          Pelajari 4P, promo & battlecard kompetitor, lalu lulus kuis (min. {summary?.passing_threshold ?? 80}) sebelum
          simulasi negosiasi.
        </p>

        {summary && summary.total > 0 && (
          <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">Progres kelulusan</span>
              <span className="tabular-nums text-muted">
                {summary.passed}/{summary.total} produk
              </span>
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <div
                className={`h-full rounded-full transition-all ${summary.all_passed ? "bg-success" : "bg-brand"}`}
                style={{ width: `${progress}%` }}
              />
            </div>
            {summary.all_passed && (
              <Link
                href="/"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-success hover:underline"
              >
                <Mic className="h-4 w-4" aria-hidden /> Semua lulus — lanjut ke simulasi
              </Link>
            )}
          </div>
        )}
      </section>

      {!data && !error && (
        <div className="space-y-3" aria-busy="true" aria-label="Memuat produk">
          {[0, 1].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl border border-line bg-surface" />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm">
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
      )}

      {data && data.products.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line bg-surface p-6 text-center text-sm text-muted">
          Belum ada produk aktif. Tambahkan data di tabel <code>own_products</code> dengan <code>is_active = true</code>.
        </div>
      )}

      {data && data.products.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2">
          {data.products.map((p) => {
            const promo = excerpt(p.sales_promo_terms);
            const bonus = excerpt(p.sales_bonus_scheme);
            return (
              <li key={p.id}>
                <Link
                  href={`/mastery/${p.id}`}
                  className="flex h-full flex-col rounded-2xl border border-line bg-surface p-4 transition hover:border-brand/50 hover:shadow-sm active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted">
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">{p.product_code}</span>
                        {p.brand && <span className="ml-1.5">{p.brand}</span>}
                      </p>
                      <h2 className="mt-1.5 font-semibold leading-snug">{p.name}</h2>
                      {p.category && <p className="text-xs text-muted">{p.category}</p>}
                    </div>
                    <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-muted" aria-hidden />
                  </div>

                  {(bonus || promo) && (
                    <div className="mt-3 space-y-1.5 text-xs">
                      {bonus && (
                        <p className="flex gap-1.5">
                          <Gift className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
                          <span>
                            <span className="font-semibold">Bonus:</span> <span className="text-muted">{bonus}</span>
                          </span>
                        </p>
                      )}
                      {promo && (
                        <p className="flex gap-1.5">
                          <Tag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
                          <span>
                            <span className="font-semibold">Promo:</span> <span className="text-muted">{promo}</span>
                          </span>
                        </p>
                      )}
                    </div>
                  )}

                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                    <StatusPill status={p.status} threshold={data.summary.passing_threshold} />
                    {p.competitor_count > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted">
                        <Swords className="h-3.5 w-3.5" aria-hidden /> {p.competitor_count} kompetitor
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

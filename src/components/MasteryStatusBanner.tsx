"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpenCheck, ChevronRight, CircleCheck } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { MasteryListResponse } from "@/lib/types";

/** Indikator kelulusan Product Mastery di halaman simulasi (informatif, tidak memblokir simulasi). */
export default function MasteryStatusBanner() {
  const [data, setData] = useState<MasteryListResponse["summary"] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<MasteryListResponse>("/api/mastery", { signal: controller.signal })
      .then((r) => setData(r.summary))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  if (!data) return <div className="h-[60px] animate-pulse rounded-2xl border border-line bg-surface" aria-hidden />;
  if (data.total === 0) return null;

  const done = data.all_passed;
  return (
    <Link
      href="/mastery"
      className={`flex items-center gap-3 rounded-2xl border p-3 transition hover:shadow-sm ${
        done ? "border-success/30 bg-success-soft" : "border-warning/30 bg-warning-soft"
      }`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          done ? "bg-success text-white" : "bg-warning text-white"
        }`}
      >
        {done ? <CircleCheck className="h-5 w-5" aria-hidden /> : <BookOpenCheck className="h-5 w-5" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-semibold ${done ? "text-success" : "text-warning"}`}>
          {done ? "Product Mastery: Lulus" : "Product Mastery: Belum Lulus"}
        </span>
        <span className="block text-xs text-muted">
          {data.passed}/{data.total} produk lulus kuis (min. {data.passing_threshold}).{" "}
          {done ? "Siap bernegosiasi!" : "Pelajari materi dulu agar simulasi lebih lancar."}
        </span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-ink">
        {done ? "Materi" : "Belajar"} <ChevronRight className="h-4 w-4" aria-hidden />
      </span>
    </Link>
  );
}

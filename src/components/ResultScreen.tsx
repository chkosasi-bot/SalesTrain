"use client";

import { CircleCheck, CircleX, Lightbulb, RotateCcw, Sparkles, ThumbsUp } from "lucide-react";
import type { Evaluation, SessionContext } from "@/lib/types";
import type { ReactNode } from "react";

interface Props {
  evaluation: Evaluation;
  context: SessionContext;
  salesmanName: string;
  onRestart: () => void;
  userSlot?: ReactNode;
}

function grade(score: number) {
  if (score >= 85) return { label: "Luar Biasa", tone: "text-success", ring: "var(--success)" };
  if (score >= 70) return { label: "Bagus", tone: "text-brand", ring: "var(--brand)" };
  if (score >= 50) return { label: "Cukup", tone: "text-warning", ring: "var(--warning)" };
  return { label: "Perlu Latihan", tone: "text-danger", ring: "var(--danger)" };
}

export default function ResultScreen({ evaluation, context, salesmanName, onRestart, userSlot }: Props) {
  const g = grade(evaluation.score);
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - evaluation.score / 100);

  return (
    <div className="flex min-h-dvh flex-col md:min-h-0">
      <main className="pt-safe flex-1 space-y-5 px-4 py-6 md:px-8 md:py-8">
        {userSlot && <div className="border-b border-line pb-3">{userSlot}</div>}
        <div className="text-center">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand-strong">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Hasil Evaluasi
          </p>
          <h1 className="mt-3 text-lg font-bold md:text-xl">
            {context.customer ? `${context.customer.owner_name} — ${context.customer.store_name}` : context.title}
          </h1>
          {(context.product || context.focus) && (
            <p className="text-sm text-muted">
              {[context.product?.name, context.focus?.label].filter(Boolean).join(" · ")}
            </p>
          )}
          {salesmanName.trim() && <p className="text-sm text-muted">Salesman: {salesmanName.trim()}</p>}
        </div>

        <section className="flex flex-col items-center rounded-2xl border border-line bg-surface p-6">
          <div className="relative h-36 w-36">
            <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden>
              <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--surface-2)" strokeWidth="10" />
              <circle
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={g.ring}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                style={{ transition: "stroke-dashoffset 900ms ease-out" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-4xl font-bold tabular-nums">{evaluation.score}</span>
              <span className="text-xs text-muted">dari 100</span>
            </div>
          </div>
          <p className={`mt-3 text-base font-semibold ${g.tone}`}>{g.label}</p>
          <p
            className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              evaluation.passed ? "bg-success-soft text-success" : "bg-warning-soft text-warning"
            }`}
          >
            {evaluation.passed ? <CircleCheck className="h-3.5 w-3.5" aria-hidden /> : <CircleX className="h-3.5 w-3.5" aria-hidden />}
            {evaluation.passed
              ? `Lulus profil ${context.customer?.customer_code ?? "ini"} (min. ${evaluation.passing_score})`
              : `Belum lulus — butuh skor ${evaluation.passing_score}`}
          </p>
          <p className="mt-2 max-w-prose text-center text-sm leading-relaxed text-muted">{evaluation.summary}</p>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="flex items-center gap-2 font-semibold text-success">
              <ThumbsUp className="h-5 w-5" aria-hidden /> Kelebihan
            </h2>
            <ul className="mt-3 space-y-2.5">
              {evaluation.strengths.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success-soft text-xs font-bold text-success">
                    {i + 1}
                  </span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="flex items-center gap-2 font-semibold text-warning">
              <Lightbulb className="h-5 w-5" aria-hidden /> Saran Perbaikan
            </h2>
            <ul className="mt-3 space-y-2.5">
              {evaluation.improvements.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-warning-soft text-xs font-bold text-warning">
                    {i + 1}
                  </span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>

      <footer className="pb-safe sticky bottom-0 border-t border-line bg-bg/90 px-4 pt-3 backdrop-blur md:static md:border-0 md:bg-transparent md:px-8 md:pb-8">
        <button
          type="button"
          onClick={onRestart}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand px-5 py-4 text-base font-semibold text-on-brand shadow-sm transition hover:bg-brand-strong active:scale-[0.99]"
        >
          <RotateCcw className="h-5 w-5" aria-hidden /> Latihan Lagi
        </button>
      </footer>
    </div>
  );
}

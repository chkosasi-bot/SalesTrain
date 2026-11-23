"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CircleCheck,
  CircleExclamationPoint,
  CircleX,
  History,
  LoaderCircle,
  Mic,
  RotateCcw,
  Sparkles,
  Trophy,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type {
  GenerateQuizResponse,
  MasteryAttemptSummary,
  MasteryStatus,
  QuizQuestionPublic,
  SubmitQuizResponse,
} from "@/lib/types";

interface Props {
  productId: string;
  productName: string;
  passingThreshold: number;
  status: MasteryStatus;
  history: MasteryAttemptSummary[];
  onStatusChange: (status: MasteryStatus) => void;
}

type Phase =
  | { kind: "intro" }
  | { kind: "generating" }
  | { kind: "answering"; token: string; questions: QuizQuestionPublic[]; answers: (number | null)[] }
  | { kind: "submitting"; token: string; questions: QuizQuestionPublic[]; answers: (number | null)[] }
  | { kind: "result"; result: SubmitQuizResponse };

const LETTERS = ["A", "B", "C", "D"];

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function QuizPanel({ productId, productName, passingThreshold, status, history, onStatusChange }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "intro" });
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    setPhase({ kind: "generating" });
    try {
      const quiz = await apiFetch<GenerateQuizResponse>(`/api/mastery/${productId}/generate-quiz`, { method: "POST" });
      setPhase({ kind: "answering", token: quiz.quizToken, questions: quiz.questions, answers: quiz.questions.map(() => null) });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyusun kuis.");
      setPhase({ kind: "intro" });
    }
  };

  const choose = (qi: number, oi: number) => {
    setPhase((ph) => {
      if (ph.kind !== "answering") return ph;
      const answers = [...ph.answers];
      answers[qi] = oi;
      return { ...ph, answers };
    });
  };

  const submit = async () => {
    if (phase.kind !== "answering" || phase.answers.some((a) => a === null)) return;
    const { token, questions, answers } = phase;
    setError(null);
    setPhase({ kind: "submitting", token, questions, answers });
    try {
      const result = await apiFetch<SubmitQuizResponse>(`/api/mastery/${productId}/submit-quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quizToken: token, answers }),
      });
      setPhase({ kind: "result", result });
      onStatusChange(result.status);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengirim jawaban.");
      setPhase({ kind: "answering", token, questions, answers });
    }
  };

  const errorBox = error && (
    <div role="alert" className="mb-3 flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-danger">
      <CircleExclamationPoint className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{error}</span>
    </div>
  );

  // ---------- Intro + riwayat ----------
  if (phase.kind === "intro" || phase.kind === "generating") {
    return (
      <div className="space-y-3">
        {errorBox}
        <section className="rounded-2xl border border-line bg-surface p-5 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
            <Sparkles className="h-6 w-6" aria-hidden />
          </div>
          <h2 className="mt-3 font-semibold">Kuis Pemahaman — {productName}</h2>
          <p className="mt-1 text-sm text-muted">
            5 soal pilihan ganda berbasis situasi lapangan, disusun AI dari materi 4P & kompetitor. Lulus jika skor ≥{" "}
            {passingThreshold}. Setiap kuis berisi soal baru.
          </p>
          {status.attempts > 0 && (
            <p className="mt-2 text-sm">
              Skor terbaik: <span className="font-semibold tabular-nums">{status.best_score}</span>
              {status.passed ? <span className="ml-1 font-semibold text-success">· Lulus</span> : null}
            </p>
          )}
          <button
            type="button"
            onClick={start}
            disabled={phase.kind === "generating"}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand px-5 py-3.5 font-semibold text-on-brand transition hover:bg-brand-strong disabled:opacity-60"
          >
            {phase.kind === "generating" ? (
              <>
                <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> Menyusun soal...
              </>
            ) : status.attempts > 0 ? (
              "Mulai Kuis Baru"
            ) : (
              "Mulai Kuis"
            )}
          </button>
        </section>

        {history.length > 0 && (
          <section className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <History className="h-4 w-4 text-muted" aria-hidden /> Riwayat Kuis
            </h3>
            <ul className="mt-2 divide-y divide-line">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-muted">{formatDate(h.created_at)}</span>
                  <span className={`font-semibold tabular-nums ${h.passed ? "text-success" : "text-warning"}`}>
                    {h.score} {h.passed ? "· Lulus" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  // ---------- Mengerjakan ----------
  if (phase.kind === "answering" || phase.kind === "submitting") {
    const answered = phase.answers.filter((a) => a !== null).length;
    const busy = phase.kind === "submitting";
    return (
      <div className="space-y-3">
        {errorBox}
        <p className="text-sm text-muted">
          Terjawab <span className="font-semibold text-ink tabular-nums">{answered}</span>/{phase.questions.length}
        </p>
        {phase.questions.map((q, qi) => (
          <fieldset key={q.id} className="rounded-2xl border border-line bg-surface p-4" disabled={busy}>
            <legend className="sr-only">Soal {qi + 1}</legend>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand">
              Soal {qi + 1} · {q.topic}
            </p>
            <p className="mt-1.5 text-[15px] font-medium leading-relaxed">{q.question}</p>
            <div className="mt-3 space-y-2">
              {q.options.map((opt, oi) => {
                const selected = phase.answers[qi] === oi;
                return (
                  <label
                    key={oi}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 text-sm transition ${
                      selected ? "border-brand bg-brand-soft" : "border-line hover:border-brand/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`q-${q.id}`}
                      className="sr-only"
                      checked={selected}
                      onChange={() => choose(qi, oi)}
                    />
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        selected ? "bg-brand text-on-brand" : "bg-surface-2 text-muted"
                      }`}
                    >
                      {LETTERS[oi]}
                    </span>
                    <span className="leading-relaxed">{opt}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
        <div className="pb-safe sticky bottom-0 -mx-4 bg-bg/95 px-4 pt-2 backdrop-blur md:static md:mx-0 md:bg-transparent md:px-0">
          <button
            type="button"
            onClick={submit}
            disabled={busy || answered < phase.questions.length}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand px-5 py-4 font-semibold text-on-brand transition hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <>
                <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> Menilai...
              </>
            ) : answered < phase.questions.length ? (
              `Jawab semua soal (${answered}/${phase.questions.length})`
            ) : (
              "Kirim Jawaban"
            )}
          </button>
        </div>
      </div>
    );
  }

  // ---------- Hasil & pembahasan ----------
  const r = phase.result;
  return (
    <div className="space-y-3">
      <section
        className={`rounded-2xl border p-5 text-center ${r.passed ? "border-success/30 bg-success-soft" : "border-warning/30 bg-warning-soft"}`}
      >
        <div
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${r.passed ? "bg-success" : "bg-warning"} text-white`}
        >
          {r.passed ? <Trophy className="h-7 w-7" aria-hidden /> : <RotateCcw className="h-7 w-7" aria-hidden />}
        </div>
        <p className="mt-3 text-4xl font-bold tabular-nums">{r.score}</p>
        <p className={`font-semibold ${r.passed ? "text-success" : "text-warning"}`}>
          {r.passed ? "Lulus!" : `Belum lulus (min. ${r.passing_threshold})`}
        </p>
        <p className="mt-1 text-sm text-muted">
          {r.correct_count} dari {r.total} jawaban benar
          {r.weak_topics.length > 0 && <> · perlu diperdalam: {r.weak_topics.join(", ")}</>}
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Link
            href={`/?product_id=${productId}`}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-3 font-semibold text-on-brand transition hover:bg-brand-strong"
          >
            <Mic className="h-5 w-5" aria-hidden /> Mulai Simulasi
          </Link>
          <button
            type="button"
            onClick={start}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3 font-semibold text-ink transition hover:bg-surface-2"
          >
            <RotateCcw className="h-5 w-5" aria-hidden /> Kuis Baru
          </button>
        </div>
      </section>

      <h3 className="pt-1 text-sm font-semibold">Pembahasan</h3>
      {r.review.map((q, qi) => (
        <article key={q.id} className="rounded-2xl border border-line bg-surface p-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
            {q.is_correct ? (
              <CircleCheck className="h-4 w-4 text-success" aria-hidden />
            ) : (
              <CircleX className="h-4 w-4 text-danger" aria-hidden />
            )}
            <span className={q.is_correct ? "text-success" : "text-danger"}>
              Soal {qi + 1} · {q.is_correct ? "Benar" : "Salah"}
            </span>
            <span className="text-muted">· {q.topic}</span>
          </p>
          <p className="mt-1.5 text-[15px] font-medium leading-relaxed">{q.question}</p>
          <ul className="mt-3 space-y-1.5">
            {q.options.map((opt, oi) => {
              const isCorrect = oi === q.correct_index;
              const isChosen = oi === q.selected_index;
              return (
                <li
                  key={oi}
                  className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 text-sm ${
                    isCorrect
                      ? "border-success/40 bg-success-soft"
                      : isChosen
                        ? "border-danger/40 bg-danger-soft"
                        : "border-line"
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      isCorrect ? "bg-success text-white" : isChosen ? "bg-danger text-white" : "bg-surface-2 text-muted"
                    }`}
                  >
                    {LETTERS[oi]}
                  </span>
                  <span className="flex-1 leading-relaxed">
                    {opt}
                    {isChosen && <span className="ml-1 text-xs font-semibold text-muted">(jawaban Anda)</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5 text-sm leading-relaxed">
            <span className="font-semibold">Penjelasan: </span>
            {q.explanation}
          </p>
        </article>
      ))}

      <Link
        href={`/?product_id=${productId}`}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand px-5 py-4 font-semibold text-on-brand transition hover:bg-brand-strong"
      >
        <Mic className="h-5 w-5" aria-hidden /> Lanjut ke Simulasi Roleplay
      </Link>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CircleCheck, CircleExclamationPoint, LoaderCircle, Mail, Monitor, Send, ShieldCheck } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { ConfirmInfoResponse, ConfirmResultResponse } from "@/lib/types";

type View =
  | { kind: "loading" }
  | { kind: "ask"; info: ConfirmInfoResponse }
  | { kind: "confirming"; info: ConfirmInfoResponse }
  | { kind: "signing_in" }
  | { kind: "verified" }
  | { kind: "error"; message: string };

interface Proof {
  accessToken: string | null;
  tokenHash: string | null;
  hashError: string | null;
}

/** Ambil token dari fragment (#access_token=...) lalu hapus dari address bar. */
function readAndClearHash(): Proof {
  const hash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
  const params = new URLSearchParams(hash);
  const proof: Proof = {
    accessToken: params.get("access_token"),
    tokenHash: null,
    hashError: params.get("error_description") || params.get("error"),
  };
  if (hash) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return proof;
}

export default function ConfirmLogin() {
  const searchParams = useSearchParams();
  const reqId = searchParams.get("req_id") ?? "";
  const secret = searchParams.get("secret") ?? "";
  const [view, setView] = useState<View>({ kind: "loading" });
  const proofRef = useRef<Proof | null>(null);
  const startedRef = useRef(false);

  const confirm = useCallback(
    async (info: ConfirmInfoResponse) => {
      setView(info.sameDevice ? { kind: "signing_in" } : { kind: "confirming", info });
      const proof = proofRef.current;
      try {
        const res = await apiFetch<ConfirmResultResponse>("/api/auth/confirm-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            req_id: reqId,
            secret,
            access_token: proof?.accessToken ?? undefined,
            token_hash: proof?.tokenHash ?? undefined,
          }),
        });
        if (res.result === "signed_in") {
          window.location.replace(new URL("/", window.location.origin).href);
          return;
        }
        setView({ kind: "verified" });
      } catch (err) {
        setView({ kind: "error", message: err instanceof Error ? err.message : "Gagal mengonfirmasi." });
      }
    },
    [reqId, secret]
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const proof = readAndClearHash();
    proof.tokenHash = searchParams.get("token_hash");
    proofRef.current = proof;

    if (proof.hashError) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hasil verifikasi Supabase dari fragment URL
      setView({
        kind: "error",
        message: /expired|invalid/i.test(proof.hashError)
          ? "Tautan email sudah kedaluwarsa atau sudah dipakai. Minta tautan baru dari layar login."
          : "Verifikasi email gagal. Minta tautan baru dari layar login.",
      });
      return;
    }
    if (!reqId || !secret) {
      setView({ kind: "error", message: "Tautan konfirmasi tidak lengkap." });
      return;
    }

    apiFetch<ConfirmInfoResponse>(
      `/api/auth/confirm-login?req_id=${encodeURIComponent(reqId)}&secret=${encodeURIComponent(secret)}`
    )
      .then((info) => {
        if (info.status === "expired") {
          setView({ kind: "error", message: "Tautan sudah kedaluwarsa. Minta tautan baru dari layar login." });
        } else if (info.status === "consumed") {
          setView({ kind: "error", message: "Permintaan masuk ini sudah digunakan." });
        } else if (info.status === "verified" && !info.sameDevice) {
          setView({ kind: "verified" });
        } else if (info.sameDevice) {
          // Dibuka di browser yang sama dengan yang meminta login → langsung masuk.
          void confirm(info);
        } else {
          setView({ kind: "ask", info });
        }
      })
      .catch((err: unknown) => setView({ kind: "error", message: err instanceof Error ? err.message : "Tautan tidak valid." }));
  }, [confirm, reqId, searchParams, secret]);

  return (
    <div className="pt-safe pb-safe flex min-h-dvh flex-col items-center justify-center px-5 py-10 text-center md:min-h-[480px]">
      {view.kind === "loading" || view.kind === "signing_in" ? (
        <>
          <LoaderCircle className="h-10 w-10 animate-spin text-brand" aria-hidden />
          <p className="mt-4 font-semibold">{view.kind === "signing_in" ? "Memasukkan Anda..." : "Memeriksa tautan..."}</p>
        </>
      ) : view.kind === "ask" || view.kind === "confirming" ? (
        <div className="w-full">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
            <ShieldCheck className="h-7 w-7" aria-hidden />
          </div>
          <h1 className="mt-4 text-xl font-bold">Konfirmasi Masuk</h1>
          <p className="mt-1 text-sm text-muted">
            Ada permintaan masuk SalesTrain untuk{" "}
            <span className="inline-flex items-center gap-1 font-medium text-ink">
              {view.info.channel === "email" ? <Mail className="h-3.5 w-3.5" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
              {view.info.identifier}
            </span>
          </p>

          <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Kode pencocokan</p>
            <p className="mt-1 text-5xl font-bold tabular-nums tracking-widest text-brand">{view.info.matchCode}</p>
            <p className="mt-3 flex items-start justify-center gap-1.5 text-sm text-muted">
              <Monitor className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              Pastikan kode ini sama dengan yang tampil di layar login laptop/desktop Anda.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void confirm(view.info)}
            disabled={view.kind === "confirming"}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand px-5 py-4 text-base font-semibold text-on-brand shadow-sm transition hover:bg-brand-strong active:scale-[0.99] disabled:opacity-60"
          >
            {view.kind === "confirming" ? (
              <>
                <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> Mengonfirmasi...
              </>
            ) : (
              "Ya, Kodenya Sama — Masukkan Saya"
            )}
          </button>
          <p className="mt-3 text-xs text-muted">
            Kode berbeda atau Anda tidak sedang mencoba masuk? Tutup halaman ini — tidak ada yang akan terjadi.
          </p>
        </div>
      ) : view.kind === "verified" ? (
        <div className="w-full">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success-soft text-success">
            <CircleCheck className="h-9 w-9" aria-hidden />
          </div>
          <h1 className="mt-4 text-xl font-bold">Verifikasi Berhasil!</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Silakan kembali ke layar laptop/desktop Anda, halaman akan masuk secara otomatis.
          </p>
          <p className="mt-6 text-xs text-muted">Halaman ini boleh ditutup.</p>
        </div>
      ) : (
        <div className="w-full">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-danger-soft text-danger">
            <CircleExclamationPoint className="h-9 w-9" aria-hidden />
          </div>
          <h1 className="mt-4 text-xl font-bold">Tidak Dapat Mengonfirmasi</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">{view.message}</p>
          <a
            href="/login"
            className="mt-6 inline-flex items-center justify-center rounded-2xl bg-brand px-5 py-3 font-semibold text-on-brand"
          >
            Ke Halaman Login
          </a>
        </div>
      )}
    </div>
  );
}

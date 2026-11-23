"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  CircleExclamationPoint,
  ExternalLink,
  LoaderCircle,
  Mail,
  Mic,
  RotateCcw,
  Send,
  Smartphone,
  UserRound,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { PollLoginResponse, RequestLoginResponse } from "@/lib/types";

type Tab = "email" | "telegram";

interface PendingLogin extends RequestLoginResponse {
  identifier: string;
}

const POLL_INTERVAL_MS = 2500;
const RESEND_COOLDOWN_S = 45;

const ERROR_MESSAGES: Record<string, string> = {
  link_invalid: "Tautan masuk tidak valid. Silakan minta tautan baru.",
  link_expired: "Tautan masuk sudah kedaluwarsa. Silakan minta tautan baru.",
  link_used: "Tautan ini sudah pernah dipakai. Silakan minta tautan baru.",
  other_browser: "Tautan dibuka di browser lain. Silakan minta tautan baru dari halaman ini.",
  auth_failed: "Gagal masuk. Silakan coba lagi.",
  session_expired: "Sesi Anda telah berakhir. Silakan masuk kembali.",
};

const STORAGE = {
  tab: "salestrain:login-tab",
  email: "salestrain:login-email",
  chatId: "salestrain:telegram-chat-id",
  name: "sales-roleplay:salesman-name",
  pending: "salestrain:pending-login",
};

function readStorage(key: string, session = false): string {
  try {
    return (session ? window.sessionStorage : window.localStorage).getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStorage(key: string, value: string | null, session = false) {
  try {
    const s = session ? window.sessionStorage : window.localStorage;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    // storage diblokir
  }
}

const inputClass =
  "w-full rounded-xl border border-line bg-surface py-3 pl-11 pr-3 text-base outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/25";

function formatRemaining(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function LoginForm({ botUsername }: { botUsername: string }) {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error");
  const next = searchParams.get("next");

  const [tab, setTab] = useState<Tab>("email");
  const [email, setEmail] = useState("");
  const [chatId, setChatId] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    errorCode ? ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.auth_failed : null
  );
  const [pending, setPending] = useState<PendingLogin | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [signingIn, setSigningIn] = useState(false);
  const pollingRef = useRef(false);

  const goHome = useCallback(() => {
    const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    window.location.replace(new URL(target, window.location.origin).href);
  }, [next]);

  const clearPending = useCallback(() => {
    setPending(null);
    writeStorage(STORAGE.pending, null, true);
  }, []);

  // Pulihkan isian terakhir & tiket yang masih menunggu (mis. setelah halaman di-refresh).
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- sinkronisasi sekali dari storage */
    const savedTab = readStorage(STORAGE.tab);
    if (savedTab === "email" || savedTab === "telegram") setTab(savedTab);
    setEmail(readStorage(STORAGE.email));
    setChatId(readStorage(STORAGE.chatId));
    setFullName(readStorage(STORAGE.name));
    try {
      const saved = JSON.parse(readStorage(STORAGE.pending, true) || "null") as PendingLogin | null;
      if (saved && new Date(saved.expiresAt).getTime() > Date.now()) {
        setPending(saved);
        setTab(saved.channel);
      }
    } catch {
      // abaikan data rusak
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Detik mundur (cooldown kirim ulang & sisa waktu tiket).
  useEffect(() => {
    if (!pending && cooldown <= 0) return;
    const t = setInterval(() => {
      setNow(Date.now());
      setCooldown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [pending, cooldown]);

  // Polling status tiket tiap 2,5 detik selama menunggu konfirmasi dari HP.
  useEffect(() => {
    if (!pending) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (stopped || pollingRef.current) return;
      pollingRef.current = true;
      try {
        const res = await fetch(`/api/auth/poll-login?req_id=${encodeURIComponent(pending.requestId)}`, {
          cache: "no-store",
        });
        const data = (await res.json().catch(() => null)) as (PollLoginResponse & { error?: string }) | null;
        if (stopped) return;

        if (res.ok && data?.status === "signed_in") {
          stopped = true;
          setSigningIn(true);
          writeStorage(STORAGE.pending, null, true);
          goHome();
          return;
        }
        if (!res.ok || data?.status === "expired" || data?.status === "consumed") {
          stopped = true;
          clearPending();
          setError(
            res.status === 403
              ? data?.error ?? "Permintaan masuk tidak dikenali di browser ini. Silakan minta tautan baru."
              : data?.status === "consumed"
                ? "Permintaan masuk ini sudah dipakai di perangkat lain. Silakan minta tautan baru."
                : "Waktu konfirmasi habis. Silakan minta tautan baru."
          );
          return;
        }
      } catch {
        // Gangguan jaringan sesaat — coba lagi pada putaran berikutnya.
      } finally {
        pollingRef.current = false;
      }
      if (!stopped) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    timer = setTimeout(tick, POLL_INTERVAL_MS);
    // Saat tab kembali aktif, langsung cek tanpa menunggu.
    const onVisible = () => {
      if (document.visibilityState === "visible" && !stopped) {
        if (timer) clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pending, clearPending, goHome]);

  const switchTab = (t: Tab) => {
    if (pending) return;
    setTab(t);
    setError(null);
    writeStorage(STORAGE.tab, t);
  };

  const requestLogin = async (e?: FormEvent | { preventDefault(): void }) => {
    e?.preventDefault();
    if (submitting || cooldown > 0) return;
    setError(null);
    setSubmitting(true);
    const name = fullName.trim();
    if (name) writeStorage(STORAGE.name, name);

    const identifier = tab === "email" ? email.trim().toLowerCase() : chatId.replace(/\s+/g, "");
    writeStorage(tab === "email" ? STORAGE.email : STORAGE.chatId, identifier);

    try {
      const res = await apiFetch<RequestLoginResponse>("/api/auth/request-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: tab, identifier, full_name: name }),
      });
      const p: PendingLogin = { ...res, identifier };
      setPending(p);
      writeStorage(STORAGE.pending, JSON.stringify(p), true);
      setCooldown(RESEND_COOLDOWN_S);
      setNow(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengirim tautan masuk.");
    } finally {
      setSubmitting(false);
    }
  };

  const changeAccount = () => {
    clearPending();
    setError(null);
  };

  const botUrl = botUsername ? `https://t.me/${botUsername}` : null;
  const remainingMs = pending ? new Date(pending.expiresAt).getTime() - now : 0;

  return (
    <div className="flex min-h-dvh flex-col md:min-h-0">
      <header className="pt-safe px-4 pb-2 pt-6 text-center md:px-8 md:pt-10">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-on-brand shadow-sm">
          <Mic className="h-7 w-7" aria-hidden />
        </div>
        <h1 className="mt-4 text-xl font-bold">Masuk ke SalesTrain</h1>
        <p className="mt-1 text-sm text-muted">Tanpa password — konfirmasi lewat Email atau Telegram, bisa dari HP.</p>
      </header>

      <main className="flex-1 px-4 py-5 md:px-8">
        <div role="tablist" aria-label="Metode masuk" className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1">
          {(
            [
              { id: "email", label: "Via Email", Icon: Mail },
              { id: "telegram", label: "Via Telegram", Icon: Send },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              disabled={!!pending && tab !== id}
              onClick={() => switchTab(id)}
              className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition disabled:opacity-40 ${
                tab === id ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden /> {label}
            </button>
          ))}
        </div>

        {error && (
          <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-danger">
            <CircleExclamationPoint className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        {pending ? (
          <section className="mt-5 rounded-2xl border border-line bg-surface p-5 text-center" aria-live="polite">
            {signingIn ? (
              <div className="py-6">
                <LoaderCircle className="mx-auto h-10 w-10 animate-spin text-brand" aria-hidden />
                <p className="mt-3 font-semibold">Terverifikasi! Memasukkan Anda...</p>
              </div>
            ) : (
              <>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand">
                  <Smartphone className="h-6 w-6" aria-hidden />
                </div>
                <h2 className="mt-3 font-semibold">Menunggu konfirmasi...</h2>
                <p className="mt-1 text-sm text-muted">
                  {pending.channel === "email" ? (
                    <>
                      Buka email yang dikirim ke <span className="font-medium text-ink">{pending.identifier}</span> — boleh di
                      HP — lalu ketuk tautannya.
                    </>
                  ) : (
                    <>Buka chat bot SalesTrain di Telegram (boleh di HP), lalu ketuk tautan konfirmasinya.</>
                  )}
                </p>

                <div className="mx-auto mt-4 max-w-xs rounded-2xl bg-surface-2 px-4 py-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">Kode pencocokan</p>
                  <p className="text-4xl font-bold tabular-nums tracking-widest text-brand">{pending.matchCode}</p>
                  <p className="mt-1 text-xs text-muted">Pastikan kode yang sama tampil di HP Anda.</p>
                </div>

                <p className="mt-4 flex items-center justify-center gap-2 text-sm text-muted">
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                  Halaman ini akan masuk otomatis · sisa {formatRemaining(remainingMs)}
                </p>

                {pending.channel === "telegram" && botUrl && (
                  <a
                    href={botUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-soft px-4 py-2.5 text-sm font-semibold text-brand-strong"
                  >
                    Buka Telegram <ExternalLink className="h-4 w-4" aria-hidden />
                  </a>
                )}

                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void requestLogin()}
                    disabled={cooldown > 0 || submitting}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-line px-3 py-2.5 text-sm font-semibold text-ink transition hover:bg-surface-2 disabled:text-muted disabled:opacity-60"
                  >
                    {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
                    {cooldown > 0 ? `Kirim Ulang (${cooldown})` : "Kirim Ulang"}
                  </button>
                  <button
                    type="button"
                    onClick={changeAccount}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-line px-3 py-2.5 text-sm font-semibold text-ink transition hover:bg-surface-2"
                  >
                    <UserRound className="h-4 w-4" aria-hidden /> Ganti Akun
                  </button>
                </div>
              </>
            )}
          </section>
        ) : (
          <form id={`panel-${tab}`} role="tabpanel" onSubmit={requestLogin} className="mt-5 space-y-4">
            {tab === "telegram" && (
              <ol className="space-y-2 rounded-2xl border border-line bg-surface p-4 text-sm">
                <li className="flex gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-strong">1</span>
                  <span>
                    Buka bot SalesTrain di Telegram lalu kirim <code className="rounded bg-surface-2 px-1">/start</code>.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-strong">2</span>
                  <span>Salin angka Chat ID yang dibalas bot, tempel di bawah.</span>
                </li>
                <li className="flex gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-strong">3</span>
                  <span>Ketuk tautan konfirmasi dari bot — layar ini akan masuk otomatis.</span>
                </li>
                {botUrl ? (
                  <li className="pt-1">
                    <a
                      href={botUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#229ED9] px-4 py-3 font-semibold text-white transition hover:opacity-90"
                    >
                      <Send className="h-4 w-4" aria-hidden /> Buka @{botUsername}
                    </a>
                  </li>
                ) : (
                  <li className="pt-1 text-xs text-danger">NEXT_PUBLIC_TELEGRAM_BOT_USERNAME belum diset.</li>
                )}
              </ol>
            )}

            {tab === "email" ? (
              <div>
                <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium">
                  Email
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden />
                  <input
                    id="login-email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nama@perusahaan.com"
                    className={inputClass}
                  />
                </div>
              </div>
            ) : (
              <div>
                <label htmlFor="login-chat-id" className="mb-1.5 block text-sm font-medium">
                  Telegram Chat ID
                </label>
                <div className="relative">
                  <Send className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden />
                  <input
                    id="login-chat-id"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9 ]{4,24}"
                    autoComplete="off"
                    required
                    value={chatId}
                    onChange={(e) => setChatId(e.target.value)}
                    placeholder="Contoh: 123456789"
                    className={`${inputClass} tabular-nums`}
                  />
                </div>
              </div>
            )}

            <div>
              <label htmlFor="login-name" className="mb-1.5 block text-sm font-medium">
                Nama Lengkap <span className="font-normal text-muted">(opsional)</span>
              </label>
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden />
                <input
                  id="login-name"
                  type="text"
                  autoComplete="name"
                  maxLength={120}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Contoh: Budi Santoso"
                  className={inputClass}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || cooldown > 0}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand px-5 py-4 text-base font-semibold text-on-brand shadow-sm transition hover:bg-brand-strong active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> Mengirim...
                </>
              ) : cooldown > 0 ? (
                `Tunggu ${cooldown} detik`
              ) : tab === "email" ? (
                "Kirim Tautan ke Email"
              ) : (
                "Kirim Tautan ke Telegram"
              )}
            </button>
          </form>
        )}
      </main>

      <footer className="pb-safe px-4 pt-2 text-center text-xs text-muted md:px-8 md:pb-8">
        Tautan bisa dibuka di HP — layar ini akan masuk otomatis setelah Anda konfirmasi.
      </footer>
    </div>
  );
}

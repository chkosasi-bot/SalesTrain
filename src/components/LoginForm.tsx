"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import {
  CircleExclamationPoint,
  ExternalLink,
  LoaderCircle,
  Mail,
  MailCheck,
  Mic,
  Send,
  UserRound,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";

type Tab = "email" | "telegram";

const ERROR_MESSAGES: Record<string, string> = {
  link_invalid: "Tautan masuk tidak valid. Silakan minta tautan baru.",
  link_expired: "Tautan masuk sudah kedaluwarsa. Silakan minta tautan baru.",
  link_used: "Tautan ini sudah pernah dipakai. Silakan minta tautan baru.",
  other_browser:
    "Tautan dibuka di browser yang berbeda dari tempat Anda memintanya. Minta tautan baru, lalu buka di browser yang sama.",
  auth_failed: "Gagal masuk. Silakan coba lagi.",
  session_expired: "Sesi Anda telah berakhir. Silakan masuk kembali.",
};

const STORAGE = {
  tab: "salestrain:login-tab",
  email: "salestrain:login-email",
  chatId: "salestrain:telegram-chat-id",
  name: "sales-roleplay:salesman-name",
};

function readStorage(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage diblokir
  }
}

const inputClass =
  "w-full rounded-xl border border-line bg-surface py-3 pl-11 pr-3 text-base outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/25";

export default function LoginForm({ botUsername }: { botUsername: string }) {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error");
  const next = searchParams.get("next") ?? "/";

  const [tab, setTab] = useState<Tab>("email");
  const [email, setEmail] = useState("");
  const [chatId, setChatId] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(errorCode ? ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.auth_failed : null);
  const [sentTo, setSentTo] = useState<{ tab: Tab; target: string } | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // Pulihkan isian terakhir (kenyamanan saja).
  useEffect(() => {
    const savedTab = readStorage(STORAGE.tab);
    /* eslint-disable react-hooks/set-state-in-effect -- sinkronisasi sekali dari localStorage */
    if (savedTab === "email" || savedTab === "telegram") setTab(savedTab);
    setEmail(readStorage(STORAGE.email));
    setChatId(readStorage(STORAGE.chatId));
    setFullName(readStorage(STORAGE.name));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const switchTab = (t: Tab) => {
    setTab(t);
    setError(null);
    setSentTo(null);
    writeStorage(STORAGE.tab, t);
  };

  const submit = async (e?: FormEvent | { preventDefault(): void }) => {
    e?.preventDefault();
    if (submitting || cooldown > 0) return;
    setError(null);
    setSubmitting(true);
    const name = fullName.trim();
    if (name) writeStorage(STORAGE.name, name);

    try {
      if (tab === "email") {
        const value = email.trim().toLowerCase();
        writeStorage(STORAGE.email, value);
        await apiFetch("/api/auth/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: value, full_name: name, next }),
        });
        setSentTo({ tab, target: value });
      } else {
        const value = chatId.replace(/\s+/g, "");
        writeStorage(STORAGE.chatId, value);
        await apiFetch("/api/auth/telegram/request-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telegram_chat_id: value, full_name: name }),
        });
        setSentTo({ tab, target: value });
      }
      setCooldown(45);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengirim tautan masuk.");
    } finally {
      setSubmitting(false);
    }
  };

  const botUrl = botUsername ? `https://t.me/${botUsername}` : null;

  return (
    <div className="flex min-h-dvh flex-col md:min-h-0">
      <header className="pt-safe px-4 pb-2 pt-6 text-center md:px-8 md:pt-10">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-on-brand shadow-sm">
          <Mic className="h-7 w-7" aria-hidden />
        </div>
        <h1 className="mt-4 text-xl font-bold">Masuk ke SalesTrain</h1>
        <p className="mt-1 text-sm text-muted">Tanpa password — kami kirimkan tautan masuk sekali pakai.</p>
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
              onClick={() => switchTab(id)}
              className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
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

        {sentTo && sentTo.tab === tab ? (
          <div className="mt-5 rounded-2xl border border-line bg-surface p-5 text-center" role="status">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-success">
              {tab === "email" ? <MailCheck className="h-6 w-6" aria-hidden /> : <Send className="h-6 w-6" aria-hidden />}
            </div>
            <h2 className="mt-3 font-semibold">{tab === "email" ? "Cek email Anda" : "Cek Telegram Anda"}</h2>
            <p className="mt-1 text-sm text-muted">
              {tab === "email" ? (
                <>
                  Tautan masuk telah dikirim ke <span className="font-medium text-ink">{sentTo.target}</span>. Buka tautan itu di
                  browser ini.
                </>
              ) : (
                <>Bot SalesTrain telah mengirim tautan masuk (berlaku 15 menit, sekali pakai) ke chat Telegram Anda.</>
              )}
            </p>
            {tab === "telegram" && botUrl && (
              <a
                href={botUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-soft px-4 py-2.5 text-sm font-semibold text-brand-strong"
              >
                Buka Telegram <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={cooldown > 0 || submitting}
              className="mt-4 block w-full text-sm font-medium text-brand disabled:text-muted"
            >
              {cooldown > 0 ? `Kirim ulang dalam ${cooldown} detik` : "Kirim ulang tautan"}
            </button>
            <button type="button" onClick={() => setSentTo(null)} className="mt-2 text-sm text-muted underline-offset-2 hover:underline">
              {tab === "email" ? "Ganti email" : "Ganti Chat ID"}
            </button>
          </div>
        ) : (
          <form id={`panel-${tab}`} role="tabpanel" onSubmit={submit} className="mt-5 space-y-4">
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
                  <span>Ketuk tautan masuk yang dikirim bot.</span>
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
        Dengan masuk, sesi latihan Anda tersimpan di akun Anda.
      </footer>
    </div>
  );
}

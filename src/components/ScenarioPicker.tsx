"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  ChevronRight,
  CircleCheck,
  CircleExclamationPoint,
  LoaderCircle,
  Mic,
  RotateCcw,
  Store,
  UserRound,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { CreateSessionResponse, ScenarioSummary, ScenariosResponse } from "@/lib/types";

interface Props {
  salesmanName: string;
  onSalesmanNameChange: (name: string) => void;
  onStarted: (data: CreateSessionResponse) => void;
  /** Identitas pengguna + tombol Keluar (ditampilkan di header). */
  userSlot?: ReactNode;
}

export default function ScenarioPicker({ salesmanName, onSalesmanNameChange, onStarted, userSlot }: Props) {
  const [scenarios, setScenarios] = useState<ScenarioSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<ScenariosResponse>("/api/scenarios", { signal: controller.signal })
      .then((data) => {
        setScenarios(data.scenarios);
        setLoadError(null);
        if (data.scenarios.length === 1) setSelectedId(data.scenarios[0].id);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(err instanceof Error ? err.message : "Gagal memuat skenario.");
      });
    return () => controller.abort();
  }, [reloadKey]);

  const retry = useCallback(() => {
    setScenarios(null);
    setLoadError(null);
    setReloadKey((k) => k + 1);
  }, []);

  const start = async () => {
    if (!selectedId || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const data = await apiFetch<CreateSessionResponse>("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario_id: selectedId, salesman_name: salesmanName.trim() }),
      });
      onStarted(data);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Gagal memulai sesi.");
      setStarting(false);
    }
  };

  const isLoading = scenarios === null && !loadError;

  return (
    <div className="flex min-h-dvh flex-col md:min-h-0">
      <header className="pt-safe px-4 pb-2 md:px-8 md:pt-8">
        {userSlot && <div className="mb-4 border-b border-line pb-3">{userSlot}</div>}
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand text-on-brand shadow-sm">
            <Mic className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight md:text-xl">AI Sales Roleplay</h1>
            <p className="text-sm text-muted">Latihan negosiasi dengan pelanggan AI</p>
          </div>
        </div>
      </header>

      <main className="flex-1 space-y-6 px-4 py-4 md:px-8">
        <section>
          <label htmlFor="salesman-name" className="mb-1.5 block text-sm font-medium">
            Nama Salesman <span className="font-normal text-muted">(otomatis dari profil, bisa diubah)</span>
          </label>
          <div className="relative">
            <UserRound className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden />
            <input
              id="salesman-name"
              type="text"
              autoComplete="name"
              maxLength={80}
              value={salesmanName}
              onChange={(e) => onSalesmanNameChange(e.target.value)}
              placeholder="Contoh: Budi Santoso"
              className="w-full rounded-xl border border-line bg-surface py-3 pl-11 pr-3 text-base outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/25"
            />
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-medium">Pilih Skenario</h2>

          {isLoading && (
            <div className="space-y-3" aria-busy="true" aria-label="Memuat skenario">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-28 animate-pulse rounded-2xl border border-line bg-surface" />
              ))}
            </div>
          )}

          {loadError && (
            <div className="rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm">
              <div className="flex items-start gap-2 text-danger">
                <CircleExclamationPoint className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                <p>{loadError}</p>
              </div>
              <button
                type="button"
                onClick={retry}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-surface px-3 py-2 font-medium text-ink ring-1 ring-line"
              >
                <RotateCcw className="h-4 w-4" aria-hidden /> Coba Lagi
              </button>
            </div>
          )}

          {scenarios && scenarios.length === 0 && (
            <div className="rounded-2xl border border-dashed border-line bg-surface p-6 text-center text-sm text-muted">
              Belum ada skenario aktif. Tambahkan skenario di tabel <code>scenarios</code> dengan{" "}
              <code>is_active = true</code>.
            </div>
          )}

          {scenarios && scenarios.length > 0 && (
            <ul className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Daftar skenario">
              {scenarios.map((s) => {
                const active = s.id === selectedId;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setSelectedId(s.id)}
                      className={`flex h-full w-full flex-col rounded-2xl border bg-surface p-4 text-left transition active:scale-[0.99] ${
                        active
                          ? "border-brand ring-2 ring-brand/25"
                          : "border-line hover:border-brand/50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-semibold leading-snug">{s.title}</h3>
                        <CircleCheck
                          className={`h-5 w-5 shrink-0 transition ${active ? "text-brand" : "text-line"}`}
                          aria-hidden
                        />
                      </div>
                      {s.description && (
                        <p className="mt-1.5 line-clamp-3 text-sm text-muted">{s.description}</p>
                      )}
                      {s.customer_name && (
                        <div className="mt-3 inline-flex items-center gap-1.5 self-start rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-strong">
                          <Store className="h-3.5 w-3.5" aria-hidden />
                          {s.customer_name}
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      <footer className="pb-safe sticky bottom-0 border-t border-line bg-bg/90 px-4 pt-3 backdrop-blur md:static md:border-0 md:bg-transparent md:px-8 md:pb-8">
        {startError && (
          <p className="mb-2 flex items-start gap-2 text-sm text-danger" role="alert">
            <CircleExclamationPoint className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {startError}
          </p>
        )}
        <button
          type="button"
          onClick={start}
          disabled={!selectedId || starting}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand px-5 py-4 text-base font-semibold text-on-brand shadow-sm transition hover:bg-brand-strong active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {starting ? (
            <>
              <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> Menyiapkan Sesi...
            </>
          ) : (
            <>
              Mulai Simulasi <ChevronRight className="h-5 w-5" aria-hidden />
            </>
          )}
        </button>
      </footer>
    </div>
  );
}

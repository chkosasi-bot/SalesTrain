"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ChevronRight,
  CircleCheck,
  CircleExclamationPoint,
  Flame,
  LoaderCircle,
  Lock,
  Mic,
  Package,
  RotateCcw,
  Store,
  Swords,
  Target,
  UserRound,
  Volume2,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type {
  ChallengeMode,
  CreateSessionResponse,
  ScenarioFocus,
  SimulationCustomer,
  SimulationOptionsResponse,
} from "@/lib/types";

interface Props {
  salesmanName: string;
  onSalesmanNameChange: (name: string) => void;
  onStarted: (data: CreateSessionResponse) => void;
  /** Header: identitas user, navigasi & banner Product Mastery. */
  headerSlot?: ReactNode;
}

const PREFS_KEY = "salestrain:sim-config";

function readPrefs(): { product?: string; customer?: string; focus?: string; mode?: string } {
  try {
    return JSON.parse(window.localStorage.getItem(PREFS_KEY) || "{}");
  } catch {
    return {};
  }
}

function writePrefs(p: { product?: string | null; customer?: string | null; focus?: string | null; mode?: string | null }) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // storage diblokir
  }
}

function Step({ n, title, children, aside }: { n: number; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-bold text-on-brand">{n}</span>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function BriefRow({ label, value }: { label: string; value: string | null }) {
  if (!value?.trim()) return null;
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-sm leading-relaxed">{value.trim()}</dd>
    </div>
  );
}

function CustomerCard({
  c,
  selected,
  onSelect,
}: {
  c: SimulationCustomer;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={c.locked}
      onClick={() => !c.locked && onSelect()}
      className={`w-full rounded-2xl border p-3 text-left transition ${
        c.locked
          ? "cursor-not-allowed border-dashed border-line bg-surface-2/60"
          : selected
            ? "border-brand bg-surface ring-2 ring-brand/25"
            : "border-line bg-surface hover:border-brand/50"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${
            c.locked ? "bg-surface text-muted" : "bg-brand-soft text-brand-strong"
          }`}
          aria-hidden
        >
          {c.locked ? <Lock className="h-4 w-4" /> : c.owner_name.replace(/^(Bu|Pak|Mbak|Mas|Ibu|Bapak)\s+/i, "").charAt(0)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[11px] text-muted">{c.customer_code}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                c.is_mandatory ? "bg-brand text-on-brand" : "bg-surface-2 text-muted"
              }`}
            >
              {c.is_mandatory ? "Wajib" : "Opsional"}
            </span>
            {c.status.passed && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-bold uppercase text-success">
                <CircleCheck className="h-3 w-3" aria-hidden /> Lulus {c.status.best_score}
              </span>
            )}
            {!c.status.passed && c.status.attempts > 0 && (
              <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-bold uppercase text-warning">
                Terbaik {c.status.best_score}
              </span>
            )}
          </span>
          <span className={`mt-0.5 block font-semibold leading-snug ${c.locked ? "text-muted" : ""}`}>{c.owner_name}</span>
          <span className="block truncate text-xs text-muted">
            {c.store_name}
            {c.area_name ? ` · ${c.area_name}` : ""}
          </span>
          {c.locked && (
            <span className="mt-1.5 flex items-start gap-1 text-xs text-warning">
              <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              <span>
                Terkunci — luluskan dulu:{" "}
                {c.required_customers.map((r) => `${r.customer_code} ${r.owner_name}`).join(", ")}
              </span>
            </span>
          )}
        </span>
      </div>
    </button>
  );
}

export default function SessionConfigurator({ salesmanName, onSalesmanNameChange, onStarted, headerSlot }: Props) {
  const [options, setOptions] = useState<SimulationOptionsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [productId, setProductId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [focus, setFocus] = useState<ScenarioFocus | null>(null);
  const [mode, setMode] = useState<ChallengeMode>("standard");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<SimulationOptionsResponse>("/api/simulation/options", { signal: controller.signal })
      .then((data) => {
        setOptions(data);
        setLoadError(null);

        // Pre-select: ?product_id=... (dari /mastery/[id]) → pilihan terakhir → item pertama.
        const prefs = readPrefs();
        const fromQuery = new URLSearchParams(window.location.search).get("product_id");
        const productIds = new Set(data.products.map((p) => p.id));
        setProductId(
          (fromQuery && productIds.has(fromQuery) && fromQuery) ||
            (prefs.product && productIds.has(prefs.product) && prefs.product) ||
            data.products[0]?.id ||
            null
        );

        const open = data.customers.filter((c) => !c.locked);
        const saved = open.find((c) => c.id === prefs.customer);
        const firstPendingMandatory = open.find((c) => c.is_mandatory && !c.status.passed);
        setCustomerId(saved?.id ?? firstPendingMandatory?.id ?? open[0]?.id ?? null);

        setFocus(data.focuses.some((f) => f.id === prefs.focus) ? (prefs.focus as ScenarioFocus) : data.focuses[0]?.id ?? null);
        if (prefs.mode === "tough" || prefs.mode === "standard") setMode(prefs.mode);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(err instanceof Error ? err.message : "Gagal memuat data simulasi.");
      });
    return () => controller.abort();
  }, [reloadKey]);

  const retry = useCallback(() => {
    setOptions(null);
    setLoadError(null);
    setReloadKey((k) => k + 1);
  }, []);

  const mandatory = useMemo(() => options?.customers.filter((c) => c.is_mandatory) ?? [], [options]);
  const optional = useMemo(() => options?.customers.filter((c) => !c.is_mandatory) ?? [], [options]);
  const mandatoryPassed = mandatory.filter((c) => c.status.passed).length;
  const selectedCustomer = options?.customers.find((c) => c.id === customerId) ?? null;
  const selectedProduct = options?.products.find((p) => p.id === productId) ?? null;
  const canStart = !!productId && !!selectedCustomer && !selectedCustomer.locked && !!focus && !starting;

  const start = async () => {
    if (!canStart) return;
    setStarting(true);
    setStartError(null);
    writePrefs({ product: productId, customer: customerId, focus, mode });
    try {
      const data = await apiFetch<CreateSessionResponse>("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          own_product_id: productId,
          customer_id: customerId,
          scenario_focus: focus,
          challenge_mode: mode,
          salesman_name: salesmanName.trim(),
        }),
      });
      onStarted(data);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Gagal memulai sesi.");
      setStarting(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col md:min-h-0">
      <header className="pt-safe px-4 pb-2 md:px-8 md:pt-8">
        {headerSlot && <div className="mb-4 border-b border-line pb-3">{headerSlot}</div>}
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand text-on-brand shadow-sm">
            <Mic className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight md:text-xl">Siapkan Simulasi</h1>
            <p className="text-sm text-muted">Pilih produk, pelanggan & fokus negosiasi</p>
          </div>
        </div>
      </header>

      <main className="flex-1 space-y-6 px-4 py-4 md:px-8">
        {!options && !loadError && (
          <div className="space-y-3" aria-busy="true" aria-label="Memuat data simulasi">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 animate-pulse rounded-2xl border border-line bg-surface" />
            ))}
          </div>
        )}

        {loadError && (
          <div className="rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm">
            <p className="flex items-start gap-2 text-danger">
              <CircleExclamationPoint className="mt-0.5 h-5 w-5 shrink-0" aria-hidden /> {loadError}
            </p>
            <button
              type="button"
              onClick={retry}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-surface px-3 py-2 font-medium text-ink ring-1 ring-line"
            >
              <RotateCcw className="h-4 w-4" aria-hidden /> Coba Lagi
            </button>
          </div>
        )}

        {options && (
          <>
            {/* 1. Produk */}
            <Step n={1} title="Produk yang Ditawarkan">
              {options.products.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-line bg-surface p-4 text-sm text-muted">Belum ada produk aktif.</p>
              ) : (
                <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-3 md:px-0" role="radiogroup" aria-label="Produk">
                  {options.products.map((p) => {
                    const active = p.id === productId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setProductId(p.id)}
                        className={`min-w-[220px] snap-start rounded-2xl border p-3 text-left transition md:min-w-0 ${
                          active ? "border-brand bg-surface ring-2 ring-brand/25" : "border-line bg-surface hover:border-brand/50"
                        }`}
                      >
                        <span className="flex items-center gap-1.5 text-[11px] text-muted">
                          <Package className="h-3.5 w-3.5" aria-hidden />
                          <span className="font-mono">{p.product_code}</span>
                          {p.brand && <span>· {p.brand}</span>}
                        </span>
                        <span className="mt-1 block text-sm font-semibold leading-snug">{p.name}</span>
                        {p.competitor_count > 0 && (
                          <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted">
                            <Swords className="h-3 w-3" aria-hidden /> {p.competitor_count} kompetitor
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </Step>

            {/* 2. Pelanggan */}
            <Step
              n={2}
              title="Profil Pelanggan"
              aside={
                mandatory.length > 0 && (
                  <span className="text-xs text-muted">
                    Wajib lulus: <span className="font-semibold tabular-nums text-ink">{mandatoryPassed}/{mandatory.length}</span>
                  </span>
                )
              }
            >
              <div className="space-y-4" role="radiogroup" aria-label="Profil pelanggan">
                {mandatory.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-brand">Profil Wajib</p>
                    <div className="grid gap-2 md:grid-cols-2">
                      {mandatory.map((c) => (
                        <CustomerCard key={c.id} c={c} selected={c.id === customerId} onSelect={() => setCustomerId(c.id)} />
                      ))}
                    </div>
                  </div>
                )}
                {optional.length > 0 && (
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                      Profil Opsional
                      {optional.some((c) => c.locked) && <Lock className="h-3 w-3" aria-label="sebagian terkunci" />}
                    </p>
                    <div className="grid gap-2 md:grid-cols-2">
                      {optional.map((c) => (
                        <CustomerCard key={c.id} c={c} selected={c.id === customerId} onSelect={() => setCustomerId(c.id)} />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {selectedCustomer && !selectedCustomer.locked && (
                <article className="mt-3 rounded-2xl border border-brand/30 bg-brand-soft/60 p-4" aria-label="Briefing pelanggan">
                  <header className="flex items-start gap-2">
                    <Store className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-brand-strong">Briefing Pelanggan</p>
                      <h3 className="font-semibold leading-snug">
                        {selectedCustomer.owner_name} — {selectedCustomer.store_name}
                      </h3>
                      <p className="text-xs text-muted">
                        {[selectedCustomer.store_scale, selectedCustomer.area_name].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </header>
                  <dl className="mt-3 space-y-2.5">
                    <BriefRow label="Karakter" value={selectedCustomer.individual_assessment} />
                    <BriefRow label="Performa Pembayaran" value={selectedCustomer.payment_performance} />
                    <BriefRow label="Riwayat Transaksi" value={selectedCustomer.historical_transactions} />
                  </dl>
                  <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <span className={`font-semibold ${selectedCustomer.is_mandatory ? "text-brand-strong" : ""}`}>
                      {selectedCustomer.is_mandatory ? "Profil Wajib" : "Profil Opsional"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Volume2 className="h-3.5 w-3.5" aria-hidden /> Suara {selectedCustomer.tts_voice} · {selectedCustomer.tts_speed.toFixed(2)}×
                    </span>
                    {selectedCustomer.status.attempts > 0 && (
                      <span>
                        Skor terbaik {selectedCustomer.status.best_score} ({selectedCustomer.status.attempts}× dinilai)
                      </span>
                    )}
                  </p>
                </article>
              )}
            </Step>

            {/* 3. Fokus skenario */}
            <Step n={3} title="Fokus Skenario">
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Fokus skenario">
                {options.focuses.map((f) => {
                  const active = f.id === focus;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setFocus(f.id)}
                      className={`rounded-2xl border p-3 text-left transition ${
                        active ? "border-brand bg-surface ring-2 ring-brand/25" : "border-line bg-surface hover:border-brand/50"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        <Target className={`h-4 w-4 ${active ? "text-brand" : "text-muted"}`} aria-hidden /> {f.label}
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted">{f.description}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-3 py-2.5">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Flame className="h-4 w-4 text-warning" aria-hidden /> Tingkat tantangan
                </span>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label="Tingkat tantangan">
                  {options.challenge_modes.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={mode === m.id}
                      onClick={() => setMode(m.id)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        mode === m.id ? "bg-surface text-ink shadow-sm" : "text-muted"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </Step>

            {/* 4. Nama */}
            <Step n={4} title="Nama Salesman">
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden />
                <input
                  id="salesman-name"
                  aria-label="Nama salesman"
                  type="text"
                  autoComplete="name"
                  maxLength={80}
                  value={salesmanName}
                  onChange={(e) => onSalesmanNameChange(e.target.value)}
                  placeholder="Otomatis dari profil akun"
                  className="w-full rounded-xl border border-line bg-surface py-3 pl-11 pr-3 text-base outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/25"
                />
              </div>
            </Step>
          </>
        )}
      </main>

      <footer className="pb-safe sticky bottom-0 border-t border-line bg-bg/90 px-4 pt-3 backdrop-blur md:static md:border-0 md:bg-transparent md:px-8 md:pb-8">
        {startError && (
          <p className="mb-2 flex items-start gap-2 text-sm text-danger" role="alert">
            <CircleExclamationPoint className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {startError}
          </p>
        )}
        {options && selectedProduct && selectedCustomer && !selectedCustomer.locked && (
          <p className="mb-2 truncate text-center text-xs text-muted">
            {selectedProduct.name} → {selectedCustomer.owner_name}
          </p>
        )}
        <button
          type="button"
          onClick={start}
          disabled={!canStart}
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

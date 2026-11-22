"use client";

import { useCallback, useEffect, useState } from "react";
import ScenarioPicker from "@/components/ScenarioPicker";
import SessionScreen from "@/components/SessionScreen";
import ResultScreen from "@/components/ResultScreen";
import UserMenu from "@/components/UserMenu";
import { apiFetch } from "@/lib/api-client";
import type { CreateSessionResponse, CurrentUser, Evaluation, MeResponse, ScenarioSummary, SessionInfo } from "@/lib/types";

type Screen =
  | { name: "select" }
  | { name: "session"; session: SessionInfo; scenario: ScenarioSummary }
  | { name: "result"; scenario: ScenarioSummary; evaluation: Evaluation };

const NAME_KEY = "sales-roleplay:salesman-name";

export default function Home() {
  const [screen, setScreen] = useState<Screen>({ name: "select" });
  const [salesmanName, setSalesmanName] = useState("");
  const [user, setUser] = useState<CurrentUser | null>(null);

  // Muat profil akun yang login; nama salesman otomatis diisi dari profil.
  useEffect(() => {
    let savedName = "";
    try {
      savedName = window.localStorage.getItem(NAME_KEY) ?? "";
    } catch {
      // storage diblokir
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- tampilkan nama terakhir selagi profil dimuat
    if (savedName) setSalesmanName(savedName);

    const controller = new AbortController();
    apiFetch<MeResponse>("/api/auth/me", { signal: controller.signal })
      .then(({ user: me }) => {
        setUser(me);
        setSalesmanName(me.full_name || savedName || me.display_name);
      })
      .catch(() => {
        // 401 sudah diarahkan ke /login oleh apiFetch; error lain: tetap pakai nama tersimpan.
      });
    return () => controller.abort();
  }, []);

  const updateName = useCallback((name: string) => {
    setSalesmanName(name);
    try {
      window.localStorage.setItem(NAME_KEY, name);
    } catch {
      // storage diblokir
    }
  }, []);

  const handleStarted = useCallback((data: CreateSessionResponse) => {
    setScreen({ name: "session", session: data.session, scenario: data.scenario });
  }, []);

  const backToSelect = useCallback(() => setScreen({ name: "select" }), []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [screen.name]);

  const userSlot = user ? (
    <UserMenu user={user} />
  ) : (
    <div className="flex items-center gap-2" aria-busy="true" aria-label="Memuat akun">
      <div className="h-9 w-9 animate-pulse rounded-full bg-surface-2" />
      <div className="h-4 w-32 animate-pulse rounded bg-surface-2" />
    </div>
  );

  return (
    <div className="flex min-h-dvh justify-center md:items-center md:px-6 md:py-8">
      <div
        className={`w-full max-w-3xl bg-bg md:overflow-hidden md:rounded-3xl md:border md:border-line md:shadow-xl ${
          screen.name === "session" ? "md:h-[min(860px,calc(100dvh-4rem))]" : ""
        }`}
      >
        {screen.name === "select" && (
          <ScenarioPicker
            salesmanName={salesmanName}
            onSalesmanNameChange={updateName}
            onStarted={handleStarted}
            userSlot={userSlot}
          />
        )}

        {screen.name === "session" && (
          <SessionScreen
            key={screen.session.id}
            session={screen.session}
            scenario={screen.scenario}
            onExit={backToSelect}
            onEvaluated={(evaluation) => setScreen({ name: "result", scenario: screen.scenario, evaluation })}
          />
        )}

        {screen.name === "result" && (
          <ResultScreen
            evaluation={screen.evaluation}
            scenario={screen.scenario}
            salesmanName={salesmanName}
            onRestart={backToSelect}
            userSlot={userSlot}
          />
        )}
      </div>
    </div>
  );
}

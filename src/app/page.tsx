"use client";

import { useCallback, useEffect, useState } from "react";
import ScenarioPicker from "@/components/ScenarioPicker";
import SessionScreen from "@/components/SessionScreen";
import ResultScreen from "@/components/ResultScreen";
import type { CreateSessionResponse, Evaluation, ScenarioSummary, SessionInfo } from "@/lib/types";

type Screen =
  | { name: "select" }
  | { name: "session"; session: SessionInfo; scenario: ScenarioSummary }
  | { name: "result"; scenario: ScenarioSummary; evaluation: Evaluation };

const NAME_KEY = "sales-roleplay:salesman-name";

export default function Home() {
  const [screen, setScreen] = useState<Screen>({ name: "select" });
  const [salesmanName, setSalesmanName] = useState("");

  // Ingat nama salesman di perangkat ini (kenyamanan saja; aman bila storage tidak tersedia).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(NAME_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sinkronisasi sekali dari localStorage
      if (saved) setSalesmanName(saved);
    } catch {
      // storage diblokir
    }
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

  return (
    <div className="flex min-h-dvh justify-center md:items-center md:px-6 md:py-8">
      <div
        className={`w-full max-w-3xl bg-bg md:overflow-hidden md:rounded-3xl md:border md:border-line md:shadow-xl ${
          screen.name === "session" ? "md:h-[min(860px,calc(100dvh-4rem))]" : ""
        }`}
      >
        {screen.name === "select" && (
          <ScenarioPicker salesmanName={salesmanName} onSalesmanNameChange={updateName} onStarted={handleStarted} />
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
          />
        )}
      </div>
    </div>
  );
}

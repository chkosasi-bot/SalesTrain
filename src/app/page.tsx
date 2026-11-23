"use client";

import { useCallback, useEffect, useState } from "react";
import SessionConfigurator from "@/components/SessionConfigurator";
import SessionScreen from "@/components/SessionScreen";
import ResultScreen from "@/components/ResultScreen";
import AppTopBar from "@/components/AppTopBar";
import MasteryStatusBanner from "@/components/MasteryStatusBanner";
import { useCurrentUser } from "@/lib/use-current-user";
import type { CreateSessionResponse, Evaluation, SessionContext, SessionInfo } from "@/lib/types";

type Screen =
  | { name: "select" }
  | { name: "session"; session: SessionInfo; context: SessionContext }
  | { name: "result"; context: SessionContext; evaluation: Evaluation };

const NAME_KEY = "sales-roleplay:salesman-name";

export default function Home() {
  const [screen, setScreen] = useState<Screen>({ name: "select" });
  const [salesmanName, setSalesmanName] = useState("");
  const user = useCurrentUser();

  // Nama salesman otomatis diisi dari profil akun (nama tersimpan di perangkat dipakai sementara).
  useEffect(() => {
    let savedName = "";
    try {
      savedName = window.localStorage.getItem(NAME_KEY) ?? "";
    } catch {
      // storage diblokir
    }
    const name = user ? user.full_name || savedName || user.display_name : savedName;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sinkron nama dari profil saat akun selesai dimuat
    if (name) setSalesmanName(name);
  }, [user]);

  const updateName = useCallback((name: string) => {
    setSalesmanName(name);
    try {
      window.localStorage.setItem(NAME_KEY, name);
    } catch {
      // storage diblokir
    }
  }, []);

  const handleStarted = useCallback((data: CreateSessionResponse) => {
    setScreen({ name: "session", session: data.session, context: data.context });
  }, []);

  const backToSelect = useCallback(() => setScreen({ name: "select" }), []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [screen.name]);

  const userSlot = <AppTopBar />;
  const selectSlot = (
    <div className="space-y-3">
      <AppTopBar />
      <MasteryStatusBanner />
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
          <SessionConfigurator
            salesmanName={salesmanName}
            onSalesmanNameChange={updateName}
            onStarted={handleStarted}
            headerSlot={selectSlot}
          />
        )}

        {screen.name === "session" && (
          <SessionScreen
            key={screen.session.id}
            session={screen.session}
            context={screen.context}
            onExit={backToSelect}
            onEvaluated={(evaluation) => setScreen({ name: "result", context: screen.context, evaluation })}
          />
        )}

        {screen.name === "result" && (
          <ResultScreen
            evaluation={screen.evaluation}
            context={screen.context}
            salesmanName={salesmanName}
            onRestart={backToSelect}
            userSlot={userSlot}
          />
        )}
      </div>
    </div>
  );
}

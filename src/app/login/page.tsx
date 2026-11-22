import type { Metadata } from "next";
import { Suspense } from "react";
import LoginForm from "@/components/LoginForm";

export const metadata: Metadata = {
  title: "Masuk · AI Sales Roleplay",
  description: "Masuk ke SalesTrain dengan Magic Link via Email atau Telegram.",
};

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh justify-center md:items-center md:px-6 md:py-8">
      <div className="w-full max-w-md bg-bg md:overflow-hidden md:rounded-3xl md:border md:border-line md:shadow-xl">
        <Suspense fallback={<div className="min-h-dvh md:min-h-[560px]" aria-busy="true" />}>
          <LoginForm botUsername={(process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "").replace(/^@/, "")} />
        </Suspense>
      </div>
    </div>
  );
}

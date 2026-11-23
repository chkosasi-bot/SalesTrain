import type { Metadata } from "next";
import { Suspense } from "react";
import ConfirmLogin from "@/components/ConfirmLogin";

export const metadata: Metadata = {
  title: "Konfirmasi Masuk · SalesTrain",
  description: "Konfirmasi permintaan masuk SalesTrain.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ConfirmPage() {
  return (
    <div className="flex min-h-dvh justify-center md:items-center md:px-6 md:py-8">
      <div className="w-full max-w-md bg-bg md:overflow-hidden md:rounded-3xl md:border md:border-line md:shadow-xl">
        <Suspense fallback={<div className="min-h-dvh md:min-h-[480px]" aria-busy="true" />}>
          <ConfirmLogin />
        </Suspense>
      </div>
    </div>
  );
}

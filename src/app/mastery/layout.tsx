import type { Metadata } from "next";
import AppTopBar from "@/components/AppTopBar";

export const metadata: Metadata = {
  title: "Materi Produk · SalesTrain",
  description: "Product Mastery: pelajari 4P, promo, battlecard kompetitor, lalu uji pemahaman dengan kuis.",
};

export default function MasteryLayout({ children }: LayoutProps<"/mastery">) {
  return (
    <div className="flex min-h-dvh justify-center md:px-6 md:py-8">
      <div className="flex w-full max-w-3xl flex-col bg-bg md:overflow-hidden md:rounded-3xl md:border md:border-line md:shadow-xl">
        <header className="pt-safe border-b border-line px-4 pb-3 md:px-8 md:pt-6">
          <AppTopBar />
        </header>
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}

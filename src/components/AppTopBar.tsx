"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenCheck, Mic } from "lucide-react";
import UserMenu from "./UserMenu";
import { useCurrentUser } from "@/lib/use-current-user";

const NAV = [
  { href: "/", label: "Simulasi Roleplay", short: "Simulasi", Icon: Mic, match: (p: string) => p === "/" },
  { href: "/mastery", label: "Materi Produk", short: "Materi", Icon: BookOpenCheck, match: (p: string) => p.startsWith("/mastery") },
] as const;

/** Header bersama: identitas user + tombol Keluar, lalu navigasi utama Simulasi ↔ Materi Produk. */
export default function AppTopBar() {
  const user = useCurrentUser();

  return (
    <div className="space-y-3">
      {user ? (
        <UserMenu user={user} />
      ) : (
        <div className="flex items-center gap-2" aria-busy="true" aria-label="Memuat akun">
          <div className="h-9 w-9 animate-pulse rounded-full bg-surface-2" />
          <div className="h-4 w-32 animate-pulse rounded bg-surface-2" />
        </div>
      )}
      {/* usePathname() pada rute dinamis wajib di dalam Suspense (Next.js 16 + Cache Components). */}
      <Suspense fallback={<div className="h-[46px] rounded-2xl bg-surface-2" aria-hidden />}>
        <MainNav />
      </Suspense>
    </div>
  );
}

function MainNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav aria-label="Navigasi utama" className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1">
        {NAV.map(({ href, label, short, Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                active ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden />
              <span className="sm:hidden">{short}</span>
              <span className="hidden sm:inline">{label}</span>
            </Link>
          );
        })}
    </nav>
  );
}

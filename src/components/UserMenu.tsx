"use client";

import { useState } from "react";
import { LoaderCircle, LogOut, Send } from "lucide-react";
import type { CurrentUser } from "@/lib/types";

/** Identitas pengguna + tombol Keluar, untuk header. */
export default function UserMenu({ user }: { user: CurrentUser }) {
  const [leaving, setLeaving] = useState(false);

  const logout = async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", cache: "no-store" });
    } catch {
      // Tetap arahkan ke login; cookie akan kedaluwarsa dengan sendirinya.
    }
    window.location.replace("/login");
  };

  const subtitle =
    user.login_method === "telegram"
      ? user.telegram_username
        ? `@${user.telegram_username}`
        : `Telegram ${user.telegram_chat_id ?? ""}`.trim()
      : user.email ?? "";
  const initial = user.display_name.replace(/^@/, "").charAt(0).toUpperCase() || "?";

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand-strong" aria-hidden>
        {initial}
      </div>
      <div className="min-w-0 text-left">
        <p className="truncate text-sm font-semibold leading-tight">{user.display_name}</p>
        <p className="flex items-center gap-1 truncate text-xs text-muted">
          {user.login_method === "telegram" && <Send className="h-3 w-3 shrink-0" aria-hidden />}
          <span className="truncate">{subtitle}</span>
        </p>
      </div>
      <button
        type="button"
        onClick={logout}
        disabled={leaving}
        className="ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink transition hover:bg-surface-2 disabled:opacity-60"
      >
        {leaving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <LogOut className="h-4 w-4" aria-hidden />}
        Keluar
      </button>
    </div>
  );
}

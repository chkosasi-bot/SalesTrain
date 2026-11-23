"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "./api-client";
import type { CurrentUser, MeResponse } from "./types";

// Satu permintaan /api/auth/me per halaman, dibagi ke semua komponen yang membutuhkan.
let pending: Promise<CurrentUser | null> | null = null;

function loadCurrentUser(): Promise<CurrentUser | null> {
  pending ??= apiFetch<MeResponse>("/api/auth/me")
    .then((r) => r.user)
    .catch(() => {
      pending = null; // izinkan mencoba lagi
      return null;
    });
  return pending;
}

export function useCurrentUser(): CurrentUser | null {
  const [user, setUser] = useState<CurrentUser | null>(null);
  useEffect(() => {
    let alive = true;
    loadCurrentUser().then((u) => alive && setUser(u));
    return () => {
      alive = false;
    };
  }, []);
  return user;
}

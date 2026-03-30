"use client";

import { AuthResponse, SessionUser } from "@property-review/shared";

const STORAGE_KEY = "property-review-session";

export interface StoredSession {
  token: string;
  user: SessionUser;
}

export function saveSession(payload: AuthResponse): void {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      token: payload.token,
      user: payload.user
    })
  );
}

export function getSession(): StoredSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function clearSession(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

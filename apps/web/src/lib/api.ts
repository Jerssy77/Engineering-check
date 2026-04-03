"use client";

import { StoredSession, getSession } from "./session";

function resolveApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL;

  if (typeof window === "undefined") {
    return configured ?? "http://127.0.0.1:3001";
  }

  const fallback = `${window.location.protocol}//${window.location.hostname}:3001`;
  if (!configured) {
    return fallback;
  }

  try {
    const parsed = new URL(configured);
    if (["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      const port = parsed.port || "3001";
      return `${window.location.protocol}//${window.location.hostname}:${port}`;
    }
    return configured;
  } catch {
    return fallback;
  }
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

async function extractMessage(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return data.message ?? data.error ?? "Request failed";
  } catch {
    return response.statusText || "Request failed";
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  session: StoredSession | null = getSession()
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (session?.token) {
    headers.set("x-user-id", session.token);
  }

  const response = await fetch(`${resolveApiBase()}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    throw new ApiError(await extractMessage(response), response.status);
  }

  const contentType = response.headers.get("Content-Type") ?? "";
  const contentDisposition = response.headers.get("Content-Disposition") ?? "";

  if (contentDisposition.includes("attachment") || !contentType.includes("application/json")) {
    return (await response.blob()) as T;
  }

  return (await response.json()) as T;
}

export function buildApiUrl(path: string): string {
  return `${resolveApiBase()}${path}`;
}

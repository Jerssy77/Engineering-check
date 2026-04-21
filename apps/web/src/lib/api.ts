"use client";

import { StoredSession, getSession } from "./session";

let preferredBrowserBase: string | null = null;

function normalizeConfiguredBase(configured: string, protocol: string, hostname: string): string {
  try {
    const parsed = new URL(configured);
    if (["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      const port = parsed.port || "3001";
      return `${protocol}//${hostname}:${port}`;
    }
    return configured;
  } catch {
    return "";
  }
}

function resolveApiBaseCandidates(): string[] {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL;

  if (typeof window === "undefined") {
    return [configured ?? "http://127.0.0.1:3001"];
  }

  const protocol = window.location.protocol;
  const hostname = window.location.hostname;
  const fallback3001 = `${protocol}//${hostname}:3001`;
  const fallback3101 = `${protocol}//${hostname}:3101`;
  const normalizedConfigured = configured
    ? normalizeConfiguredBase(configured, protocol, hostname)
    : "";

  const candidates = [preferredBrowserBase, normalizedConfigured, fallback3001, fallback3101].filter(
    (value): value is string => Boolean(value)
  );

  return candidates.filter((value, index) => candidates.indexOf(value) === index);
}

function resolveApiBase(): string {
  const candidates = resolveApiBaseCandidates();
  return candidates[0] ?? "http://127.0.0.1:3001";
}

async function fetchWithFallback(input: string, init: RequestInit): Promise<Response> {
  const candidates = resolveApiBaseCandidates();
  let lastError: unknown = null;

  for (const base of candidates) {
    try {
      const response = await fetch(`${base}${input}`, init);
      preferredBrowserBase = base;
      return response;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Network request failed");
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

  const requestInit: RequestInit = {
    ...init,
    headers
  };

  const response =
    typeof window === "undefined"
      ? await fetch(`${resolveApiBase()}${path}`, requestInit)
      : await fetchWithFallback(path, requestInit);

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

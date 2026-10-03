"use client";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

const TOKEN_KEY = "summon.token";
const USER_KEY = "summon.user";

/**
 * Single-env frontend: the browser talks to the backend directly for both
 * auth HTTP and the WS relay. `NEXT_PUBLIC_SIGNAL_URL=wss://host` implies
 * the API base `https://host` — no other env var needed on Vercel.
 */
function apiBase(): string {
  const signal =
    process.env.NEXT_PUBLIC_SIGNAL_URL ?? "ws://127.0.0.1:8787";
  if (signal.startsWith("wss://")) return `https://${signal.slice(6)}`;
  if (signal.startsWith("ws://")) return `http://${signal.slice(5)}`;
  return signal.replace(/\/$/, "");
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function saveAuth(token: string, user: AuthUser): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

export async function loginRequest(
  path: "/api/auth/login" | "/api/auth/register",
  body: Record<string, string>,
): Promise<{ token: string; user: AuthUser } | { error: string }> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as {
    token?: string;
    user?: AuthUser;
    error?: string;
  };
  if (!res.ok || !data.token || !data.user) {
    return { error: data.error ?? "Request failed" };
  }
  saveAuth(data.token, data.user);
  return { token: data.token, user: data.user };
}

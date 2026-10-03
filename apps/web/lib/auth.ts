"use client";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

const TOKEN_KEY = "summon.token";
const USER_KEY = "summon.user";

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
  const res = await fetch(path, {
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

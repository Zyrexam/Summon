"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FlameIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getToken, loginRequest } from "@/lib/auth";

type Mode = "login" | "register";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = React.useState<Mode>("login");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [error, setError] = React.useState("Enter your email and password to continue.");

  React.useEffect(() => {
    if (getToken()) {
      router.replace("/");
    }
  }, [router]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setStatus("error");
      setError("Enter your email and password to continue.");
      return;
    }
    setStatus("loading");
    const result = await loginRequest(
      mode === "login" ? "/api/auth/login" : "/api/auth/register",
      mode === "login"
        ? { email, password }
        : { email, password, name },
    );
    if ("error" in result) {
      setStatus("error");
      setError(result.error);
      return;
    }
    router.replace("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="flex flex-col items-center gap-1 text-center">
          <div
            aria-hidden="true"
            className="mb-1 flex size-10 items-center justify-center rounded-xl bg-ember-muted text-ember"
          >
            <FlameIcon className="size-5" />
          </div>
          <CardTitle className="text-xl">Summon</CardTitle>
          <CardDescription>
            Meet with AI. Private calls, E2EE chat, AI only when summoned.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            {mode === "register" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Display name</Label>
                <Input
                  id="name"
                  autoComplete="name"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={status === "loading"}
                />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@team.example"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (status === "error") setStatus("idle");
                }}
                aria-invalid={status === "error" || undefined}
                disabled={status === "loading"}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                placeholder="••••••••"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (status === "error") setStatus("idle");
                }}
                aria-invalid={status === "error" || undefined}
                disabled={status === "loading"}
              />
            </div>
            {status === "error" && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={status === "loading"}
              data-testid="auth-submit"
            >
              {status === "loading" ? (
                <>
                  <Loader2Icon className="animate-spin" />
                  {mode === "login" ? "Signing in…" : "Creating account…"}
                </>
              ) : mode === "login" ? (
                "Sign in"
              ) : (
                "Create account"
              )}
            </Button>
            <button
              type="button"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setStatus("idle");
              }}
            >
              {mode === "login"
                ? "Need an account? Create one"
                : "Have an account? Sign in"}
            </button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

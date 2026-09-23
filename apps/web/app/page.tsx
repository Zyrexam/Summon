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

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [status, setStatus] = React.useState<
    "idle" | "loading" | "error"
  >("idle");

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || !password) {
      setStatus("error");
      return;
    }
    setStatus("loading");
    router.push("/rooms");
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
            Private rooms. E2EE chat. AI only when summoned.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
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
                autoComplete="current-password"
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
                Enter your email and password to continue.
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={status === "loading"}
            >
              {status === "loading" ? (
                <>
                  <Loader2Icon className="animate-spin" />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

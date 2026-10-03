"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CopyIcon,
  FlameIcon,
  LinkIcon,
  LogOutIcon,
  PlusIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { clearAuth, getToken, getUser } from "@/lib/auth";
import { useSession } from "@/lib/session";

type LiveSession = { id: string; memberCount: number };

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = React.useState<{ name: string; email: string } | null>(
    null,
  );
  const [live, setLive] = React.useState<LiveSession[]>([]);
  const [joinUrl, setJoinUrl] = React.useState("");
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const handleEvent = React.useCallback(
    (event: Parameters<Parameters<typeof useSession>[0]>[0]) => {
      if (event.type === "session-created") {
        router.push(`/c/${event.sessionId}`);
        return;
      }
      if (event.type === "sessions") {
        setLive(event.sessions);
      }
    },
    [router],
  );

  const session = useSession(handleEvent);

  React.useEffect(() => {
    const token = getToken();
    const u = getUser();
    if (!token || !u) {
      router.replace("/login");
      return;
    }
    setUser(u);
  }, [router]);

  React.useEffect(() => {
    if (!session.ready) return;
    session.listSessions();
  }, [session.ready, session.listSessions]);

  async function createSession() {
    if (!session.ready) return;
    session.create();
  }

  function submitJoin(event: React.FormEvent) {
    event.preventDefault();
    const raw = joinUrl.trim();
    if (!raw) return;
    let id = raw;
    try {
      const url = new URL(raw, window.location.origin);
      const parts = url.pathname.split("/").filter(Boolean);
      const cIndex = parts.indexOf("c");
      if (cIndex >= 0 && parts[cIndex + 1]) {
        id = parts[cIndex + 1]!;
      } else if (parts.length > 0) {
        id = parts[parts.length - 1]!;
      }
    } catch {
      const marker = raw.split("/c/");
      if (marker.length > 1) {
        id = marker[marker.length - 1]!.split(/[/?#]/)[0]!;
      }
    }
    id = id.replace(/\/+$/, "");
    if (!id) return;
    router.push(`/c/${id}`);
  }

  async function copyLink(id: string) {
    const url = `${window.location.origin}/c/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      window.prompt("Copy invite link", url);
    }
  }

  function signOut() {
    clearAuth();
    router.replace("/login");
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-md bg-ember-muted text-ember">
          <FlameIcon className="size-4" />
        </span>
        <span className="text-lg font-medium tracking-tight">Summon</span>
        <span className="ms-auto flex items-center gap-3 text-sm text-muted-foreground">
          {user && (
            <>
              <span className="truncate" data-testid="dash-user">
                {user.name}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title="Sign out"
                onClick={signOut}
                data-testid="sign-out"
              >
                <LogOutIcon />
                <span className="sr-only">Sign out</span>
              </Button>
            </>
          )}
        </span>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Start a session</CardTitle>
          <CardDescription>
            Create a call link, share it, admit people when they knock.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button
            type="button"
            className="w-full"
            onClick={() => void createSession()}
            disabled={!session.ready}
            data-testid="create-session"
          >
            <PlusIcon />
            Create session
          </Button>
          <form onSubmit={submitJoin} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor="join-link" className="text-sm font-medium">
                Or join with a link
              </label>
              <Input
                id="join-link"
                value={joinUrl}
                onChange={(e) => setJoinUrl(e.target.value)}
                placeholder="Paste invite link"
                className="mt-1"
                data-testid="join-link-input"
              />
            </div>
            <Button type="submit" variant="outline" data-testid="join-submit">
              <LinkIcon />
              Join
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Live sessions you host</CardTitle>
          <CardDescription>Only active calls — no history.</CardDescription>
        </CardHeader>
        <CardContent>
          {live.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No live sessions</EmptyTitle>
                <EmptyDescription>
                  Create a session to get an invite link.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="live-sessions">
              {live.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="break-all font-mono text-sm">{s.id}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.memberCount} online
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copyLink(s.id)}
                    data-testid={`copy-${s.id}`}
                  >
                    <CopyIcon />
                    {copiedId === s.id ? "Copied" : "Copy link"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => router.push(`/c/${s.id}`)}
                  >
                    Open
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

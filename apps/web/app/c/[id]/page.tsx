"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ClockIcon,
  CopyIcon,
  FlameIcon,
  Loader2Icon,
  UserPlusIcon,
  XIcon,
} from "lucide-react";
import { aadFor, encryptRoomText, generateRoomKey } from "@summon/core";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CallStage } from "@/components/call-stage";
import { ChatSidebar } from "@/components/chat-sidebar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { getToken, getUser } from "@/lib/auth";
import { useMesh, type MeshSend, type PeerView } from "@/lib/mesh";
import {
  useSession,
  loadRoomKey,
  mergeHistory,
  saveRoomKey,
  type SessionEvent,
  type SessionMessage,
} from "@/lib/session";
import { clockTime, initials } from "@/lib/format";
import { createRoomKeyStore } from "@/lib/room-key";
import { senderRows } from "@/lib/chat-rows";
import { summonContextLines } from "@/lib/summon-context";
import { reportStateFrom, type ReportState } from "@/lib/report";
import type {
  RosterMember,
  SignalClientMessage,
  SignalServerMessage,
} from "@summon/core";

type Phase = "checking" | "entry" | "waiting" | "denied" | "joined" | "ended";

const SUMMON_PREFIX = /^@ai\b\s*/i;
const SUMMON_CONTEXT_LINES = 15;
const SUMMON_AI_ID = "summon-ai";
const SUMMON_AI_NAME = "Summon AI";

export default function CallPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const sessionId = params.id;
  const [phase, setPhase] = React.useState<Phase>("checking");
  const [messages, setMessages] = React.useState<SessionMessage[]>([]);
  const [draft, setDraft] = React.useState("");
  const [knocks, setKnocks] = React.useState<
    { visitorId: string; visitorName: string }[]
  >([]);
  const [knockOpen, setKnockOpen] = React.useState(false);
  const [roster, setRoster] = React.useState<RosterMember[]>([]);
  const [isHost, setIsHost] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [key, setKey] = React.useState<string | null>(null);
  const [myId, setMyId] = React.useState<string | null>(null);
  const [chatOpen, setChatOpen] = React.useState(false);
  const [confirmEnd, setConfirmEnd] = React.useState(false);
  const [confirmLeave, setConfirmLeave] = React.useState(false);
  const [linkCopied, setLinkCopied] = React.useState(false);
  const [summoning, setSummoning] = React.useState(false);
  const [summonError, setSummonError] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<ReportState | null>(null);

  const senders = React.useMemo(
    () => senderRows(messages, roster),
    [messages, roster],
  );

  const downloadReport = React.useCallback(() => {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([report.markdown], { type: "text/markdown" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = report.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [report]);

  const messagesRef = React.useRef<SessionMessage[]>([]);
  messagesRef.current = messages;

  const keyRef = React.useRef<string | null>(null);
  keyRef.current = key;
  const myIdRef = React.useRef<string | null>(null);
  myIdRef.current = myId;
  const meshSignalRef = React.useRef<
    ((message: SignalServerMessage) => void) | null
  >(null);
  const phaseRef = React.useRef<Phase>("checking");
  phaseRef.current = phase;
  const rtcJoined = React.useRef(false);
  const readyHandled = React.useRef(false);

  const sendRef = React.useRef<MeshSend | null>(null);
  const signalSendRef = React.useRef<
    ((message: SignalClientMessage) => void) | null
  >(null);

  const mesh = useMesh(
    (message) => {
      sendRef.current?.(message);
    },
    meshSignalRef,
  );

  const roomKeys = React.useRef(
    createRoomKeyStore({
      load: loadRoomKey,
      save: saveRoomKey,
      generate: generateRoomKey,
    }),
  ).current;

  const ensureHostKey = React.useCallback(async () => {
    const existing = keyRef.current ?? roomKeys.get(sessionId);
    if (existing) {
      keyRef.current = existing;
      setKey(existing);
      return existing;
    }
    const generated = await roomKeys.ensure(sessionId);
    keyRef.current = generated;
    setKey(generated);
    return generated;
  }, [roomKeys, sessionId]);

  const handleEvent = React.useCallback(
    async (event: SessionEvent) => {
      if (event.type === "ready") {
        setMyId(event.userId);
        myIdRef.current = event.userId;
        if (readyHandled.current) return;
        readyHandled.current = true;
        const stored = loadRoomKey(sessionId);
        if (stored) {
          keyRef.current = stored;
          roomKeys.seed(sessionId, stored);
          setKey(stored);
        }
        // Always attempt host-open first (no-op error for non-hosts), else knock.
        // send via session below through a ref filled after useSession
        pendingAfterReady.current = stored ? "knock" : "host-open";
        return;
      }
      if (event.type === "error") {
        setError(event.message);
        if (
          (event.code === "no-session" || event.code === "not-host") &&
          phaseRef.current === "checking"
        ) {
          if (pendingAfterReady.current === "host-open") {
            pendingAfterReady.current = null;
            setPhase("entry");
          }
        }
        return;
      }
      if (event.type === "session-ended") {
        if (event.sessionId === sessionId) {
          setPhase("ended");
          mesh.leave();
          // Guests never sent `end` themselves, so nobody requested their
          // report yet — without this they stare at an empty ended screen.
          signalSendRef.current?.({ type: "report", sessionId });
        }
        return;
      }
      if (event.type === "admitted") {
        if (event.sessionId !== sessionId) return;
        if (!keyRef.current) {
          setPhase("waiting");
        } else {
          setPhase("joined");
        }
        return;
      }
      if (event.type === "denied") {
        if (event.sessionId === sessionId) setPhase("denied");
        return;
      }
      if (event.type === "report") {
        if (event.sessionId !== sessionId) return;
        setReport(reportStateFrom(event.sessionId, event.lines, event.endedAt));
        return;
      }
      if (event.type === "room-key") {
        if (event.sessionId !== sessionId) return;
        saveRoomKey(sessionId, event.key);
        roomKeys.seed(sessionId, event.key);
        keyRef.current = event.key;
        setKey(event.key);
        setPhase("joined");
        return;
      }
      if (event.type === "room-msg") {
        if (event.message.sessionId !== sessionId) return;
        const msg = event.message;
        setMessages((prev) =>
          prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
        );
        return;
      }
      if (event.type === "history") {
        if (event.sessionId !== sessionId) return;
        setMessages((prev) => mergeHistory(prev, event.messages));
        return;
      }
      if (event.type === "ai-answer") {
        if (event.sessionId !== sessionId) return;
        setSummoning(false);
        const activeKey = keyRef.current;
        if (!activeKey) return;
        const msgId = event.requestId;
        const { iv, enc } = await encryptRoomText(
          activeKey,
          event.answer,
          // Receivers rebuild the AAD from the relay-stamped `from`, which is the
        // summoner, not Summon AI: binding to the AI id would make every other
        // member's decrypt fail.
          aadFor(sessionId, msgId, myIdRef.current ?? "self"),
        );
        signalSendRef.current?.({
          type: "room-msg",
          sessionId,
          msgId,
          iv,
          enc,
          kind: "ai",
        });
        setMessages((prev) =>
          prev.some((m) => m.id === msgId) ? prev : [
            ...prev,
            {
              id: msgId,
              sessionId,
              from: SUMMON_AI_ID,
              fromName: SUMMON_AI_NAME,
              body: event.answer,
              kind: "ai",
              time: clockTime(new Date()),
              readable: true,
            },
          ],
        );
        return;
      }
      if (event.type === "ai-error") {
        if (event.sessionId !== sessionId) return;
        setSummoning(false);
        setSummonError(event.message);
        return;
      }
      if (event.type === "roster") {
        if (event.sessionId !== sessionId) return;
        setRoster(event.members);
        const uid = myIdRef.current;
        if (!uid) return;
        const self = event.members.find((m) => m.id === uid);
        if (!self) return;
        setIsHost(Boolean(self.host));
        if (self.host) {
          setPhase((p) =>
            p === "checking" || p === "entry" || p === "waiting" ? "joined" : p,
          );
          void ensureHostKey();
        } else if (keyRef.current) {
          setPhase((p) =>
            p === "checking" || p === "entry" || p === "waiting" ? "joined" : p,
          );
        }
        return;
      }
      if (event.type === "knock") {
        if (event.knock.sessionId !== sessionId) return;
        setKnocks((prev) =>
          prev.some((k) => k.visitorId === event.knock.visitorId)
            ? prev
            : [...prev, event.knock],
        );
        return;
      }
      if (event.type === "signal") {
        meshSignalRef.current?.(event.message);
      }
    },
    [ensureHostKey, mesh, sessionId],
  );

  const session = useSession(handleEvent);
  sendRef.current = session.send as unknown as MeshSend;
  signalSendRef.current = session.send;

  // The relay advertises its mesh ceiling in `ready`; until then the mesh
  // uses the protocol default. The relay always enforces the real limit.
  React.useEffect(() => {
    mesh.setMaxPeers(session.maxPeers);
  }, [mesh, session.maxPeers]);

  const pendingAfterReady = React.useRef<"knock" | "host-open" | null>(null);

  React.useEffect(() => {
    if (!getToken() || !getUser()) {
      router.replace(`/login?next=/c/${sessionId}`);
    }
  }, [router, sessionId]);

  React.useEffect(() => {
    if (!session.ready || !readyHandled.current) return;
    const pending = pendingAfterReady.current;
    if (pending === "knock") {
      pendingAfterReady.current = null;
      session.knock(sessionId);
      return;
    }
    if (pending === "host-open") {
      pendingAfterReady.current = null;
      session.hostOpen(sessionId);
      // if we are not the host, error handler flips to entry;
      // if we are not authenticated into a session, also entry after short path
      const timer = window.setTimeout(() => {
        if (phaseRef.current === "checking") setPhase("entry");
      }, 400);
      return () => window.clearTimeout(timer);
    }
  }, [session.ready, session.knock, session.hostOpen, sessionId]);

  async function submitEntry(event: React.FormEvent) {
    event.preventDefault();
    setPhase("waiting");
    session.knock(sessionId);
  }

  React.useEffect(() => {
    if (phase !== "joined" || !key || rtcJoined.current || !myId) return;
    rtcJoined.current = true;
    void (async () => {
      await mesh.start(sessionId, myId);
      session.joinRtc(sessionId);
    })();
  }, [phase, key, myId, mesh, session, sessionId]);

  async function allowKnock(visitorId: string) {
    const activeKey = await ensureHostKey();
    session.admit(sessionId, visitorId);
    session.sendRoomKey(sessionId, visitorId, activeKey);
    setKnocks((prev) => prev.filter((k) => k.visitorId !== visitorId));
    setKnockOpen(false);
  }

  function denyKnock(visitorId: string) {
    session.deny(sessionId, visitorId);
    setKnocks((prev) => prev.filter((k) => k.visitorId !== visitorId));
  }

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    const activeKey = keyRef.current;
    if (!body || !activeKey) return;

    if (SUMMON_PREFIX.test(body)) {
      const question = body.replace(SUMMON_PREFIX, "").trim();
      if (!question) return;
      setSummonError(null);
      setSummoning(true);
      setDraft("");
      session.summon({
        sessionId,
        requestId: `s-${Date.now()}`,
        question,
        context: summonContextLines(messagesRef.current, SUMMON_CONTEXT_LINES),
      });
      return;
    }

    const user = getUser();
    const msgId = `m-${Date.now()}`;
    const { iv, enc } = await encryptRoomText(
      activeKey,
      body,
      aadFor(sessionId, msgId, myId ?? "self"),
    );
    session.sendRoomMsg({ sessionId, msgId, iv, enc, kind: "human" });
    setMessages((prev) => [
      ...prev,
      {
        id: msgId,
        sessionId,
        from: myId ?? "self",
        fromName: user?.name ?? "You",
        body,
        kind: "human",
        time: clockTime(new Date()),
        readable: true,
        you: true,
      },
    ]);
    setDraft("");
  }

  async function copyInviteLink() {
    const url = `${window.location.origin}/c/${sessionId}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      window.prompt("Copy invite link", url);
    }
  }

  function doLeave() {
    setConfirmLeave(false);
    mesh.leave();
    session.leave(sessionId);
    session.requestReport(sessionId);
    router.push("/");
  }

  function doEnd() {
    setConfirmEnd(false);
    session.end(sessionId);
    mesh.leave();
    session.requestReport(sessionId);
    setPhase("ended");
  }

  const peerNames = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of roster) map[m.id] = m.name;
    return map;
  }, [roster]);

  const peers: PeerView[] = mesh.peers;

  if (phase === "checking" && !error) {
    return (
      <main className="grid min-h-svh place-items-center bg-background">
        <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (phase === "ended") {
    return (
      <main className="grid min-h-svh place-items-center bg-background p-6">
        <div className="w-full max-w-sm rounded-xl border bg-card p-6 text-center shadow-sm">
          <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-muted">
            <FlameIcon className="size-5 text-ember" />
          </span>
          <h1 className="text-base font-medium">Session ended</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {report
              ? `${report.ended ? "Session ended" : "Session still live"}. ${report.lines.length} line${report.lines.length === 1 ? "" : "s"} recorded.`
              : "This call is over. Return to the dashboard to start another."}
          </p>
          {report && (
            <>
              <Button
                type="button"
                variant="outline"
                className="mt-4 w-full"
                onClick={downloadReport}
                data-testid="download-report"
              >
                Download report
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Who spoke, when, and which message. Message text stays
                end-to-end encrypted and is never on the relay.
              </p>
            </>
          )}
          <Button
            type="button"
            className="mt-4 w-full"
            onClick={() => router.push("/")}
            data-testid="back-dashboard"
          >
            Back to dashboard
          </Button>
        </div>
      </main>
    );
  }

  if (phase === "denied") {
    return (
      <main className="grid min-h-svh place-items-center bg-background p-6">
        <div
          className="w-full max-w-sm rounded-xl border bg-card p-6 text-center shadow-sm"
          data-testid="join-denied"
        >
          <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <XIcon className="size-5" />
          </span>
          <h2 className="text-base font-medium">Request declined</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The host denied your request to join.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => setPhase("entry")}
          >
            Try again
          </Button>
        </div>
      </main>
    );
  }

  if (phase === "waiting") {
    return (
      <main className="grid min-h-svh place-items-center bg-background p-6">
        <div
          className="w-full max-w-sm rounded-xl border bg-card p-6 text-center shadow-sm"
          data-testid="join-waiting"
        >
          <span className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-muted">
            <ClockIcon className="size-5 text-muted-foreground" />
          </span>
          <h2 className="text-base font-medium">Waiting for host</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The host must allow you before you can enter this session.
          </p>
          <Button
            type="button"
            variant="ghost"
            className="mt-4"
            onClick={() => setPhase("entry")}
          >
            Cancel
          </Button>
        </div>
      </main>
    );
  }

  if (phase === "entry") {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-md bg-ember-muted text-ember">
            <FlameIcon className="size-4" />
          </span>
          <span className="text-lg font-medium tracking-tight">Summon</span>
        </div>
        <form
          onSubmit={submitEntry}
          className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm"
        >
          <div className="mb-4 flex flex-col items-center gap-2 text-center">
            <h1 className="break-all font-mono text-sm">{sessionId}</h1>
            <p className="text-sm text-muted-foreground">
              This call is invite-only. Request to join and the host will admit
              you.
            </p>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
          <Button
            type="submit"
            className="w-full"
            data-testid="request-join"
          >
            Request to join
          </Button>
        </form>
      </main>
    );
  }

  return (
    <div className="flex h-svh min-h-0 w-full flex-col overflow-hidden bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <span className="flex size-6 items-center justify-center rounded-md bg-ember-muted text-ember">
          <FlameIcon className="size-3.5" />
        </span>
        <span className="max-w-[12rem] truncate font-mono text-xs sm:max-w-xs">
          {sessionId}
        </span>
        <span className="ms-auto flex items-center gap-2">
          {error && <span className="text-xs text-destructive">{error}</span>}
          {isHost && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void copyInviteLink()}
                data-testid="copy-invite-link"
              >
                <CopyIcon />
                <span className="hidden sm:inline">
                  {linkCopied ? "Copied" : "Copy invite link"}
                </span>
              </Button>
              <Button
                type="button"
                variant={knocks.length > 0 ? "default" : "outline"}
                size="sm"
                onClick={() => setKnockOpen(true)}
                data-testid="knock-list"
              >
                <UserPlusIcon />
                {knocks.length > 0 ? (
                  knocks.length
                ) : (
                  <span className="hidden sm:inline">Requests</span>
                )}
              </Button>
            </>
          )}
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {roster.filter((m) => m.online).length}/{roster.length || 1}
          </span>
          <div className="md:hidden">
            <Sheet open={chatOpen} onOpenChange={setChatOpen}>
              <SheetTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="open-chat"
                  />
                }
              >
                Chat
              </SheetTrigger>
              <SheetContent
                side="right"
                className="flex w-full max-w-sm flex-col p-0 data-[side=right]:w-full sm:max-w-md"
              >
                <SheetHeader className="sr-only">
                  <SheetTitle>Chat</SheetTitle>
                  <SheetDescription>Session chat</SheetDescription>
                </SheetHeader>
                <div className="min-h-0 flex-1">
                  <ChatSidebar
                    messages={messages}
                    senders={senders}
                    draft={draft}
                    onDraftChange={setDraft}
                    onSend={(e) => {
                      void sendMessage(e);
                    }}
                    summoning={summoning}
                    summonError={summonError}
                  />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <CallStage
          status={mesh.status}
          micOn={mesh.micOn}
          camOn={mesh.camOn}
          isHost={isHost}
          selfRef={mesh.selfRef}
          peers={peers}
          peerNames={peerNames}
          onToggleMic={mesh.toggleMic}
          onToggleCam={mesh.toggleCam}
          onLeave={() => setConfirmLeave(true)}
          onEnd={isHost ? () => setConfirmEnd(true) : undefined}
        />
        <aside className="hidden w-80 shrink-0 md:block xl:w-96">
          <ChatSidebar
            messages={messages}
            senders={senders}
            draft={draft}
            onDraftChange={setDraft}
            onSend={(e) => {
              void sendMessage(e);
            }}
            summoning={summoning}
            summonError={summonError}
          />
        </aside>
      </div>

      <Dialog open={knockOpen} onOpenChange={setKnockOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Join requests</DialogTitle>
            <DialogDescription>
              Allow admits the visitor and ships the room key.
            </DialogDescription>
          </DialogHeader>
          {knocks.length === 0 ? (
            <p
              className="py-4 text-sm text-muted-foreground"
              data-testid="knock-empty"
            >
              No one is waiting.
            </p>
          ) : (
            <ul className="flex flex-col gap-3 py-2">
              {knocks.map((knock) => (
                <li
                  key={knock.visitorId}
                  className="flex items-center gap-3 rounded-lg border p-3"
                  data-testid="knock-row"
                >
                  <span className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {initials(knock.visitorName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {knock.visitorName}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void allowKnock(knock.visitorId)}
                    data-testid="allow-knock"
                  >
                    Allow
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => denyKnock(knock.visitorId)}
                    data-testid="deny-knock"
                  >
                    Deny
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Leave session?</DialogTitle>
            <DialogDescription>
              You can rejoin while the call is live if the host still has the
              link open.
            </DialogDescription>
          </DialogHeader>
          {report && !report.ended && (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-muted-foreground">
                {report.lines.length} line{report.lines.length === 1 ? "" : "s"}{" "}
                recorded so far.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={downloadReport}
                data-testid="download-report-live"
              >
                Download report
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmLeave(false)}
            >
              Stay
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={doLeave}
              data-testid="confirm-leave"
            >
              Leave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>End session for everyone?</DialogTitle>
            <DialogDescription>
              This closes the call for all participants.
            </DialogDescription>
          </DialogHeader>
          {report && (
            <div className="flex flex-col gap-2 text-sm">
              <p className="text-muted-foreground">
                {report.ended ? "Session ended." : "Session still live."}{" "}
                {report.lines.length} line{report.lines.length === 1 ? "" : "s"}{" "}
                recorded.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={downloadReport}
                data-testid="download-report"
              >
                Download report
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmEnd(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={doEnd}
              data-testid="confirm-end"
            >
              End session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

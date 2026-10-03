"use client";

import * as React from "react";
import {
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  PowerIcon,
  VideoIcon,
  VideoOffIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CallStatus, PeerView } from "@/lib/mesh";
import { initials } from "@/lib/format";


type CallStageProps = {
  status: CallStatus;
  micOn: boolean;
  camOn: boolean;
  isHost: boolean;
  selfRef: React.RefObject<HTMLVideoElement | null>;
  peers: PeerView[];
  peerNames: Record<string, string>;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onLeave: () => void;
  onEnd?: () => void;
};

function gridClass(count: number) {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-1 sm:grid-cols-2";
  if (count <= 4) return "grid-cols-2";
  return "grid-cols-2 sm:grid-cols-3";
}

export function CallStage({
  status,
  micOn,
  camOn,
  isHost,
  selfRef,
  peers,
  peerNames,
  onToggleMic,
  onToggleCam,
  onLeave,
  onEnd,
}: CallStageProps) {
  const tiles = peers.length + 1;
  const label =
    status === "connecting" || status === "joining"
      ? "Connecting…"
      : "Waiting for others to join";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-muted">
      <div className={`grid min-h-0 flex-1 gap-2 p-2 ${gridClass(tiles)}`}>
        <div className="relative min-h-40 overflow-hidden rounded-lg border bg-background">
          <video
            ref={selfRef}
            data-testid="self-video"
            autoPlay
            playsInline
            muted
            className={`size-full object-cover scale-x-[-1] ${camOn ? "" : "invisible"}`}
          />
          {!camOn && (
            <div className="absolute inset-0 grid place-items-center bg-muted" data-testid="self-video-off">
              <VideoOffIcon className="size-8 text-muted-foreground" />
            </div>
          )}
          <span className="absolute bottom-2 left-2 rounded bg-background/90 px-2 py-0.5 text-xs font-medium">
            You
          </span>
        </div>
        {peers.map((peer) => (
          <RemoteTile
            key={peer.peerId}
            peer={peer}
            name={peerNames[peer.peerId] ?? "Guest"}
          />
        ))}
        {peers.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
        )}
      </div>
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background/95 p-2 shadow-sm">
        <Button
          type="button"
          size="icon"
          variant={micOn ? "secondary" : "destructive"}
          onClick={onToggleMic}
          title={micOn ? "Mute" : "Unmute"}
        >
          {micOn ? <MicIcon /> : <MicOffIcon />}
          <span className="sr-only">{micOn ? "Mute" : "Unmute"}</span>
        </Button>
        <Button
          type="button"
          size="icon"
          variant={camOn ? "secondary" : "destructive"}
          onClick={onToggleCam}
          title={camOn ? "Camera off" : "Camera on"}
        >
          {camOn ? <VideoIcon /> : <VideoOffIcon />}
          <span className="sr-only">
            {camOn ? "Camera off" : "Camera on"}
          </span>
        </Button>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          onClick={onLeave}
          title="Leave call"
          data-testid="leave-call"
        >
          <PhoneOffIcon />
          <span className="sr-only">Leave call</span>
        </Button>
        {isHost && onEnd && (
          <Button
            type="button"
            size="icon"
            variant="destructive"
            onClick={onEnd}
            title="End session for everyone"
            data-testid="end-session"
          >
            <PowerIcon />
            <span className="sr-only">End session</span>
          </Button>
        )}
      </div>
    </div>
  );
}

function RemoteTile({
  peer,
  name,
}: {
  peer: PeerView;
  name: string;
}) {
  const ref = React.useRef<HTMLVideoElement | null>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.srcObject = peer.stream;
  }, [peer.stream]);
  return (
    <div className="relative min-h-40 overflow-hidden rounded-lg border bg-background">
      <video
        ref={ref}
        data-testid={`peer-video-${peer.peerId}`}
        autoPlay
        playsInline
        className="size-full object-cover"
      />
      <span className="absolute bottom-2 left-2 rounded bg-background/90 px-2 py-0.5 text-xs font-medium">
        {initials(name)} · {name}
      </span>
    </div>
  );
}

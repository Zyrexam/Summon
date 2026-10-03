"use client";

import * as React from "react";
import { MAX_SESSION_PEERS, type SignalServerMessage } from "@summon/core";
import { canAcceptPeer } from "./mesh-cap";

export type CallStatus = "idle" | "joining" | "connecting" | "in-call";

export type PeerView = {
  peerId: string;
  stream: MediaStream | null;
};

type PeerRT = {
  pc: RTCPeerConnection;
  stream: MediaStream | null;
  pendingIce: RTCIceCandidateInit[];
};

type MeshState = {
  local: MediaStream | null;
  peers: Map<string, PeerRT>;
  pendingIce: Map<string, RTCIceCandidateInit[]>;
  myId: string | null;
  sessionId: string | null;
  makingOffer: Set<string>;
};

const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];

export type MeshSend = (
  message:
    | { type: "rtc-offer"; to: string; sdp: string }
    | { type: "rtc-answer"; to: string; sdp: string }
    | { type: "rtc-ice"; to: string; candidate: unknown },
) => void;

export function useMesh(
  send: MeshSend,
  onSignal: React.MutableRefObject<
    ((message: SignalServerMessage) => void) | null
  >,
) {
  const maxPeersRef = React.useRef(MAX_SESSION_PEERS);
  /** Follows the ceiling the relay advertised; the relay still enforces it. */
  const setMaxPeers = React.useCallback((cap: number) => {
    if (Number.isSafeInteger(cap) && cap > 0) maxPeersRef.current = cap;
  }, []);
  const [status, setStatus] = React.useState<CallStatus>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [micOn, setMicOn] = React.useState(true);
  const [camOn, setCamOn] = React.useState(true);
  const [peers, setPeers] = React.useState<PeerView[]>([]);
  const selfRef = React.useRef<HTMLVideoElement | null>(null);
  const stateRef = React.useRef<MeshState>({
    local: null,
    peers: new Map(),
    pendingIce: new Map(),
    myId: null,
    sessionId: null,
    makingOffer: new Set(),
  });

  const publishPeers = React.useCallback(() => {
    const list: PeerView[] = [];
    for (const [peerId, peer] of stateRef.current.peers) {
      list.push({ peerId, stream: peer.stream });
    }
    setPeers(list);
  }, []);

  const ensurePeer = React.useCallback(
    (peerId: string, autoNegotiate = true): PeerRT => {
      const state = stateRef.current;
      const existing = state.peers.get(peerId);
      if (existing) return existing;
      const local = state.local;
      const pc = new RTCPeerConnection({ iceServers });
      if (local) {
        for (const track of local.getTracks()) pc.addTrack(track, local);
      }
      const peer: PeerRT = { pc, stream: null, pendingIce: [] };
      state.peers.set(peerId, peer);

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        send({
          type: "rtc-ice",
          to: peerId,
          candidate: {
            ...event.candidate.toJSON(),
            candidate: event.candidate.candidate,
          },
        });
      };

      pc.ontrack = (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        peer.stream = stream;
        publishPeers();
        setStatus((s) => (s === "idle" ? s : "in-call"));
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") {
          setError("Video connection failed. Check your network and try again.");
        }
      };

      pc.onnegotiationneeded = async () => {
        if (!autoNegotiate) return;
        const state2 = stateRef.current;
        if (state2.makingOffer.has(peerId)) return;
        state2.makingOffer.add(peerId);
        try {
          const offer = await pc.createOffer();
          if (pc.signalingState !== "stable") return;
          await pc.setLocalDescription(offer);
          send({ type: "rtc-offer", to: peerId, sdp: offer.sdp ?? "" });
        } catch {
          // negotiation failed; peer may retry
        } finally {
          state2.makingOffer.delete(peerId);
        }
      };

      const queued = state.pendingIce.get(peerId) ?? [];
      state.pendingIce.delete(peerId);
      void (async () => {
        for (const candidate of queued) {
          try {
            await pc.addIceCandidate(candidate);
          } catch {
            // stale
          }
        }
      })();

      return peer;
    },
    [publishPeers, send],
  );

  const handleSignal = React.useCallback(
    async (message: SignalServerMessage) => {
      const state = stateRef.current;
      if (!state.sessionId) return;

      if (message.type === "peers") {
        if (message.peers.length === 0) {
          setStatus("connecting");
          return;
        }
        setStatus("connecting");
        for (const peerId of message.peers) {
          ensurePeer(peerId, false);
        }
        return;
      }

      if (message.type === "peer-joined") {
        if (!canAcceptPeer(state.peers.size, maxPeersRef.current)) return;
        const peer = ensurePeer(message.peerId, false);
        try {
          const offer = await peer.pc.createOffer();
          await peer.pc.setLocalDescription(offer);
          send({ type: "rtc-offer", to: message.peerId, sdp: offer.sdp ?? "" });
        } catch {
          // The peer may have sent an offer first; the answer path handles it.
        }
        setStatus((s) => (s === "idle" ? s : "connecting"));
        return;
      }

      if (message.type === "peer-left") {
        const peer = state.peers.get(message.peerId);
        if (peer) {
          peer.pc.close();
          state.peers.delete(message.peerId);
          state.pendingIce.delete(message.peerId);
        }
        publishPeers();
        if (state.peers.size === 0) setStatus("connecting");
        return;
      }

      if (message.type === "rtc-offer") {
        const peer = ensurePeer(message.from, false);
        try {
          if (peer.pc.signalingState !== "stable") {
            await peer.pc.setLocalDescription({ type: "rollback" });
          }
          await peer.pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          send({
            type: "rtc-answer",
            to: message.from,
            sdp: answer.sdp ?? "",
          });
          const queued = peer.pendingIce.splice(0);
          for (const candidate of queued) {
            try {
              await peer.pc.addIceCandidate(candidate);
            } catch {
              // stale
            }
          }
        } catch {
          // ignore bad sdp
        }
        return;
      }

      if (message.type === "rtc-answer") {
        const peer = state.peers.get(message.from);
        if (!peer) return;
        try {
          await peer.pc.setRemoteDescription({ type: "answer", sdp: message.sdp });
          const queued = peer.pendingIce.splice(0);
          for (const candidate of queued) {
            try {
              await peer.pc.addIceCandidate(candidate);
            } catch {
              // stale
            }
          }
        } catch {
          // ignore
        }
        return;
      }

      if (message.type === "rtc-ice") {
        const peer = state.peers.get(message.from);
        const candidate = message.candidate as RTCIceCandidateInit;
        if (!peer) {
          const list = state.pendingIce.get(message.from) ?? [];
          list.push(candidate);
          state.pendingIce.set(message.from, list);
          return;
        }
        if (peer.pc.remoteDescription) {
          try {
            await peer.pc.addIceCandidate(candidate);
          } catch {
            // stale
          }
        } else {
          peer.pendingIce.push(candidate);
        }
      }
    },
    [ensurePeer, publishPeers, send],
  );

  React.useEffect(() => {
    onSignal.current = (message: SignalServerMessage) => {
      void handleSignal(message);
    };
    return () => {
      onSignal.current = null;
    };
  }, [handleSignal, onSignal]);

  const teardown = React.useCallback(() => {
    const state = stateRef.current;
    state.local?.getTracks().forEach((track) => track.stop());
    for (const peer of state.peers.values()) peer.pc.close();
    state.peers.clear();
    state.pendingIce.clear();
    state.local = null;
    state.sessionId = null;
    state.myId = null;
    if (selfRef.current) selfRef.current.srcObject = null;
    setPeers([]);
    setStatus("idle");
    setMicOn(true);
    setCamOn(true);
  }, []);

  const start = React.useCallback(
    async (sessionId: string, myId: string) => {
      if (stateRef.current.local) return;
      setError(null);
      let local: MediaStream | null = null;
      let audioAvailable = false;
      let videoAvailable = false;
      try {
        local = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: true,
        });
        audioAvailable = local.getAudioTracks().length > 0;
        videoAvailable = local.getVideoTracks().length > 0;
      } catch {
        try {
          local = await navigator.mediaDevices.getUserMedia({ audio: true });
          audioAvailable = local.getAudioTracks().length > 0;
        } catch {
          try {
            local = await navigator.mediaDevices.getUserMedia({ video: true });
            videoAvailable = local.getVideoTracks().length > 0;
          } catch {
            local = new MediaStream();
          }
        }
      }
      const tracks = local.getTracks();
      stateRef.current.local = local;
      stateRef.current.sessionId = sessionId;
      stateRef.current.myId = myId;
      if (selfRef.current) selfRef.current.srcObject = local;
      setCamOn(videoAvailable);
      setMicOn(audioAvailable);
      if (!audioAvailable && !videoAvailable) {
        setError("Camera and microphone are unavailable. You can still chat.");
      } else if (!videoAvailable) {
        setError("Camera is unavailable. You can still chat and see others.");
      } else if (!audioAvailable) {
        setError("Microphone is unavailable. You can still chat and see others.");
      }
      setStatus("connecting");
    },
    [],
  );

  const leave = React.useCallback(() => {
    teardown();
    setError(null);
  }, [teardown]);

  const toggleMic = React.useCallback(() => {
    const tracks = stateRef.current.local?.getAudioTracks() ?? [];
    const next = !micOn;
    for (const track of tracks) track.enabled = next;
    setMicOn(next);
  }, [micOn]);

  const toggleCam = React.useCallback(() => {
    const tracks = stateRef.current.local?.getVideoTracks() ?? [];
    const next = !camOn;
    for (const track of tracks) track.enabled = next;
    setCamOn(next);
  }, [camOn]);

  React.useEffect(() => teardown, [teardown]);

  return {
    status,
    error,
    micOn,
    camOn,
    selfRef,
    peers,
    start,
    leave,
    toggleMic,
    toggleCam,
    setMaxPeers,
  };
}

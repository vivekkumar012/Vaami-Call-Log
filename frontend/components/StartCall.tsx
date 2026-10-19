"use client";

import { useEffect, useRef, useState } from "react";
import { BOT_URL } from "@/lib/api";

type Status = "idle" | "connecting" | "live";

/** Wait until the browser has gathered all ICE candidates (the bot expects a complete SDP). */
function waitForIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", done);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", done);
    setTimeout(resolve, 3000); // don't hang forever
  });
}

export default function StartCall({ onCallEnded }: { onCallEnded: () => void }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  function cleanup() {
    const pc = pcRef.current;
    if (!pc) return; // already cleaned up
    pcRef.current = null;
    pc.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStatus("idle");
    // The bot saves the call to the Worker right after the connection closes; give it a moment.
    setTimeout(onCallEnded, 2500);
  }

  useEffect(() => () => cleanup(), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    setError(null);
    setStatus("connecting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      pcRef.current = pc;

      pc.ontrack = (e) => {
        if (audioRef.current) audioRef.current.srcObject = e.streams[0]; // the bot's voice
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") setStatus("live");
        if (["failed", "closed", "disconnected"].includes(pc.connectionState)) cleanup();
      };
      stream.getTracks().forEach((t) => pc.addTrack(t, stream)); // our microphone

      await pc.setLocalDescription(await pc.createOffer());
      await waitForIce(pc);

      const res = await fetch(`${BOT_URL}/api/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sdp: pc.localDescription!.sdp, type: pc.localDescription!.type }),
      });
      if (!res.ok) throw new Error(`Bot server returned ${res.status}`);
      const answer = await res.json();
      await pc.setRemoteDescription({ sdp: answer.sdp, type: answer.type });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        msg.includes("fetch")
          ? `Can't reach the bot at ${BOT_URL}. Is "python server.py" running?`
          : msg,
      );
      cleanup();
    }
  }

  return (
    <div className="start">
      {status === "idle" && (
        <button className="btn btn-start" onClick={start}>
          Start call
        </button>
      )}
      {status === "connecting" && (
        <button className="btn" disabled>
          Connecting…
        </button>
      )}
      {status === "live" && (
        <>
          <span className="live">
            <span className="dot" /> Call in progress — speak, and interrupt any time
          </span>
          <button className="btn btn-end" onClick={cleanup}>
            End call
          </button>
        </>
      )}
      {error && <p className="error">{error}</p>}
      <audio ref={audioRef} autoPlay />
    </div>
  );
}

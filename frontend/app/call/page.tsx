"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CallDetail, formatDuration, formatTime, getCall } from "@/lib/api";

const STAGE_LABEL = { stt: "Speech-to-text (Deepgram)", llm: "LLM (Groq)", tts: "Text-to-speech" } as const;

function Detail() {
  const id = useSearchParams().get("id");
  const [call, setCall] = useState<CallDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getCall(id)
      .then(setCall)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  if (!id) return <p className="error">No call selected.</p>;
  if (error) return <p className="error">{error}</p>;
  if (!call) return <p className="muted">Loading…</p>;

  return (
    <>
      <Link href="/" className="back">
        ← All calls
      </Link>
      <h1>{formatTime(call.started_at)}</h1>
      <p className="muted mono">
        {call.id} · {formatDuration(call.duration_seconds)} · {call.transcript.length} turns
      </p>

      <h2>Latency</h2>
      {call.metrics.length === 0 ? (
        <p className="muted">No latency data was captured for this call.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Stage</th>
              <th>Average</th>
              <th>Slowest</th>
              <th>Samples</th>
            </tr>
          </thead>
          <tbody>
            {call.metrics.map((m) => (
              <tr key={m.stage}>
                <td>{STAGE_LABEL[m.stage]}</td>
                <td>{Math.round(m.avg_ms)} ms</td>
                <td>{Math.round(m.max_ms)} ms</td>
                <td>{m.samples}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Transcript</h2>
      {call.transcript.length === 0 && <p className="muted">Nothing was said on this call.</p>}
      <ol className="chat">
        {call.transcript.map((t) => (
          <li key={t.seq} className={t.role}>
            <span className="who">{t.role === "user" ? "You" : "Agent"}</span>
            <span>{t.content}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

export default function CallPage() {
  // useSearchParams needs a Suspense boundary in a static export
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <Detail />
    </Suspense>
  );
}

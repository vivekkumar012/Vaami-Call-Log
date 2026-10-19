"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { CallDetail, formatDuration, formatTime, getCall } from "@/lib/api";

const STAGE_LABEL = {
  stt: "Speech-to-text",
  llm: "Language model",
  tts: "Text-to-speech",
} as const;

const STAGE_PROVIDER = {
  stt: "Deepgram",
  llm: "Groq",
  tts: "Cartesia / ElevenLabs",
} as const;

const STAGE_TONE = {
  stt: "from-cyan-500 to-blue-500",
  llm: "from-violet-500 to-fuchsia-500",
  tts: "from-emerald-500 to-teal-500",
} as const;

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

  if (!id) return <MessageState title="No call selected" message="Choose a call from the dashboard to see its details." />;
  if (error) return <MessageState title="Unable to load this call" message={error} error />;
  if (!call) return <MessageState title="Loading call details" message="Retrieving the transcript and performance data…" />;

  const totalLatency = call.metrics.length
    ? Math.round(call.metrics.reduce((sum, metric) => sum + metric.avg_ms, 0))
    : 0;

  return (
    <div className="min-h-screen text-slate-900">
      <header className="border-b border-white/70 bg-white/75 shadow-sm backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3 text-lg font-bold tracking-tight">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-teal-500 via-cyan-500 to-indigo-500 text-sm text-white shadow-lg shadow-cyan-500/20">
              V
            </span>
            <span>
              Vaami <span className="font-normal text-slate-400">/ Voice intelligence</span>
            </span>
          </Link>
          <Link
            href="/"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:border-teal-200 hover:text-teal-700"
          >
            ← All calls
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-indigo-950 to-teal-900 p-6 text-white shadow-2xl shadow-indigo-900/15 sm:p-10">
          <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-emerald-200">
                <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_0_4px_rgba(110,231,183,0.15)]" />
                Completed call
              </div>
              <p className="text-sm font-medium text-cyan-200">Call session</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
                {formatTime(call.started_at)}
              </h1>
              <p className="mt-3 max-w-2xl break-all font-mono text-xs text-slate-300">{call.id}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <HeroStat label="Duration" value={formatDuration(call.duration_seconds)} />
              <HeroStat label="Turns" value={String(call.transcript.length)} />
              <HeroStat label="Avg pipeline" value={totalLatency ? `${totalLatency} ms` : "—"} />
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-3xl border border-white/80 bg-white/85 p-5 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur sm:p-7">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-600">Conversation record</p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight">Transcript</h2>
                <p className="mt-1 text-sm text-slate-500">A complete record of this voice interaction.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">
                {call.transcript.length} turns
              </span>
            </div>

            {call.transcript.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                <p className="font-semibold text-slate-600">Nothing was said on this call.</p>
                <p className="mt-1 text-sm text-slate-400">The transcript will appear here after a completed conversation.</p>
              </div>
            ) : (
              <ol className="space-y-4">
                {call.transcript.map((turn) => (
                  <li key={turn.seq} className={`flex gap-3 ${turn.role === "user" ? "flex-row-reverse" : ""}`}>
                    <span
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-bold text-white shadow-sm ${
                        turn.role === "user"
                          ? "bg-gradient-to-br from-teal-500 to-cyan-500"
                          : "bg-gradient-to-br from-indigo-500 to-violet-500"
                      }`}
                    >
                      {turn.role === "user" ? "You" : "AI"}
                    </span>
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                        turn.role === "user"
                          ? "rounded-tr-md bg-gradient-to-br from-teal-50 to-cyan-50 text-slate-700"
                          : "rounded-tl-md border border-slate-100 bg-slate-50 text-slate-700"
                      }`}
                    >
                      <p className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-400">
                        {turn.role === "user" ? "You" : "Vaami"}
                      </p>
                      {turn.content}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="rounded-3xl border border-white/80 bg-white/85 p-5 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur sm:p-7">
            <div className="mb-6">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-600">Performance</p>
              <h2 className="mt-1 text-2xl font-bold tracking-tight">Pipeline latency</h2>
              <p className="mt-1 text-sm text-slate-500">Response timing captured during this session.</p>
            </div>

            {call.metrics.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                <p className="font-semibold text-slate-600">No latency data captured.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {call.metrics.map((metric) => (
                  <article key={metric.stage} className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50/80">
                    <div className={`h-1.5 bg-gradient-to-r ${STAGE_TONE[metric.stage]}`} />
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-bold text-slate-800">{STAGE_LABEL[metric.stage]}</h3>
                          <p className="mt-0.5 text-xs text-slate-400">{STAGE_PROVIDER[metric.stage]}</p>
                        </div>
                        <span className="rounded-lg bg-white px-2.5 py-1 text-sm font-bold text-slate-700 shadow-sm">
                          {Math.round(metric.avg_ms)} ms
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <MetricValue label="Slowest" value={`${Math.round(metric.max_ms)} ms`} />
                        <MetricValue label="Samples" value={String(metric.samples)} />
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[92px] rounded-2xl border border-white/10 bg-white/10 px-4 py-3 backdrop-blur">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-300">{label}</p>
      <p className="mt-1 text-lg font-bold text-white">{value}</p>
    </div>
  );
}

function MetricValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white px-3 py-2 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">{label}</p>
      <p className="mt-0.5 font-bold text-slate-700">{value}</p>
    </div>
  );
}

function MessageState({ title, message, error = false }: { title: string; message: string; error?: boolean }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/80 bg-white/90 p-8 text-center shadow-xl">
        <div className={`mx-auto grid h-12 w-12 place-items-center rounded-2xl text-xl ${error ? "bg-rose-100 text-rose-600" : "bg-teal-100 text-teal-600"}`}>
          {error ? "!" : "…"}
        </div>
        <h1 className="mt-5 text-xl font-bold text-slate-900">{title}</h1>
        <p className={`mt-2 text-sm ${error ? "text-rose-600" : "text-slate-500"}`}>{message}</p>
        <Link href="/" className="mt-6 inline-flex rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-teal-700">
          Back to calls
        </Link>
      </div>
    </div>
  );
}

export default function CallPage() {
  return (
    <Suspense fallback={<MessageState title="Loading call details" message="Preparing the workspace…" />}>
      <Detail />
    </Suspense>
  );
}

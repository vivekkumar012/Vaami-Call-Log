"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import StartCall from "@/components/StartCall";
import { CallSummary, formatDuration, formatTime, getHealth, listCalls } from "@/lib/api";

type Tab = "calls" | "stats" | "live" | "logs";

const tabs: { id: Tab; label: string }[] = [
  { id: "calls", label: "Calls" },
  { id: "stats", label: "Stats" },
  { id: "live", label: "Live call" },
  { id: "logs", label: "Dev console" },
];

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <article className="group rounded-2xl border border-white/70 bg-white/80 p-5 shadow-[0_12px_40px_rgba(15,23,42,0.07)] backdrop-blur transition hover:-translate-y-1 hover:shadow-[0_18px_45px_rgba(15,23,42,0.11)]">
      <div className="mb-4 h-1.5 w-10 rounded-full bg-gradient-to-r from-teal-500 to-cyan-400 transition-all group-hover:w-16" />
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{hint}</p>
    </article>
  );
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("calls");
  const [calls, setCalls] = useState<CallSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workerOnline, setWorkerOnline] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      setCalls((await listCalls()).calls);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
    getHealth().then(() => setWorkerOnline(true)).catch(() => setWorkerOnline(false));
  }, [load]);

  const stats = useMemo(() => {
    const items = calls ?? [];
    const totalSeconds = items.reduce((sum, call) => sum + call.duration_seconds, 0);
    const totalTurns = items.reduce((sum, call) => sum + call.turn_count, 0);
    return {
      count: items.length,
      average: items.length ? totalSeconds / items.length : 0,
      turns: totalTurns,
      latest: items[0] ? formatTime(items[0].started_at) : "No calls yet",
    };
  }, [calls]);

  return (
    <div className="min-h-screen text-slate-900">
      <header className="border-b border-white/70 bg-white/75 shadow-sm backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3 text-lg font-bold tracking-tight">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-teal-500 via-cyan-500 to-indigo-500 text-sm text-white shadow-lg shadow-cyan-500/20">V</span>
            <span>Vaami <span className="font-normal text-slate-400">/ Voice intelligence</span></span>
          </Link>
          <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 shadow-sm">
            <span className={`h-2 w-2 rounded-full ${workerOnline === false ? "bg-red-500" : "bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]"}`} />
            {workerOnline === false ? "Worker offline" : "Worker connected"}
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`border-b-2 px-3 py-3 text-sm font-semibold transition ${
                tab === item.id
                  ? "border-emerald-600 text-emerald-700"
                  : "border-transparent text-neutral-500 hover:text-neutral-900"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="relative mb-8 overflow-hidden rounded-3xl border border-white/80 bg-gradient-to-br from-slate-950 via-indigo-950 to-teal-900 px-6 py-8 text-white shadow-2xl shadow-indigo-900/15 sm:px-10 sm:py-10">
          <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-fuchsia-500/20 blur-3xl" />
          <div className="relative flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-cyan-300">Voice operations</p>
            <h1 className="mt-2 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
              {tab === "calls" && "Every call, one clear record."}
              {tab === "stats" && "Call performance at a glance."}
              {tab === "live" && "Start a low-latency voice call."}
              {tab === "logs" && "Local service status."}
            </h1>
          </div>
          {tab !== "live" && (
            <button
              type="button"
              onClick={() => setTab("live")}
              className="relative rounded-xl bg-white px-5 py-3 text-sm font-bold text-indigo-950 shadow-xl shadow-black/20 transition hover:-translate-y-0.5 hover:bg-cyan-50"
            >
              Start a call
            </button>
          )}
          </div>
        </div>

        {error && <p className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {tab === "live" && (
          <section className="rounded-3xl border border-white/80 bg-white/85 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.1)] backdrop-blur sm:p-8">
            <div className="mb-6 max-w-xl">
              <h2 className="text-xl font-bold">Talk to Vaami</h2>
              <p className="mt-2 text-sm text-slate-500">
                Allow microphone access, then start speaking. The finished transcript and latency metrics are saved automatically.
              </p>
            </div>
            <StartCall
              onCallEnded={() => {
                load();
                setTab("calls");
              }}
            />
          </section>
        )}

        {tab === "calls" && (
          <section className="overflow-hidden rounded-3xl border border-white/80 bg-white/85 shadow-[0_18px_55px_rgba(15,23,42,0.08)] backdrop-blur">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-5 sm:px-7">
              <div>
                <h2 className="font-bold">Recent calls</h2>
                <p className="text-sm text-slate-500">{stats.count} recorded sessions</p>
              </div>
              <button type="button" onClick={load} className="rounded-lg bg-teal-50 px-3 py-2 text-sm font-bold text-teal-700 transition hover:bg-teal-100">
                Refresh
              </button>
            </div>
            {calls === null ? (
              <p className="p-6 text-sm text-neutral-500">Loading calls…</p>
            ) : calls.length === 0 ? (
              <p className="p-6 text-sm text-neutral-500">No calls yet. Start a call to create the first record.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Started</th>
                      <th className="px-5 py-3 font-semibold">Duration</th>
                      <th className="px-5 py-3 font-semibold">Turns</th>
                      <th className="px-5 py-3 font-semibold">Session</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {calls.map((call) => (
                      <tr key={call.id} className="hover:bg-neutral-50">
                        <td className="px-5 py-4">
                          <Link href={`/call?id=${encodeURIComponent(call.id)}`} className="font-medium text-emerald-700 hover:underline">
                            {formatTime(call.started_at)}
                          </Link>
                        </td>
                        <td className="px-5 py-4 text-neutral-600">{formatDuration(call.duration_seconds)}</td>
                        <td className="px-5 py-4 text-neutral-600">{call.turn_count}</td>
                        <td className="px-5 py-4 font-mono text-xs text-neutral-500">{call.id.slice(0, 12)}…</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {tab === "stats" && (
          <section className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Recorded calls" value={String(stats.count)} hint="Stored in D1" />
              <StatCard label="Avg duration" value={formatDuration(stats.average)} hint="Across recorded calls" />
              <StatCard label="Transcript turns" value={String(stats.turns)} hint="User and assistant turns" />
              <StatCard label="Latest call" value={stats.latest} hint="Most recent session" />
            </div>
            <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
              <h2 className="font-semibold">Pipeline</h2>
              <p className="mt-2 text-sm text-neutral-500">Browser WebRTC → Python Pipecat → Deepgram → Groq → Cartesia → Cloudflare D1.</p>
            </div>
          </section>
        )}

        {tab === "logs" && (
          <section className="grid gap-4 md:grid-cols-2">
            <StatCard label="Worker API" value={workerOnline === false ? "Offline" : "Healthy"} hint="GET /health" />
            <StatCard label="Data store" value="D1" hint={`${stats.count} calls available locally`} />
            <div className="rounded-2xl border border-neutral-200 bg-neutral-950 p-6 font-mono text-xs text-emerald-300 md:col-span-2">
              <p>$ local services</p>
              <p className="mt-2 text-neutral-300">worker: http://localhost:8787</p>
              <p className="text-neutral-300">bot: http://localhost:7860</p>
              <p className="text-neutral-300">frontend: http://localhost:3000</p>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

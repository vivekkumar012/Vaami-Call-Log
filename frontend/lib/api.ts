export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";
export const BOT_URL = process.env.NEXT_PUBLIC_BOT_URL ?? "http://localhost:7860";

export interface CallSummary {
  id: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  turn_count: number;
}
export interface Turn {
  seq: number;
  role: "user" | "assistant";
  content: string;
  timestamp: string | null;
}
export interface Metric {
  stage: "stt" | "llm" | "tts";
  avg_ms: number;
  max_ms: number;
  samples: number;
}
export interface CallDetail {
  id: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  transcript: Turn[];
  metrics: Metric[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.json().catch(() => ({}))).error ?? res.statusText}`);
  return res.json();
}

export const listCalls = () => get<{ calls: CallSummary[]; total: number }>("/calls?limit=50");
export const getCall = (id: string) => get<CallDetail>(`/calls/${encodeURIComponent(id)}`);
export const getHealth = () => get<{ ok: boolean }>("/health");

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

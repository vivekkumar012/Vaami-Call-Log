export interface Env {
  DB: D1Database;
  API_KEY?: string; // secret; if set, POST /calls requires header x-api-key
  ALLOWED_ORIGIN?: string;
}

interface TurnInput {
  role: "user" | "assistant";
  content: string;
  timestamp?: string | null;
}
interface MetricInput {
  stage: "stt" | "llm" | "tts";
  avg_ms: number;
  max_ms: number;
  samples: number;
}
interface CallInput {
  id?: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  transcript: TurnInput[];
  metrics?: MetricInput[];
}

const STAGES = ["stt", "llm", "tts"];

// ---------- helpers ----------

function corsHeaders(env: Env): HeadersInit {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-api-key",
    "Access-Control-Max-Age": "86400",
  };
}

function json(env: Env, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

// Structured logs show up in Cloudflare dashboard -> Workers -> Observability
function log(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}) {
  console[level](JSON.stringify({ level, msg, ...extra }));
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function isIso(v: unknown): v is string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

function validate(body: any): Required<Pick<CallInput, "id">> & CallInput {
  if (!body || typeof body !== "object") throw new HttpError(400, "Body must be a JSON object");
  if (!isIso(body.started_at) || !isIso(body.ended_at)) {
    throw new HttpError(400, "started_at and ended_at must be ISO-8601 strings");
  }
  if (typeof body.duration_seconds !== "number" || body.duration_seconds < 0) {
    throw new HttpError(400, "duration_seconds must be a non-negative number");
  }
  if (!Array.isArray(body.transcript)) throw new HttpError(400, "transcript must be an array");
  for (const t of body.transcript) {
    if (!t || (t.role !== "user" && t.role !== "assistant") || typeof t.content !== "string") {
      throw new HttpError(400, "each transcript turn needs role (user|assistant) and content");
    }
  }
  const metrics = body.metrics ?? [];
  if (!Array.isArray(metrics)) throw new HttpError(400, "metrics must be an array");
  for (const m of metrics) {
    if (
      !m ||
      !STAGES.includes(m.stage) ||
      typeof m.avg_ms !== "number" ||
      typeof m.max_ms !== "number" ||
      typeof m.samples !== "number"
    ) {
      throw new HttpError(400, "each metric needs stage (stt|llm|tts), avg_ms, max_ms, samples");
    }
  }
  const id = typeof body.id === "string" && body.id.length > 0 && body.id.length <= 100 ? body.id : crypto.randomUUID();
  return { ...body, id, metrics };
}

// ---------- handlers ----------

async function createCall(request: Request, env: Env): Promise<Response> {
  if (env.API_KEY && request.headers.get("x-api-key") !== env.API_KEY) {
    throw new HttpError(401, "Invalid or missing x-api-key");
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
  const call = validate(raw);

  // One atomic batch: either the whole call is saved or nothing is.
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare("INSERT INTO calls (id, started_at, ended_at, duration_seconds) VALUES (?, ?, ?, ?)").bind(
      call.id,
      call.started_at,
      call.ended_at,
      call.duration_seconds,
    ),
    ...call.transcript.map((t, i) =>
      env.DB.prepare("INSERT INTO transcripts (call_id, seq, role, content, timestamp) VALUES (?, ?, ?, ?, ?)").bind(
        call.id,
        i,
        t.role,
        t.content,
        t.timestamp ?? null,
      ),
    ),
    ...(call.metrics ?? []).map((m) =>
      env.DB.prepare("INSERT INTO call_metrics (call_id, stage, avg_ms, max_ms, samples) VALUES (?, ?, ?, ?, ?)").bind(
        call.id,
        m.stage,
        m.avg_ms,
        m.max_ms,
        m.samples,
      ),
    ),
  ];

  try {
    await env.DB.batch(stmts);
  } catch (e) {
    if (String(e).includes("UNIQUE")) throw new HttpError(409, `Call ${call.id} already exists`);
    throw e;
  }

  log("info", "call saved", { call_id: call.id, turns: call.transcript.length, duration: call.duration_seconds });
  return json(env, { id: call.id }, 201);
}

async function listCalls(url: URL, env: Env): Promise<Response> {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 20, 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  const [rows, total] = await env.DB.batch([
    env.DB.prepare(
      `SELECT c.id, c.started_at, c.ended_at, c.duration_seconds,
              (SELECT COUNT(*) FROM transcripts t WHERE t.call_id = c.id) AS turn_count
       FROM calls c ORDER BY c.started_at DESC LIMIT ? OFFSET ?`,
    ).bind(limit, offset),
    env.DB.prepare("SELECT COUNT(*) AS n FROM calls"),
  ]);

  return json(env, {
    calls: rows.results,
    total: (total.results[0] as { n: number }).n,
    limit,
    offset,
  });
}

async function getCall(id: string, env: Env): Promise<Response> {
  const [call, turns, metrics] = await env.DB.batch([
    env.DB.prepare("SELECT id, started_at, ended_at, duration_seconds FROM calls WHERE id = ?").bind(id),
    env.DB.prepare("SELECT seq, role, content, timestamp FROM transcripts WHERE call_id = ? ORDER BY seq").bind(id),
    env.DB.prepare("SELECT stage, avg_ms, max_ms, samples FROM call_metrics WHERE call_id = ?").bind(id),
  ]);

  if (call.results.length === 0) throw new HttpError(404, "Call not found");
  const callRow = call.results[0] as {
    id: string;
    started_at: string;
    ended_at: string;
    duration_seconds: number;
  };
  return json(env, { ...callRow, transcript: turns.results, metrics: metrics.results });
}

async function getStats(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT COUNT(*) AS total_calls,
            COALESCE(AVG(duration_seconds), 0) AS average_duration_seconds,
            COALESCE(SUM((SELECT COUNT(*) FROM transcripts t WHERE t.call_id = calls.id)), 0) AS total_turns,
            MAX(started_at) AS latest_started_at
     FROM calls`,
  ).first<{
    total_calls: number;
    average_duration_seconds: number;
    total_turns: number;
    latest_started_at: string | null;
  }>();

  return json(env, {
    total_calls: result?.total_calls ?? 0,
    average_duration_seconds: result?.average_duration_seconds ?? 0,
    total_turns: result?.total_turns ?? 0,
    latest_started_at: result?.latest_started_at ?? null,
  });
}

// ---------- router ----------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const started = Date.now();
    const url = new URL(request.url);
    let status = 500;

    try {
      if (request.method === "OPTIONS") {
        status = 204;
        return new Response(null, { status, headers: corsHeaders(env) });
      }

      const detail = url.pathname.match(/^\/calls\/([^/]+)$/);
      let res: Response;

      if (url.pathname === "/calls" && request.method === "POST") res = await createCall(request, env);
      else if (url.pathname === "/calls" && request.method === "GET") res = await listCalls(url, env);
      else if (url.pathname === "/stats" && request.method === "GET") res = await getStats(env);
      else if (detail && request.method === "GET") res = await getCall(decodeURIComponent(detail[1]), env);
      else if (url.pathname === "/health") res = json(env, { ok: true });
      else throw new HttpError(404, "Not found");

      status = res.status;
      return res;
    } catch (e) {
      if (e instanceof HttpError) {
        status = e.status;
        log("warn", e.message, { path: url.pathname, status });
        return json(env, { error: e.message }, e.status);
      }
      log("error", "unhandled error", { path: url.pathname, error: String(e) });
      status = 500;
      return json(env, { error: "Internal server error" }, 500);
    } finally {
      log("info", "request", { method: request.method, path: url.pathname, status, ms: Date.now() - started });
    }
  },
} satisfies ExportedHandler<Env>;

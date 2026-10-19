-- One row per call
CREATE TABLE IF NOT EXISTS calls (
  id               TEXT PRIMARY KEY,
  started_at       TEXT NOT NULL,
  ended_at         TEXT NOT NULL,
  duration_seconds REAL NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls (started_at DESC);

-- Ordered turns of the conversation
CREATE TABLE IF NOT EXISTS transcripts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id   TEXT NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  seq       INTEGER NOT NULL,
  role      TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content   TEXT NOT NULL,
  timestamp TEXT
);
CREATE INDEX IF NOT EXISTS idx_transcripts_call ON transcripts (call_id, seq);

-- Latency per pipeline stage (time-to-first-byte, in ms)
CREATE TABLE IF NOT EXISTS call_metrics (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id TEXT NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  stage   TEXT NOT NULL CHECK (stage IN ('stt', 'llm', 'tts')),
  avg_ms  REAL NOT NULL,
  max_ms  REAL NOT NULL,
  samples INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_metrics_call ON call_metrics (call_id);

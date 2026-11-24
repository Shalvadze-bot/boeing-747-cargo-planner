CREATE TABLE IF NOT EXISTS cargo_ai_calls (
  actor TEXT NOT NULL,
  run_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  work_key TEXT NOT NULL,
  started_ms INTEGER NOT NULL,
  model TEXT NOT NULL,
  charge_nano INTEGER NOT NULL CHECK (charge_nano >= 0),
  status TEXT NOT NULL,
  provider_id TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  elapsed_ms INTEGER,
  PRIMARY KEY (actor, run_id, step)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cargo_ai_actor_time ON cargo_ai_calls (actor, started_ms);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cargo_ai_actor_work ON cargo_ai_calls (actor, work_key, started_ms);

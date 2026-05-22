ALTER TABLE "agents"
  ADD COLUMN IF NOT EXISTS "runtime" text NOT NULL DEFAULT 'openwork',
  ADD COLUMN IF NOT EXISTS "agent_kind" text NOT NULL DEFAULT 'dev_agent',
  ADD COLUMN IF NOT EXISTS "provider" text;

UPDATE "agents"
SET "provider" = lower("model")
WHERE "provider" IS NULL
  AND lower("model") IN ('claude', 'codex', 'qwen', 'cursor', 'opencode');

ALTER TABLE "agent_runs"
  ADD COLUMN IF NOT EXISTS "runtime" text,
  ADD COLUMN IF NOT EXISTS "agent_kind" text,
  ADD COLUMN IF NOT EXISTS "provider" text;

UPDATE "agent_runs"
SET
  "runtime" = COALESCE("runtime", 'openwork'),
  "agent_kind" = COALESCE("agent_kind", 'dev_agent'),
  "provider" = COALESCE(
    "provider",
    CASE
      WHEN lower("model") IN ('claude', 'codex', 'qwen', 'cursor', 'opencode')
        THEN lower("model")
      ELSE NULL
    END
  );

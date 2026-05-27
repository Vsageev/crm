ALTER TABLE "agent_runners"
  ADD COLUMN IF NOT EXISTS "connection_scope" text,
  ADD COLUMN IF NOT EXISTS "owner_account_id" text,
  ADD COLUMN IF NOT EXISTS "bound_workspace_id" text,
  ADD COLUMN IF NOT EXISTS "original_bound_workspace_id" text,
  ADD COLUMN IF NOT EXISTS "legacy_connection_scope" boolean;

ALTER TABLE "agent_runner_pairing_codes"
  ADD COLUMN IF NOT EXISTS "connection_scope" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_runners_owner_account_id_users_id_fk'
  ) THEN
    ALTER TABLE "agent_runners"
      ADD CONSTRAINT "agent_runners_owner_account_id_users_id_fk"
      FOREIGN KEY ("owner_account_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_runners_bound_workspace_id_workspaces_id_fk'
  ) THEN
    ALTER TABLE "agent_runners"
      ADD CONSTRAINT "agent_runners_bound_workspace_id_workspaces_id_fk"
      FOREIGN KEY ("bound_workspace_id") REFERENCES "workspaces"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_runners_original_bound_workspace_id_workspaces_id_fk'
  ) THEN
    ALTER TABLE "agent_runners"
      ADD CONSTRAINT "agent_runners_original_bound_workspace_id_workspaces_id_fk"
      FOREIGN KEY ("original_bound_workspace_id") REFERENCES "workspaces"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

UPDATE "agent_runners"
SET
  "connection_scope" = COALESCE("connection_scope", 'account'),
  "owner_account_id" = COALESCE("owner_account_id", "user_id"),
  "bound_workspace_id" = COALESCE("bound_workspace_id", "workspace_id"),
  "original_bound_workspace_id" = COALESCE("original_bound_workspace_id", "workspace_id"),
  "legacy_connection_scope" = COALESCE("legacy_connection_scope", true)
WHERE "connection_scope" IS NULL
   OR "owner_account_id" IS NULL
   OR "bound_workspace_id" IS NULL
   OR "original_bound_workspace_id" IS NULL
   OR "legacy_connection_scope" IS NULL;

UPDATE "agent_runner_pairing_codes"
SET "connection_scope" = COALESCE("connection_scope", 'account')
WHERE "connection_scope" IS NULL;

CREATE INDEX IF NOT EXISTS "agent_runners_scope_workspace_idx"
  ON "agent_runners" ("connection_scope", "bound_workspace_id");

ALTER TABLE "agents"
  ADD COLUMN IF NOT EXISTS "runner_inventory_runner_id" text,
  ADD COLUMN IF NOT EXISTS "runner_inventory_workspace_id" text,
  ADD COLUMN IF NOT EXISTS "runner_inventory_version" integer,
  ADD COLUMN IF NOT EXISTS "runner_inventory_capability_refs" jsonb,
  ADD COLUMN IF NOT EXISTS "runner_inventory_workspace_root_origin" text,
  ADD COLUMN IF NOT EXISTS "runner_inventory_workspace_root_verified_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "runner_inventory_verified_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "legacy_agent_file_state" text,
  ADD COLUMN IF NOT EXISTS "legacy_agent_file_repair_state" text,
  ADD COLUMN IF NOT EXISTS "legacy_agent_file_checked_at" timestamp with time zone;

UPDATE "agents"
SET
  "runner_inventory_version" = COALESCE("runner_inventory_version", 1),
  "runner_inventory_workspace_root_origin" = COALESCE(
    "runner_inventory_workspace_root_origin",
    'repository_root'
  ),
  "legacy_agent_file_state" = COALESCE("legacy_agent_file_state", 'not_applicable'),
  "legacy_agent_file_repair_state" = COALESCE(
    "legacy_agent_file_repair_state",
    CASE
      WHEN "repository_root_origin" = 'runner_local'
        AND "repository_root_runner_id" IS NOT NULL
        AND "repository_root_verified_at" IS NOT NULL
        AND COALESCE("repository_root_repair_required", false) = false
      THEN 'not_required'
      ELSE 'needs_runner_validation'
    END
  )
WHERE "repository_root" IS NOT NULL
  AND btrim("repository_root") <> '';

UPDATE "agents"
SET
  "runner_inventory_version" = COALESCE("runner_inventory_version", 1),
  "runner_inventory_workspace_root_origin" = COALESCE(
    "runner_inventory_workspace_root_origin",
    'unknown'
  ),
  "legacy_agent_file_state" = COALESCE("legacy_agent_file_state", 'unknown_backend_legacy'),
  "legacy_agent_file_repair_state" = COALESCE(
    "legacy_agent_file_repair_state",
    'needs_runner_validation'
  )
WHERE "repository_root" IS NULL
  OR btrim("repository_root") = '';

ALTER TABLE "agents"
  ADD COLUMN IF NOT EXISTS "repository_root_origin" text,
  ADD COLUMN IF NOT EXISTS "repository_root_runner_id" text,
  ADD COLUMN IF NOT EXISTS "repository_root_verified_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "repository_root_repair_required" boolean;

UPDATE "agents"
SET
  "repository_root_origin" = COALESCE("repository_root_origin", 'unknown'),
  "repository_root_repair_required" = COALESCE("repository_root_repair_required", true)
WHERE "repository_root" IS NOT NULL
  AND btrim("repository_root") <> '';

UPDATE "agents"
SET
  "repository_root_origin" = NULL,
  "repository_root_runner_id" = NULL,
  "repository_root_verified_at" = NULL,
  "repository_root_repair_required" = COALESCE("repository_root_repair_required", false)
WHERE "repository_root" IS NULL
  OR btrim("repository_root") = '';

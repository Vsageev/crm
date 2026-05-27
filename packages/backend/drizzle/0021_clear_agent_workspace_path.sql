UPDATE "agents"
SET
  "legacy_data" = jsonb_set(
    CASE
      WHEN jsonb_typeof(COALESCE("legacy_data", '{}'::jsonb)) = 'object'
        THEN COALESCE("legacy_data", '{}'::jsonb)
      ELSE '{}'::jsonb
    END,
    '{workspacePathLegacy}',
    jsonb_build_object(
      'path',
      "workspace_path",
      'source',
      'agents.workspace_path',
      'classification',
      'metadata_only',
      'executableAuthority',
      false,
      'classifiedAt',
      NOW()
    ),
    true
  ),
  "workspace_path" = NULL
WHERE "workspace_path" IS NOT NULL
  AND btrim("workspace_path") <> ''
  AND NOT (
    CASE
      WHEN jsonb_typeof(COALESCE("legacy_data", '{}'::jsonb)) = 'object'
        THEN COALESCE("legacy_data", '{}'::jsonb)
      ELSE '{}'::jsonb
    END ? 'workspacePathLegacy'
  );

UPDATE "agents"
SET "workspace_path" = NULL
WHERE "workspace_path" IS NOT NULL
  AND btrim("workspace_path") <> '';

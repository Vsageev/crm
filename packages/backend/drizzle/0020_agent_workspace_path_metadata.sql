UPDATE "agents"
SET
  "legacy_data" = jsonb_set(
    COALESCE("legacy_data", '{}'::jsonb),
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
  "workspace_path" = NULL,
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
WHERE ("repository_root" IS NULL OR btrim("repository_root") = '')
  AND "workspace_path" IS NOT NULL
  AND btrim("workspace_path") <> ''
  AND NOT (COALESCE("legacy_data", '{}'::jsonb) ? 'workspacePathLegacy');

UPDATE "agents"
SET
  "workspace_path" = NULL,
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
WHERE ("repository_root" IS NULL OR btrim("repository_root") = '')
  AND "workspace_path" IS NOT NULL
  AND btrim("workspace_path") <> '';

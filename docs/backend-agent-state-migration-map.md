# Backend Agent State Migration Map

This audit maps current backend-owned agent state to the target runner split:
the runner owns runtime availability, executable capabilities, executable
workspaces, and agent workspace files; the backend owns output history, current
connection control plane, queue/routing records, and product metadata.

`workspace` has two meanings in this codebase. Product workspaces are backend
metadata in `workspaces`. Executable agent workspaces are runner-local
directories used as cwd and file roots.

## Ownership Classes

| Class | Meaning |
| --- | --- |
| Runner-owned | Source of truth must be on the user runner/daemon. Backend may proxy a user action or cache a non-authoritative snapshot. |
| Backend-owned | Canonical product, queue, history, auth, or control-plane state remains in Postgres/backend storage. |
| Metadata pointer | Backend stores an id, route, origin, path string, hash, or status used to resolve runner/backend state, but the pointed-to bytes/path/capability are owned elsewhere. |
| Legacy compatibility | Existing backend-local data/path behavior retained only for old rows, local-dev same-host mode, import, or forensic reads. |

## Current Inventory

| Surface | Current files | State touched | Current owner | Target owner |
| --- | --- | --- | --- | --- |
| Agent table | `packages/backend/src/db/schema.ts`, `sql-store-adapter.ts`, `services/agents.ts` | `agents` product metadata, model/provider, group, service user, API key ids, permissions, repository/workspace path metadata | Backend | Backend for product metadata and auth; runner for executable path/file authority |
| Agent file helpers | `services/agents.ts` | `DATA_DIR/agents/<id>` file list/read/write/upload/delete/reference/import summaries | Backend | Runner-owned for no-repository executable files; legacy backend files importable only |
| Agent file routes | `routes/agents.ts` | `/api/agents/:id/files*`, `/files/status`, `/files/import-legacy`, legacy `/files/reveal`, references | Mixed | Runner proxy for no-repository files; backend legacy compatibility only behind explicit gates |
| Runner filesystem routes | `routes/runner-filesystem.ts` | browse, pick, reveal, prepare workspace, import attachment, reveal agent file, validate repository root | Backend proxy | Runner-owned actions, backend-owned auth/routing and metadata updates |
| Runner devices | `routes/agent-runners.ts`, `services/runner-devices.ts` | `agent_runners`, pairing codes, credential hashes, display names, status, last seen, capabilities cache | Backend | Backend owns credentials, connection records, revocation, routing cache; runner owns live capability truth. Scope model: [Runner Connection Scope Contract](./runner-connection-scope-contract.md) |
| Runner socket registry | `services/agent-runners.ts` | in-memory connected runners, active job ids, filesystem request ids, run/job mapping | Backend process memory | Backend-owned current connections until a shared registry exists |
| Agent execution | `services/agent-chat.ts`, `services/agent-runs.ts`, `services/agent-batch-queue.ts` | queue rows, run rows, lifecycle, stdout/stderr, job payloads, cwd resolution | Backend | Backend-owned queue/routing/history; runner-owned cwd and materialized files |
| Product workspaces | `routes/workspaces.ts`, `services/workspaces.ts`, `workspaces` table | product workspace name and board/collection/agent-group membership | Backend | Backend-owned product metadata and runner routing scope |
| Conversation workspaces | `services/agent-workspaces.ts`, `routes/runner-filesystem.ts`, conversation metadata | `workspaceMode`, `workspaceRelativePath`, subfolder cwd materialization | Backend creates some legacy files | Metadata pointer in backend; runner-owned directory creation/materialization |
| Storage attachments | `routes/storage.ts`, `services/storage.ts` | `/api/storage/*`, `DATA_DIR/storage`, `/api/runner-attachments/download` | Backend | Backend-owned bytes/metadata; runner-owned materialized per-job/import copies |
| CLI status/model availability | `services/agents.ts`, `routes/agents.ts`, `frontend/src/lib/agent-models.ts` | backend host CLI probing and curated model metadata | Backend host | Runner-owned provider/model availability; backend keeps UI catalog metadata only |
| Frontend runner UI | `AgentsPage.tsx`, `FileSystemBrowserModal.tsx`, `MarkdownContent.tsx`, `RunnerDevicesTab.tsx` | runner device listing, filesystem pick/reveal, no-repo file browser, repository verification | Mixed calls | UI should call runner endpoints for runner-local state and treat stored paths as inert until verified |

## Field Classification

### `agents`

| Field | Class | Migration action |
| --- | --- | --- |
| `id`, `name`, `description`, `status`, `archivedAt`, `createdAt`, `updatedAt` | Backend-owned | Keep as product metadata. |
| `model`, `modelId`, `runtime`, `agentKind`, `provider`, `thinkingLevel`, `preset`, `presetParameters` | Backend-owned product metadata | Keep desired/default selection. Do not treat as proof that the runner has the CLI/model installed. |
| `apiKeyId`, `apiKeyName`, `apiKeyPrefix`, `workspaceApiKeyId`, `workspaceApiKey`, `serviceUserId`, `skipPermissions` | Backend-owned | Keep canonical auth and job-scoped secret release. |
| `capabilities` | Backend-owned | This is API permission metadata, not runner capability. Rename or document in follow-up UI/API work to avoid confusion with runner capabilities. |
| `groupId` | Backend-owned routing metadata | Keep as the input to workspace routing; repair ambiguous/missing workspace membership before enqueue. |
| `repositoryRoot` | Metadata pointer | Keep as inert path metadata until runner-verified. Never reinterpret legacy backend paths as runner paths. |
| `repositoryRootOrigin` | Metadata pointer | `runner_local` enables use only with runner id/verified timestamp. `unknown` and `backend_local_legacy` require repair. |
| `repositoryRootRunnerId`, `repositoryRootVerifiedAt`, `repositoryRootRepairRequired` | Metadata pointer | Required repair gates for hosted execution/reveal. Backfill existing roots to repair-required unless already verified. |
| `runnerInventoryRunnerId`, `runnerInventoryWorkspaceId`, `runnerInventoryVersion`, `runnerInventoryCapabilityRefs`, `runnerInventoryWorkspaceRootOrigin`, `runnerInventoryWorkspaceRootVerifiedAt`, `runnerInventoryVerifiedAt` | Metadata pointer | Point to the runner-owned agent inventory and latest capability advertisement. Do not store or infer executable file contents from backend `DATA_DIR`. |
| `legacyAgentFileState`, `legacyAgentFileRepairState`, `legacyAgentFileCheckedAt` | Legacy compatibility | Classify backend-local no-repository files as import/validation work only; runner import/prepare actions clear repair state. |
| `workspacePath` | Inert legacy metadata only | Repo-backed paths are recomputed from verified `repositoryRoot` for display/proxy responses; no-repo legacy values are preserved in `legacy_data.workspacePathLegacy` and cleared from the live column. They are never runner cwd authority. |
| `separateFolderPerChat` | Backend-owned metadata | Keep as default conversation mode; runner owns actual subfolder materialization. |
| `skillIds`, `cronJobs`, avatar fields, `lastActivity` | Backend-owned product metadata | Keep in backend; explicit runner sync/file setup owns materialized agent context files. |
| `legacyData` | Legacy compatibility | Preserve for migration archaeology only; never use as runner authority. |

### Runner Tables

| Table/field | Class | Migration action |
| --- | --- | --- |
| `agent_runners.id`, `userId`, `workspaceId`, `displayName`, `credentialHash`, `credentialPrefix`, `revokedAt` | Backend-owned | Keep canonical connection identity, auth, revocation, and routing scope. Add `connectionScope`, `ownerAccountId`, `boundWorkspaceId`, `legacyConnectionScope` per [Runner Connection Scope Contract](./runner-connection-scope-contract.md); backfill existing rows as `account` without changing activation. |
| `agent_runners.status`, `lastSeenAt` | Backend-owned current connection cache | Keep as backend control-plane cache; live socket registry remains authoritative for immediate dispatch. |
| `agent_runners.version`, `capabilities` | Metadata pointer / runner-owned snapshot | Keep as latest advertised snapshot only. Treat capability truth as runner-owned and refreshed on hello/heartbeat. |
| `agent_runner_pairing_codes.*` | Backend-owned | Keep one-time pairing state. |
| `agent_runner_tokens.*` | Backend-owned legacy/control-plane auth | Audit for active usage before removal or consolidation with runner credentials. |

### Queue, Run, And History Tables

| Table/field | Class | Migration action |
| --- | --- | --- |
| `agent_runs.*`, `agent_chat_turns.*` | Backend-owned | Keep output history, lifecycle, stdout/stderr, response text, and transcript links. |
| `agent_runs.executor`, `stdoutPath`, `stderrPath`, `legacyData` | Legacy compatibility / backend-owned history | Preserve old local-run forensics. Do not convert old local paths into runner paths. |
| `agent_chat_queue.*`, `agent_batch_runs.*`, `agent_batch_run_items.*` | Backend-owned queue/routing | Keep durable scheduling and retry state. Add only explicit failure/repair metadata when a path/capability is invalid. |
| queued/processing job payload assumptions in `legacyData` | Legacy compatibility | Do not rewrite silently. Let in-flight work finish under original assumptions or fail with explicit recovery text. |

### Workspaces, Files, And Attachments

| State | Class | Migration action |
| --- | --- | --- |
| `workspaces` table | Backend-owned product metadata | Keep names and board/collection/agent-group membership. This is not the executable workspace root. |
| `conversation.metadata.workspaceMode` / `workspaceRelativePath` | Metadata pointer | Backfill or repair malformed values; runner prepares directories explicitly. |
| Backend `DATA_DIR/agents/<id>` no-repo files | Legacy compatibility | Report with `no-repository-agent-files:report`; import through `/api/agents/:id/files/import-legacy` only. |
| Repo-backed agent context files under `<repositoryRoot>/.openwork/agents/<slug>` | Runner-owned | Backend may request explicit setup/sync; do not read/write backend host path in hosted mode. |
| No-repo agent files under `<runnerRoot>/.openwork/no-repository-agents/<id>/workspace` | Runner-owned | Use runner file actions only. Backend stores no canonical file copy after import. |
| `/api/storage/*` files and media objects | Backend-owned | Keep as backend storage. Runner receives signed/authenticated download references and materializes copies locally. |
| Explicit attachment imports and per-run staged files | Runner-owned copies | Backend owns source attachment and signed manifest only; runner validates destination/hash/size. |
| Skill files under platform skills | Backend-owned product content | Keep backend-managed unless explicitly synced into runner agent context. |

## Service And Route Transition Map

| Component | Current backend authority | Target transition |
| --- | --- | --- |
| `createAgent` | Inserts metadata, creates service user/key, computes `workspacePath`, scaffolds files under backend path. | Keep metadata and auth creation. Move executable file scaffolding to explicit runner setup; new no-repo agents should not require backend file writes for execution. |
| `updateAgent` | Updates product metadata and may sync preset model-scoped backend files. | Keep metadata update; move context-file changes to explicit runner sync actions. |
| `listAgentFiles` / `readAgentFileContent` / `writeAgentFileContent` / upload/delete/reference | Direct backend filesystem authority for repo-backed and legacy no-repo branches. | Use runner file operations for runner-owned workspaces. Keep backend branch only for legacy import/local-dev compatibility. |
| `/api/agents/:id/files/status` | Reports runner availability and legacy backend import summary. | Keep as transition API until backend legacy file authority is removed. |
| `/api/agents/:id/files/import-legacy` | Reads backend legacy files and sends base64 payload to runner. | Keep one-way repair/import; after verified imports and retention window, remove backend file authority. |
| `/api/runner-filesystem/*` | Backend authenticates and proxies to selected runner; validation can update agent path metadata. | Keep as current runner-owned filesystem API. Add stronger scoped agent/file operations as protocol evolves. |
| `/api/agent-runners*` | Backend owns device records and stores latest capabilities. | Keep control plane. Stop using persisted `capabilities` as canonical availability without a live runner check. |
| `dispatchRemoteAgentJob` | Backend picks runner, records job mappings, sends job offer with workspace path. | Keep dispatch/routing. Ensure cwd and staged files are runner-validated before enqueue/offer. |
| `agent-chat` workspace resolution | Backend resolves repository/no-repo/subfolder paths and can still reference backend `DATA_DIR` for legacy cases. | Backend resolves metadata and gates; runner validates/materializes actual cwd and files. |
| `storage` attachment download/import | Backend reads `DATA_DIR/storage` and emits signed runner download refs. | Keep backend source storage; never pass backend disk paths as executable file authority. |

## Frontend Call Transition Map

| UI surface | Current call | Target state |
| --- | --- | --- |
| Runner settings | `/agent-runners`, `/agent-runners/pairing-codes`, rename/revoke | Keep backend control-plane UI. Display capabilities as latest runner advertisement, not backend-owned truth. |
| Runner filesystem picker | `/runner-filesystem/browse`, `/runner-filesystem/pick-folder` | Keep. Disable on no runner/unsupported runner; no `/storage/*` fallback. |
| Repository verification | `/runner-filesystem/validate-repository-root` | Keep. Verification is the required repair action for legacy roots. |
| Repository/conversation reveal | `/runner-filesystem/prepare-conversation-workspace`, `/runner-filesystem/reveal` | Keep. Only reveal verified runner-local paths. |
| No-repo agent files | `/agents/:id/files*` with `workspaceId`, `/runner-filesystem/reveal-agent-file`, `/files/import-legacy` | Keep during transition; responses must expose `origin: "runner"` for runner-owned operations. |
| Backend storage page | `/storage/*` | Keep as backend-storage only. Do not use for runner-local repository paths. |
| Markdown absolute path reveal | `/runner-filesystem/reveal` | Keep gated by runner availability; absolute paths from output are not authority without runner/daemon validation. |
| Skill file browser reveal | `/skills/:id/files/reveal` | Keep backend-managed skill content, gated for host reveal in hosted mode. |

## Migration Checklist

### 1. Schema migration

- [x] Add repository-root origin metadata:
  `repositoryRootOrigin`, `repositoryRootRunnerId`,
  `repositoryRootVerifiedAt`, `repositoryRootRepairRequired`.
- [x] Add runner-owned inventory pointers and legacy repair state:
  `runnerInventoryRunnerId`, `runnerInventoryWorkspaceId`,
  `runnerInventoryVersion`, `runnerInventoryCapabilityRefs`,
  `runnerInventoryWorkspaceRootOrigin`,
  `runnerInventoryWorkspaceRootVerifiedAt`, `runnerInventoryVerifiedAt`,
  `legacyAgentFileState`, `legacyAgentFileRepairState`,
  `legacyAgentFileCheckedAt`.
- [ ] Add runner connection scope metadata on `agent_runners` and pairing codes:
  `connectionScope`, `ownerAccountId`, `boundWorkspaceId`,
  `legacyConnectionScope`. Backfill existing rows to `account` scope without
  changing activation. See [Runner Connection Scope Contract](./runner-connection-scope-contract.md).
- [ ] If runner availability moves beyond a cache, add a durable capability
  snapshot table with `runnerId`, advertised revision, and expiry semantics.
- Rollback: additive nullable columns can remain inert. Stop new runner
  dispatch, restore the pre-migration database backup only if routing metadata
  corrupts enqueue/reveal behavior.

### 2. Backfill and repair

- [ ] Run `pnpm --filter backend repository-roots:report`.
- [ ] For every row with non-null `repositoryRoot` where origin is not
  `runner_local`, `repositoryRootRunnerId` is missing,
  `repositoryRootVerifiedAt` is missing, or
  `repositoryRootRepairRequired = true`, require
  `/api/runner-filesystem/validate-repository-root` before hosted reveal or
  new job usage. Active rows must either be repaired or have explicit
  blocked/manual-repair card/comment evidence.
- [ ] Run `pnpm --filter backend no-repository-agent-files:report`.
- [ ] Run `pnpm --filter backend agent-inventory:report`.
- [ ] Run `pnpm --filter backend agent-inventory:backfill`.
- [ ] Run `pnpm --filter backend agent-ownership:gate`; it must report `PASS`
  before moving runner ownership cards to Done.
- [ ] For every no-repo row reporting `legacy_importable`, require explicit
  `/api/agents/:id/files/import-legacy` or intentional archival before removing
  backend legacy file access.
- [ ] Repair malformed `conversation.metadata.workspaceMode` and unsafe
  `workspaceRelativePath` values; do not silently create new runner folders
  from malformed metadata.
- Rollback: keep existing path strings and legacy backend files untouched.
  Disable runner-local actions for unrepaired rows rather than clearing data.

### 3. API transition

- [ ] Keep `/api/agent-runners*` as backend-owned control-plane APIs.
- [ ] Keep `/api/runner-filesystem/*` as the only runner-local filesystem API
  family.
- [ ] Split any remaining `/api/agents/:id/files*` backend file authority into
  explicit runner proxy operations or legacy import/local-dev-only operations.
- [ ] Replace backend host CLI status as runtime availability with runner
  capability/status from a live eligible runner.
- [ ] Ensure chat/card/batch enqueue fails before job offer when repository
  root, no-repo workspace, attachments, or provider capability require repair.
- Rollback: preserve old read-only/list compatibility where needed, but keep
  hosted mutating/reveal endpoints behind `OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM`.

### 4. UI transition

- [ ] Show stored legacy paths as inert metadata until `runner_local`
  verification exists.
- [ ] Keep no-runner and old-runner disabled states for browse/pick/reveal/file
  actions.
- [ ] Label runner capabilities as live/last-advertised and separate them from
  agent API permission `capabilities`.
- [ ] Keep backend storage UI visually separate from runner-local repository
  and no-repo file UIs.
- Rollback: hide runner-local controls and leave product metadata visible; do
  not route UI fallback to backend host filesystem endpoints in hosted mode.

### 5. Remove backend file authority

- [ ] After reports show no required imports/repairs, remove backend writes for
  executable agent context files from `services/agents.ts`.
- [ ] Remove legacy `/api/agents/:id/files/references` and repo-backed backend
  file reveal/mutation branches, or keep only explicit local-dev same-host
  compatibility.
- [ ] Keep backend `DATA_DIR/storage` because attachments/media remain
  backend-owned storage, not runner workspace files.
- [ ] Keep run logs/history in backend-owned `agent_runs`.
- Rollback: restore from the retention backup of `DATA_DIR/agents` only to run
  explicit imports or forensics; do not re-enable it as hosted execution
  authority.

## Legacy Rows That Require Repair

Do not silently reinterpret these rows:

- `agents.repositoryRoot` is non-null and any of these are true:
  `repositoryRootOrigin` is null/`unknown`/`backend_local_legacy`,
  `repositoryRootRunnerId` is null, `repositoryRootVerifiedAt` is null, or
  `repositoryRootRepairRequired = true`.
- Repo-backed agents where `workspacePath` does not equal
  `deriveAgentWorkspacePath(repositoryRoot, name)` after runner verification.
- No-repository agents whose `workspacePath` is an absolute backend
  `DATA_DIR/agents/<id>` path and whose legacy file report has importable
  files.
- No-repository agents whose selected runner lacks an absolute
  `capabilities.workspaceRoot`.
- Agent groups assigned to zero workspaces or multiple workspaces for the same
  user when no `workspaceId` is supplied.
- Queued/processing runs or queue rows with legacy payloads containing
  backend-local absolute paths.
- Conversation metadata with `workspaceMode` outside `shared|subfolder` or a
  `workspaceRelativePath` that normalizes outside the execution root.
- Runner rows with revoked credentials, stale live status, unsupported
  `capabilities.protocolVersion`, missing provider support, or missing
  `supportsFilesystem` for filesystem actions.
- Attachment manifests that only contain backend disk paths without a scoped
  runner download/materialization reference.

## Verification Commands

Use this set before coding follow-up migrations:

```bash
pnpm --filter backend db:migrate
pnpm --filter backend db:migrate
pnpm --filter backend repository-roots:report
pnpm --filter backend no-repository-agent-files:report
pnpm --filter backend agent-inventory:report
pnpm --filter backend agent-inventory:backfill
pnpm --filter backend agent-ownership:gate
pnpm runner-fs:scan
pnpm smoke:runner-workspace-contract
pnpm smoke:runner-split
pnpm typecheck
```

Rollback note for `0020_agent_workspace_path_metadata`: preserve
`legacy_data.workspacePathLegacy` as history. If application code must be rolled
back, do not repopulate `agents.workspace_path` for no-repository agents from
that legacy value unless backend-local execution authority is explicitly being
restored as a separate rollback decision. Keep runner readiness and file actions
bound to runner inventory/capabilities.

For live smoke, start or reuse the dev stack with backend on
`http://localhost:3847` and frontend on `http://localhost:5173`, then verify:

- `GET /health`
- seeded admin login
- `GET /api/boards/:id`
- `GET /api/boards/:id/execution-plans`
- at least one runner-relevant endpoint such as
  `GET /api/agent-runners`, `GET /api/runner-filesystem/status`, or
  `GET /api/agents/:id/files/status`

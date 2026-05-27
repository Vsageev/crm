# Runner Local Filesystem UX/API Contract

This spike decides ownership for repository browsing, folder picking, reveal
actions, repository root selection, and local path display when OpenWork is
hosted and the user's filesystem is reachable only through the paired native
runner/daemon.

## Decision

Backend-managed storage remains server-storage and continues to use
`/api/storage`, `/api/storage/upload`, `/api/storage/download`,
`/api/storage/files/content`, and `/api/storage/reveal` against `DATA_DIR`.
Those endpoints must not be reused for runner-local repository paths.

User-machine filesystem operations are runner-local. In hosted mode they must
go through the current user's eligible paired runner/daemon or be disabled with
an actionable runner requirement. The hosted backend must not silently browse or
reveal its own host filesystem for repository selection, markdown absolute
paths, agent workspaces, or conversation folders.

The minimum native runner/daemon API surface for the implementation slice is:

- `GET /api/runner-filesystem/browse?path=<path>&mode=file|folder` proxies to a
  connected runner/daemon and returns `{ origin: "runner", runnerId, path,
  entries }`.
- `POST /api/runner-filesystem/pick-folder` opens the runner/daemon native
  folder picker and returns `{ origin: "runner", runnerId, path }`.
- `POST /api/runner-filesystem/reveal` reveals a runner-local path and returns
  `204`; it must not return file contents.
- `POST /api/runner-filesystem/validate-repository-root` validates/remaps a
  selected repository root for a specific runner/workspace and returns path
  origin metadata.

These names are intentionally separate from `/api/storage/*` so server storage
and runner-local filesystem authority do not collapse into one endpoint family.

## Compatibility States

| State | Required behavior |
| --- | --- |
| Runner connected with daemon filesystem capability | Enable browse, folder picker, reveal, and repository-root validation through the runner-local endpoints only. |
| Runner connected but old protocol/no daemon filesystem capability | Disable runner-local browse/pick/reveal with `runner_filesystem_unsupported`; keep existing server-storage UI enabled. Do not call `/api/storage/browse-fs`, `/api/storage/pick-folder`, or `/api/storage/reveal-local` as fallback. |
| No runner | Disable repository browse/pick/reveal with `runner_unavailable`; explain that a paired runner is required. Existing stored paths may be displayed as inert metadata. |
| Server-storage case | Keep storage browse/upload/download/reveal under `/api/storage/*`; classify as backend-storage and do not route through runner endpoints. |
| Explicit local development same-host mode | May opt into legacy server-local filesystem routes only behind an explicit development flag. Hosted mode default must be disabled, not best-effort fallback. |

This behavior is final for the current native runner. `busy` runners still
count as connected for filesystem availability if they are non-stale and
advertise filesystem capability; busy affects status display, not eligibility.

## Surface Classification

| Surface | Current call site | Classification | Implementation contract |
| --- | --- | --- | --- |
| Storage page file manager | `packages/frontend/src/pages/StoragePage.tsx` -> `FileBrowser` -> `/storage/*` | backend-storage | Keep on `/api/storage/*`; this is backend-managed storage under `DATA_DIR`. |
| Storage references target browser | `FileSystemBrowserModal.tsx` -> `/storage/browse-fs`; `POST /api/storage/references` stores symlink target | unsupported in hosted mode unless explicitly local-dev | Stop exposing this as generic host browsing in hosted mode. Either remove/disable reference-to-host-path creation outside local-dev or redesign references as server-storage-only metadata. |
| Preset working-directory/repository picker | `AgentsPage.tsx` `handlePickPresetDirectory()` -> `/storage/pick-folder` | runner-local | Replace with runner-local folder picker. No runner/old runner disables the control; no backend picker fallback. |
| Agent settings repository folder reveal | `AgentsPage.tsx` `revealLocalPathInFileManager()` -> `/storage/reveal-local` | runner-local | Replace with runner-local reveal if the repository root has runner path origin. Otherwise show repair/confirm flow. |
| Agent settings agent folder reveal | `AgentsPage.tsx` `revealAgentWorkspaceInFileManager()` -> `/agents/:id/files/reveal` | runner-local for repo-backed agents; disabled-until-runner for hosted legacy paths | Do not reveal backend agent workspace for repo-backed agents in hosted mode. Use runner-local reveal after repository-root validation/materialization. |
| Conversation subfolder reveal | `AgentsPage.tsx` `revealConversationFolder()` -> `/api/runner-filesystem/prepare-conversation-workspace`, then `/api/runner-filesystem/reveal` | runner-local | Prepare the runner-local subfolder explicitly before reveal. Repository-backed agents use `<repositoryRoot>/conversations/<conversationId>`; no-repository agents use `<runnerRoot>/.openwork/no-repository-agents/<agentId>/workspace/conversations/<conversationId>`. Shared conversations stay unavailable. |
| Markdown absolute path action menu | `MarkdownContent.tsx` -> `/storage/reveal-local`; editor URL links use local URI schemes | runner-local | Gate reveal/editor actions by path origin. Absolute paths from agent output are not authority; reveal only if within validated runner roots or after daemon confirmation. |
| Agent file browser reveal | `AgentsPage.tsx` agent file browser -> `/agents/:id/files/reveal` | runner-local for repo-backed agents; backend-storage-like only for backend-owned legacy agent data | Split by path origin. Hosted repo-backed agents must use runner-local reveal; backend-owned legacy data may remain server-local only when explicitly classified. |
| Skill file browser reveal | `AgentsPage.tsx` skill file browser -> `/skills/:id/files/reveal` | backend-storage for platform skills | Keep separate from runner repository paths unless skills are explicitly materialized into a runner workspace, in which case reveal uses runner origin metadata. |

Surfaces that must stop calling server local-filesystem endpoints in hosted mode:

- `AgentsPage.tsx` preset directory picker -> `/storage/pick-folder`.
- `AgentsPage.tsx` repository root reveal -> `/storage/reveal-local`.
- `AgentsPage.tsx` agent workspace reveal -> `/agents/:id/files/reveal` for repo-backed agents.
- `AgentsPage.tsx` conversation subfolder reveal -> `/agents/:id/chat/conversations/:conversationId/reveal-folder`.
- `MarkdownContent.tsx` absolute path reveal -> `/storage/reveal-local`.
- `FileSystemBrowserModal.tsx` `/storage/browse-fs` for host path reference selection.

## Repository Root Migration

Existing `agents.repositoryRoot` and `agents.workspacePath` values are path
strings without origin metadata. They must be treated as unverified metadata in
hosted mode.

Add path-origin metadata before enabling runner-local actions:

- `repositoryRootOrigin`: `runner_local | backend_local_legacy | unknown`.
- `repositoryRootRunnerId` or a stable runner/workspace binding.
- `repositoryRootVerifiedAt`.
- `repositoryRootRepairRequired` when an existing value has no origin or fails
  runner validation.

Backfill requirement:

- Existing rows with non-null `repositoryRoot` become `unknown` or
  `backend_local_legacy` depending on deployment mode; hosted deployments must
  require runner validation before use.
- Existing repo-backed `workspacePath` should be recomputed from the validated
  repository root as `<repositoryRoot>/.openwork/agents/<slug>` rather than
  trusted independently.
- Existing queued/processing runs keep their original path assumptions or fail
  explicitly during recovery; do not rewrite in-flight cwd silently.

Repair flow:

1. Display the stored path as inert metadata with "Verify on runner".
2. Ask the selected runner/daemon to validate or let the user pick a replacement
   folder.
3. Persist path origin metadata and recompute `workspacePath`.
4. Only then enable reveal and new job usage.

Audit command:

```bash
pnpm --filter backend repository-roots:report
```

Expected clean output shape from workspace
`60b79645-d5f9-4815-9852-511a4d3b3cde`:

```json
{
  "checkedAt": "2026-05-23T00:00:00.000Z",
  "agentsNeedingRepositoryRootRepair": 0,
  "agents": []
}
```

Any non-empty `agents` array means hosted runner-local actions must stay
disabled for those agents until a paired runner validates the root and the
backend stores `repositoryRootOrigin: "runner_local"`,
`repositoryRootRunnerId`, and `repositoryRootVerifiedAt`.

## Regression Guard

Run this diagnostic scan after any implementation change:

```bash
pnpm runner-fs:scan
```

The scanner lists every known local filesystem action call site and highlights
server-local endpoints that are prohibited in hosted runner-local surfaces.
Implementation cards should keep the command and assert the remaining
prohibited calls are either removed, gated to explicit local-dev mode, or
documented as backend-storage only.

Keep this command in the release checklist. Fail or review a release if hosted
runner-local surfaces call server-local filesystem endpoints without an
explicit local-development gate. Backend-storage `/api/storage/*` upload,
download, content, and storage reveal endpoints are intentional only for
server-managed storage and must not be treated as runner-local repository
authority.

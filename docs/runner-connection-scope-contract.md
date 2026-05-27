# Runner Connection Scope Contract

This contract defines the product and data model for two runner connection
scopes: **account-connected** and **project-connected** (bound to an OpenWork
product workspace). It is the canonical reference for schema, API, UI, routing,
and migration work in the `Runner connection scopes: account and project`
execution plan.

Related docs:

- [Runner Separation Contract](./runner-separation-contract.md) — backend vs
  runner boundary
- [Backend Agent State Migration Map](./backend-agent-state-migration-map.md) —
  broader agent/runner state inventory
- [Native Runner Availability Spike](./native-runner-availability-routing-recovery-spike.md) —
  dispatch eligibility invariants

## Canonical Terminology

Use these exact terms in API fields, UI copy, tests, and follow-up cards.

| Term | API field | Meaning |
| --- | --- | --- |
| **Runner connection** | `agentRunners` row + optional live socket | A paired user-machine runner registered in the backend control plane. |
| **Connection scope** | `connectionScope` | `account` or `project`. Determines who may activate the runner and where it appears. |
| **Owner account** | `ownerAccountId` | The user account that owns the runner credential and admin rights. Always the pairing account today (`agent_runners.user_id`). |
| **Bound workspace** | `boundWorkspaceId` | The product workspace the runner is connected for. Immutable after create for `project` scope. Maps to `agent_runners.workspace_id` today. |
| **Activation** | n/a (behavior) | Using a runner for job dispatch, filesystem proxy, or explicit runner-local prepare/reveal. Not the WebSocket hello itself. |
| **Activation actor** | request auth subject | The authenticated user (or API key principal) attempting to run work through a runner. |
| **Visibility actor** | request auth subject | Any principal reading runner lists, run history, card comments, or linked artifacts. |
| **Disconnect/admin actor** | request auth subject | Principal performing rename, revoke, or pairing-code creation. |
| **Legacy connection** | `legacyConnectionScope: true` | Pre-scope row backfilled without changing activation behavior. |

UI labels:

- Settings tab title stays **Runner Devices**.
- Scope picker labels: **Account runner** (`account`) and **Project runner**
  (`project`).
- Help text for account scope: “Only your account can start jobs on this runner.
  Teammates can still read run output and card comments.”
- Help text for project scope: “Any workspace member with permission to run
  agents can use this runner. It stays bound to this workspace.”

## Scope Model

### Account-connected runner (`connectionScope: "account"`)

- Owned by the connecting account (`ownerAccountId`).
- Only the owner account may **activate** the runner (dispatch jobs, filesystem
  proxy, prepare/reveal) unless an explicit future delegation feature is added.
- Listed in **Settings → Runner Devices** for the owner when the active product
  workspace matches `boundWorkspaceId`.
- Work artifacts produced through the runner remain readable to everyone who
  already has access to the underlying project artifact (card, board,
  conversation, collection, run history). Connection scope does **not** hide
  comments, stdout/stderr, linked files, or `agent_runs` rows.

### Project-connected runner (`connectionScope: "project"`)

- Bound to exactly one product workspace (`boundWorkspaceId`).
- Visible in the project agent space (workspace-scoped runner list used by agent
  settings, batch preflight, and runner filesystem actions).
- Any **workspace member** with normal permission to run agents may activate it.
- `boundWorkspaceId` is immutable. Metadata edits must not move the runner to
  another workspace. Re-bind requires revoke + new pairing.
- Owner account retains disconnect/admin rights (rename, revoke, pairing).

### Workspace member (interim definition)

Today product workspaces are single-owner (`workspaces.user_id`). Until a
durable membership table lands, **workspace member** means:

1. The workspace owner account, or
2. Any authenticated principal that already has workspace content access through
   existing RBAC (for example `settings:read` / `settings:update` on agent and
   board routes scoped to that workspace's boards/collections/agents).

Follow-up cards may replace (2) with explicit `workspace_members` rows. This
contract keeps the activation/visibility split stable across that transition.

## Permission Matrix

| Action | Account scope | Project scope |
| --- | --- | --- |
| Pair/create connection | Owner account with `settings:update` on bound workspace | Owner account with `settings:update` on bound workspace |
| List connection in settings | Owner account | Workspace members with `settings:read` |
| List connection in agent space | Owner account only | Workspace members with `settings:read` |
| Rename runner | Owner account | Owner account |
| Revoke/disconnect runner | Owner account | Owner account |
| Activate runner (dispatch/prepare/filesystem) | Owner account only | Workspace members with agent-run permission (`settings:update` on chat/card/batch enqueue paths today) |
| Read run history (`agent_runs`) | Existing artifact ACL | Existing artifact ACL |
| Read card comments / linked output | Existing artifact ACL | Existing artifact ACL |
| Read/download attachments produced by runs | Existing artifact ACL | Existing artifact ACL |
| Change `boundWorkspaceId` | Forbidden (409) | Forbidden (409) |
| Change `connectionScope` after create | Forbidden (409) | Forbidden (409) |

Activation permission is about **who may consume the runner**. Visibility of
historical artifacts follows board/collection/card/conversation permissions only.

## Current Inventory (Pre-Scope Code)

### Persisted tables and fields

| Surface | Location | Fields / behavior |
| --- | --- | --- |
| Runner device record | `agent_runners` | `id`, `userId`, `workspaceId`, `displayName`, credential hash/prefix, `status`, `lastSeenAt`, `version`, `capabilities`, `revokedAt`, timestamps, `legacyData` |
| Pairing codes | `agent_runner_pairing_codes` | `userId`, `workspaceId`, `codeHash`, `displayName`, `expiresAt`, `usedAt` |
| Legacy tokens | `agent_runner_tokens` | Separate auth path; audit before consolidation |
| Agent routing scope | `agents.groupId` → `workspaces.agentGroupIds` | Resolves `{ userId: workspace.userId, workspaceId }` via `runnerRoutingScopesForAgentGroup()` |
| Agent inventory pointers | `agents.runnerInventory*` | Latest runner/workspace capability snapshot; not connection scope |
| Repository root binding | `agents.repositoryRoot*` | Path metadata validated through runner; independent of connection scope |
| Run history | `agent_runs` | Backend-owned output; no runner scope gate on read |
| Card comments | `card_comments` | Linked via `agentRunId`; visibility follows card ACL |
| Attachments | `storage` + card/message attachment metadata | Backend-owned bytes; runner staging is ephemeral |
| Live socket registry | in-memory `ConnectedRunner` | `userId`, `workspaceId`, capabilities, active jobs |

### Routes and services

| Route / service | Scope today | Notes |
| --- | --- | --- |
| `GET /api/agent-runners` | Owner list (`request.user.sub === userId`) | Optional `workspaceId` filter |
| `GET /api/agent-runners/live` | Any `settings:read` | Live socket list |
| `POST /api/agent-runners/pairing-codes` | Workspace owner only | `createRunnerPairingCode()` verifies `workspace.userId` |
| `POST /api/agent-runners/pair` | Unauthenticated runner | Creates row with pairing code's `userId` + `workspaceId` |
| `PATCH /api/agent-runners/:id` | Owner rename only | No workspace/scope fields |
| `POST /api/agent-runners/:id/revoke` | Owner revoke only | Disconnects live socket |
| `GET /api/runner-filesystem/*` | Activation via `userId` + optional `workspaceId` | Uses `getRunnerFilesystemAvailability()` |
| Chat/card/batch enqueue | `preflightAgentRunner()` | Requires `{ userId, workspaceId }` from agent group routing |
| `dispatchRemoteAgentJob()` | `runnerMatchesUser` + `runnerMatchesWorkspace` | `workspaceId === '*'` wildcard matches any workspace (legacy/dev only; do not use for scoped product runners) |

Key implementation files:

- `packages/backend/src/services/runner-devices.ts`
- `packages/backend/src/routes/agent-runners.ts`
- `packages/backend/src/services/agent-runners.ts`
- `packages/backend/src/services/agent-chat.ts` (`preflightAgentRunner`)
- `packages/backend/src/routes/runner-filesystem.ts`
- `packages/frontend/src/pages/settings/RunnerDevicesTab.tsx`

### Current implicit behavior

All existing paired runners behave like **account-connected** runners:

- Pairing requires workspace ownership.
- Listing, rename, and revoke require `request.user.sub === agent_runners.userId`.
- Dispatch/filesystem eligibility requires `runner.userId === routingScope.userId`
  and workspace match.
- Historical runs, comments, and attachments remain readable through existing
  artifact routes regardless of who paired the runner.

No API today exposes `connectionScope` or allows moving `workspaceId` through
metadata edits.

## Target Data Model (Schema Card)

Add nullable columns first, backfill, then enforce in API:

```sql
ALTER TABLE agent_runners
  ADD COLUMN IF NOT EXISTS connection_scope text,
  ADD COLUMN IF NOT EXISTS owner_account_id text,
  ADD COLUMN IF NOT EXISTS bound_workspace_id text,
  ADD COLUMN IF NOT EXISTS legacy_connection_scope boolean;

ALTER TABLE agent_runner_pairing_codes
  ADD COLUMN IF NOT EXISTS connection_scope text;
```

Field rules after backfill:

| Field | Required | Mutable | Notes |
| --- | --- | --- | --- |
| `connectionScope` | yes | no | `account` or `project` |
| `ownerAccountId` | yes | no | FK → `users.id` |
| `boundWorkspaceId` | yes | no for `project`; no API move for `account` | FK → `workspaces.id` |
| `legacyConnectionScope` | yes | no | `true` for backfilled rows until owner re-pairs |
| `displayName` | yes | yes | Owner only |
| `userId` | deprecated alias | no | Keep synced with `ownerAccountId` during transition |
| `workspaceId` | deprecated alias | no | Keep synced with `boundWorkspaceId` during transition |

Public API shape (list/detail):

```json
{
  "id": "…",
  "connectionScope": "account",
  "ownerAccountId": "…",
  "boundWorkspaceId": "…",
  "legacyConnectionScope": true,
  "displayName": "My runner",
  "status": "online",
  "capabilities": {},
  "revoked": false
}
```

Pairing request body adds optional `connectionScope` (default `account`).

## Activation And Routing Rules

Shared preflight (`preflightAgentRunner`) stays the gate for chat, card, cron,
board batch, and collection batch paths.

For **account** scope:

```
activationAllowed =
  activationActorId === runner.ownerAccountId
  AND runner.boundWorkspaceId === routingScope.workspaceId
  AND runner live-eligible (NRI-001..004)
```

For **project** scope:

```
activationAllowed =
  activationActor is workspace member of runner.boundWorkspaceId
  AND activationActor has agent-run permission
  AND runner.boundWorkspaceId === routingScope.workspaceId
  AND runner live-eligible
```

Routing scope resolution stays unchanged: one agent group → one workspace
(`agent_runner_workspace_ambiguous` when violated).

Artifact reads never call these activation checks.

## Artifact Visibility Contract

Runner connection scope affects **activation only**. These surfaces stay on
existing artifact ACL:

| Surface | Read gate | Scope independence |
| --- | --- | --- |
| `GET /api/agent-runs` / run detail | Agent/board/collection access | Yes |
| `GET /api/cards/:id/comments` | Card/board access | Yes |
| Chat transcript / turns | Conversation access | Yes |
| Storage downloads linked from comments or runs | Storage permissions | Yes |
| Agent file browser read (runner proxy) | Agent `settings:read` + runner activation rules for mutation | Reads of historical backend-stored output stay allowed |

When an account-connected runner completes card work, teammates with card access
must still see the auto-generated comment, run link, stdout excerpts, and
attachments.

## Migration And Backfill

### Classification rule for existing rows

Run once during the schema migration card:

```sql
UPDATE agent_runners
SET
  connection_scope = COALESCE(connection_scope, 'account'),
  owner_account_id = COALESCE(owner_account_id, user_id),
  bound_workspace_id = COALESCE(bound_workspace_id, workspace_id),
  legacy_connection_scope = COALESCE(legacy_connection_scope, true)
WHERE connection_scope IS NULL
   OR owner_account_id IS NULL
   OR bound_workspace_id IS NULL
   OR legacy_connection_scope IS NULL;
```

Pairing codes with null scope default to `account`.

This preserves today's activation permissions: only the pairing account can
activate, and workspace binding stays the same.

### Explicit non-goals for backfill

- Do **not** auto-upgrade existing rows to `project` scope.
- Do **not** change `userId` / `workspaceId` values.
- Do **not** revoke or disconnect live runners.
- Do **not** rewrite `agent_runs`, `card_comments`, or attachment metadata.

### Repair / report command (schema card)

```bash
pnpm --filter backend runner-connections:report
```

Expected shape:

```json
{
  "checkedAt": "2026-05-26T00:00:00.000Z",
  "total": 3,
  "byScope": { "account": 3, "project": 0 },
  "legacy": 3,
  "missingBoundWorkspace": 0,
  "orphanedWorkspace": 0
}
```

### Rollback

1. Stop deploying scope-aware API/UI changes.
2. Leave additive columns in place (nullable / ignored).
3. Continue treating `userId` + `workspaceId` as authoritative for dispatch.
4. Restore database backup only if backfill corrupts `ownerAccountId` or
   `boundWorkspaceId`. Do not delete runs/comments during rollback.

## Negative Permission Responses

Implement in the schema/API card; tests in
`packages/backend/src/routes/agent-runners.scope-contract.test.ts` document the
contract.

| Attempt | HTTP | Code |
| --- | --- | --- |
| Non-owner rename/revoke | 404 | n/a (`Runner not found`) |
| Non-member list project runner (future) | 403 | `runner_connection_forbidden` |
| Non-owner activate account runner | 409 | `runner_activation_forbidden` |
| Member without run permission activate project runner | 403 | `runner_activation_forbidden` |
| PATCH `boundWorkspaceId` or `connectionScope` | 400/409 | `runner_binding_immutable` |
| Pairing code for workspace user does not own | 400 | `Workspace not found` |
| Dispatch when routing workspace ≠ `boundWorkspaceId` | 409 | `agent_runner_unavailable` |

Messages must remain actionable and must not leak credential material.

## Verification

Release rollout steps, backfill report, rollback, and manual dual-scope runner smoke:
[Runner Connection Scope Release Guide](./runner-connection-scope-release.md).

CI / local regression:

```bash
pnpm --filter backend db:migrate
pnpm --filter backend db:migrate   # idempotent second run
pnpm typecheck
pnpm --filter backend test -- src/services/runner-devices.connection-scope.test.ts src/services/runner-devices.activation.test.ts src/services/runner-connection-scope-regression.test.ts src/routes/agent-runners.scope-contract.test.ts
vitest run packages/frontend/src/lib/runner-connections.test.ts packages/frontend/src/components/RunnerConnectionList.test.tsx packages/frontend/src/components/ProjectRunnersPanel.test.tsx
```

Live HTTP (backend on `http://localhost:3847`):

```bash
OPENWORK_LIVE_ACCEPTANCE_BOARD_ID=<board-id> \
OPENWORK_LIVE_ACCEPTANCE_CARD_ID=<card-id> \
pnpm acceptance:live-transition
```

The live suite checks board/execution-plans, account and project runner lists, the
`workspaceId` guard for project lists, card comment reads, and runner filesystem paths.

## Follow-Up Cards

| Card | Work |
| --- | --- |
| Schema/API | Add columns, backfill, expose `connectionScope` in API, enforce immutable fields |
| Account activation/artifact visibility | Enforce owner-only activation; prove artifact ACL regression suite |
| Project sharing/immutable binding | Workspace-member list/activate; forbid workspace moves |
| UI | Scope picker, labels, agent-space runner list |
| Verification/docs | End-to-end acceptance with paired project runner |

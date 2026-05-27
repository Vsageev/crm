# Runner Connection Scope — Release Guide

Use this guide when rolling out migration `0019_runner_connection_scope.sql` and the
account/project runner scope API/UI. The product contract lives in
[Runner Connection Scope Contract](./runner-connection-scope-contract.md).

## What ships

- `connectionScope` (`account` | `project`) on `agent_runners` and pairing codes
- Immutable `ownerAccountId`, `boundWorkspaceId`, `originalBoundWorkspaceId`
- `legacyConnectionScope` for rows backfilled from pre-scope installs
- Owner-only activation for account runners; workspace-member activation for project runners
- Artifact reads (runs, card comments, storage downloads) unchanged — scope gates activation only

## Pre-deploy checklist

1. Back up Postgres (`agent_runners`, `agent_runner_pairing_codes`, `agent_runs`, `card_comments`).
2. Note active runner count: `pnpm --filter backend runner-connections:report`
3. Confirm no in-flight remote jobs (optional: pause batch runs).

## Deploy steps

From the repo root:

```bash
pnpm --filter backend db:migrate
pnpm --filter backend db:migrate   # must be idempotent
pnpm typecheck
pnpm --filter backend test -- src/services/runner-devices.connection-scope.test.ts src/services/runner-devices.activation.test.ts src/routes/agent-runners.scope-contract.test.ts src/services/runner-connection-scope-regression.test.ts
vitest run packages/frontend/src/lib/runner-connections.test.ts packages/frontend/src/components/RunnerConnectionList.test.tsx packages/frontend/src/components/ProjectRunnersPanel.test.tsx
```

Deploy backend, frontend, and runner packages together. Older runners without scope
awareness still pair; new columns default safely.

## Post-migrate verification

### 1. Report command

```bash
pnpm --filter backend runner-connections:report
```

Expect:

- `byScope.unknown === 0`
- `missingBoundWorkspace === 0`
- `invalidBinding === 0`
- `legacy` equals pre-existing runner count (backfilled rows stay `legacyConnectionScope: true`)

### 2. Existing connections still work

With backend on `http://localhost:3847` and seeded admin:

| Check | Endpoint | Expected |
| --- | --- | --- |
| List account runners | `GET /api/agent-runners?workspaceId=<ws>&connectionScope=account` | 200; legacy rows show `connectionScope: "account"`, `legacyConnectionScope: true` |
| List project runners | `GET /api/agent-runners?workspaceId=<ws>&connectionScope=project` | 200; `entries` array (may be empty) |
| Run history | `GET /api/agent-runs?limit=5` | 200; prior runs readable |
| Card comments | `GET /api/cards/<cardId>/comments` | 200; historical comments unchanged |
| Board + plans | `GET /api/boards/<id>`, `GET /api/boards/<id>/execution-plans` | 200 |

Automated gate:

```bash
OPENWORK_LIVE_ACCEPTANCE_BOARD_ID=<board-id> \
OPENWORK_LIVE_ACCEPTANCE_CARD_ID=<card-id> \
pnpm acceptance:live-transition
```

### 3. Negative permission checks (must fail clearly)

| Attempt | Expected |
| --- | --- |
| Non-owner `PATCH /api/agent-runners/:id` | 404 `Runner not found` |
| Non-owner `POST /api/agent-runners/:id/revoke` | 404 |
| `GET /api/agent-runners?connectionScope=project` without `workspaceId` | 400 `runner_connection_workspace_required` |
| Teammate activating owner's account runner (dispatch/filesystem) | 409 `runner_activation_forbidden` |
| Moving `boundWorkspaceId` via DB/API patch | 409 `runner_binding_immutable` (service layer) |

Regression tests enforce these in CI; live acceptance probes list routes and comment reads.

## Backfill behavior

Migration `0019` sets on existing `agent_runners` rows:

- `connection_scope = 'account'`
- `owner_account_id = user_id`
- `bound_workspace_id = workspace_id`
- `legacy_connection_scope = true`

Activation rules are unchanged for legacy account runners: only the pairing account may dispatch.

Pairing codes with null scope default to `account`.

## Rollback / repair

### Safe rollback (code only)

1. Revert to the previous backend/frontend release.
2. Leave additive columns in place (nullable, ignored by old code).
3. Continue using `user_id` + `workspace_id` for dispatch.
4. Re-run `pnpm --filter backend runner-connections:report` after revert.

### Data repair

If `owner_account_id` or `bound_workspace_id` diverge from legacy columns:

```sql
UPDATE agent_runners
SET
  owner_account_id = user_id,
  bound_workspace_id = workspace_id,
  original_bound_workspace_id = workspace_id,
  connection_scope = COALESCE(connection_scope, 'account')
WHERE owner_account_id IS NULL
   OR bound_workspace_id IS NULL;
```

Do **not** delete `agent_runs`, `card_comments`, or attachment rows during repair.

### Revoke and re-pair

To change scope or workspace binding: revoke the runner in Settings → Runner Devices,
then create a new pairing code with the desired scope.

## Manual runner smoke (both scopes)

The openwork-runner CLI does not yet accept `connectionScope` on the wire; scope is
chosen when creating the pairing code in the UI/API.

1. **Account runner** — Settings → Runner Devices → Account runner → create code →
   `OPENWORK_SERVER_URL=http://localhost:3847 OPENWORK_RUNNER_PAIRING_CODE=<code> pnpm --filter openwork-runner dev`
2. **Project runner** — Agents → Project runners → Connect project runner (or Settings
   with `?tab=runners&scope=project`) → pair with the same env vars.
3. Confirm account runner: only your account can dispatch; project runner: workspace
   owner can dispatch.
4. Complete a card run on each; verify teammates (when available) still read comments
   and run output without activation rights on the account runner.

If only one physical machine is available, account-scope smoke in CI plus project-scope
pairing-code creation (`POST /api/agent-runners/pairing-codes` with
`connectionScope: "project"`) satisfies release sign-off; full dual-connection smoke
remains a manual checklist item above.

## Sign-off criteria

- [ ] `db:migrate` idempotent (two consecutive runs)
- [ ] `runner-connections:report` clean
- [ ] Focused scope tests green
- [ ] `pnpm acceptance:live-transition` green
- [ ] Existing runners listed after migrate
- [ ] Historical runs, comments, and artifacts readable
- [ ] Forbidden activation/move paths return documented error codes

# Development Guide

General dev setup, commands, and troubleshooting. For module-specific guidance, see:

- [Runbook](./RUNBOOK.md) — stale process cleanup, common issues, quick fixes
- [Backend Development](./backend-development.md) — routes, services, error handling, implementation patterns
- [Design System](./design-system.md) — colors, typography, components, animation rules
- [Agent Chat Turns ADR](./agent-chat-turns-adr.md) — canonical chat transcript model
- [Agent Chat Cutover Checklist](./agent-chat-cutover-checklist.md) — staging/production migration validation
- [Runner Separation Contract](./runner-separation-contract.md) — hosted backend vs user-machine runner boundary
- [Runner Local Filesystem UX/API Contract](./runner-local-filesystem-ux-api-contract.md) — runner-local browse, reveal, and repository-root path-origin contract
- [Native Runner Boundary Baseline](./native-runner-boundary-baseline.md) — current native runner path/env/job contract and failure baseline
- [Native Runner Availability Spike](./native-runner-availability-routing-recovery-spike.md) — current runner scheduling, routing, and recovery invariants
- [Backend Agent State Migration Map](./backend-agent-state-migration-map.md) — current backend state inventory, ownership classification, repair/rollback checklist
- [Runner Connection Scope Contract](./runner-connection-scope-contract.md) — account vs project runner connection scopes, permission matrix, migration/backfill
- [Runner Connection Scope Release](./runner-connection-scope-release.md) — rollout, verification, rollback, and manual runner smoke for both scopes
- [Live Transition Acceptance](./LIVE_TRANSITION_ACCEPTANCE.md) — mandatory local-dev usability gate and card-comment evidence template for batch-card handoff

## Quick Start

```bash
pnpm install   # install dependencies
pnpm dev       # run backend, frontend, and landing
pnpm typecheck # run type checking
pnpm lint      # run linter
```

`pnpm dev` runs `pnpm --filter backend db:migrate` before starting the dev stack. Set `OPENWORK_DEV_SKIP_MIGRATE=true` to skip that step. Agent execution requires a separately paired runner; if no eligible runner is connected, agent run creation fails with a clear runner-unavailable error instead of spawning a backend-local CLI.

## Shared Utilities

Import utilities from the `shared` package instead of reimplementing:

```typescript
import { formatBytes, formatDate, createListResponse } from 'shared';

formatBytes(1536000); // "1.5 MB"
formatDate(new Date().toISOString()); // formatted date
createListResponse(items, total, limit, offset); // consistent API response
```

## Code Style

- TypeScript for all new code
- camelCase for variables, PascalCase for types
- Keep functions small and focused
- Comments only for complex logic (why, not what)
- Prefer extending shared utilities before adding local helpers

## Troubleshooting

```bash
pnpm clean && pnpm install && pnpm build  # clean rebuild
pnpm typecheck                             # check types without emitting
pnpm lint:fix                              # auto-fix lint errors
```

## Local Postgres (required)

Relational data lives in PostgreSQL only. Set `DATABASE_URL` in `packages/backend/.env` (see `packages/backend/.env.example`).

Example local database:

```bash
docker run --name openwork-postgres \
  -e POSTGRES_USER=openwork \
  -e POSTGRES_PASSWORD=openwork \
  -e POSTGRES_DB=openwork \
  -p 5432:5432 \
  -d postgres:16
```

Typical `packages/backend/.env` entries:

```bash
DATABASE_URL=postgres://openwork:openwork@localhost:5432/openwork
DB_MIGRATIONS_DIR=./drizzle
DB_MIGRATIONS_TABLE=__drizzle_migrations
DB_MIGRATIONS_SCHEMA=drizzle
```

Drizzle commands run from the repo root through the backend workspace:

```bash
pnpm --filter backend db:generate
pnpm --filter backend db:migrate
pnpm --filter backend db:studio
```

### Fresh SQL database (bootstrap)

With `DATABASE_URL` set, `db:bootstrap` applies Drizzle migrations to the target database, then seeds default users, settings, collection, and workspace. You can still run `db:migrate` separately in CI or when you only need the schema.

```bash
DATABASE_URL=postgres://openwork:openwork@localhost:5432/openwork \
  pnpm --filter backend db:bootstrap
```

Seeded local login accounts (passwords are for development only):

| Email | Password |
| --- | --- |
| `admin@workspace.local` | `admin123` |
| `manager@workspace.local` | `manager123` |
| `agent1@workspace.local` | `agent123` |

`DATA_DIR` remains used for backend-owned uploads, skill-library files, and other non-relational paths; runner-owned agent files live on the paired runner and are accessed through runner filesystem APIs.

### Agent execution and concurrency

For schema migrations or restores while the API is running, stop extra backend replicas first and let in-flight agent work finish (or cancel batch runs through the API) so queue rows are not mid-transition. Chat queue and batch drains take per-conversation or per-batch-run row locks in Postgres so two processes cannot claim the same queued item; overlapping work on the same scope still serializes on the database.

Agent execution requires an outbound user runner. Local development does not start a runner automatically; pair and run one separately when normal chat/card/cron agent runs should execute. The hosted backend runs the API, database, queue, storage, pairing, preflight, and runner WebSocket control plane. The user's machine runs the native runner, provider CLIs, workspace cwd, attachment staging, local filesystem browse/pick/reveal, and repository-root validation.

```bash
# User machine, after creating a pairing code in Settings -> Runners
# OPENWORK_RUNNER_WORKSPACE_ROOT is optional; when omitted it defaults to the current directory.
OPENWORK_SERVER_URL=https://your-openwork-host.example \
OPENWORK_RUNNER_PAIRING_CODE=<one-time-code> \
OPENWORK_RUNNER_WORKSPACE_ROOT=/path/to/workspace \
pnpm --filter openwork-runner dev
```

Legacy `AGENT_EXECUTOR_MODE=local` and `AGENT_EXECUTOR_MODE=hybrid` are unsupported in normal runtime. The hosted backend does not spawn agent CLIs locally; if no eligible runner is connected, new run creation reports the runner-unavailable state. The runner pairs once with `/api/agent-runners/pair`, stores its scoped credential in `~/.openwork-runner/config.json`, connects to `/api/runners/ws`, executes concurrent jobs, and streams stdout/stderr back into normal `agent_runs` history. Existing run history remains readable, including older `executor=local` records. Set `MAX_CONCURRENT_AGENTS` to a positive number to add an app-level cap; the default `0` means no app-level limit.

Existing databases must apply migrations after pulling this branch:

```bash
pnpm --filter backend db:migrate
```

The migration adds `agent_runs.executor`, which preserves old local-run history and is required for remote-run cancellation and startup recovery.

### Batch-card live transition gate

Before marking a board-batch card complete, leave the local dev server usable
for the next card. Run the live transition gate against backend
`http://localhost:3847` and frontend `http://localhost:5173`:

```bash
pnpm acceptance:live-transition
```

The card completion comment must include the exact commands run, server URLs,
API checks, UI smoke screenshot/log note when applicable, and any repair actions.
If backend/frontend startup or runtime regresses, fix it inside the current card
before moving the card to Done. See [Live Transition Acceptance](./LIVE_TRANSITION_ACCEPTANCE.md)
for the required comment template.

### Native runner release checklist

Run this checklist before releasing runner-split changes. Keep it scoped to the current native runner.

1. Apply nullable database migrations and verify schema state:
   - `pnpm --filter backend db:migrate`
   - Rollback note: stop new runner dispatch first; restore the prior database backup if a migration/backfill corrupts routing metadata.
2. Backfill and validate legacy chat turns introduced by the chat-turn cutover:
   - `pnpm --filter backend chat-turns:migrate -- --link-references`
   - Expected report: JSON or log output with created/updated turn counts; a second run should be idempotent with no new required work.
   - Rollback note: the backfill is additive; restore from backup only if generated turn records must be removed wholesale.
3. Audit repository-root path-origin migration `0016_repository_root_origin.sql`:
   - `pnpm --filter backend repository-roots:report`
   - `pnpm --filter backend agent-ownership:gate`
   - Expected report shape from the workspace `60b79645-d5f9-4815-9852-511a4d3b3cde`:
     ```json
     {
       "checkedAt": "2026-05-23T00:00:00.000Z",
       "agentsNeedingRepositoryRootRepair": 0,
       "unaccountedActiveAgentsNeedingRepositoryRootRepair": 0,
       "agents": []
     }
     ```
   - Any active row in `agents` must be repaired with `/api/runner-filesystem/validate-repository-root` or linked to an explicit blocked/manual-repair card/comment before hosted runner-local reveal, new job usage, or card handoff.
   - Rollback note: keep existing `repositoryRoot` strings as inert metadata; do not clear them unless a user selects a replacement path.
4. Audit backend-side legacy no-repository agent files before runner-owned file rollout:
   - `pnpm --filter backend no-repository-agent-files:report`
   - `pnpm --filter backend agent-inventory:report`
   - `pnpm --filter backend agent-inventory:backfill`
   - `pnpm --filter backend agent-ownership:gate`
   - Existing backend files are reported as `legacy_importable`; they are not executable source of truth for native runner jobs and must be imported through the explicit runner file action when needed.
5. Validate runner split contracts:
   - `pnpm smoke:runner-split`
   - `pnpm smoke:runner-workspace-contract`
   - `pnpm exec vitest run packages/shared/src/runner-protocol.smoke.test.ts packages/runner/src/executor.smoke.test.ts packages/backend/src/services/agent-runner-protocol.contract.test.ts`
   - `pnpm --filter backend test -- src/services/agent-runners.test.ts`
   - `pnpm smoke:runner-split` includes the chat turn/write-path tests, runner
     filesystem route checks, explicit conversation subfolder prepare, and the
     busy-runner concurrency guard. Its structured `qa-smoke report` output
     must include `cross-machine workspace acceptance` with distinct
     `backendDataRoot` and `runnerRoot` values.
   - `pnpm smoke:runner-workspace-contract` creates separate temporary backend
     `DATA_DIR` and runner workspace roots, covers repository-root and
     no-repository prepared-workspace paths, staged/imported attachments, and a
     negative backend-path leak control. The final JSON line must report
     `"status":"PASS"`.
6. Validate local filesystem separation:
   - `pnpm runner-fs:scan`
   - Fail or review if a hosted runner-local surface calls `/api/storage/browse-fs`, `/api/storage/pick-folder`, `/api/storage/reveal-local`, `/api/agents/:id/files/reveal`, or conversation `reveal-folder` without an explicit same-host local-dev gate. `/api/storage/*` upload/download/content/reveal remains backend-storage, not runner-local filesystem authority.
7. Validate compatibility:
   - Existing native runners on protocol `1.1` may run same-machine jobs without attachment staging, but hosted attachment jobs require the current staging protocol and must fail before enqueue for old runners. Agent-context files are runner/daemon-owned and must be prepared by explicit setup/file actions, not chat enqueue.
   - Old queued job payloads keep their original assumptions or fail with the explicit recovery/staging message; do not rewrite in-flight payload cwd or attachment paths.
   - Legacy repository roots are `unknown` or `backend_local_legacy` until verified by a runner and must be treated as repair-required in hosted mode.
   - Existing attachments remain backend-storage records and are downloaded by the runner through scoped `/api/runner-attachments/download` manifest entries; storage paths are not executable paths.
   - Single-machine development may use localhost and same-host paths only through explicit development compatibility. Production must set `OPENWORK_PUBLIC_API_URL` to a runner-reachable origin.

### Admin HTTP backups (`/api/backups`)

| Action              | Behavior                                                                                                                                                                                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/backups` | Requires a successful `postgres.dump` (pg_dump custom format). The request fails with an explicit error if `pg_dump` is missing, not on `PATH`, or cannot reach `DATABASE_URL`. Also writes per-collection JSON mirrors and a small manifest.                                 |
| `POST .../restore`  | Requires `postgres.dump` in that backup: snapshots the live DB (same pg_dump requirement), runs `pg_restore --clean --if-exists`, then reloads the store. JSON-only directories from `POST /api/backups/import` are retained as archived data and are not applied by restore. |

`GET .../download` returns only collection JSON (manifest and `postgres.dump` are omitted from the bundle).

## Store Contract Tests

Run the store contract against SQL with a throwaway Postgres database:

```bash
STORE_CONTRACT_DATABASE_URL=postgres://openwork:openwork@localhost:5432/openwork pnpm test:store-contract
```

The SQL command connects to the configured server, creates a temporary database,
applies the current Drizzle SQL migration, runs the contract, and drops the
database. SQL preserves the same records after `reload()`, but mapped table row
order is not treated as stable after updates unless callers add an explicit
domain sort.

## Backend Postgres Lifecycle Tests

`pnpm --filter backend test` includes the delete-lifecycle regression suite under
`packages/backend/src/services/postgres-delete-lifecycle.test.ts`. The suite is
skipped unless a real Postgres admin URL is provided, then it creates a temporary
database, applies the current Drizzle SQL migrations, runs the lifecycle checks,
and drops the database.

```bash
LIFECYCLE_DATABASE_URL=postgres://openwork:openwork@localhost:5432/openwork \
  pnpm --filter backend exec vitest run src/services/postgres-delete-lifecycle.test.ts
```

`STORE_CONTRACT_DATABASE_URL` is also accepted for CI jobs that already provide
one throwaway Postgres server URL for SQL integration tests.

# Runner-Split QA Smoke Harness

Run this before merging changes that touch agent chat queueing, runner routing,
runner protocol, or the agent chat sidebar state contract.

```bash
pnpm smoke:runner-split
pnpm smoke:runner-workspace-contract
pnpm acceptance:live-transition
```

The command runs focused Vitest suites and prints a concise pass/fail report,
including the IDs of any test resources created by the backend smoke test.
It does not require a live backend, frontend, runner, or PostgreSQL database.
The backend smoke test uses in-memory service-layer records with `qa-smoke`
resource IDs and does not mutate local application state.

`pnpm acceptance:live-transition` is the mandatory live handoff gate for
board-batch cards. Run it from a clean terminal against the current dev server
before the next card starts. It verifies migrations, `/health`, seeded admin
auth, board fetch, execution-plan fetch, agent-run history read, runner
capability/status reads, runner filesystem/prepare/import routes, frontend
board route loading, and hosted-mode backend-path leak rejection.

`pnpm smoke:runner-workspace-contract` is the final different-root acceptance
harness. It creates a temporary hosted-backend `DATA_DIR` root and a distinct
temporary runner workspace root, then fails if backend absolute paths appear in
runner job cwd, staged/imported attachments, or runner filesystem operations.

## Coverage

- Backend service/API contract: creates a test agent, workspace, agent
  conversation, card, and queued chat prompt through service helpers.
- Cross-machine workspace acceptance: covers repository-root execution,
  no-repository explicit prepare/repair, explicit conversation subfolder
  prepare, chat send/edit durability, attachment metadata, runner-local
  browse/reveal/validate APIs, and structured `qa-smoke report` evidence with
  distinct backend and runner roots.
- Chat turn/write-path regression tests: verifies chat send/edit/failed-turn
  durability stays independent from runner workspace setup failures.
- Native runner scheduling: verifies one eligible connected runner remains
  available while busy and can accept at least two independent jobs.
- Sidebar/chat state contract: verifies component state, route state, queue
  state, CSS-module layout fixtures, and negative controls for the frontend
  agent sidebar/chat contract.
- Runner protocol: validates current job offer and runner lifecycle payloads.
- Non-Codex startup planning: verifies executable discovery and command plans
  for Claude, Qwen, Cursor, and OpenCode without spawning their real CLIs.
- Runner filesystem endpoint scan: fails or reports any hosted runner-local UI
  surface that calls server-local filesystem endpoints without an explicit
  same-host local-development gate.

## Prerequisites

- Node.js 20+
- pnpm 9+
- Dependencies installed with `pnpm install`

## Unsupported Environments

- Environments where shell scripts cannot execute temporary files from the OS
  temp directory.
- Production hosts where development/test dependencies are intentionally absent.

## Temporary Data

The harness uses test-only IDs prefixed with `qa-smoke`. Runner executable
fixtures are created under the OS temp directory and removed after each test.
The workspace-contract harness prints JSON lines with `backendDataRoot`,
`runnerRoot`, `repositoryRoot`, and `noRepositoryWorkspace`; `rootsAreDistinct`
must be `true`, and the final JSON line must be `{"status":"PASS",...}`.

## Batch Handoff Evidence

Every batch-card completion comment must include:

- exact commands run, including migrations, `pnpm typecheck`, focused tests, and
  `pnpm acceptance:live-transition`
- backend/frontend URLs used
- API checks for `/health`, auth, board, execution plans, agent-run history,
  runner capability/status, runner prepare/import, and the negative
  backend-path leak control
- UI smoke screenshot path or log note when applicable
- repair actions taken for any dev-server startup/runtime regression

Do not mark a card done if the current dev server cannot still be used by the
next board task.

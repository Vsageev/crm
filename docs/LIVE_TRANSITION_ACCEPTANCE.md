# Live Transition Acceptance

Run this gate before marking any board-batch card complete when the next card
will use the same local dev server.

```bash
pnpm acceptance:live-transition
```

The suite is intentionally live. It runs backend migrations, checks `/health`,
logs in with the seeded admin account, fetches a board and its execution plans,
checks board batch preview/run-list surfaces, loads the frontend board and
Agents routes, reads agent-run and chat history, reads runner capabilities,
exercises runner filesystem/prepare/import routes, checks an agent
detail/file-authority surface, snapshots backend legacy agent DATA_DIR file
inventory before and after the gate, runs the runner-owned agent migration gate,
and confirms backend-local filesystem gate state. In hosted mode the gate must
reject backend host path access; in
same-host local development it records that the compatibility gate is enabled
and relies on the live executable-agent host-path negative check, invalid
runner-path negative check, and route tests for rejection proof.

Defaults:

- Backend: `http://localhost:3847`
- Frontend: `http://localhost:5173`
- Login: `admin@workspace.local` / `admin123`

Useful overrides:

```bash
OPENWORK_LIVE_ACCEPTANCE_BOARD_ID=<board-id> pnpm acceptance:live-transition
OPENWORK_LIVE_ACCEPTANCE_CARD_ID=<card-id> pnpm acceptance:live-transition
OPENWORK_LIVE_ACCEPTANCE_REQUIRE_RUNNER=true pnpm acceptance:live-transition
OPENWORK_LIVE_ACCEPTANCE_SKIP_MIGRATE=true pnpm acceptance:live-transition
```

When no runner is paired, runner-dependent steps must still return explicit
`runner_unavailable`/repair errors. Set
`OPENWORK_LIVE_ACCEPTANCE_REQUIRE_RUNNER=true` when the card changed actual
runner execution, filesystem proxying, repository prepare, or attachment import
behavior and a positive paired-runner proof is required.

## Mandatory Card Comment Evidence

Every completed batch card must include this evidence in its card comment:

```md
Live transition evidence:
- Commands run:
  - pnpm --filter backend db:migrate
  - pnpm --filter backend db:migrate
  - pnpm --filter backend repository-roots:report
  - pnpm --filter backend agent-inventory:report
  - pnpm --filter backend agent-ownership:gate
  - pnpm typecheck
  - <narrow backend/runner/frontend tests touched by this card>
  - pnpm acceptance:live-transition
- Server URLs:
  - Backend: http://localhost:3847
  - Frontend: http://localhost:5173
- API checks:
  - GET /health => <status/body>
  - POST /api/auth/login as seeded admin => <status>
  - GET /api/boards/<boardId> => <status>
  - GET /api/boards/<boardId>/execution-plans => <status>
  - GET /api/boards/<boardId>/batch-run/preview and /batch-runs => <status>
  - GET /api/agent-runs?limit=1 => <status>
  - GET /api/agent-chat/recent and one agent conversation/view surface => <status>
  - GET /api/agents/<agentId> and /files/status => <status/ownership>
  - GET /api/agents?limit=100 => <status/all executableOwnership states>
  - GET /api/agent-runners and /api/runner-filesystem/status => <status>
  - Runner prepare/import endpoint checked: <endpoint/status>
  - Negative hosted-mode/backend-path leak check: <endpoint/status/code>
  - Backend legacy DATA_DIR agent inventory before/after => <unchanged summary>
- UI smoke:
  - Board page URL loaded: http://localhost:5173/boards/<boardId>
  - Agents page URL loaded: http://localhost:5173/agents
  - Screenshot/log note: <path or brief note>
- Repair actions:
  - <none, or exact dev-server/runtime/ownership repair actions fixed before completion>
```

Do not mark a card done while the backend or frontend dev server is broken.
Downstream agents must fix startup or runtime regressions inside the current
card before handing off to the next board task.

For runner ownership migration cards, the API rejects moving the card into a
Done/Completed column until a card comment contains this evidence. If
`repository-roots:report` or `agent-inventory:report` still has active-agent
gaps, the comment or linked repair card must mention the affected agent id
and an explicit blocked/manual-repair marker so `pnpm --filter backend
agent-ownership:gate` can account for it.

## Ownership Symptom Map

| Symptom before handoff | Failing guard/test |
| --- | --- |
| Backend writes or changes `DATA_DIR/agents/*` while validating runner work | `pnpm acceptance:live-transition` → `backend legacy agent DATA_DIR unchanged` |
| Agent files appear readable/writable through backend-host paths in hosted mode | `pnpm acceptance:live-transition` → `negative executable agent host path route control`; `pnpm --filter backend test -- src/routes/agents.delete.test.ts src/routes/storage.reveal-local.test.ts` |
| A connected runner can accept jobs without runner-owned inventory | `pnpm --filter backend test -- src/services/agent-runners.test.ts`; live gate `runner capability read` |
| Board handoff cannot load execution plans or batch controls | `pnpm acceptance:live-transition` → `execution-plan fetch` and `board batch surfaces usable`; `pnpm exec vitest run packages/frontend/src/pages/boards/BoardBatchRunPanel.test.tsx packages/frontend/src/pages/boards/BoardExecutionPlansPanel.test.tsx` |
| Historical agent runs or chat turns disappear when no runner is online | `pnpm acceptance:live-transition` → `agent history read` and `chat history surface read`; `pnpm --filter backend test -- src/routes/agent-chat-view.contract.test.ts` |
| Repository/no-repository runner workspace repair regresses | `pnpm --filter backend test -- src/routes/runner-filesystem.test.ts src/services/agent-chat.enqueue.test.ts`; `pnpm exec vitest run packages/runner/src/executor.smoke.test.ts` |
| Attachments resolve to backend storage paths as executable inputs | `pnpm --filter backend test -- src/services/agent-chat.attachments.test.ts src/routes/storage.runner-attachments.test.ts`; `pnpm exec vitest run packages/runner/src/executor.smoke.test.ts` |
| Active agents retain legacy/unknown executable ownership without repair state or evidence | `pnpm --filter backend agent-ownership:gate`; live gate `runner-owned agent migration gate` |

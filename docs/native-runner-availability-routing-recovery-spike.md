# Native Runner Availability, Routing, And Recovery Spike

This handoff freezes the current native-runner scheduling contract before
availability hardening. It is a behavior baseline, not a capacity-design target.
Do not change production scheduling/routing/recovery behavior while consuming
this contract unless the dependent card explicitly says so.

## Named Invariants

- **NRI-001 Busy Is Eligible**: a connected, non-stale runner that matches user,
  workspace, and provider remains eligible even when `activeJobIds.size > 0`.
  Busy is a live-status label only; it is not an availability filter.
- **NRI-002 Independent Jobs May Share One Runner**: one eligible native runner
  may receive multiple independent `job_offer` messages. Do not add runner
  capacity controls, global serialization, or single-job-per-runner locks.
- **NRI-003 Least-Loaded Tie Break**: when multiple runners are eligible, the
  backend prefers the lowest `activeJobIds.size`, then the most recent
  `lastSeenAt`. This is balancing, not admission control.
- **NRI-004 Scoped Eligibility**: eligibility filters are WebSocket open state,
  not stale, user match, workspace match or `*`, and provider support.
- **NRI-005 Shared Preflight**: all enqueue/start paths must preflight the same
  agent-to-runner scope before creating durable queue/run work: supported
  provider, exactly one workspace routing scope, and at least one eligible
  connected runner. The preflight must not inspect or cap runner active-job
  count.
- **NRI-006 Durable Work Before Dispatch**: chat creates an `agent_runs` row and
  log files before `dispatchRemoteAgentJob`; batch items become `processing`
  before their card task creates an agent run; queue rows remain the durable
  source for retry/recovery.
- **NRI-007 Recovery Is Explicit**: stale runners are excluded from new offers;
  disconnect does not fail in-flight jobs until reconnect grace expires; backend
  restart can persist unknown/recovered runner output and terminal messages by
  `runId`; cancellation only sends a runner `cancel` when this backend process
  still maps `runId -> jobId -> runnerId`.
- **NRI-008 Sticky Process Constraint**: in-memory runner sockets, pending jobs,
  and reconnect grace timers are process-local. Current deployments require
  sticky runner WebSockets or a single backend instance for reliable cancel and
  grace behavior.

## Current Behavior By Path

Chat enqueue (`enqueueAgentPrompt`) preflights the agent runner workspace,
provider, connected runner, and provider support before creating a chat queue
item. Chat drain serializes only conflicting work in the same conversation or
target message branch. It does not serialize all work on a runner.

Direct chat execution (`runAgentProcess`) repeats the runner preflight just
before creating the agent run. It then creates a remote `agent_runs` row,
allocates logs and a project port, marks the run `running`, and dispatches a
native `job_offer`.

Agent cron (`executeCronTask`) reuses the same run/start path as non-chat agent
work. Board cron only creates cards and does not dispatch native runner jobs.

Board batch and collection batch both call `enqueueAgentBatchRun`. Batch run
creation records queued batch items, then `drainBatchRun` starts ready items up
to `maxParallel`. `maxParallel` is batch-item parallelism only; it is not runner
capacity. Each processing item calls the card execution path and therefore uses
the same remote-runner dispatch contract.

Cancellation marks durable run state through `killAgentRun`. A runner `cancel`
message is sent only when the current backend process has the in-memory remote
job mapping. Batch cancellation cancels queued items immediately and calls
`killAgentRun` for processing items with an `agentRunId`.

Stale runner handling excludes stale sockets from new offers and availability
checks. Runner status is `online`, `busy`, or `stale`; only `stale` is
unavailable.

Backend restart recovery is mixed. Chat and batch queue initialization inspect
durable queued/processing rows and retry/fail based on run state. Runner
protocol handling also accepts output or terminal messages for unknown in-memory
jobs and appends/completes by `runId`. In-memory timeouts, pending promises, and
cancel mappings are not durable.

Reconnect grace is keyed by runner id. On socket close, jobs for that runner are
failed only after `REMOTE_AGENT_RUNNER_RECONNECT_GRACE_MS`, unless the same
runner id reconnects first. Reconnect reattaches in-flight job ids known to this
process.

## Shared Preflight Shape

Implementation cards should introduce one shared helper with this exact shape:

```ts
type NativeRunnerPreflight = {
  agentId: string;
  userId: string;
  workspaceId: string;
  provider: RunnerProvider;
  eligible: true;
};
```

The helper must:

- load the agent and reject archived/missing agents through existing path errors;
- infer the runner provider from the agent model and reject unsupported models;
- resolve the agent group to exactly one workspace routing scope;
- fail ambiguous or missing group-to-workspace routing before enqueue;
- require at least one connected, non-stale runner matching user, workspace or
  `*`, and provider;
- return the same unavailable messages currently produced by
  `getRemoteAgentRunnerUnavailableMessage`;
- avoid active-job-count checks, runner capacity fields, and single-runner locks.

## Ambiguous Routing And Multi-Instance Decisions

Ambiguous group-to-workspace routing should fail preflight with
`agent_runner_workspace_ambiguous` once the shared helper exists. The current
code mostly resolves through workspace group membership and default workspace
fallbacks; the implementation must not silently choose between multiple
workspaces that contain the same group.

Multi-instance deployments remain documented as constrained. Runner WebSockets,
pending jobs, reconnect grace, and run cancellation are process-local. Until a
durable runner-job table or cross-instance message bus exists, deployments must
use one backend instance for runner traffic or sticky WebSocket routing for each
runner id. Do not add multi-runtime scheduling in the availability-hardening
slice.

## Allowed State Transitions

Chat queue item: `queued -> processing -> completed | failed | stopped`;
`queued -> superseded`; `processing -> queued` only through retry/recovery.

Batch run: `queued -> running -> completed | failed | cancelled`; active stats
are refreshed from item states.

Batch item: `queued -> processing -> completed | failed | cancelled | skipped`;
`processing -> queued` only through retry/recovery.

Agent run: `queued -> running -> completed | failed | killed`; recovered
terminal runner messages may complete a run even when in-memory job state is
gone.

Runner live status: `online <-> busy`; `online|busy -> stale`; socket close
removes the runner from the connected map and starts reconnect grace.

## Migration And Backfill Requirements

Availability hardening should add durable fields only with migrations/backfills:

- `agent_runs.runnerJobId`, `agent_runs.runnerId`, `agent_runs.runnerWorkspaceId`
  if cancellation/recovery must survive backend restarts or cross-instance
  routing;
- batch item `agentRunId` already exists and must be backfilled only if older
  rows can omit it;
- queue/run fields storing provider, resolved workspace id, or runner protocol
  version need nullable rollout plus backfill from existing agent/run metadata;
- runner state/capability fields must preserve existing protocol `1.1` rows and
  older paired runners without advertised workspace root.

## Regression Guard

The concurrency guard is:

```bash
pnpm --filter backend test -- src/services/agent-runners.test.ts
```

The focused test is `native runner availability invariant > keeps a busy
eligible runner available for independent jobs`. It dispatches two independent
jobs to one matching runner before either completes and asserts two `job_offer`
messages plus two active job ids. Any implementation that treats `busy` as
unavailable or adds a single-job-per-runner lock should fail this test.

Additional contract checks for later implementation cards:

```bash
pnpm smoke:runner-split
pnpm smoke:runner-workspace-contract
pnpm exec vitest run packages/shared/src/runner-protocol.smoke.test.ts packages/runner/src/executor.smoke.test.ts packages/backend/src/services/agent-runner-protocol.contract.test.ts
```

# Native Runner Boundary Baseline

This baseline freezes the current native runner host-boundary contract before
runner path, environment, staging, routing, or recovery changes. It supplements
the broader [Runner Separation Contract](./runner-separation-contract.md).

## Ownership

Backend-owned state:

- `DATA_DIR` agent records, uploads, attachment bytes, and persisted metadata.
- `repositoryRoot` and `workspacePath` values on agent records as metadata.
- Conversation workspace mode, queue/run records, and workspace API keys.

Runner-owned state:

- Executable cwd from `RunnerJobIntent.workspace.path`.
- Provider CLIs, provider credentials, process environment, `PATH`, stdout,
  stderr, final-message files, and temporary runner files.
- `PROJECTS_DIR`, `PROJECT_PORT`, and staged/generated project outputs.

Known current gaps to preserve as baseline, not endorse as target behavior:

- The current job intent still carries `workspace.type: "local_path"` and an
  absolute path that must exist on the selected runner.
- Attachment job entries currently include local `path` values; cross-host
  materialization through runner/daemon-owned storage is still future work.
- Backend-local and runner-local paths can be identical only in explicit local
  development where backend and runner run on the same machine.

## Environment Semantics

Native jobs pass env only through `RunnerJobIntent.environment.variables` plus
runner process env inherited by `createExecutionPlan`.

Locked variables:

- `WORKSPACE_API_URL`: backend-selected API origin for provider workspace calls.
  It should come from `OPENWORK_PUBLIC_API_URL`; local development may fall
  back to `HOST`/`PORT` when reachable by the paired runner.
- `WORKSPACE_API_KEY`: scoped agent service key; secret.
- `PROJECTS_DIR`: runner-local output directory.
- `PROJECT_PORT`: runner-local port allocation.
- `PWD`: set by the runner to the normalized executable cwd.
- `OPENWORK_SERVER_URL`: runner process setting used for pairing and WebSocket
  connection, not forwarded as a job variable by the backend.
- `OPENWORK_RUNNER_WORKSPACE_ROOT`: runner process setting advertised as
  `capabilities.workspaceRoot` and enforced by runner policy.
- Provider CLI env and credentials remain runner-local unless explicitly sent as
  agent env vars; sent secrets must stay job-scoped.

Compatibility aliases and fallbacks that must remain during rollout:

- Runner config path defaults to `~/.openwork-runner/config.json`; the explicit
  override is `OPENWORK_RUNNER_CONFIG`.
- Runner identity can come from `OPENWORK_RUNNER_ID` or stored config.
- Pairing uses `OPENWORK_RUNNER_PAIRING_CODE`.
- Backend local URL fallback from `HOST`/`PORT` remains for local paired runner
  development when `OPENWORK_PUBLIC_API_URL` is unset.
- Existing `AGENT_EXECUTOR_MODE=local|hybrid` history remains readable, but new
  runtime dispatch must not silently spawn backend-local CLIs.

## Current Job Intent Shape

The native job offer is `ServerRunnerMessage.type === "job_offer"` with
`protocolVersion: "1.1"`, a backend-generated `jobId`, and `job` shaped as
`RunnerJobIntent`:

- `runId`, `agentId`;
- `provider`, `modelPreference`, prompt/messages;
- `workspace: { type: "local_path", path, workspaceId }`;
- optional `attachments[]` with filename, MIME type, size, local path,
  extraction metadata, and manifest metadata;
- `allowedOperations` with tools, approval, env, secrets, network, and shell;
- optional `environment.variables[]` with name/value/source/secret.

Ordinary `job_offer` execution payloads do not carry
`workspace.materialization`. Runner-local workspace file creation, agent context
sync, and conversation subfolder setup are reserved for the named
`workspace_setup` protocol operation and must happen before execution dispatch.
Chat create/send/edit, retry, and queue drain only reference the already
prepared cwd.

The locked fixture lives in
`packages/shared/src/runner-protocol.smoke.test.ts`.

## Failure Baseline

Expected actionable messages:

| Case | Current expected message |
| --- | --- |
| Missing runner | `No remote agent runner is connected.` |
| Missing public URL for remote hosts | Documented smoke failure: `WORKSPACE_API_URL must be runner-reachable; set OPENWORK_PUBLIC_API_URL or use a reachable HOST/PORT for local development.` |
| Missing workspace path | `Workspace path does not exist: <path>` |
| Relative workspace path | `Workspace path must be absolute: <path>` |
| Missing attachment/context materialization | Documented smoke failure: `Attachment/context file is not materialized on the runner: <path>` |
| Incompatible runner protocol | Runner rejects with `Unsupported runner protocol <version>; expected 1.1`; backend closes mismatched hello with `Runner protocol version mismatch`. |

Missing public URL and attachment materialization are documented-only baseline
cases because the current code does not yet preflight those conditions in one
shared place. Later implementation cards should convert them to automated
contract tests before changing behavior.

## Regression Commands

Automated baseline:

```bash
pnpm smoke:runner-split
```

Workspace path diagnostic for the current native-runner compatibility gap:

```bash
pnpm smoke:runner-workspace-contract
```

This command is the different-root acceptance harness for the current native
runner. It creates a temporary hosted-backend `DATA_DIR` root and a distinct
temporary runner workspace root, then prints one JSON line per case:

- `missing-runner-root`: repository-backed jobs can run without
  `capabilities.workspaceRoot` when the cwd is an absolute verified runner-local
  path. `OPENWORK_RUNNER_WORKSPACE_ROOT` remains required only for
  OpenWork-managed no-repository workspace creation and persistent imports.
- `relative-agents-cwd`: backend-ish relative cwd such as `agents/<id>` must not
  become executable runner cwd.
- `missing-absolute-cwd`: missing absolute runner-local workspace paths must be
  rejected before provider spawn.
- `outside-root-cwd`: verified repository paths outside the advertised runner
  root must still be accepted when they are absolute and accessible on the
  runner machine.
- `repository-root-runner-cwd`: repository-root agents execute from the verified
  runner-local repository root without backend `DATA_DIR` leakage.
- `no-repository-prepared-workspace`: no-repository workspaces are explicitly
  prepared under the runner root and runner-local file browse/reveal operations
  stay there.
- `attachment-staging-and-import`: chat attachments are staged into runner-owned
  per-run storage, while explicit imports write under the runner workspace root.
- `backend-path-leak-negative-control`: intentionally verifies the harness fails
  when backend absolute paths appear in runner-bound job data.

The final JSON line must report `"status":"PASS"` and `rootsAreDistinct` must be
`true` in the root summary line.

Focused contract checks:

```bash
pnpm exec vitest run packages/shared/src/runner-protocol.smoke.test.ts packages/runner/src/executor.smoke.test.ts packages/backend/src/services/agent-runner-protocol.contract.test.ts
```

Live local runner smoke, when a paired runner and local backend are available:

```bash
OPENWORK_SERVER_URL=http://localhost:3000 \
OPENWORK_RUNNER_WORKSPACE_ROOT=/path/to/local/workspace \
pnpm --filter openwork-runner dev
```

Then send a normal agent message/card run and confirm:

- the run receives a remote `job_offer`;
- `WORKSPACE_API_URL`, `WORKSPACE_API_KEY`, and `PWD` are present in the job
  env;
- `PROJECTS_DIR` and `PROJECT_PORT` are either runner-local values supplied by
  the runner/provider path or intentionally absent from hosted backend dispatch;
- cwd equals the runner-local workspace path;
- an outside-root workspace fails before provider spawn with the message above.

## Migration Notes For Later Runner-Fix Cards

Later cards may need migrations or backfills for:

- existing agents with backend-host `repositoryRoot` or `workspacePath` values;
- no-repository legacy agents whose `workspacePath` falls back to
  `DATA_DIR/agents/<agentId>`;
- conversations whose `metadata.workspaceMode` is absent, malformed, or whose
  `workspaceRelativePath` is not safely below the execution root;
- cron, card, board-batch, and collection-batch runs that currently reuse the
  same backend-derived agent execution root without conversation metadata;
- queued or processing native runs whose job payloads contain backend-local
  paths;
- attachment records whose manifests only identify backend storage paths;
- runner capability/protocol records if protocol `1.1` evolves.

Minimum non-breaking current native-runner workspace contract:

- Server-owned: agent records, `repositoryRoot`/`workspacePath` metadata,
  conversation workspace metadata, workspace/routing ownership, scoped
  workspace API keys, queue/run records, and backend upload/storage metadata.
- Runner-owned: executable cwd, `OPENWORK_RUNNER_WORKSPACE_ROOT`,
  `capabilities.workspaceRoot`, provider CLI environment, provider credentials,
  optional runner-local `PROJECTS_DIR`/`PROJECT_PORT`, final-message/temp files, and validation that
  the final cwd exists on the runner and stays below the advertised root when a
  root is advertised.
- Preflight before enqueue: resolve the agent to exactly one workspace and a
  connected eligible runner; reject clearly when no runner is connected; when a
  runner root is advertised, reject obviously relative, backend-owned, missing,
  or outside-root workspace values before `job_offer`; preserve local backend +
  local runner as the baseline.
- Runner materialization: ordinary execution receives
  `workspace: { type: "local_path", path }` and no agent-context materialization
  payload. Repo/no-repo/conversation cwd and agent context files must be
  prepared runner-side or via daemon by explicit setup/sync/repair before
  provider spawn, then execution keeps `PWD` equal to that runner-local cwd.
- Compatibility: do not make `OPENWORK_RUNNER_WORKSPACE_ROOT` newly mandatory in
  one step. Existing paired runners without an advertised root need a clear
  compatibility branch: either allow only explicit local-development same-host
  paths with diagnostics, or fail preflight with setup guidance before enqueue.

Current `job.workspace.path` sources to preserve while migrating:

- Repository-root agents: `repositoryRoot` is the execution root for shared
  chats and non-chat triggers; `workspacePath` remains the agent context root
  at `<repositoryRoot>/.openwork/agents/<agent-slug>/`.
- No-repository agents: `workspacePath` falls back to
  `DATA_DIR/agents/<agentId>` and is backend-local unless the runner is local on
  the same machine.
- Separate-folder-per-chat conversations: `conversation.metadata.workspaceMode`
  of `subfolder` resolves to `conversations/<conversationId>` below the
  repository execution root; missing metadata defaults to shared mode unless
  the agent toggle materializes legacy metadata.
- Cron, card, board-batch, and collection-batch runs: currently reuse the
  agent execution root and do not have per-conversation workspace metadata.
- Local development: backend and runner may share the same filesystem; this is
  the only supported case where backend-local absolute paths can also be valid
  runner-local absolute paths.

Compatibility expectations:

- Old backend + new runner: new runner must continue accepting protocol `1.1`
  job offers or reject with a clear protocol message.
- New backend + old runner: backend must avoid sending new required fields until
  protocol negotiation proves support.
- Existing queued/processing native runs: either finish under their original
  protocol/path assumptions or fail with an explicit recovery message.
- Existing agents: legacy `repositoryRoot`/`workspacePath` values must be
  treated as metadata until runner/daemon validation remaps or confirms them.

Execution-plan guardrail: every implementation runner-fix card must depend on
this baseline card before it is run.

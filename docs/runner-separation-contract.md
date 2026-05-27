# Runner Separation Contract

This contract defines the boundary between the hosted OpenWork backend and
user-machine execution. It is the target architecture for runner-split work:
hosted backend code must not depend on paths, CLIs, filesystem browsers, or
loopback URLs that exist only on the backend host.

## Actors

- **Backend**: the hosted OpenWork API, queue, database, object storage, and
  runner dispatch control plane.
- **Runner**: the user-machine worker that accepts runner jobs, spawns provider
  CLIs, streams output, and enforces job policy.
- **Daemon**: the user-machine OS integration layer. It may be packaged with the
  runner, but it has a separate contract: local filesystem browsing, reveal,
  path selection, workspace materialization, and file sync.

The backend may route work and persist records. The runner and daemon are the
only components that may assume a user-machine path is valid.

For local filesystem UX details, see
[Runner Local Filesystem UX/API Contract](./runner-local-filesystem-ux-api-contract.md).

## State Ownership

| State | Backend-owned | Runner-owned | Daemon-owned |
| --- | --- | --- | --- |
| Users, workspaces, collections, cards, conversations, messages, turns, queue rows, run records, audit logs | Canonical in Postgres. | Read only through job payloads or workspace API credentials. | No canonical ownership. |
| Runner device records, pairing codes, credential hashes, status, capabilities | Canonical records and revocation. | Local credential material in `OPENWORK_RUNNER_CONFIG` or equivalent. | May expose pairing UX, but does not own credentials beyond local storage. |
| Agent records, model/provider selection, workspace routing scope, permissions | Canonical metadata. | Receives resolved job intent and allowed operations. | May help select or validate local paths. |
| Agent env vars and workspace API keys | Encrypted canonical values and scoped release decision. | Ephemeral per-job environment only. | No persistence except secure local credential storage if explicitly required. |
| Repository working tree | Metadata binding only; backend must not mutate by host path. | Executes inside a runner-local checkout or mounted workspace. | Selects, validates, reveals, and can sync/materialize the local checkout. |
| Per-chat workspace directories | Conversation metadata only: mode and relative path. Chat send/edit must not create files. | Uses runner-local cwd for job execution. | Creates/materializes `conversations/<conversationId>/` and shared context links/files through explicit setup/file actions. |
| Uploaded attachments | Canonical upload metadata and bytes under backend storage. | Uses runner-local materialized files for the job. | Downloads/syncs attachments into a runner-local cache and resolves local paths. |
| Agent files (`AGENTS.md`, skills, docs, memory, presets) | Canonical metadata and optional synced content/revisions. It may request explicit file changes, but not as a side effect of chat enqueue. | Consumes files from the local agent context for execution. | Owns local materialization under the workspace and path-safe edits/reveals. |
| Provider CLIs, provider credentials, shell PATH | No ownership and no backend-host probing for execution eligibility. | Owns installed CLIs, CLI config, process supervision, stdout/stderr state, and capability advertisement. | May provide setup/status UI, but runner reports executable capability. |
| Local filesystem browse/reveal | Only proxies authenticated requests to a paired user-machine daemon, or rejects when unavailable. | No broad browse/reveal authority during jobs unless explicitly granted. | Owns OS picker, browse, reveal, and local path references. |

## Path And Workspace Semantics

All paths in runner jobs are runner-local paths. Backend-local paths such as
`DATA_DIR`, backend upload directories, or `/tmp` on the server must never be
sent as executable job paths unless the backend and runner are the same machine
in an explicitly marked development mode.

### Repository Roots

- A repository root is stored as a workspace binding, not as proof that the path
  exists on the backend host.
- Repository roots carry path-origin metadata. `runner_local` means a paired
  runner/daemon validated the path; `unknown` and `backend_local_legacy` are
  inert in hosted mode until repaired.
- For the current protocol shape, `RunnerJobIntent.workspace.path` is
  `type: "local_path"` and must already be valid on the selected runner.
- Hosted deployments should resolve repository roots through the paired
  daemon/runner. If a root is missing, inaccessible, or not synced, the job must
  fail before provider CLI spawn with an actionable runner workspace error.
- `capabilities.workspaceRoot` is the default base for OpenWork-managed
  no-repository workspaces, persistent attachment imports, and generated agent
  file areas. It is not a jail for user-selected repository roots; a runner may
  validate and execute any absolute repository path its OS user can access.
- The repository-root repair report is:

  ```bash
  pnpm --filter backend repository-roots:report
  ```

  Expected clean output shape, as audited for workspace
  `60b79645-d5f9-4815-9852-511a4d3b3cde`:

  ```json
  {
    "checkedAt": "2026-05-23T00:00:00.000Z",
    "agentsNeedingRepositoryRootRepair": 0,
    "agents": []
  }
  ```

  Non-empty `agents` entries must be validated through
  `/api/runner-filesystem/validate-repository-root` before hosted job dispatch
  or runner-local reveal actions use that path.

### Per-Chat Workspaces

Conversation workspace mode is backend metadata:

- `shared`: run in the repository execution root.
- `subfolder`: run in `conversations/<conversationId>/` below the repository
  execution root.

The daemon prepares subfolder workspaces on the user machine through an
explicit setup, repair, reveal, or file operation. Ordinary conversation
creation, chat send, edit, retry, and queue drain only consume the current
runner-local state and must not implicitly create or rewrite workspace files.
Normal `job_offer` payloads must not include `workspace.materialization`.

The current explicit prepare flow uses runner filesystem requests:

- `POST /api/runner-filesystem/prepare-agent-workspace` prepares a
  no-repository agent's base workspace and any existing subfolder conversations
  for that agent.
- `POST /api/runner-filesystem/prepare-conversation-workspace` prepares one
  `conversations/<conversationId>/` directory for either a repository-backed or
  no-repository agent before reveal or execution.
- The runner validates no-repository workspace paths under
  `OPENWORK_RUNNER_WORKSPACE_ROOT` and creates the directory if it is missing.
  Repository-backed conversation subfolders are derived under the validated
  repository root and may be outside `OPENWORK_RUNNER_WORKSPACE_ROOT`.
- The backend derives the default relative path as
  `conversations/<conversationId>` and clamps stale or malformed metadata back
  to that path.

Instruction/context file sync remains a separate explicit file/setup action.
Preparing a conversation subfolder must not copy backend `DATA_DIR` files or
rewrite agent context as a side effect.

### Attachments

Attachment records remain backend-owned. A runner job must receive
runner-local materialized files, not backend storage paths.

Required sync flow:

1. Backend stores attachment metadata and bytes under a stable `storagePath`.
2. Job payload includes logical attachment metadata: filename, MIME type, size,
   type, backend storage identifier, and optional text-extraction metadata.
3. Runner or daemon downloads the attachment through the public API with scoped
   authorization into a runner-owned cache.
4. Runner passes the cache path to provider CLIs and includes the logical
   manifest in the prompt for providers without native file arguments.

Current code still builds attachment paths from backend `DATA_DIR`. That is a
known gap for hosted deployments and must be removed before remote runner jobs
can rely on attachments across hosts.

### Attachment Staging Handoff

This is the chosen contract for current native-runner attachment staging.
Agent-context files are intentionally excluded from ordinary chat-job staging:
they are runner/daemon-owned workspace files and are changed only through
explicit setup, sync, repair, or file-interface actions.

Inventory and transfer mechanism:

| Item | Current source passed toward jobs | Final transfer mechanism |
| --- | --- | --- |
| Chat uploads | Message attachment metadata with `storagePath`; current backend code resolves it under `DATA_DIR/storage` before building `RunnerAttachment.path`. | Backend sends logical metadata plus an authenticated API download reference in a staged manifest. Runner downloads bytes into a runner-owned staging directory and rewrites `RunnerAttachment.path` and `textExtraction.textPath` to runner-local files before provider spawn. |
| Card files | Card attachments use the same storage metadata and `/api/storage/download` surface as uploads; card-agent prompts currently do not have a separate native file path contract. | Same staged manifest/download flow when a card file is included in a job. Do not special-case card storage as runner-readable disk. |
| Agent memory, skills, `AGENTS.md`, and docs | Backend-owned metadata or synced content/revisions; conversation/chat execution must not use backend host paths as workspace authority. | Do not bundle these as a side effect of chat enqueue or run dispatch. Use explicit runner/daemon file setup, sync, repair, or file-interface operations to create or update runner-local agent context before execution. |
| Generated context and prompt-only metadata | Prompt text assembled by backend, plus logical trigger/card/conversation context. | Keep prompt text inline. Any generated file needed by a provider must be emitted as a manifest item and materialized runner-local before spawn. |
| Text extraction sidecars | Current `textExtraction.textPath` may equal a backend attachment disk path. | If extracted text is needed, either materialize the source file and set `textPath` to that runner-local file for text-like files, or include a separate text sidecar manifest item with its own size/hash. |
| Run logs and artifacts | Backend writes stdout/stderr under `DATA_DIR/agent-runs`; runner may emit `artifact.path` over WebSocket. | Stdout/stderr remain streamed to backend run history. Runner artifact paths are not authority; backend may request artifact upload through the runner protocol/API, then persist backend-owned storage metadata. |
| Backend storage absolute paths | `DATA_DIR/storage/...`, `DATA_DIR/agents/...`, or server `/tmp` paths can appear in current local-only fixtures. | Unsupported as a final contract. They are valid only in explicitly marked same-machine development compatibility mode and must fail pre-enqueue or runner preflight in hosted mode. |

Manifest requirements:

- Every staged item has an opaque `id`, `kind`, display `filename`, MIME type,
  byte size, SHA-256 hash when available, storage identifier or context revision,
  and a relative destination under the runner staging root.
- Backend download references use existing authenticated APIs or scoped signed
  URLs. Do not expose filesystem paths as download authority.
- The runner must reject destinations that escape the staging/workspace root
  after path normalization.
- Size limits are enforced before enqueue: use existing upload limits for
  individual files and cap total staged bytes per job. Agent-context size and
  shape limits belong to the explicit file/setup operation that changes those
  runner-local files, not ordinary chat enqueue.
- Staging cleanup is runner-owned. Remove per-job staged files on terminal
  state after a short retry/debug TTL; allow cached immutable attachment/context
  blobs by hash, but never require cache hits for correctness.

Auth and failure behavior:

- Downloads require the selected runner credential or a job-scoped token scoped
  to the exact manifest item IDs. Workspace API keys are not attachment download
  authority unless explicitly scoped that way by the implementation card.
- If attachment staging is unavailable, no native attachment job should be
  offered to a runner. The
  enqueue path should fail the turn/card/batch item with an actionable message:
  `Attachment/context staging is unavailable for native runner jobs.`
- Missing, expired, oversized, hash-mismatched, or unauthorized staged
  attachments fail before provider spawn with an attachment materialization
  error. Missing runner workspace or agent context files are runner readiness
  failures, not reasons for backend chat mutation paths to rewrite files.
- Old protocol `1.1` runners continue to see the existing `attachments[].path`
  shape only in same-machine compatibility mode. Hosted/cross-host jobs must not
  be dispatched to old runners for attachment/context jobs; they fail before
  enqueue with a protocol/capability message.

Explicit attachment persistence uses the runner filesystem authority, not chat
enqueue. `POST /api/runner-filesystem/import-attachment` creates a scoped
download reference for an existing backend storage attachment and asks the
selected runner to write it under the runner workspace root. The runner rejects
missing credentials, hash/size mismatches, symlink targets, and destinations
outside the advertised workspace root. Per-run staging cleanup deletes only the
runner job directory and must not target files created through this explicit
import path.

Migration and backfill:

- No stored upload/download records need rewriting. Existing `storagePath`
  values remain canonical backend storage identifiers.
- Additive metadata may be added for attachment hashes/text-extraction state.
  Agent-context revisions, when needed, are part of explicit file/setup sync,
  not chat enqueue.
- Existing queued/processing native runs keep their original payload assumptions
  or fail with the explicit recovery message above; do not mutate old runner job
  payloads in place.

### Agent Files

Agent files are the instruction/context files under the agent workspace, for
example `AGENTS.md`, skills, docs, memory, and preset-generated files.

- Repo-backed agents use `<repositoryRoot>/.openwork/agents/<agent-slug>/`.
- Legacy agents without a repository root use the agent workspace root.
- Backend APIs may expose logical file operations, but hosted backends must not
  perform those operations against their own filesystem for user-machine
  workspaces.
- Daemon-backed file operations must validate paths against the selected agent
  workspace root, preserve traversal protections, and report symlink/reference
  targets without granting broader browse authority.

## Public API, Callback, And Environment Contract

### Public API URL

Jobs running away from the backend host must use a public, runner-reachable API
origin.

- `OPENWORK_SERVER_URL` is required for the runner and points at the externally
  reachable OpenWork backend, for example `https://openwork.example.com`.
- Runner pairing uses `POST {OPENWORK_SERVER_URL}/api/agent-runners/pair`.
- Runner job transport uses `wss://.../api/runners/ws` derived from the same
  origin.
- Agent workspace API calls from provider CLIs must use `WORKSPACE_API_URL` set
  to the same public origin, not `localhost` or the backend bind address.

Backend jobs prefer `OPENWORK_PUBLIC_API_URL` for `WORKSPACE_API_URL`. If it is
unset, local development falls back to `HOST`/`PORT`; that fallback is valid only
when the runner can reach the backend bind address.

### Runner Callback Transport

The callback channel is the runner WebSocket. The backend does not expose a
separate unauthenticated callback URL.

Server to runner:

- `server_hello`
- `job_offer`
- `workspace_setup` for explicit setup, sync, or repair only; this operation
  may carry agent context and conversation workspace materialization data and is
  not part of ordinary chat/card/cron execution dispatch
- `cancel`

Runner to server:

- `runner_hello` with protocol version, runner identity, capabilities, and
  policy. Protocol `1.2` capabilities are explicit for the current native
  OpenWork runtime: `supportedProviders`,
  `supportedTools`, `supportedWorkspaceModes`, `daemonEndpoints`, and
  `concurrency.maxJobs`;
- `job_accepted` or `job_rejected`;
- `output_event` for stdout/stderr streaming;
- `final_message` when a provider can surface a final response separately;
- `artifact` for declared job artifacts;
- exactly one terminal state: `completed`, `failed`, or `cancelled`;
- `protocol_error` for malformed or unsupported messages.

The backend persists run state and logs from this transport. Runners may keep
local child processes alive across a WebSocket reconnect, then re-announce
accepted jobs so the backend can reattach during the reconnect grace period.

### Job Environment

The backend sends only job-scoped environment entries in
`RunnerJobIntent.environment.variables`.

Backend-supplied variables:

- `WORKSPACE_API_URL`: public OpenWork API origin reachable from the runner.
- `WORKSPACE_API_KEY`: scoped key for the agent service account, when the agent
  is allowed to call the workspace API.
- `PWD`: the resolved runner-local cwd.

Compatibility variables:

- `PROJECTS_DIR` is not sent by the hosted backend unless it has a runner-local
  value. Runners/providers that need a project output directory should derive
  one from the runner-local workspace, for example below `PWD`.
- `PROJECT_PORT` is not allocated or probed by the hosted backend for runner
  jobs. Runners/providers that need a preview port must allocate it on the
  runner host or run without this variable.

Rules:

- Backend operational env vars such as database URLs, JWT secrets, backend data
  dirs, CORS, TLS key paths, and webhook app secrets must not be forwarded.
- Agent env vars are decrypted by the backend only for the job and are marked
  secret in the protocol.
- Runner policy may reject env or secret access even if a job asks for it.
- Provider API keys should come from runner-local provider configuration when
  possible. If OpenWork sends a secret, it is job-scoped and must not be written
  to runner config or logs.

### Routing, Preflight, And Isolation

Before creating chat, cron, board-batch, or collection-batch work, the backend
must preflight the selected agent:

- resolve the agent's group to exactly one workspace and owning user;
- fail explicitly when the group is in zero or multiple workspaces;
- verify a connected non-stale runner for that user/workspace supports the
  selected provider;
- keep queued work queued when only the global app concurrency limit is full.

Routing is stable by `(userId, workspaceId)` and is never "first match wins"
when more than one workspace contains the group. `AGENT_RUNNER_ID` may pin
dispatch to one live runner; without it, this backend process selects the
least-loaded eligible runner.

Each run gets a job-scoped sandbox rooted at the runner workspace:

- shared chats run at `.` relative to the runner workspace root;
- subfolder chats run at `conversations/<conversationId>` only after an
  explicit prepare/setup/sync/repair/reveal operation has prepared that
  runner-local folder;
- ordinary execution dispatch must fail or persist execution failure metadata
  when the prepared cwd is not ready; it must not create or rewrite workspace
  files as a side effect of chat send/edit/queue drain;
- `PROJECT_PORT` is allocated only by the runner/provider when needed, not by
  probing the backend host;
- `PWD`, `WORKSPACE_API_URL`, `WORKSPACE_API_KEY`, and active agent env vars are
  the only required backend-supplied
  environment entries;
- provider credentials should remain runner-local; workspace API keys and agent
  env vars are marked secret and scoped to the job.

Current concurrency controls are:

- backend global `MAX_CONCURRENT_AGENTS`;
- board/collection batch `maxParallel` per batch run;
- per-conversation and per-card duplicate run keys;
- runner policy checks for env, secret, network, shell, approval mode,
  provider, and workspace root.

### Multi-Backend Instance Requirements

The current runner socket registry and in-flight `runId -> jobId -> runnerId`
maps are process-local. A horizontally scaled backend must add one of these
control-plane guarantees before multiple replicas dispatch runner work:

- sticky routing so the runner WebSocket, queue drain, cancellation, and run
  recovery for a job return to the same backend instance;
- or a shared runner registry/job-dispatch bus that stores live runner leases,
  in-flight job ownership, terminal messages, cancellation commands, and
  reconnect grace state outside process memory.

Database row locks already serialize chat queue and batch item claims, but they
do not route WebSocket messages across backend replicas. Without sticky routing
or a shared registry, cancellation and recovered terminal messages can miss the
process that owns the runner socket.

## Security Rules

### Secrets

- Store canonical secrets only in the backend encrypted store or in the
  runner's own provider credential stores.
- Never persist raw runner credentials, pairing codes, workspace API keys, or
  agent env var values in logs, card comments, run metadata, artifacts, or
  workspace files.
- Pairing codes are one-time and short-lived. Runner credentials are revocable
  by runner id and scoped to the owning user/workspace.
- Job payloads may contain secrets only when `allowedOperations.secrets` is true
  and the selected runner advertised `policy.secretAccess`.

### Local Filesystem Browsing And Reveal

- Hosted backend routes must not browse or reveal the backend host filesystem
  for user workspace selection.
- Local browse, folder picker, path references, and reveal operations require a
  paired daemon on the user machine and an authenticated user action.
- Runner connected with filesystem daemon capability: enable
  `/api/runner-filesystem/browse`, `/api/runner-filesystem/pick-folder`,
  `/api/runner-filesystem/reveal`, and
  `/api/runner-filesystem/validate-repository-root` only.
- No runner: disable runner-local filesystem actions with `runner_unavailable`;
  stored paths may be displayed only as inert metadata.
- Old runner or no daemon filesystem capability: disable browse/pick/reveal
  with `runner_filesystem_unsupported`; do not fall back to server-local storage
  endpoints.
- Server-storage operations stay under `/api/storage/*` and classify as
  backend-storage. Keep `/api/storage/*` separate from runner-local
  `/api/runner-filesystem/*`.
- Reveal operations must be non-mutating and must not return file contents.
- Browsing must be scoped by daemon policy. Hidden files, system roots, symlink
  targets, and removable/network locations should be exposed only when the
  daemon policy allows them.
- Absolute paths emitted by agent output are not authority. Reveal must check
  that the path belongs to an allowed runner/daemon root or ask for explicit
  user confirmation through the daemon.

### Runner-Scoped Permissions

Runner selection and execution are constrained by both backend routing and
runner policy:

- backend routes jobs only to runners matching the job's user and workspace
  scope;
- optional `AGENT_RUNNER_ID` may pin dispatch to one runner;
- runtime must match runner `supportedRuntimes`;
- provider selection must match runner `supportedProviders`;
- workspace mode must match runner `supportedWorkspaceModes`;
- busy is a status, not unavailability. A connected, non-stale runner matching
  user/workspace/provider remains eligible when it already has active jobs; one
  eligible native runner may accept multiple independent jobs. Active job count
  is only a least-loaded tie-break across multiple eligible runners.
- `allowedOperations.tools` must contain the requested provider;
- approval mode, env access, secret access, network, and shell access must be
  allowed by runner policy;
- cwd and materialized attachment paths must stay inside authorized runner
  roots;
- cancellation must target the exact `runId`/`jobId` mapping;
- revoked or stale runners are not eligible for new jobs.

If any check fails, the job must fail explicitly. The backend must not fall back
to spawning a local CLI on the hosted backend.

## Compatibility Notes

Existing local development can still run backend and runner on one machine.
That mode is convenient, but it is not the deployment contract. New runner-split
work should test the remote-host case: backend paths are not runner paths,
`localhost` on the backend is not `localhost` on the runner, and OS filesystem
operations happen on the user machine through a daemon boundary.

Existing protocol `1.1` runners remain compatible for jobs that do not require
new attachment staging or daemon filesystem capabilities. Hosted jobs with
attachments or runner-local filesystem actions require the current capability
advertisement and must fail before enqueue or before provider spawn when those
capabilities are absent. Existing attachments remain
backend-storage records; the runner receives scoped download references and
materializes files locally. Legacy repository roots stay readable as metadata
but are not trusted as hosted executable cwd until runner-verified.

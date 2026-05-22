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

## State Ownership

| State | Backend-owned | Runner-owned | Daemon-owned |
| --- | --- | --- | --- |
| Users, workspaces, collections, cards, conversations, messages, turns, queue rows, run records, audit logs | Canonical in Postgres. | Read only through job payloads or workspace API credentials. | No canonical ownership. |
| Runner device records, pairing codes, credential hashes, status, capabilities | Canonical records and revocation. | Local credential material in `OPENWORK_RUNNER_CONFIG` or equivalent. | May expose pairing UX, but does not own credentials beyond local storage. |
| Agent records, model/provider selection, workspace routing scope, permissions | Canonical metadata. | Receives resolved job intent and allowed operations. | May help select or validate local paths. |
| Agent env vars and workspace API keys | Encrypted canonical values and scoped release decision. | Ephemeral per-job environment only. | No persistence except secure local credential storage if explicitly required. |
| Repository working tree | Metadata binding only; backend must not mutate by host path. | Executes inside a runner-local checkout or mounted workspace. | Selects, validates, reveals, and can sync/materialize the local checkout. |
| Per-chat workspace directories | Conversation metadata only: mode and relative path. | Uses runner-local cwd for job execution. | Creates/materializes `conversations/<conversationId>/` and shared context links/files. |
| Uploaded attachments | Canonical upload metadata and bytes under backend storage. | Uses runner-local materialized files for the job. | Downloads/syncs attachments into a runner-local cache and resolves local paths. |
| Agent files (`AGENTS.md`, skills, docs, memory, presets) | Canonical metadata and optional synced content/revisions. | Consumes files from the local agent context for execution. | Owns local materialization under the workspace and path-safe edits/reveals. |
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
- For the current protocol shape, `RunnerJobIntent.workspace.path` is
  `type: "local_path"` and must already be valid on the selected runner.
- Hosted deployments should resolve repository roots through the paired
  daemon/runner. If a root is missing, outside the runner root, or not synced,
  the job must fail before provider CLI spawn with an actionable runner
  workspace error.
- Runners that advertise `capabilities.workspaceRoot` must reject jobs whose cwd
  is outside that root after path normalization.

### Per-Chat Workspaces

Conversation workspace mode is backend metadata:

- `shared`: run in the repository execution root.
- `subfolder`: run in `conversations/<conversationId>/` below the repository
  execution root.

The daemon materializes subfolder workspaces on the user machine. The standard
materialization is:

- create `conversations/<conversationId>/`;
- materialize instruction markdown with the conversation cwd rewritten;
- link or sync shared context directories such as `skills/`, `docs/`, and
  `memory/` from the agent context;
- keep the resolved cwd inside the repository execution root even if stale or
  malformed metadata contains another relative path.

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
- `cancel`

Runner to server:

- `runner_hello` with protocol version, runner identity, capabilities, and
  policy. Protocol `1.2` capabilities are explicit for `supportedRuntimes`
  (`openwork`, `hermes`, `openclaw`), `supportedAgentKinds`,
  `supportedProviders`, `supportedTools`, `supportedWorkspaceModes`,
  `daemonEndpoints`, and `concurrency.maxJobs`;
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

Required variables:

- `WORKSPACE_API_URL`: public OpenWork API origin reachable from the runner.
- `WORKSPACE_API_KEY`: scoped key for the agent service account, when the agent
  is allowed to call the workspace API.
- `PROJECTS_DIR`: runner-local output directory for generated projects.
- `PROJECT_PORT`: runner-local port allocation for the job.
- `PWD`: the resolved runner-local cwd.

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
- subfolder chats run at `conversations/<conversationId>` with an explicit
  materialization request;
- `PROJECT_PORT` is allocated per run and released on terminal state;
- `PROJECTS_DIR`, `PROJECT_PORT`, `PWD`, `WORKSPACE_API_URL`,
  `WORKSPACE_API_KEY`, and active agent env vars are the only backend-supplied
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
- runtime and agent kind must match runner `supportedRuntimes` and
  `supportedAgentKinds`;
- provider selection must match runner `supportedProviders`;
- workspace mode must match runner `supportedWorkspaceModes`;
- runner active jobs must be below `capabilities.concurrency.maxJobs`;
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

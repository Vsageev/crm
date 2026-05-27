import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { WebSocket, WebSocketServer } from 'ws';
import { env } from '../config/env.js';
import {
  RUNNER_PROTOCOL_VERSION,
  extractAgentOutputIncompleteText,
  parseRunnerServerMessage,
  type RunnerCapabilities as ProtocolRunnerCapabilities,
  type RunnerFilesystemRequest,
  type RunnerFilesystemResult,
  type RunnerJobIntent,
  type RunnerServerMessage,
  type ServerRunnerMessage,
} from 'shared';
import { store } from '../db/index.js';
import {
  auditRunnerActivationDenied,
  authenticateRunnerCredential,
  evaluateRunnerActivation,
  noteRunnerConnected,
  noteRunnerDisconnected,
  noteRunnerSeen,
  resolveRunnerConnectionBinding,
  RUNNER_STALE_AFTER_MS,
  type RunnerActivationDenialCategory,
  type RunnerCapabilities,
  type RunnerConnectionScope,
  type RunnerRecord,
} from './runner-devices.js';
import type { AgentRunLifecycleEvent } from './agent-runs.js';

export interface RemoteAgentJob {
  userId?: string | null;
  workspaceId?: string | null;
  /** Authenticated principal activating the runner; defaults to userId when omitted. */
  activationActorId?: string | null;
  runnerId?: string | null;
  intent: RunnerJobIntent;
  timeoutMs?: number;
}

export interface RemoteAgentJobCallbacks {
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
}

export interface RemoteAgentJobResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export class RemoteAgentJobError extends Error {
  code: number | null;
  stdout: string;
  stderr: string;

  constructor(message: string, result?: RemoteAgentJobResult) {
    super(message);
    this.name = 'RemoteAgentJobError';
    this.code = result?.code ?? null;
    this.stdout = result?.stdout ?? '';
    this.stderr = result?.stderr ?? '';
  }
}

interface PendingJob {
  jobId: string;
  runId: string;
  callbacks: RemoteAgentJobCallbacks;
  resolve: (result: RemoteAgentJobResult) => void;
  reject: (error: Error) => void;
  stdout: string;
  stderr: string;
  timeout: ReturnType<typeof setTimeout> | null;
}

interface PendingFilesystemRequest {
  requestId: string;
  timeout: ReturnType<typeof setTimeout> | null;
  resolve: (result: RunnerFilesystemResult) => void;
  reject: (error: Error) => void;
}

interface ConnectedRunner {
  id: string;
  userId: string;
  workspaceId: string;
  connectionScope: RunnerConnectionScope;
  ownerAccountId: string;
  boundWorkspaceId: string;
  name: string;
  ws: WebSocket;
  capabilities: RunnerCapabilities | ProtocolRunnerCapabilities;
  connectedAt: string;
  lastSeenAt: string;
  activeJobIds: Set<string>;
}

const runners = new Map<string, ConnectedRunner>();
const jobsById = new Map<string, PendingJob>();
const filesystemRequestsById = new Map<string, PendingFilesystemRequest>();
const jobRunnerById = new Map<string, string>();
const jobIdByRunId = new Map<string, string>();
const availableRunnerListeners = new Set<() => void>();
const RUNNER_HEARTBEAT_INTERVAL_MS = 30_000;
/** When a runner socket drops, fail in-flight jobs only after this grace period (cleared on reconnect). */
const runnerReconnectGraceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleRunnerDisconnectGrace(runnerId: string) {
  clearRunnerReconnectGrace(runnerId);
  const graceMs = env.REMOTE_AGENT_RUNNER_RECONNECT_GRACE_MS;
  if (graceMs === 0) {
    failJobsForDisconnectedRunner(runnerId, `Runner ${runnerId} disconnected`);
    return;
  }
  const timer = setTimeout(() => {
    runnerReconnectGraceTimers.delete(runnerId);
    if (runners.has(runnerId)) return;
    failJobsForDisconnectedRunner(
      runnerId,
      `Runner ${runnerId} disconnected (reconnect grace expired after ${graceMs}ms)`,
    );
  }, graceMs);
  timer.unref?.();
  runnerReconnectGraceTimers.set(runnerId, timer);
}

function clearRunnerReconnectGrace(runnerId: string) {
  const timer = runnerReconnectGraceTimers.get(runnerId);
  if (!timer) return;
  clearTimeout(timer);
  runnerReconnectGraceTimers.delete(runnerId);
}

function collectJobIdsForRunner(runnerId: string): Set<string> {
  const ids = new Set<string>();
  for (const [jobId, mappedRunnerId] of jobRunnerById) {
    if (mappedRunnerId === runnerId) ids.add(jobId);
  }
  return ids;
}

function reattachInFlightJobsToRunner(runner: ConnectedRunner) {
  for (const jobId of collectJobIdsForRunner(runner.id)) {
    if (jobsById.has(jobId)) runner.activeJobIds.add(jobId);
  }
}

function recordRunLifecycle(
  runId: string | null | undefined,
  event: Omit<AgentRunLifecycleEvent, 'at'> & { at?: string },
) {
  if (!runId) return;
  void import('./agent-runs.js')
    .then(({ appendAgentRunLifecycleEvent }) => {
      appendAgentRunLifecycleEvent(runId, event);
    })
    .catch((err) => {
      console.error(`[runners] Failed to record lifecycle event for run ${runId}:`, err);
    });
}

function findRunIdForJobId(jobId: string): string | null {
  for (const [runId, mappedJobId] of jobIdByRunId) {
    if (mappedJobId === jobId) return runId;
  }
  return null;
}

async function failRecoveredJob(jobId: string, message: string) {
  const runId = findRunIdForJobId(jobId);
  jobRunnerById.delete(jobId);
  if (!runId) return;
  jobIdByRunId.delete(runId);

  try {
    const { completeAgentRun } = await import('./agent-runs.js');
    recordRunLifecycle(runId, {
      event: 'backend_recovered_job_failed',
      jobId,
      message,
    });
    await completeAgentRun(runId, message);
  } catch (err) {
    console.error(`[runners] Failed to finalize recovered runner job ${runId}:`, err);
  }
}

function failJobsForDisconnectedRunner(runnerId: string, message: string) {
  for (const jobId of [...jobRunnerById.keys()]) {
    if (jobRunnerById.get(jobId) === runnerId) {
      if (jobsById.has(jobId)) {
        failPendingJob(jobId, new Error(message));
      } else {
        void failRecoveredJob(jobId, message);
      }
    }
  }
}

function runnerIsOpen(runner: ConnectedRunner): boolean {
  return runner.ws.readyState === WebSocket.OPEN;
}

function noteConnectedRunnerSeen(runner: ConnectedRunner) {
  noteRunnerSeen(runner.id, runner.activeJobIds.size > 0 ? 'busy' : 'online');
}

function send(ws: WebSocket, message: ServerRunnerMessage) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(message));
}

function parseJsonMessage(raw: WebSocket.RawData): RunnerServerMessage | null {
  try {
    return parseRunnerServerMessage(JSON.parse(raw.toString()));
  } catch {
    return null;
  }
}

async function authenticateUpgrade(request: IncomingMessage): Promise<RunnerRecord | null> {
  const host = request.headers.host ?? 'localhost';
  const url = new URL(request.url ?? '/', `http://${host}`);
  const auth = request.headers.authorization;
  const headerCredential = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
  const credential =
    headerCredential || url.searchParams.get('credential') || url.searchParams.get('token');
  if (!credential) return null;

  return authenticateRunnerCredential(credential);
}

function runnerMatchesWorkspace(runner: ConnectedRunner, workspaceId?: string | null): boolean {
  if (!workspaceId) return true;
  const boundWorkspaceId = runner.boundWorkspaceId || runner.workspaceId;
  return boundWorkspaceId === workspaceId || runner.workspaceId === '*';
}

function runnerActivationRecord(runner: ConnectedRunner): Record<string, unknown> {
  const stored = store.getById('agentRunners', runner.id);
  if (stored) return stored;
  return {
    id: runner.id,
    userId: runner.ownerAccountId,
    workspaceId: runner.boundWorkspaceId,
    connectionScope: runner.connectionScope,
    ownerAccountId: runner.ownerAccountId,
    boundWorkspaceId: runner.boundWorkspaceId,
    legacyConnectionScope: true,
  };
}

function runnerMatchesRoutingScope(
  runner: ConnectedRunner,
  userId?: string | null,
  workspaceId?: string | null,
): boolean {
  if (!runnerMatchesWorkspace(runner, workspaceId)) return false;
  if (runner.connectionScope === 'project') return true;
  return !userId || runner.ownerAccountId === userId;
}

function runnerMatchesActivationScope(
  runner: ConnectedRunner,
  activationActorId?: string | null,
  workspaceId?: string | null,
  hasAgentRunPermission = true,
): boolean {
  if (!workspaceId || !runnerMatchesWorkspace(runner, workspaceId)) return false;
  const actor = activationActorId?.trim();
  if (!actor) return false;
  return evaluateRunnerActivation({
    record: runnerActivationRecord(runner),
    activationActorId: actor,
    routingWorkspaceId: workspaceId,
    hasAgentRunPermission,
  }).allowed;
}

function resolveActivationActorId(
  routingUserId?: string | null,
  activationActorId?: string | null,
): string | null {
  const actor = (activationActorId ?? routingUserId)?.trim();
  return actor || null;
}

function runnerSupportsProvider(runner: ConnectedRunner, provider?: RunnerJobIntent['provider']): boolean {
  if (!provider) return true;
  const supportedProviders = runner.capabilities?.supportedProviders;
  const installedProviders = runner.capabilities?.installedProviders;
  return (
    (Array.isArray(supportedProviders) && supportedProviders.includes(provider)) ||
    (Array.isArray(installedProviders) && installedProviders.includes(provider))
  );
}

function runnerUsesCurrentProtocol(runner: ConnectedRunner): boolean {
  return runner.capabilities?.protocolVersion === RUNNER_PROTOCOL_VERSION;
}

function runnerSupportsAttachmentStaging(runner: ConnectedRunner): boolean {
  return runner.capabilities?.protocolVersion === RUNNER_PROTOCOL_VERSION;
}

function jobRequiresAttachmentStaging(intent: RunnerJobIntent): boolean {
  return (intent.stagingManifest?.attachments.length ?? 0) > 0;
}

function jobIncludesWorkspaceSetupPayload(intent: RunnerJobIntent): boolean {
  return (
    typeof intent.workspace === 'object' &&
    intent.workspace !== null &&
    'materialization' in intent.workspace
  );
}

function runnerSupportsFilesystem(runner: ConnectedRunner): boolean {
  return runner.capabilities?.supportsFilesystem === true;
}

function runnerSupportsAgentInventory(runner: ConnectedRunner): boolean {
  const inventory = runner.capabilities?.agentInventory;
  return (
    inventory !== undefined &&
    inventory !== null &&
    inventory.protocolVersion === 1 &&
    typeof inventory.revision === 'string' &&
    typeof inventory.advertisedAt === 'string' &&
    typeof inventory.ttlMs === 'number' &&
    Array.isArray(inventory.workspaceRoots) &&
    Array.isArray(inventory.fileOperations) &&
    Array.isArray(inventory.agents)
  );
}

function runnerSupportsJobPolicy(
  runner: ConnectedRunner,
  provider?: RunnerJobIntent['provider'],
  approvalMode: RunnerJobIntent['allowedOperations']['approvalMode'] = 'dangerous',
): boolean {
  if (!provider) return true;
  const supportedTools = runner.capabilities?.supportedTools;
  const allowedTools = runner.capabilities?.policy?.allowedTools;
  const toolAllowed = Array.isArray(supportedTools)
    ? supportedTools.includes(provider)
    : Array.isArray(allowedTools) && allowedTools.includes(provider);
  const approvalModes = runner.capabilities?.approvalModes;
  const policyApprovalModes = runner.capabilities?.policy?.approvalModes;
  const approvalAllowed = Array.isArray(approvalModes)
    ? approvalModes.includes(approvalMode)
    : Array.isArray(policyApprovalModes) && policyApprovalModes.includes(approvalMode);
  return toolAllowed && approvalAllowed;
}

function runnerMatchesJob(
  runner: ConnectedRunner,
  userId?: string | null,
  workspaceId?: string | null,
  provider?: RunnerJobIntent['provider'],
  activationActorId?: string | null,
  hasAgentRunPermission = true,
): boolean {
  const actor = resolveActivationActorId(userId, activationActorId);
  return (
    runnerIsOpen(runner) &&
    getConnectedRunnerLiveStatus(runner) !== 'stale' &&
    runnerUsesCurrentProtocol(runner) &&
    runnerSupportsAgentInventory(runner) &&
    runnerMatchesActivationScope(runner, actor, workspaceId, hasAgentRunPermission) &&
    runnerSupportsProvider(runner, provider) &&
    runnerSupportsJobPolicy(runner, provider)
  );
}

function pickRunner(
  userId?: string | null,
  workspaceId?: string | null,
  provider?: RunnerJobIntent['provider'],
  activationActorId?: string | null,
  hasAgentRunPermission = true,
): ConnectedRunner | null {
  if (env.AGENT_RUNNER_ID) {
    const preferred = runners.get(env.AGENT_RUNNER_ID);
    if (
      preferred &&
      runnerMatchesJob(
        preferred,
        userId,
        workspaceId,
        provider,
        activationActorId,
        hasAgentRunPermission,
      )
    ) {
      return preferred;
    }
    return null;
  }

  // Prefer the least-loaded runner; break ties deterministically by most-recent heartbeat.
  return [...runners.values()]
    .filter((runner) =>
      runnerMatchesJob(
        runner,
        userId,
        workspaceId,
        provider,
        activationActorId,
        hasAgentRunPermission,
      ),
    )
    .sort((a, b) => {
      const activeDelta = a.activeJobIds.size - b.activeJobIds.size;
      if (activeDelta !== 0) return activeDelta;
      return Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt);
    })[0] ?? null;
}

function pickSpecificRunner(
  runnerId: string | null | undefined,
  userId?: string | null,
  workspaceId?: string | null,
  provider?: RunnerJobIntent['provider'],
  activationActorId?: string | null,
  hasAgentRunPermission = true,
): ConnectedRunner | null {
  if (!runnerId) {
    return pickRunner(userId, workspaceId, provider, activationActorId, hasAgentRunPermission);
  }
  const runner = runners.get(runnerId);
  return runner &&
    runnerMatchesJob(
      runner,
      userId,
      workspaceId,
      provider,
      activationActorId,
      hasAgentRunPermission,
    )
    ? runner
    : null;
}

function notifyAvailableRunner() {
  if (!hasAvailableRemoteAgentRunner()) return;
  for (const listener of availableRunnerListeners) {
    listener();
  }
}

function runnerMatchesFilesystemRequest(
  runner: ConnectedRunner,
  userId?: string | null,
  workspaceId?: string | null,
  activationActorId?: string | null,
  hasAgentRunPermission = true,
): boolean {
  const actor = resolveActivationActorId(userId, activationActorId);
  return (
    runnerIsOpen(runner) &&
    getConnectedRunnerLiveStatus(runner) !== 'stale' &&
    runnerUsesCurrentProtocol(runner) &&
    runnerSupportsAgentInventory(runner) &&
    runnerMatchesActivationScope(runner, actor, workspaceId, hasAgentRunPermission) &&
    runnerSupportsFilesystem(runner)
  );
}

function pickFilesystemRunner(
  userId?: string | null,
  workspaceId?: string | null,
  activationActorId?: string | null,
  hasAgentRunPermission = true,
): ConnectedRunner | null {
  return [...runners.values()]
    .filter((runner) =>
      runnerMatchesFilesystemRequest(
        runner,
        userId,
        workspaceId,
        activationActorId,
        hasAgentRunPermission,
      ),
    )
    .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))[0] ?? null;
}

function isRunnerStale(runner: ConnectedRunner, now = Date.now()): boolean {
  const lastSeenMs = Date.parse(runner.lastSeenAt);
  return Number.isFinite(lastSeenMs) && now - lastSeenMs > RUNNER_STALE_AFTER_MS;
}

function getConnectedRunnerLiveStatus(
  runner: ConnectedRunner,
  now = Date.now(),
): 'online' | 'busy' | 'stale' {
  if (isRunnerStale(runner, now)) return 'stale';
  return runner.activeJobIds.size > 0 ? 'busy' : 'online';
}

function failPendingJob(jobId: string, error: Error) {
  const pending = jobsById.get(jobId);
  if (!pending) return;
  recordRunLifecycle(pending.runId, {
    event: 'backend_job_failed',
    jobId,
    message: error.message,
  });
  if (pending.timeout) clearTimeout(pending.timeout);
  jobsById.delete(jobId);
  jobIdByRunId.delete(pending.runId);
  const runnerId = jobRunnerById.get(jobId);
  jobRunnerById.delete(jobId);
  const runner = runnerId ? runners.get(runnerId) : null;
  if (runner) {
    runner.activeJobIds.delete(jobId);
    runner.lastSeenAt = new Date().toISOString();
    noteConnectedRunnerSeen(runner);
  }
  notifyAvailableRunner();
  pending.reject(error);
}

/** Merge runner `completed` stdout with chunks already buffered via `output_event` / `final_message`. */
function mergeRunnerCompletedStdout(pendingStdout: string, completedStdout: string): string {
  if (completedStdout) {
    return `${completedStdout}${
      pendingStdout && !completedStdout.includes(pendingStdout) ? pendingStdout : ''
    }`;
  }
  return pendingStdout;
}

function completePendingJob(
  jobId: string,
  result: RemoteAgentJobResult,
  runner: ConnectedRunner | null,
) {
  const pending = jobsById.get(jobId);
  if (!pending) return;
  recordRunLifecycle(pending.runId, {
    event: 'runner_job_completed',
    runnerId: runner?.id,
    jobId,
    code: result.code,
    stdoutBytes: result.stdout.length,
    stderrBytes: result.stderr.length,
  });
  if (pending.timeout) clearTimeout(pending.timeout);
  jobsById.delete(jobId);
  jobRunnerById.delete(jobId);
  jobIdByRunId.delete(pending.runId);
  if (runner) {
    runner.activeJobIds.delete(jobId);
    runner.lastSeenAt = new Date().toISOString();
    noteConnectedRunnerSeen(runner);
  }
  notifyAvailableRunner();
  const stderr = result.stderr
    ? `${result.stderr}${pending.stderr && !result.stderr.includes(pending.stderr) ? pending.stderr : ''}`
    : pending.stderr;
  pending.resolve({
    code: result.code,
    stdout: mergeRunnerCompletedStdout(pending.stdout, result.stdout),
    stderr,
  });
}

async function completeUnknownRunnerTerminalMessage(
  message: Extract<RunnerServerMessage, { type: 'completed' | 'failed' | 'cancelled' }>,
) {
  try {
    const { completeAgentRun } = await import('./agent-runs.js');
    const errorMessage =
      message.type === 'completed'
        ? null
        : message.type === 'failed'
          ? message.message
          : message.message || 'Remote runner cancelled the job';
    recordRunLifecycle(message.runId, {
      event: `runner_job_${message.type}_after_recovery`,
      jobId: message.jobId,
      code: message.type === 'cancelled' ? null : message.code,
      message: errorMessage ?? undefined,
      stdoutBytes: message.stdout.length,
      stderrBytes: message.stderr.length,
    });
    await completeAgentRun(message.runId, errorMessage, {
      stdout: message.stdout,
      stderr: message.stderr,
    });
  } catch (err) {
    console.error(`[runners] Failed to finalize unknown runner terminal message for run ${message.runId}:`, err);
  }
}

function appendRunnerFinalMessage(pending: PendingJob, message: Extract<RunnerServerMessage, { type: 'final_message' }>) {
  const event = {
    type: 'item.completed',
    item: {
      id: `openwork-final-message-${message.runId}`,
      type: 'openwork_final_message',
      text: message.text,
    },
  };
  const line = `${JSON.stringify(event)}\n`;
  pending.stdout += line;
  pending.callbacks.onStdout?.(line);
}

async function appendUnknownRunnerOutputEvent(
  message: Extract<RunnerServerMessage, { type: 'output_event' }>,
) {
  try {
    const { appendAgentRunOutput } = await import('./agent-runs.js');
    appendAgentRunOutput(message.runId, message.stream, message.text);
  } catch (err) {
    console.error(`[runners] Failed to append output for unknown runner job ${message.runId}:`, err);
  }
}

async function appendUnknownRunnerFinalMessage(
  message: Extract<RunnerServerMessage, { type: 'final_message' }>,
) {
  const event = {
    type: 'item.completed',
    item: {
      id: `openwork-final-message-${message.runId}`,
      type: 'openwork_final_message',
      text: message.text,
    },
  };
  try {
    const { appendAgentRunOutput } = await import('./agent-runs.js');
    appendAgentRunOutput(message.runId, 'stdout', `${JSON.stringify(event)}\n`);
  } catch (err) {
    console.error(`[runners] Failed to append final message for unknown runner job ${message.runId}:`, err);
  }
}

export function getCompletedRunnerProtocolError(
  message: Extract<RunnerServerMessage, { type: 'completed' }>,
): RemoteAgentJobError | null {
  const incompleteMessage = extractAgentOutputIncompleteText(message.stdout);
  if (!incompleteMessage) return null;
  return new RemoteAgentJobError(incompleteMessage, {
    code: message.code,
    stdout: message.stdout,
    stderr: message.stderr,
  });
}

function handleRunnerMessage(runner: ConnectedRunner, message: RunnerServerMessage | null) {
  if (!message) return;
  runner.lastSeenAt = new Date().toISOString();
  noteConnectedRunnerSeen(runner);

  if (message.type === 'runner_hello') {
    runner.name = message.name || runner.name;
    runner.capabilities = message.capabilities ?? {};
    void noteRunnerConnected(runner.id, {
      displayName: runner.name,
      version: message.capabilities?.runnerVersion,
      capabilities: runner.capabilities,
    });
    if (message.protocolVersion !== RUNNER_PROTOCOL_VERSION) {
      notifyAvailableRunner();
      return;
    }
    notifyAvailableRunner();
    return;
  }

  if (message.type === 'runner_heartbeat') {
    runner.name = message.name || runner.name;
    runner.capabilities = message.capabilities ?? runner.capabilities;
    void noteRunnerConnected(runner.id, {
      displayName: runner.name,
      version: runner.capabilities?.runnerVersion,
      capabilities: runner.capabilities,
    });
    notifyAvailableRunner();
    return;
  }

  if (message.type === 'job_accepted') {
    const pending = jobsById.get(message.jobId);
    recordRunLifecycle(message.runId, {
      event: pending ? 'runner_job_accepted' : 'runner_job_recovered',
      runnerId: runner.id,
      jobId: message.jobId,
    });
    if (!pending) {
      jobRunnerById.set(message.jobId, runner.id);
      jobIdByRunId.set(message.runId, message.jobId);
      runner.activeJobIds.add(message.jobId);
      noteConnectedRunnerSeen(runner);
      return;
    }
    return;
  }

  if (message.type === 'job_rejected') {
    if (message.runId) {
      recordRunLifecycle(message.runId, {
        event: 'runner_job_rejected',
        runnerId: runner.id,
        jobId: message.jobId,
        message: `${message.code}: ${message.message}`,
      });
    }
    failPendingJob(message.jobId, new Error(`${message.code}: ${message.message}`));
    return;
  }

  if (message.type === 'output_event' && message.stream === 'stdout') {
    const pending = jobsById.get(message.jobId);
    if (!pending) {
      void appendUnknownRunnerOutputEvent(message);
      return;
    }
    pending.stdout += message.text;
    pending.callbacks.onStdout?.(message.text);
    return;
  }

  if (message.type === 'output_event' && message.stream === 'stderr') {
    const pending = jobsById.get(message.jobId);
    if (!pending) {
      void appendUnknownRunnerOutputEvent(message);
      return;
    }
    pending.stderr += message.text;
    pending.callbacks.onStderr?.(message.text);
    return;
  }

  if (message.type === 'final_message') {
    const pending = jobsById.get(message.jobId);
    if (!pending) {
      void appendUnknownRunnerFinalMessage(message);
      return;
    }
    recordRunLifecycle(message.runId, {
      event: 'runner_final_message_received',
      runnerId: runner.id,
      jobId: message.jobId,
      stdoutBytes: message.text.length,
    });
    appendRunnerFinalMessage(pending, message);
    return;
  }

  if (message.type === 'artifact') {
    return;
  }

  if (message.type === 'completed') {
    if (!jobsById.has(message.jobId)) {
      runner.activeJobIds.delete(message.jobId);
      jobRunnerById.delete(message.jobId);
      jobIdByRunId.delete(message.runId);
      noteConnectedRunnerSeen(runner);
      void completeUnknownRunnerTerminalMessage(message);
      return;
    }
    const pending = jobsById.get(message.jobId)!;
    const mergedStdout = mergeRunnerCompletedStdout(pending.stdout, message.stdout ?? '');
    const protocolError = getCompletedRunnerProtocolError({
      ...message,
      stdout: mergedStdout,
    });
    if (protocolError) {
      failPendingJob(message.jobId, protocolError);
      return;
    }
    completePendingJob(
      message.jobId,
      {
        code: message.code,
        stdout: message.stdout ?? '',
        stderr: message.stderr ?? '',
      },
      runner,
    );
    return;
  }

  if (message.type === 'failed') {
    if (!jobsById.has(message.jobId)) {
      runner.activeJobIds.delete(message.jobId);
      jobRunnerById.delete(message.jobId);
      jobIdByRunId.delete(message.runId);
      noteConnectedRunnerSeen(runner);
      void completeUnknownRunnerTerminalMessage(message);
      return;
    }
    failPendingJob(message.jobId, new RemoteAgentJobError(message.message, {
      code: message.code,
      stdout: message.stdout,
      stderr: message.stderr,
    }));
    return;
  }

  if (message.type === 'cancelled') {
    if (!jobsById.has(message.jobId)) {
      runner.activeJobIds.delete(message.jobId);
      jobRunnerById.delete(message.jobId);
      jobIdByRunId.delete(message.runId);
      noteConnectedRunnerSeen(runner);
      void completeUnknownRunnerTerminalMessage(message);
      return;
    }
    failPendingJob(message.jobId, new Error(message.message || 'Remote runner cancelled the job'));
    return;
  }

  if (message.type === 'protocol_error') {
    if (message.jobId) failPendingJob(message.jobId, new Error(message.message));
    return;
  }

  if (message.type === 'filesystem_response') {
    const pending = filesystemRequestsById.get(message.requestId);
    if (!pending) return;
    if (pending.timeout) clearTimeout(pending.timeout);
    filesystemRequestsById.delete(message.requestId);
    if (message.ok) {
      pending.resolve(message.result);
    } else {
      pending.reject(new Error(`${message.code}: ${message.message}`));
    }
  }
}

export function registerAgentRunnerServer(app: FastifyInstance) {
  const wss = new WebSocketServer({ noServer: true });
  const heartbeatInterval = setInterval(() => {
    for (const runner of runners.values()) {
      if (!runnerIsOpen(runner)) continue;
      try {
        runner.ws.ping();
      } catch {
        runner.ws.terminate();
      }
    }
  }, RUNNER_HEARTBEAT_INTERVAL_MS);
  heartbeatInterval.unref();

  app.server.on('upgrade', (request, socket, head) => {
    const host = request.headers.host ?? 'localhost';
    const url = new URL(request.url ?? '/', `http://${host}`);
    if (url.pathname !== '/api/runners/ws') return;

    void authenticateUpgrade(request).then((runnerRecord) => {
      if (!runnerRecord) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        const runnerId = runnerRecord.id || url.searchParams.get('runnerId') || randomUUID();
        const now = new Date().toISOString();

        const existing = runners.get(runnerId);
        if (existing) {
          console.warn(`[runners] Runner ${runnerId} reconnected — closing previous WebSocket`);
          existing.ws.close(1000, 'Replaced by new connection');
          runners.delete(runnerId);
        }
        clearRunnerReconnectGrace(runnerId);

        const binding = resolveRunnerConnectionBinding(
          runnerRecord as unknown as Record<string, unknown>,
        );
        const runner: ConnectedRunner = {
          id: runnerId,
          userId: binding.ownerAccountId,
          workspaceId: binding.boundWorkspaceId,
          connectionScope: binding.connectionScope,
          ownerAccountId: binding.ownerAccountId,
          boundWorkspaceId: binding.boundWorkspaceId,
          name: url.searchParams.get('name') || runnerRecord.displayName || runnerId,
          ws,
          capabilities: {},
          connectedAt: now,
          lastSeenAt: now,
          activeJobIds: new Set(),
        };

        runners.set(runnerId, runner);
        reattachInFlightJobsToRunner(runner);
        send(ws, { type: 'server_hello', protocolVersion: RUNNER_PROTOCOL_VERSION, runnerId });

        ws.on('message', (raw) => handleRunnerMessage(runner, parseJsonMessage(raw)));
        ws.on('pong', () => {
          runner.lastSeenAt = new Date().toISOString();
          noteConnectedRunnerSeen(runner);
        });
        ws.on('close', () => {
          if (runners.get(runnerId) !== runner) return;
          runners.delete(runnerId);
          noteRunnerDisconnected(runnerId);
          scheduleRunnerDisconnectGrace(runnerId);
        });
      });
    }).catch(() => {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    });
  });

  app.addHook('onClose', async () => {
    clearInterval(heartbeatInterval);
    wss.close();
  });
}

export function listConnectedAgentRunners() {
  return [...runners.values()].map((runner) => ({
    id: runner.id,
    userId: runner.userId,
    workspaceId: runner.workspaceId,
    name: runner.name,
    status: getConnectedRunnerLiveStatus(runner),
    capabilities: runner.capabilities,
    connectedAt: runner.connectedAt,
    lastSeenAt: runner.lastSeenAt,
    currentJobId: [...runner.activeJobIds][0] ?? null,
    currentJobIds: [...runner.activeJobIds],
  }));
}

export function getLiveRunnerStatusMap(): Map<string, 'online' | 'busy' | 'stale'> {
  return new Map([...runners.values()].map((runner) => [runner.id, getConnectedRunnerLiveStatus(runner)]));
}

export function getLiveRunnerCapabilitiesMap(): Map<string, RunnerCapabilities> {
  return new Map(
    [...runners.values()].map((runner) => [
      runner.id,
      runner.capabilities as RunnerCapabilities,
    ]),
  );
}

function parseRunnerDispatchScope(
  first?: string | null,
  second?: string | RunnerJobIntent['provider'] | null,
  third?: RunnerJobIntent['provider'] | null,
  fourth?: string | null,
): {
  routingUserId?: string | null;
  workspaceId?: string | null;
  provider?: RunnerJobIntent['provider'];
  activationActorId?: string | null;
} {
  if (third !== undefined) {
    return {
      routingUserId: first,
      workspaceId: second as string | null,
      provider: third ?? undefined,
      activationActorId: fourth ?? first,
    };
  }
  return {
    workspaceId: first,
    provider: second as RunnerJobIntent['provider'] | undefined,
    activationActorId: fourth,
  };
}

function findRunnerActivationDenial(
  routingUserId: string | null | undefined,
  workspaceId: string | null | undefined,
  activationActorId?: string | null,
): { runnerId: string; category: RunnerActivationDenialCategory; message: string } | null {
  const actor = resolveActivationActorId(routingUserId, activationActorId);
  if (!actor || !workspaceId) return null;
  for (const runner of runners.values()) {
    if (!runnerIsOpen(runner) || getConnectedRunnerLiveStatus(runner) === 'stale') continue;
    if (!runnerMatchesWorkspace(runner, workspaceId)) continue;
    const result = evaluateRunnerActivation({
      record: runnerActivationRecord(runner),
      activationActorId: actor,
      routingWorkspaceId: workspaceId,
    });
    if (!result.allowed) {
      return {
        runnerId: runner.id,
        category: result.category,
        message: result.message,
      };
    }
  }
  return null;
}

export function hasAvailableRemoteAgentRunner(
  userIdOrWorkspaceId?: string | null,
  workspaceIdOrProvider?: string | null,
  providerMaybe?: RunnerJobIntent['provider'],
  activationActorId?: string | null,
): boolean;
export function hasAvailableRemoteAgentRunner(
  workspaceId?: string | null,
  provider?: RunnerJobIntent['provider'],
): boolean;
export function hasAvailableRemoteAgentRunner(
  first?: string | null,
  second?: string | RunnerJobIntent['provider'] | null,
  third?: RunnerJobIntent['provider'] | null,
  fourth?: string | null,
): boolean {
  const scope = parseRunnerDispatchScope(first, second, third, fourth);
  return (
    pickRunner(
      scope.routingUserId,
      scope.workspaceId,
      scope.provider,
      scope.activationActorId,
    ) !== null
  );
}

export function getAvailableRemoteAgentRunnerCapabilities(
  userId?: string | null,
  workspaceId?: string | null,
  provider?: RunnerJobIntent['provider'],
  activationActorId?: string | null,
): (RunnerCapabilities | ProtocolRunnerCapabilities) | null {
  return (
    pickRunner(userId, workspaceId, provider, activationActorId)?.capabilities ?? null
  );
}

export function getAvailableRemoteAgentRunnerSelection(
  userId?: string | null,
  workspaceId?: string | null,
  provider?: RunnerJobIntent['provider'],
  activationActorId?: string | null,
): { runnerId: string; capabilities: RunnerCapabilities | ProtocolRunnerCapabilities } | null {
  const runner = pickRunner(userId, workspaceId, provider, activationActorId);
  return runner ? { runnerId: runner.id, capabilities: runner.capabilities } : null;
}

export function hasConnectedRemoteAgentRunner(
  userIdOrWorkspaceId?: string | null,
  workspaceIdMaybe?: string | null,
  activationActorId?: string | null,
): boolean;
export function hasConnectedRemoteAgentRunner(workspaceId?: string | null): boolean;
export function hasConnectedRemoteAgentRunner(
  first?: string | null,
  second?: string | null,
  third?: string | null,
): boolean {
  let routingUserId: string | null | undefined;
  let workspaceId: string | null | undefined;

  if (second === undefined) {
    workspaceId = first;
  } else {
    routingUserId = first;
    workspaceId = second;
    void third;
  }

  return [...runners.values()].some(
    (runner) =>
      runnerIsOpen(runner) &&
      getConnectedRunnerLiveStatus(runner) !== 'stale' &&
      runnerMatchesRoutingScope(runner, routingUserId, workspaceId),
  );
}

export type RunnerFilesystemAvailability =
  | { state: 'available'; runnerId: string }
  | { state: 'runner_unavailable'; message: string }
  | { state: 'runner_filesystem_unsupported'; message: string };

export function getRunnerFilesystemAvailability(
  userId?: string | null,
  workspaceId?: string | null,
  activationActorId?: string | null,
): RunnerFilesystemAvailability {
  const actor = resolveActivationActorId(userId, activationActorId);
  const eligible = [...runners.values()].filter(
    (runner) =>
      runnerIsOpen(runner) &&
      getConnectedRunnerLiveStatus(runner) !== 'stale' &&
      runnerMatchesActivationScope(runner, actor, workspaceId),
  );
  if (eligible.length === 0) {
    return {
      state: 'runner_unavailable',
      message: 'No paired runner is connected for this workspace.',
    };
  }
  if (!eligible.some(runnerUsesCurrentProtocol)) {
    return {
      state: 'runner_filesystem_unsupported',
      message: 'The connected runner uses an older protocol and must be upgraded before local filesystem actions are available.',
    };
  }
  if (!eligible.some(runnerSupportsAgentInventory)) {
    return {
      state: 'runner_filesystem_unsupported',
      message: 'The connected runner does not advertise runner-owned agent inventory. Upgrade and restart the runner before local filesystem actions are available.',
    };
  }
  const runner = eligible.find(runnerSupportsFilesystem);
  if (!runner) {
    return {
      state: 'runner_filesystem_unsupported',
      message: 'The connected runner does not support local filesystem actions. Update and restart the runner.',
    };
  }
  return { state: 'available', runnerId: runner.id };
}

export function getRunnerFilesystemSelection(
  userId?: string | null,
  workspaceId?: string | null,
  activationActorId?: string | null,
): { runnerId: string; capabilities: RunnerCapabilities | ProtocolRunnerCapabilities } | null {
  const runner = pickFilesystemRunner(userId, workspaceId, activationActorId);
  return runner ? { runnerId: runner.id, capabilities: runner.capabilities } : null;
}

export async function dispatchRunnerFilesystemRequest(params: {
  userId?: string | null;
  workspaceId?: string | null;
  activationActorId?: string | null;
  runnerId?: string | null;
  request: RunnerFilesystemRequest;
  timeoutMs?: number;
}): Promise<{ runnerId: string; result: RunnerFilesystemResult }> {
  const activationActorId = params.activationActorId ?? params.userId;
  const availability = getRunnerFilesystemAvailability(
    params.userId,
    params.workspaceId,
    activationActorId,
  );
  if (availability.state !== 'available') {
    throw new Error(`${availability.state}: ${availability.message}`);
  }
  const runner = params.runnerId
    ? runners.get(params.runnerId) ?? null
    : pickFilesystemRunner(params.userId, params.workspaceId, activationActorId);
  if (!runner) {
    throw new Error('runner_unavailable: No paired runner is connected for this workspace.');
  }
  if (
    params.runnerId &&
    !runnerMatchesFilesystemRequest(
      runner,
      params.userId,
      params.workspaceId,
      activationActorId,
    )
  ) {
    throw new Error('runner_unavailable: The selected runner is not available for this workspace.');
  }
  if (
    Array.isArray(runner.capabilities.filesystemOperations) &&
    !runner.capabilities.filesystemOperations.includes(params.request.action)
  ) {
    throw new Error(
      `runner_filesystem_unsupported: The selected runner does not advertise filesystem operation ${params.request.action}. Update and restart the runner.`,
    );
  }
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timeoutMs = params.timeoutMs ?? 30_000;
    const timeout = setTimeout(() => {
      filesystemRequestsById.delete(requestId);
      reject(new Error(`operation_failed: Runner filesystem request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timeout.unref?.();
    filesystemRequestsById.set(requestId, {
      requestId,
      timeout,
      resolve: (result) => resolve({ runnerId: runner.id, result }),
      reject,
    });
    send(runner.ws, {
      type: 'filesystem_request',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      requestId,
      request: params.request,
    });
  });
}

export function disconnectRemoteAgentRunner(runnerId: string): boolean {
  const runner = runners.get(runnerId);
  if (!runner) return false;
  runner.ws.close(1008, 'Runner revoked');
  runners.delete(runnerId);
  for (const jobId of [...runner.activeJobIds]) {
    failPendingJob(jobId, new Error(`Runner ${runnerId} revoked`));
  }
  return true;
}

const PROVIDER_COMMANDS: Record<RunnerJobIntent['provider'], string> = {
  claude: 'claude',
  codex: 'codex',
  qwen: 'qwen',
  cursor: 'cursor-agent',
  opencode: 'opencode',
};

function hasAnyLiveOpenRunner(): boolean {
  return [...runners.values()].some(
    (runner) => runnerIsOpen(runner) && getConnectedRunnerLiveStatus(runner) !== 'stale',
  );
}

function hasUpgradeRequiredRunner(
  userId?: string | null,
  workspaceId?: string | null,
  activationActorId?: string | null,
): boolean {
  const actor = resolveActivationActorId(userId, activationActorId);
  return [...runners.values()].some(
    (runner) =>
      runnerIsOpen(runner) &&
      getConnectedRunnerLiveStatus(runner) !== 'stale' &&
      runnerMatchesActivationScope(runner, actor, workspaceId) &&
      ((typeof runner.capabilities?.protocolVersion === 'string' &&
        runner.capabilities.protocolVersion !== RUNNER_PROTOCOL_VERSION) ||
        (runnerUsesCurrentProtocol(runner) && !runnerSupportsAgentInventory(runner))),
  );
}

function hasProviderCapableCurrentRunner(
  userId?: string | null,
  workspaceId?: string | null,
  provider?: RunnerJobIntent['provider'],
  activationActorId?: string | null,
): boolean {
  const actor = resolveActivationActorId(userId, activationActorId);
  return [...runners.values()].some(
    (runner) =>
      runnerIsOpen(runner) &&
      getConnectedRunnerLiveStatus(runner) !== 'stale' &&
      runnerUsesCurrentProtocol(runner) &&
      runnerMatchesActivationScope(runner, actor, workspaceId) &&
      runnerSupportsProvider(runner, provider),
  );
}

export function getRemoteAgentRunnerUnavailableMessage(
  first?: string | null,
  second?: string | RunnerJobIntent['provider'] | null,
  third?: RunnerJobIntent['provider'] | null,
  fourth?: string | null,
): string {
  const scope = parseRunnerDispatchScope(first, second, third ?? undefined, fourth);
  const { routingUserId: userId, workspaceId, provider, activationActorId } = scope;

  if (!hasAnyLiveOpenRunner()) {
    return 'No remote agent runner is connected. Start or pair an OpenWork runner, then try again.';
  }

  const activationDenial = findRunnerActivationDenial(userId, workspaceId, activationActorId);
  if (activationDenial) {
    void auditRunnerActivationDenied({
      activationActorId: resolveActivationActorId(userId, activationActorId) ?? '',
      runnerId: activationDenial.runnerId,
      category: activationDenial.category,
      routingWorkspaceId: workspaceId ?? '',
    });
    return activationDenial.message;
  }

  if (!hasConnectedRemoteAgentRunner(userId, workspaceId, activationActorId)) {
    return 'No eligible remote agent runner is connected for this workspace.';
  }
  if (hasUpgradeRequiredRunner(userId, workspaceId, activationActorId)) {
    return `The connected remote agent runner must be upgraded to advertise runner-owned agent inventory for protocol ${RUNNER_PROTOCOL_VERSION} before it can accept new work.`;
  }
  if (provider && hasProviderCapableCurrentRunner(userId, workspaceId, provider, activationActorId)) {
    return `No eligible remote agent runner allows the required ${provider} tool with dangerous approval mode. Update the runner policy advertisement or choose another model.`;
  }
  if (provider && !hasAvailableRemoteAgentRunner(userId, workspaceId, provider, activationActorId)) {
    return `No eligible remote agent runner supports ${provider}. Install ${PROVIDER_COMMANDS[provider]} on the runner, restart it, or choose another model.`;
  }
  return 'No eligible remote agent runner is connected for this workspace.';
}

export function onRemoteAgentRunnerAvailable(listener: () => void): () => void {
  availableRunnerListeners.add(listener);
  return () => {
    availableRunnerListeners.delete(listener);
  };
}

export function dispatchRemoteAgentJob(
  job: RemoteAgentJob,
  callbacks: RemoteAgentJobCallbacks = {},
): Promise<RemoteAgentJobResult> {
  const activationActorId = job.activationActorId ?? job.userId;
  const runner = pickSpecificRunner(
    job.runnerId,
    job.userId,
    job.workspaceId,
    job.intent.provider,
    activationActorId,
  );
  if (!runner) {
    return Promise.reject(
      new Error(
        getRemoteAgentRunnerUnavailableMessage(
          job.userId,
          job.workspaceId,
          job.intent.provider,
          activationActorId,
        ),
      ),
    );
  }
  if (jobIncludesWorkspaceSetupPayload(job.intent)) {
    return Promise.reject(
      new Error(
        'Workspace materialization is not part of ordinary runner job execution; use the named workspace setup/sync operation before dispatch.',
      ),
    );
  }
  if (jobRequiresAttachmentStaging(job.intent) && !runnerSupportsAttachmentStaging(runner)) {
    return Promise.reject(
      new Error('Attachment/context staging is unavailable for native runner jobs.'),
    );
  }

  const jobId = randomUUID();
  runner.activeJobIds.add(jobId);
  runner.lastSeenAt = new Date().toISOString();
  noteConnectedRunnerSeen(runner);
  recordRunLifecycle(job.intent.runId, {
    event: 'backend_job_dispatching',
    runnerId: runner.id,
    jobId,
    message: `Dispatching ${job.intent.provider} runner job`,
  });

  return new Promise<RemoteAgentJobResult>((resolve, reject) => {
    const timeoutMs = job.timeoutMs ?? env.REMOTE_AGENT_RUN_TIMEOUT_MS;
    const timeout =
      timeoutMs > 0
        ? setTimeout(() => {
            cancelRemoteAgentRun(job.intent.runId);
            failPendingJob(jobId, new Error(`Remote agent run timed out after ${timeoutMs}ms`));
          }, timeoutMs)
        : null;
    timeout?.unref();

    jobsById.set(jobId, {
      jobId,
      runId: job.intent.runId,
      callbacks,
      resolve,
      reject,
      stdout: '',
      stderr: '',
      timeout,
    });
    jobRunnerById.set(jobId, runner.id);
    jobIdByRunId.set(job.intent.runId, jobId);

    send(runner.ws, {
      type: 'job_offer',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId,
      job: job.intent,
    });
    recordRunLifecycle(job.intent.runId, {
      event: 'backend_job_offer_sent',
      runnerId: runner.id,
      jobId,
    });
  });
}

export function cancelRemoteAgentRun(runId: string): boolean {
  const jobId = jobIdByRunId.get(runId);
  if (!jobId) return false;
  const runnerId = jobRunnerById.get(jobId);
  const runner = runnerId ? runners.get(runnerId) : null;
  if (!runner) return false;
  send(runner.ws, { type: 'cancel', protocolVersion: RUNNER_PROTOCOL_VERSION, jobId, runId });
  return true;
}

/** True while this run has an in-flight remote job on this backend process. */
export function isRemoteAgentRunPending(runId: string): boolean {
  return jobIdByRunId.has(runId);
}

export const __runnerTestUtils = {
  getConnectedRunnerLiveStatus,
  handleRunnerMessage,
  isRunnerStale,
  pickRunner,
  reattachInFlightJobsToRunner,
  runners,
  jobsById,
  filesystemRequestsById,
  jobRunnerById,
  jobIdByRunId,
  failJobsForDisconnectedRunner,
  scheduleRunnerDisconnectGrace,
  clearRunnerReconnectGrace,
  runnerReconnectGraceTimers,
};

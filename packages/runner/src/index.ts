#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import {
  RUNNER_PROTOCOL_VERSION,
  extractFinalResponseText,
  parseRunnerJobIntent,
  parseServerRunnerMessage,
  type RunnerAgentInventoryEntry,
  type RunnerCapabilities,
  type RunnerFilesystemRequest,
  type RunnerFilesystemResult,
  type RunnerProvider,
  type RunnerRejectionCode,
  type RunnerServerMessage,
  type ServerRunnerMessage,
} from 'shared';
import { materializeStagedAttachments } from './attachment-staging.js';
import { finalizeCodexRunnerLogs } from './codex-final-message.js';
import { buildRunnerTerminalMessage } from './terminal-message.js';
import {
  PROVIDER_BINARIES,
  createExecutionPlan,
  isPolicyFailure,
  materializeRunnerWorkspace,
  resolveProviderExecutable,
  spawnDetachedExecutionPlan,
  type DetachedExecutionProcess,
} from './executor.js';
import {
  handleAgentWorkspaceFileRequest,
  importAttachmentToWorkspace,
  prepareWorkspacePath,
  RunnerFilesystemError,
  validateRepositoryRoot,
} from './workspace-prepare.js';

const RUNNER_VERSION = '0.0.1';
const serverUrl = process.env.OPENWORK_SERVER_URL;
const runnerName = process.env.OPENWORK_RUNNER_NAME || os.hostname();
const workspaceRoot = path.resolve(process.env.OPENWORK_RUNNER_WORKSPACE_ROOT || process.cwd());
const configPath =
  process.env.OPENWORK_RUNNER_CONFIG ||
  path.join(os.homedir(), '.openwork-runner', 'config.json');
const stateDir =
  process.env.OPENWORK_RUNNER_STATE_DIR ||
  path.join(path.dirname(configPath), 'jobs');

interface RunnerConfig {
  serverUrl?: string;
  runnerId?: string;
  credential?: string;
  runnerVersion?: string;
  pairedAt?: string;
}

if (!serverUrl) {
  console.error('OPENWORK_SERVER_URL is required.');
  process.exit(1);
}

interface SupervisedJob {
  jobId: string;
  runId: string;
  provider: RunnerProvider;
  pid: number | null;
  startedAt: string;
  stdoutPath: string;
  stderrPath: string;
  outputLastMessagePath?: string;
  child?: DetachedExecutionProcess;
  stdoutOffset: number;
  stderrOffset: number;
  stdoutBytes: number;
  stderrBytes: number;
  lastOutputAt?: string;
  lastOutputStream?: 'stdout' | 'stderr';
  finalizedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  finalized: boolean;
}

interface PersistedJob {
  jobId: string;
  runId: string;
  provider: SupervisedJob['provider'];
  pid: number | null;
  startedAt: string;
  stdoutPath: string;
  stderrPath: string;
  outputLastMessagePath?: string;
  stdoutBytes?: number;
  stderrBytes?: number;
  lastOutputAt?: string;
  lastOutputStream?: 'stdout' | 'stderr';
  finalizedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
}

const jobs = new Map<string, SupervisedJob>();
let activeWs: WebSocket | null = null;
let pairingRetryInFlight = false;
let pairingRetryAttempted = false;
const pendingServerMessages: RunnerServerMessage[] = [];
const JOB_LOG_POLL_MS = 500;
const RUNNER_HEARTBEAT_INTERVAL_MS = 30_000;
const JOB_DEBUG_CLEANUP_TTL_MS = Number(process.env.OPENWORK_RUNNER_JOB_DEBUG_TTL_MS ?? 5 * 60 * 1000);
const SUPPORTED_FILESYSTEM_OPERATIONS: NonNullable<RunnerCapabilities['filesystemOperations']> = [
  'browse',
  'pick_folder',
  'reveal',
  'validate_repository_root',
  'prepare_workspace',
  'list_agent_files',
  'read_agent_file',
  'write_agent_file',
  'create_agent_folder',
  'delete_agent_path',
  'reveal_agent_path',
  'import_agent_files',
  'import_attachment',
];

function directoryMtimeIso(dirPath: string, fallback: string): string {
  try {
    return fs.statSync(dirPath).mtime.toISOString();
  } catch {
    return fallback;
  }
}

function listDirectoryEntries(dirPath: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

const REPOSITORY_SCAN_IGNORE_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
]);

type DiscoveredRunnerAgentInventoryEntry = RunnerAgentInventoryEntry & {
  repositoryRootPath?: string;
  source?: 'no_repository_workspace' | 'repository_workspace' | 'repository_scan';
};

function discoverRunnerAgentInventory(advertisedAt: string): DiscoveredRunnerAgentInventoryEntry[] {
  const entries: DiscoveredRunnerAgentInventoryEntry[] = [];
  const seen = new Set<string>();

  const addEntry = (entry: DiscoveredRunnerAgentInventoryEntry) => {
    const key = `${entry.agentId}:${entry.workspaceRootPath ?? ''}:${entry.repositoryRootPath ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
  };

  const noRepositoryRoot = path.join(workspaceRoot, '.openwork', 'no-repository-agents');
  for (const agentDir of listDirectoryEntries(noRepositoryRoot)) {
    if (!agentDir.isDirectory()) continue;
    const agentWorkspacePath = path.join(noRepositoryRoot, agentDir.name, 'workspace');
    try {
      if (!fs.statSync(agentWorkspacePath).isDirectory()) continue;
    } catch {
      continue;
    }
    addEntry({
      agentId: agentDir.name,
      readiness: 'ready',
      fileOperations: SUPPORTED_FILESYSTEM_OPERATIONS,
      workspaceRootPath: agentWorkspacePath,
      source: 'no_repository_workspace',
      updatedAt: directoryMtimeIso(agentWorkspacePath, advertisedAt),
    });
  }

  const scanRepositoryRoot = (
    repositoryRoot: string,
    source: NonNullable<DiscoveredRunnerAgentInventoryEntry['source']>,
  ) => {
    const repositoryAgentsRoot = path.join(repositoryRoot, '.openwork', 'agents');
    for (const agentDir of listDirectoryEntries(repositoryAgentsRoot)) {
      if (!agentDir.isDirectory()) continue;
      const agentWorkspacePath = path.join(repositoryAgentsRoot, agentDir.name);
      addEntry({
        agentId: agentDir.name,
        readiness: 'ready',
        fileOperations: SUPPORTED_FILESYSTEM_OPERATIONS,
        workspaceRootPath: agentWorkspacePath,
        repositoryRootPath: repositoryRoot,
        source,
        updatedAt: directoryMtimeIso(agentWorkspacePath, advertisedAt),
      });
    }
  };

  scanRepositoryRoot(workspaceRoot, 'repository_workspace');

  const scanForRepositories = (dirPath: string, depthRemaining: number) => {
    if (depthRemaining <= 0) return;
    for (const entry of listDirectoryEntries(dirPath)) {
      if (!entry.isDirectory()) continue;
      if (REPOSITORY_SCAN_IGNORE_DIRS.has(entry.name)) continue;
      const childPath = path.join(dirPath, entry.name);
      scanRepositoryRoot(childPath, 'repository_scan');
      scanForRepositories(childPath, depthRemaining - 1);
    }
  };
  scanForRepositories(workspaceRoot, 3);

  return entries;
}

export function buildRunnerCapabilities(): RunnerCapabilities {
  const supportedProviders = Object.entries(PROVIDER_BINARIES)
    .filter(([provider]) => resolveProviderExecutable(provider as keyof typeof PROVIDER_BINARIES))
    .map(([provider]) => provider as keyof typeof PROVIDER_BINARIES);
  const advertisedAt = new Date().toISOString();
  const agents = discoverRunnerAgentInventory(advertisedAt);
  const inventoryRevision = [
    RUNNER_PROTOCOL_VERSION,
    RUNNER_VERSION,
    workspaceRoot,
    supportedProviders.join(','),
    SUPPORTED_FILESYSTEM_OPERATIONS.join(','),
    agents.map((agent) => `${agent.agentId}:${agent.updatedAt}`).join(','),
  ].join('|');

  return {
    protocolVersion: RUNNER_PROTOCOL_VERSION,
    os: os.platform(),
    arch: os.arch(),
    runnerVersion: RUNNER_VERSION,
    workspaceRoot,
    installedProviders: supportedProviders,
    supportedProviders,
    supportedTools: supportedProviders,
    approvalModes: ['dangerous'],
    workspaceModes: ['shared', 'subfolder'],
    concurrency: {
      activeJobs: jobs.size,
      maxJobs: null,
    },
    supportsCancellation: true,
    supportsArtifacts: true,
    supportsFilesystem: true,
    filesystemOperations: SUPPORTED_FILESYSTEM_OPERATIONS,
    agentInventory: {
      protocolVersion: 1,
      revision: inventoryRevision,
      advertisedAt,
      ttlMs: RUNNER_HEARTBEAT_INTERVAL_MS * 4,
      workspaceRoots: [
        {
          id: 'default',
          path: workspaceRoot,
          scope: 'workspace',
          writable: true,
        },
      ],
      fileOperations: SUPPORTED_FILESYSTEM_OPERATIONS,
      agents,
    },
    policy: {
      workspaceRootRequired: Boolean(workspaceRoot),
      allowedTools: supportedProviders,
      approvalModes: ['dangerous'],
      envAccess: true,
      secretAccess: true,
      network: true,
      shell: true,
    },
  };
}

function revealPathInFileManager(targetPath: string) {
  if (process.platform === 'darwin') {
    const stat = fs.statSync(targetPath);
    spawn('open', stat.isDirectory() ? [targetPath] : ['-R', targetPath], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    return;
  }
  if (process.platform === 'win32') {
    spawn('explorer', [`/select,${targetPath}`], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  const target = fs.statSync(targetPath).isDirectory() ? targetPath : path.dirname(targetPath);
  spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
}

function runCommand(
  command: string,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string; error?: Error }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => resolve({ code: null, stdout, stderr, error }));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function pickFolder(startPath?: string): Promise<string | null> {
  if (process.platform !== 'darwin') {
    throw new Error('Native folder picker is not available on this runner platform.');
  }
  const defaultLocation =
    startPath && fs.existsSync(startPath)
      ? ` default location POSIX file "${escapeAppleScriptString(startPath)}"`
      : '';
  const result = await runCommand('osascript', [
    '-e',
    `POSIX path of (choose folder with prompt "Select repository folder"${defaultLocation})`,
  ]);
  if (result.code === 0) return result.stdout.trim() || null;
  if (/cancel|-128/i.test(`${result.stdout}\n${result.stderr}\n${result.error?.message ?? ''}`)) {
    return null;
  }
  throw new Error(result.stderr.trim() || result.error?.message || 'Folder picker failed');
}

async function handleFilesystemRequest(
  request: RunnerFilesystemRequest,
): Promise<RunnerFilesystemResult> {
  if (request.action === 'prepare_workspace') {
    return prepareWorkspacePath(request, workspaceRoot);
  }
  if (request.action === 'import_attachment') {
    const credential = process.env.OPENWORK_RUNNER_CREDENTIAL || readConfig().credential || '';
    return importAttachmentToWorkspace(request, workspaceRoot, {
      serverUrl: serverUrl!,
      credential,
    });
  }
  if (
    request.action === 'list_agent_files' ||
    request.action === 'read_agent_file' ||
    request.action === 'write_agent_file' ||
    request.action === 'create_agent_folder' ||
    request.action === 'delete_agent_path' ||
    request.action === 'reveal_agent_path' ||
    request.action === 'import_agent_files'
  ) {
    return handleAgentWorkspaceFileRequest(request, workspaceRoot, {
      revealPath: revealPathInFileManager,
    });
  }
  if (request.action === 'browse') {
    const dirPath = path.resolve(request.path);
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) throw new Error('Path is not a directory');
    const entries = fs.readdirSync(dirPath, { withFileTypes: true }).flatMap((entry) => {
      const entryPath = path.join(dirPath, entry.name);
      let entryStat: fs.Stats;
      try {
        entryStat = fs.statSync(entryPath);
      } catch {
        return [];
      }
      return [{
        name: entry.name,
        path: entryPath,
        type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
        size: entryStat.size,
        modifiedAt: entryStat.mtime.toISOString(),
      }];
    });
    return { action: 'browse', path: dirPath, entries };
  }
  if (request.action === 'pick_folder') {
    return { action: 'pick_folder', path: await pickFolder(request.startPath) };
  }
  if (request.action === 'reveal') {
    const targetPath = path.resolve(request.path);
    if (!fs.existsSync(targetPath)) throw new Error('Path not found');
    revealPathInFileManager(targetPath);
    return { action: 'reveal' };
  }
  const validated = validateRepositoryRoot(request.path, workspaceRoot);
  return {
    action: 'validate_repository_root',
    ...validated,
  };
}

function readConfig(): RunnerConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as RunnerConfig;
  } catch {
    return {};
  }
}

function writeConfig(config: RunnerConfig) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

async function pairWithCode(code: string): Promise<RunnerConfig> {
  console.log(`Pairing runner with ${serverUrl}...`);
  const res = await fetch(new URL('/api/agent-runners/pair', serverUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      displayName: runnerName,
      version: RUNNER_VERSION,
      capabilities: buildRunnerCapabilities(),
    }),
  });
  if (!res.ok) {
    throw new Error(`Pairing failed with HTTP ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { runner: { id: string }; credential: string };
  const config = {
    serverUrl,
    runnerId: data.runner.id,
    credential: data.credential,
    runnerVersion: RUNNER_VERSION,
    pairedAt: new Date().toISOString(),
  };
  writeConfig(config);
  console.log(`Paired runner ${data.runner.id}. Credential saved to ${configPath}`);
  return config;
}

function buildWebSocketUrl(): URL {
  const config = readConfig();
  const credentialFromEnv = process.env.OPENWORK_RUNNER_CREDENTIAL;
  if (!credentialFromEnv && config.credential && config.serverUrl && config.serverUrl !== serverUrl) {
    throw new Error(
      `Saved runner credential is for ${config.serverUrl}, but OPENWORK_SERVER_URL is ${serverUrl}. Set OPENWORK_RUNNER_PAIRING_CODE to pair this server or set OPENWORK_RUNNER_CREDENTIAL explicitly.`,
    );
  }
  const credential = credentialFromEnv || config.credential;
  const runnerId = process.env.OPENWORK_RUNNER_ID || config.runnerId;
  if (!credential) {
    throw new Error('Runner is not paired. Set OPENWORK_RUNNER_PAIRING_CODE once to pair this runner.');
  }
  const url = new URL('/api/runners/ws', serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('credential', credential);
  if (runnerId) url.searchParams.set('runnerId', runnerId);
  url.searchParams.set('name', runnerName);
  return url;
}

function send(ws: WebSocket, message: RunnerServerMessage) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(message));
}

function sendToServer(message: RunnerServerMessage) {
  if (activeWs?.readyState === WebSocket.OPEN) {
    activeWs.send(JSON.stringify(message));
    return;
  }
  pendingServerMessages.push(message);
}

function flushPendingServerMessages() {
  while (activeWs?.readyState === WebSocket.OPEN && pendingServerMessages.length > 0) {
    activeWs.send(JSON.stringify(pendingServerMessages.shift()));
  }
}

function announceActiveJobs(ws: WebSocket) {
  for (const job of jobs.values()) {
    send(ws, {
      type: 'job_accepted',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId: job.jobId,
      runId: job.runId,
    });
  }
}

function parseMessage(raw: WebSocket.RawData): ServerRunnerMessage | null {
  try {
    return parseServerRunnerMessage(JSON.parse(raw.toString()));
  } catch {
    return null;
  }
}

function rejectJob(
  ws: WebSocket,
  jobId: string,
  runId: string | undefined,
  code: RunnerRejectionCode,
  message: string,
) {
  const rejection = {
    type: 'job_rejected',
    protocolVersion: RUNNER_PROTOCOL_VERSION,
    jobId,
    runId,
    code,
    message,
  } as RunnerServerMessage;
  if (ws.readyState === WebSocket.OPEN) send(ws, rejection);
  else sendToServer(rejection);
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function jobDir(jobId: string, runId: string): string {
  return path.join(stateDir, `${safeId(runId)}-${safeId(jobId)}`);
}

function jobStatePath(jobId: string, runId: string): string {
  return path.join(jobDir(jobId, runId), 'job.json');
}

function persistJob(job: SupervisedJob) {
  fs.mkdirSync(path.dirname(jobStatePath(job.jobId, job.runId)), { recursive: true });
  const payload: PersistedJob = {
    jobId: job.jobId,
    runId: job.runId,
    provider: job.provider,
    pid: job.pid,
    startedAt: job.startedAt,
    stdoutPath: job.stdoutPath,
    stderrPath: job.stderrPath,
    outputLastMessagePath: job.outputLastMessagePath,
    stdoutBytes: job.stdoutBytes,
    stderrBytes: job.stderrBytes,
    lastOutputAt: job.lastOutputAt,
    lastOutputStream: job.lastOutputStream,
    finalizedAt: job.finalizedAt,
    exitCode: job.exitCode,
    signal: job.signal,
  };
  fs.writeFileSync(jobStatePath(job.jobId, job.runId), `${JSON.stringify(payload, null, 2)}\n`, {
    mode: 0o600,
  });
}

function removePersistedJob(job: SupervisedJob) {
  const dir = jobDir(job.jobId, job.runId);
  const cleanup = () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  };
  if (JOB_DEBUG_CLEANUP_TTL_MS <= 0) {
    cleanup();
    return;
  }
  const timer = setTimeout(cleanup, JOB_DEBUG_CLEANUP_TTL_MS);
  timer.unref?.();
}

function readFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readNewLogText(filePath: string, offset: number): { text: string; offset: number } {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      if (size <= offset) return { text: '', offset: size };
      const buffer = Buffer.alloc(size - offset);
      fs.readSync(fd, buffer, 0, buffer.length, offset);
      return { text: buffer.toString('utf-8'), offset: size };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { text: '', offset };
  }
}

function sendJobOutput(job: SupervisedJob, stream: 'stdout' | 'stderr', text: string) {
  if (!text) return;
  sendToServer({
    type: 'output_event',
    protocolVersion: RUNNER_PROTOCOL_VERSION,
    jobId: job.jobId,
    runId: job.runId,
    stream,
    text,
  });
}

function readNewJobOutput(job: SupervisedJob) {
  const stdout = readNewLogText(job.stdoutPath, job.stdoutOffset);
  job.stdoutOffset = stdout.offset;
  if (stdout.text) {
    job.stdoutBytes += Buffer.byteLength(stdout.text);
    job.lastOutputAt = new Date().toISOString();
    job.lastOutputStream = 'stdout';
    persistJob(job);
  }
  sendJobOutput(job, 'stdout', stdout.text);

  const stderr = readNewLogText(job.stderrPath, job.stderrOffset);
  job.stderrOffset = stderr.offset;
  if (stderr.text) {
    job.stderrBytes += Buffer.byteLength(stderr.text);
    job.lastOutputAt = new Date().toISOString();
    job.lastOutputStream = 'stderr';
    persistJob(job);
  }
  sendJobOutput(job, 'stderr', stderr.text);
}

function inferRecoveredExitCode(stdout: string, stderr: string): number | null {
  if (extractFinalResponseText(stdout)) return 0;
  if (stderr.trim()) return 1;
  return null;
}

function startPollingJob(job: SupervisedJob) {
  if (job.pollTimer) return;
  job.pollTimer = setInterval(() => {
    readNewJobOutput(job);
    if (job.child || !job.pid || isPidAlive(job.pid)) return;
    finalizeJob(job, inferRecoveredExitCode(readFile(job.stdoutPath), readFile(job.stderrPath)), null);
  }, JOB_LOG_POLL_MS);
  job.pollTimer.unref?.();
}

function stopPollingJob(job: SupervisedJob) {
  if (!job.pollTimer) return;
  clearInterval(job.pollTimer);
  job.pollTimer = null;
}

function finalizeJob(job: SupervisedJob, code: number | null, signal: NodeJS.Signals | null) {
  if (job.finalized) return;
  job.finalized = true;
  job.finalizedAt = new Date().toISOString();
  job.exitCode = code;
  job.signal = signal;
  persistJob(job);
  stopPollingJob(job);

  if (signal) {
    const diag = `[openwork-runner] child terminated by signal ${signal} (code=${code ?? 'null'}) for run ${job.runId}\n`;
    try {
      fs.appendFileSync(job.stderrPath, diag);
    } catch {
      // Best-effort diagnostic.
    }
    console.warn(diag.trim());
  }

  readNewJobOutput(job);

  const stdout = readFile(job.stdoutPath);
  const stderr = readFile(job.stderrPath);
  const lastMessage = readOutputLastMessage(job.outputLastMessagePath);
  const finalized =
    job.provider === 'codex'
      ? finalizeCodexRunnerLogs({
          runId: job.runId,
          code,
          stdout,
          stderr,
          outputLastMessagePath: job.outputLastMessagePath,
          lastMessage,
        })
      : {
          code,
          stdout,
          stderr,
          appendedFinalMessage: false,
        };

  if (finalized.stdout !== stdout) {
    const appended = finalized.stdout.startsWith(stdout)
      ? finalized.stdout.slice(stdout.length)
      : finalized.stdout;
    sendJobOutput(job, 'stdout', appended);
  }
  if (finalized.stderr !== stderr) {
    const appended = finalized.stderr.startsWith(stderr)
      ? finalized.stderr.slice(stderr.length)
      : finalized.stderr;
    sendJobOutput(job, 'stderr', appended);
  }

  sendToServer(buildRunnerTerminalMessage({
    jobId: job.jobId,
    runId: job.runId,
    provider: job.provider,
    code: finalized.code,
    stdout: finalized.stdout,
    stderr: finalized.stderr,
  }));

  jobs.delete(job.jobId);
  removePersistedJob(job);
}

function terminateJob(job: SupervisedJob) {
  if (!job.pid) return;
  try {
    if (process.platform !== 'win32') process.kill(-job.pid, 'SIGTERM');
    else process.kill(job.pid, 'SIGTERM');
  } catch {
    try {
      process.kill(job.pid, 'SIGTERM');
    } catch {
      // Process may already be gone.
    }
  }
}

function recoverPersistedJobs() {
  if (!fs.existsSync(stateDir)) return;

  const entries = fs.readdirSync(stateDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const statePath = path.join(stateDir, entry.name, 'job.json');
    let persisted: PersistedJob;
    try {
      persisted = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as PersistedJob;
    } catch {
      continue;
    }
    if (!persisted.jobId || !persisted.runId || !persisted.provider) continue;

    const job: SupervisedJob = {
      jobId: persisted.jobId,
      runId: persisted.runId,
      provider: persisted.provider,
      pid: persisted.pid,
      startedAt: persisted.startedAt ?? new Date().toISOString(),
      stdoutPath: persisted.stdoutPath,
      stderrPath: persisted.stderrPath,
      outputLastMessagePath: persisted.outputLastMessagePath,
      stdoutOffset: fileSize(persisted.stdoutPath),
      stderrOffset: fileSize(persisted.stderrPath),
      stdoutBytes: persisted.stdoutBytes ?? fileSize(persisted.stdoutPath),
      stderrBytes: persisted.stderrBytes ?? fileSize(persisted.stderrPath),
      lastOutputAt: persisted.lastOutputAt,
      lastOutputStream: persisted.lastOutputStream,
      finalizedAt: persisted.finalizedAt,
      exitCode: persisted.exitCode,
      signal: persisted.signal,
      pollTimer: null,
      finalized: false,
    };
    jobs.set(job.jobId, job);

    if (job.pid && isPidAlive(job.pid)) {
      startPollingJob(job);
      continue;
    }

    finalizeJob(job, inferRecoveredExitCode(readFile(job.stdoutPath), readFile(job.stderrPath)), null);
  }
}

function readOutputLastMessage(filePath: string | undefined): string {
  if (!filePath) return '';
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return '';
  } finally {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
}

async function startJob(ws: WebSocket, jobId: string, job: ServerRunnerMessage & { type: 'job_offer' }) {
  let intent = parseRunnerJobIntent(job.job);

  if (job.protocolVersion !== RUNNER_PROTOCOL_VERSION) {
    rejectJob(
      ws,
      jobId,
      intent?.runId,
      'protocol_version_mismatch',
      `Unsupported runner protocol ${job.protocolVersion}; expected ${RUNNER_PROTOCOL_VERSION}`,
    );
    return;
  }

  if (!intent) {
    rejectJob(ws, jobId, undefined, 'invalid_job', 'Invalid or missing runner job payload');
    return;
  }

  const runId = intent.runId;
  try {
    const credential = process.env.OPENWORK_RUNNER_CREDENTIAL || readConfig().credential;
    if (!credential && intent.stagingManifest?.attachments.length) {
      throw new Error('Runner credential is unavailable for attachment staging');
    }
    intent = await materializeStagedAttachments(intent, {
      serverUrl: serverUrl!,
      credential: credential ?? '',
    });
  } catch (error) {
    rejectJob(
      ws,
      jobId,
      runId,
      'invalid_job',
      `Attachment materialization failed: ${(error as Error).message}`,
    );
    return;
  }

  const plan = createExecutionPlan(intent, buildRunnerCapabilities());
  if (isPolicyFailure(plan)) {
    rejectJob(ws, jobId, runId, plan.code, plan.message);
    return;
  }

  send(ws, {
    type: 'job_accepted',
    protocolVersion: RUNNER_PROTOCOL_VERSION,
    jobId,
    runId,
  });

  const dir = jobDir(jobId, runId);
  fs.mkdirSync(dir, { recursive: true });
  const stdoutPath = path.join(dir, 'stdout.log');
  const stderrPath = path.join(dir, 'stderr.log');
  const stdoutFd = fs.openSync(stdoutPath, 'w');
  const stderrFd = fs.openSync(stderrPath, 'w');
  let child: DetachedExecutionProcess;
  try {
    child = spawnDetachedExecutionPlan(plan, { stdoutFd, stderrFd });
  } catch (error) {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
    rejectJob(ws, jobId, runId, 'spawn_failed', (error as Error).message);
    return;
  }
  fs.closeSync(stdoutFd);
  fs.closeSync(stderrFd);

  const supervised: SupervisedJob = {
    jobId,
    runId,
    provider: intent.provider,
    pid: child.pid ?? null,
    startedAt: new Date().toISOString(),
    stdoutPath,
    stderrPath,
    outputLastMessagePath: plan.outputLastMessagePath,
    child,
    stdoutOffset: 0,
    stderrOffset: 0,
    stdoutBytes: 0,
    stderrBytes: 0,
    pollTimer: null,
    finalized: false,
  };
  jobs.set(jobId, supervised);
  persistJob(supervised);
  startPollingJob(supervised);

  child.on('error', (error) => {
    supervised.finalized = true;
    stopPollingJob(supervised);
    jobs.delete(jobId);
    removePersistedJob(supervised);
    rejectJob(ws, jobId, runId, 'spawn_failed', error.message);
  });

  child.on('close', (code, signal) => {
    finalizeJob(supervised, code, signal);
  });

  if (child.stdin) {
    child.stdin.end(plan.stdinData ?? '');
  }
}

function handleWorkspaceSetup(
  ws: WebSocket,
  message: ServerRunnerMessage & { type: 'workspace_setup' },
) {
  try {
    materializeRunnerWorkspace(message.setup);
    send(ws, {
      type: 'workspace_setup_completed',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      setupId: message.setupId,
    });
  } catch (error) {
    send(ws, {
      type: 'workspace_setup_failed',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      setupId: message.setupId,
      message: (error as Error).message,
    });
  }
}

function retryPairAfterAuthRejection(): boolean {
  const pairingCode = process.env.OPENWORK_RUNNER_PAIRING_CODE;
  if (!pairingCode || pairingRetryInFlight || pairingRetryAttempted) return false;
  pairingRetryAttempted = true;
  pairingRetryInFlight = true;
  console.warn('Saved runner credential was rejected. Re-pairing with OPENWORK_RUNNER_PAIRING_CODE...');
  void pairWithCode(pairingCode)
    .catch((error: Error) => {
      console.error(error.message);
    })
    .finally(() => {
      pairingRetryInFlight = false;
      setTimeout(connect, 2000);
    });
  return true;
}

function connect() {
  const config = readConfig();
  let wsUrl: URL;
  try {
    wsUrl = buildWebSocketUrl();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  const ws = new WebSocket(wsUrl);
  const runnerId = process.env.OPENWORK_RUNNER_ID || config.runnerId || '';
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let authRetryScheduled = false;
  let authRejected = false;

  const sendRunnerAdvertisement = (type: 'runner_hello' | 'runner_heartbeat') => {
    send(ws, {
      type,
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      runnerId,
      name: runnerName,
      capabilities: buildRunnerCapabilities(),
    });
  };

  ws.on('open', () => {
    activeWs = ws;
    sendRunnerAdvertisement('runner_hello');
    heartbeatTimer = setInterval(
      () => sendRunnerAdvertisement('runner_heartbeat'),
      RUNNER_HEARTBEAT_INTERVAL_MS,
    );
    heartbeatTimer.unref?.();
    flushPendingServerMessages();
    announceActiveJobs(ws);
    console.log(`Connected runner ${runnerId} to ${serverUrl}`);
  });

  ws.on('message', (raw) => {
    const message = parseMessage(raw);
    if (!message) return;
    if (message.type === 'server_hello') return;
    if (message.type === 'job_offer') {
      void startJob(ws, message.jobId, message);
      return;
    }
    if (message.type === 'workspace_setup') {
      handleWorkspaceSetup(ws, message);
      return;
    }
    if (message.type === 'cancel') {
      const job = jobs.get(message.jobId);
      if (job) terminateJob(job);
      return;
    }
    if (message.type === 'filesystem_request') {
      void handleFilesystemRequest(message.request)
        .then((result) => {
          send(ws, {
            type: 'filesystem_response',
            protocolVersion: RUNNER_PROTOCOL_VERSION,
            requestId: message.requestId,
            ok: true,
            result,
          });
        })
        .catch((error) => {
          const code =
            error instanceof RunnerFilesystemError
              ? error.code
              : /not found/i.test((error as Error).message)
                ? 'not_found'
                : 'operation_failed';
          send(ws, {
            type: 'filesystem_response',
            protocolVersion: RUNNER_PROTOCOL_VERSION,
            requestId: message.requestId,
            ok: false,
            code,
            message: (error as Error).message,
          });
        });
    }
  });

  ws.on('close', (closeCode, closeReason) => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    const inFlight = jobs.size;
    if (inFlight > 0) {
      console.warn(
        `[openwork-runner] WS closed (code=${closeCode}, reason=${closeReason?.toString() || ''}) while ${inFlight} job(s) in-flight; keeping child process(es) alive for reconnect`,
      );
    }
    if (activeWs === ws) activeWs = null;
    if (authRetryScheduled) return;
    if (authRejected && retryPairAfterAuthRejection()) {
      authRetryScheduled = true;
      return;
    }
    setTimeout(connect, 2000);
  });

  ws.on('unexpected-response', (_request, response) => {
    if (response.statusCode !== 401) return;
    authRejected = true;
    response.resume();
    if (retryPairAfterAuthRejection()) authRetryScheduled = true;
  });

  ws.on('error', (error) => {
    console.error(`Runner connection error: ${error.message}`);
  });
}

async function main() {
  const pairingCode = process.env.OPENWORK_RUNNER_PAIRING_CODE;
  const forcePair = process.env.OPENWORK_RUNNER_FORCE_PAIR === 'true';
  const config = readConfig();
  if (pairingCode && (forcePair || !config.credential || config.serverUrl !== serverUrl)) {
    await pairWithCode(pairingCode);
    pairingRetryAttempted = true;
  } else if (pairingCode) {
    console.log(
      `Using saved runner credential from ${configPath}. If the server rejects it, the provided pairing code will be used once.`,
    );
  }
  recoverPersistedJobs();
  connect();
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});

import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {
  execFileSync,
  spawn,
  type ChildProcessByStdio,
  type StdioOptions,
} from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import type {
  RunnerAttachment,
  RunnerCapabilities,
  RunnerJobIntent,
  RunnerProvider,
  RunnerRejectionCode,
  RunnerWorkspaceMaterialization,
  RunnerWorkspaceSetupIntent,
} from 'shared';

interface CliCommand {
  bin: string;
  args: string[];
}

export interface JobPolicyFailure {
  code: RunnerRejectionCode;
  message: string;
}

export interface JobExecutionPlan {
  command: CliCommand;
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdinData?: string;
  outputLastMessagePath?: string;
}

export type SpawnedExecutionProcess = ChildProcessByStdio<Writable | null, Readable, Readable>;

export type DetachedExecutionProcess = ChildProcessByStdio<Writable | null, null, null>;

export const PROVIDER_BINARIES: Record<RunnerProvider, string> = {
  claude: 'claude',
  codex: 'codex',
  qwen: 'qwen',
  cursor: 'cursor-agent',
  opencode: 'opencode',
};

const COMMON_CLI_SEARCH_DIRS = [
  path.join(os.homedir(), '.opencode', 'bin'),
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), '.cargo', 'bin'),
  path.join(os.homedir(), '.bun', 'bin'),
  path.join(os.homedir(), '.deno', 'bin'),
  path.join(os.homedir(), '.npm-global', 'bin'),
  path.join(os.homedir(), 'Library', 'pnpm'),
  path.join(os.homedir(), 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/opt/local/bin',
  '/usr/bin',
  '/bin',
];

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    fs.accessSync(filePath, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function getWindowsExecutableNames(command: string): string[] {
  const pathExts = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const lowerCommand = command.toLowerCase();
  if (pathExts.some((ext) => lowerCommand.endsWith(ext.toLowerCase()))) {
    return [command];
  }
  return [command, ...pathExts.map((ext) => `${command}${ext}`)];
}

function candidateExecutableNames(command: string): string[] {
  return process.platform === 'win32' ? getWindowsExecutableNames(command) : [command];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function resolveCommandFromShell(command: string): string | null {
  const shell = process.env.SHELL;
  if (!shell || process.platform === 'win32') return null;

  try {
    const output = execFileSync(shell, ['-lic', `command -v ${shellQuote(command)}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    });
    const firstLine = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (firstLine && path.isAbsolute(firstLine) && isExecutableFile(firstLine)) {
      return firstLine;
    }
  } catch {
    return null;
  }

  return null;
}

function listNvmBinDirs(): string[] {
  const versionsRoot = path.join(os.homedir(), '.nvm', 'versions', 'node');
  try {
    return fs
      .readdirSync(versionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(versionsRoot, entry.name, 'bin'));
  } catch {
    return [];
  }
}

function getCommandSearchDirs(): string[] {
  return Array.from(
    new Set([
      ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean),
      ...(process.env.OPENWORK_RUNNER_EXTRA_PATH ?? '').split(path.delimiter).filter(Boolean),
      ...listNvmBinDirs(),
      ...COMMON_CLI_SEARCH_DIRS,
    ]),
  );
}

function buildRunnerPath(commandBin: string): string {
  return Array.from(new Set([path.dirname(commandBin), ...getCommandSearchDirs()])).join(
    path.delimiter,
  );
}

export function resolveCommandExecutable(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  const hasPathSeparator =
    trimmed.includes(path.sep) || (path.posix.sep !== path.sep && trimmed.includes(path.posix.sep));
  if (hasPathSeparator) {
    return isExecutableFile(trimmed) ? path.resolve(trimmed) : null;
  }

  for (const dir of getCommandSearchDirs()) {
    for (const candidateName of candidateExecutableNames(trimmed)) {
      const candidatePath = path.join(dir, candidateName);
      if (isExecutableFile(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return resolveCommandFromShell(trimmed);
}

export function resolveProviderExecutable(provider: RunnerProvider): string | null {
  return resolveCommandExecutable(PROVIDER_BINARIES[provider]);
}

function stringifyMetadata(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

function formatAttachmentForPrompt(attachment: RunnerAttachment, index: number): string {
  const lines = [
    `- ${index + 1}.`,
    `  filename: ${attachment.filename}`,
    `  type: ${attachment.type}`,
    `  path: ${attachment.path}`,
    `  mimeType: ${attachment.mimeType}`,
    `  sizeBytes: ${attachment.sizeBytes}`,
  ];

  if (attachment.textExtraction) {
    const extractionParts = [`status=${attachment.textExtraction.status}`];
    if (attachment.textExtraction.textPath) {
      extractionParts.push(`textPath=${attachment.textExtraction.textPath}`);
    }
    if (typeof attachment.textExtraction.charCount === 'number') {
      extractionParts.push(`charCount=${attachment.textExtraction.charCount}`);
    }
    if (typeof attachment.textExtraction.truncated === 'boolean') {
      extractionParts.push(`truncated=${attachment.textExtraction.truncated}`);
    }
    if (attachment.textExtraction.error) {
      extractionParts.push(`error=${attachment.textExtraction.error}`);
    }
    lines.push(`  textExtraction: ${extractionParts.join(', ')}`);
  }

  if (attachment.manifest) {
    lines.push(`  manifest: ${stringifyMetadata(attachment.manifest)}`);
  }

  return lines.join('\n');
}

function appendAttachmentMetadataToPrompt(prompt: string, attachments: RunnerAttachment[]): string {
  if (attachments.length === 0) return prompt;
  const manifest = attachments.map(formatAttachmentForPrompt).join('\n');
  const section = `Attachments:\n${manifest}`;
  return `${prompt ? `${prompt}\n\n` : ''}${section}`;
}

function getNativeAttachmentArgs(
  provider: RunnerProvider,
  attachments: RunnerAttachment[],
): string[] {
  if (attachments.length === 0) return [];

  if (provider === 'codex') {
    const imagePaths = attachments
      .filter((attachment) => attachment.type === 'image')
      .map((attachment) => attachment.path);
    return imagePaths.length > 0 ? ['--image', ...imagePaths] : [];
  }

  if (provider === 'opencode') {
    return attachments.flatMap((attachment) => ['--file', attachment.path]);
  }

  return [];
}

export function inferProvider(model: string): RunnerProvider | null {
  const modelLower = model.trim().toLowerCase();
  if (modelLower.includes('claude')) return 'claude';
  if (modelLower.includes('codex')) return 'codex';
  if (modelLower.includes('qwen')) return 'qwen';
  if (modelLower.includes('cursor')) return 'cursor';
  if (modelLower.includes('opencode')) return 'opencode';
  return null;
}

export function buildCliCommand(
  job: RunnerJobIntent,
  resolvedBin?: string,
  options: { outputLastMessagePath?: string } = {},
): CliCommand {
  const attachments = job.attachments ?? [];
  const nativeAttachmentArgs = getNativeAttachmentArgs(job.provider, attachments);
  const fullPrompt = appendAttachmentMetadataToPrompt(job.prompt, attachments);
  const modelId = job.modelPreference.modelId;
  const thinkingLevel = job.modelPreference.thinkingLevel;
  const bin = resolvedBin ?? resolveProviderExecutable(job.provider);
  if (!bin) {
    throw new Error(
      `Provider ${job.provider} command ${PROVIDER_BINARIES[job.provider]} is not executable in the runner environment`,
    );
  }

  if (job.provider === 'claude') {
    const args = [
      '-p',
      fullPrompt,
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
    ];
    if (modelId) args.push('--model', modelId);
    if (thinkingLevel) args.push('--effort', thinkingLevel);
    if (job.allowedOperations.approvalMode === 'dangerous') {
      args.push('--dangerously-skip-permissions');
    }
    return { bin, args };
  }

  if (job.provider === 'codex') {
    const args = ['exec', '--json'];
    if (job.allowedOperations.approvalMode === 'dangerous') {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    }
    if (options.outputLastMessagePath) {
      args.push('--output-last-message', options.outputLastMessagePath);
    }
    args.push(...nativeAttachmentArgs);
    if (modelId) args.push('--model', modelId);
    if (thinkingLevel) args.push('-c', `model_reasoning_effort="${thinkingLevel}"`);
    args.push('--', fullPrompt);
    return { bin, args };
  }

  if (job.provider === 'qwen') {
    const args = ['--output-format', 'stream-json', '--include-partial-messages'];
    if (job.allowedOperations.approvalMode === 'dangerous') args.push('--approval-mode', 'yolo');
    if (modelId) args.push('--model', modelId);
    args.push('--prompt', fullPrompt);
    return { bin, args };
  }

  if (job.provider === 'cursor') {
    const args = [
      '--print',
      '--output-format',
      'stream-json',
      '--stream-partial-output',
      '--force',
    ];
    if (job.allowedOperations.approvalMode === 'dangerous') args.push('--trust');
    if (modelId) args.push('--model', modelId);
    args.push(fullPrompt);
    return { bin, args };
  }

  const args = ['run', '--format', 'json'];
  if (modelId) args.push('--model', modelId);
  if (thinkingLevel) args.push('--variant', thinkingLevel);
  args.push(...nativeAttachmentArgs);
  args.push(fullPrompt);
  return { bin, args };
}

function pathInsideRoot(targetPath: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetPath);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`);
}

const MATERIALIZATION_MANIFEST = path.join('.openwork', 'managed-agent-context.json');

function safeMaterializedRelativePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return (
    normalized.length > 0 &&
    !normalized.startsWith('/') &&
    !normalized.split('/').includes('..') &&
    normalized.split('/').every(Boolean)
  );
}

function materializedPath(root: string, relativePath: string): string {
  if (!safeMaterializedRelativePath(relativePath)) {
    throw new Error(`Invalid materialized workspace file path: ${relativePath}`);
  }
  const resolved = path.resolve(root, relativePath);
  if (!pathInsideRoot(resolved, root)) {
    throw new Error(`Materialized workspace file escapes workspace root: ${relativePath}`);
  }
  return resolved;
}

function safeMaterializedRelativeDirectory(relativePath: string): boolean {
  return safeMaterializedRelativePath(relativePath);
}

function ensureRunnerConversationLinks(
  workspaceRoot: string,
  conversationWorkspace: NonNullable<RunnerWorkspaceMaterialization['conversationWorkspace']>,
): void {
  const repoRoot = path.resolve(workspaceRoot, '..', '..');
  const agentContextRoot = materializedPath(repoRoot, conversationWorkspace.agentContextRoot);
  for (const entry of conversationWorkspace.linkEntries) {
    if (!safeMaterializedRelativeDirectory(entry)) {
      throw new Error(`Invalid conversation workspace link path: ${entry}`);
    }
    const sourcePath = materializedPath(agentContextRoot, entry);
    if (!fs.existsSync(sourcePath)) continue;
    const linkPath = materializedPath(workspaceRoot, entry);
    if (fs.existsSync(linkPath)) {
      const existing = fs.lstatSync(linkPath);
      if (!existing.isSymbolicLink()) continue;
      const relativeTarget = path.relative(path.dirname(linkPath), sourcePath) || '.';
      if (path.normalize(fs.readlinkSync(linkPath)) === path.normalize(relativeTarget)) continue;
      fs.unlinkSync(linkPath);
    }
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });
    const relativeTarget = path.relative(path.dirname(linkPath), sourcePath) || '.';
    fs.symlinkSync(relativeTarget, linkPath);
  }
}

function formatInstructionDirectory(dirPath: string): string {
  const resolved = path.resolve(dirPath);
  return resolved.endsWith(path.sep) ? resolved : `${resolved}${path.sep}`;
}

function renderConversationInstructionMarkdown(
  sourceContent: string,
  conversationDir: string,
): string {
  const cwd = formatInstructionDirectory(conversationDir);
  let rendered = sourceContent;

  rendered = rendered.replace(
    /^- The project repository root is `[^`]+`\.\n- Use other paths only if the task requires it; ask first when avoidable\.\s*$/m,
    [
      `- The working directory for this conversation is \`${cwd}\`. Work in this folder by default for commands and file operations.`,
      '- Use other paths only if the task requires it; ask first when avoidable.',
    ].join('\n'),
  );

  rendered = rendered.replace(
    /^- The project repository root is `[^`]+`\.\s*$/m,
    `- The working directory for this conversation is \`${cwd}\`. Work in this folder by default for commands and file operations.`,
  );

  rendered = rendered.replace(
    /^Default workspace behavior:\s*- Work in `[^`]+` by default for commands and file operations\.\s*$/m,
    `Default workspace behavior: - Work in \`${cwd}\` by default for commands and file operations.`,
  );

  return rendered;
}

function ensureRunnerConversationMarkdown(
  workspaceRoot: string,
  conversationWorkspace: NonNullable<RunnerWorkspaceMaterialization['conversationWorkspace']>,
): void {
  const repoRoot = path.resolve(workspaceRoot, '..', '..');
  const agentContextRoot = materializedPath(repoRoot, conversationWorkspace.agentContextRoot);
  for (const entry of conversationWorkspace.markdownEntries ?? []) {
    if (!safeMaterializedRelativeDirectory(entry)) {
      throw new Error(`Invalid conversation workspace markdown path: ${entry}`);
    }
    const sourcePath = materializedPath(agentContextRoot, entry);
    if (!fs.existsSync(sourcePath)) continue;
    const destinationPath = materializedPath(workspaceRoot, entry);
    const rendered = renderConversationInstructionMarkdown(
      fs.readFileSync(sourcePath, 'utf-8'),
      workspaceRoot,
    );
    if (fs.existsSync(destinationPath)) {
      const existing = fs.lstatSync(destinationPath);
      if (existing.isDirectory()) continue;
      if (existing.isSymbolicLink()) fs.unlinkSync(destinationPath);
      else if (existing.isFile() && fs.readFileSync(destinationPath, 'utf-8') === rendered) {
        continue;
      }
    }
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, rendered, 'utf-8');
  }
}

function readManagedMaterializationManifest(root: string): string[] {
  const manifestPath = path.join(root, MATERIALIZATION_MANIFEST);
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { files?: unknown };
    if (!Array.isArray(parsed.files)) return [];
    return parsed.files.filter((file): file is string => typeof file === 'string');
  } catch {
    return [];
  }
}

function hashText(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function readFileHash(filePath: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

function pruneEmptyParents(root: string, startDir: string) {
  let current = path.resolve(startDir);
  const resolvedRoot = path.resolve(root);
  while (pathInsideRoot(current, resolvedRoot) && current !== resolvedRoot) {
    try {
      fs.rmdirSync(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

export function materializeRunnerWorkspace(setup: RunnerWorkspaceSetupIntent): void {
  const materialization = setup.materialization;
  if (materialization.strategy !== 'runner_local_agent_workspace') {
    throw new Error(
      `Unsupported workspace materialization strategy: ${
        (materialization as RunnerWorkspaceMaterialization).strategy
      }`,
    );
  }

  const root = path.resolve(setup.workspace.path);
  const contextRoot = path.resolve(
    root,
    '.openwork',
    'agent-context',
    setup.agentId,
    materialization.agentContext.revision,
  );
  fs.mkdirSync(root, { recursive: true });
  const nextFiles = new Set(materialization.agentContext.files.map((file) => file.path));
  const previouslyManagedFiles = readManagedMaterializationManifest(root);
  for (const oldRelativePath of previouslyManagedFiles) {
    if (nextFiles.has(oldRelativePath)) continue;
    const oldPath = materializedPath(root, oldRelativePath);
    fs.rmSync(oldPath, { force: true });
    pruneEmptyParents(root, path.dirname(oldPath));
  }

  for (const file of materialization.agentContext.files) {
    const actualSize = Buffer.byteLength(file.content);
    if (file.sizeBytes !== undefined && file.sizeBytes !== actualSize) {
      throw new Error(`Agent context size mismatch for ${file.path}`);
    }
    const actualHash = hashText(file.content);
    if (file.sha256 && file.sha256 !== actualHash) {
      throw new Error(`Agent context hash mismatch for ${file.path}`);
    }
    const cachedDestination = materializedPath(contextRoot, file.path);
    fs.mkdirSync(path.dirname(cachedDestination), { recursive: true });
    if (
      fs.existsSync(cachedDestination) &&
      file.sha256 &&
      readFileHash(cachedDestination) === file.sha256
    ) {
      // Reuse immutable cached context file by revision/hash.
    } else {
      fs.writeFileSync(cachedDestination, file.content, {
        encoding: 'utf-8',
        mode: file.mode,
      });
    }
    if (file.sha256 && readFileHash(cachedDestination) !== file.sha256) {
      throw new Error(`Agent context cache hash mismatch for ${file.path}`);
    }

    const destination = materializedPath(root, file.path);
    const wasManaged = previouslyManagedFiles.includes(file.path);
    if (fs.existsSync(destination) && !wasManaged && readFileHash(destination) !== actualHash) {
      throw new Error(`Refusing to overwrite unmanaged workspace file: ${file.path}`);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, file.content, {
      encoding: 'utf-8',
      mode: file.mode,
    });
  }

  if (materialization.conversationWorkspace) {
    ensureRunnerConversationMarkdown(root, materialization.conversationWorkspace);
    ensureRunnerConversationLinks(root, materialization.conversationWorkspace);
  }

  const manifestPath = path.join(root, MATERIALIZATION_MANIFEST);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        strategy: materialization.strategy,
        revision: materialization.agentContext.revision,
        files: [...nextFiles].sort(),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf-8',
  );
}

export function validateJobPolicy(
  job: RunnerJobIntent,
  capabilities: RunnerCapabilities,
): JobPolicyFailure | null {
  if (!capabilities.supportedProviders.includes(job.provider)) {
    return { code: 'unsupported_provider', message: `Unsupported provider: ${job.provider}` };
  }
  if (!resolveProviderExecutable(job.provider)) {
    return {
      code: 'unsupported_provider',
      message: `Provider ${job.provider} command ${PROVIDER_BINARIES[job.provider]} is not executable in the runner environment`,
    };
  }
  if (!job.allowedOperations.tools.includes(job.provider)) {
    return {
      code: 'policy_denied',
      message: `Provider ${job.provider} is not allowed for this job`,
    };
  }
  if (!capabilities.policy.allowedTools.includes(job.provider)) {
    return { code: 'policy_denied', message: `Runner policy does not allow ${job.provider}` };
  }
  if (!capabilities.policy.approvalModes.includes(job.allowedOperations.approvalMode)) {
    return {
      code: 'policy_denied',
      message: `Runner policy does not allow approval mode ${job.allowedOperations.approvalMode}`,
    };
  }
  if (job.allowedOperations.env && !capabilities.policy.envAccess) {
    return { code: 'policy_denied', message: 'Runner policy does not allow environment access' };
  }
  if (job.allowedOperations.secrets && !capabilities.policy.secretAccess) {
    return { code: 'policy_denied', message: 'Runner policy does not allow secret access' };
  }
  if (job.allowedOperations.network && !capabilities.policy.network) {
    return { code: 'policy_denied', message: 'Runner policy does not allow network access' };
  }
  if (job.allowedOperations.shell && !capabilities.policy.shell) {
    return { code: 'policy_denied', message: 'Runner policy does not allow shell access' };
  }
  if (!path.isAbsolute(job.workspace.path)) {
    return {
      code: 'invalid_job',
      message: `Workspace path must be absolute: ${job.workspace.path}`,
    };
  }
  if (!fs.existsSync(job.workspace.path)) {
    return { code: 'invalid_job', message: `Workspace path does not exist: ${job.workspace.path}` };
  }
  return null;
}

function createCodexLastMessagePath(runId: string): string {
  const safeRunId = runId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(os.tmpdir(), 'openwork-runner', 'codex-last-messages', `${safeRunId}.txt`);
}

export function createExecutionPlan(
  job: RunnerJobIntent,
  capabilities: RunnerCapabilities,
): JobExecutionPlan | JobPolicyFailure {
  const policyFailure = validateJobPolicy(job, capabilities);
  if (policyFailure) return policyFailure;
  const providerExecutable = resolveProviderExecutable(job.provider);
  if (!providerExecutable) {
    return {
      code: 'unsupported_provider',
      message: `Provider ${job.provider} command ${PROVIDER_BINARIES[job.provider]} is not executable in the runner environment`,
    };
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (job.allowedOperations.env) {
    for (const variable of job.environment?.variables ?? []) {
      if (variable.secret && !job.allowedOperations.secrets) continue;
      env[variable.name] = variable.value;
    }
  }
  env.PWD = path.resolve(job.workspace.path);
  env.PATH = buildRunnerPath(providerExecutable);
  const outputLastMessagePath =
    job.provider === 'codex' ? createCodexLastMessagePath(job.runId) : undefined;
  if (outputLastMessagePath) fs.mkdirSync(path.dirname(outputLastMessagePath), { recursive: true });

  return {
    command: buildCliCommand(job, providerExecutable, { outputLastMessagePath }),
    cwd: path.resolve(job.workspace.path),
    env,
    outputLastMessagePath,
  };
}

export function isPolicyFailure(
  value: JobExecutionPlan | JobPolicyFailure,
): value is JobPolicyFailure {
  return 'code' in value;
}

export function spawnExecutionPlan(plan: JobExecutionPlan): SpawnedExecutionProcess {
  return spawn(plan.command.bin, plan.command.args, {
    cwd: plan.cwd,
    env: plan.env,
    stdio: [plan.stdinData === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  }) as SpawnedExecutionProcess;
}

export function spawnDetachedExecutionPlan(
  plan: JobExecutionPlan,
  options: { stdoutFd: number; stderrFd: number },
): DetachedExecutionProcess {
  const stdio: StdioOptions = [
    plan.stdinData === undefined ? 'ignore' : 'pipe',
    options.stdoutFd,
    options.stderrFd,
  ];
  const child = spawn(plan.command.bin, plan.command.args, {
    cwd: plan.cwd,
    env: plan.env,
    detached: true,
    stdio,
  }) as DetachedExecutionProcess;
  child.unref();
  return child;
}

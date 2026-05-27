import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  RunnerAgentWorkspaceFileEntry,
  RunnerFilesystemRequest,
  RunnerFilesystemResult,
} from 'shared';

export type RunnerFilesystemFailureCode =
  | 'runner_filesystem_unsupported'
  | 'invalid_path'
  | 'not_found'
  | 'operation_failed'
  | 'workspace_root_missing'
  | 'path_outside_workspace_root'
  | 'path_inaccessible';

export class RunnerFilesystemError extends Error {
  code: RunnerFilesystemFailureCode;

  constructor(code: RunnerFilesystemFailureCode, message: string) {
    super(message);
    this.name = 'RunnerFilesystemError';
    this.code = code;
  }
}

function pathInsideRoot(candidate: string, root: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function requireAccessibleDirectory(dirPath: string, code: RunnerFilesystemFailureCode): fs.Stats {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dirPath);
  } catch {
    throw new RunnerFilesystemError(code, `Path does not exist: ${dirPath}`);
  }
  if (!stat.isDirectory()) {
    throw new RunnerFilesystemError('invalid_path', `Path is not a directory: ${dirPath}`);
  }
  try {
    fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
  } catch {
    throw new RunnerFilesystemError(
      'path_inaccessible',
      `Path exists but is inaccessible: ${dirPath}`,
    );
  }
  return stat;
}

function normalizeAgentRelativePath(filePath: string): string {
  let normalized = filePath.trim().replace(/\\/g, '/');
  if (!normalized) normalized = '/';
  if (!normalized.startsWith('/')) normalized = '/' + normalized;
  if (normalized !== '/' && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}

function sanitizeAgentEntryName(name: string): string {
  const safeName = name.replace(/[/\\:*?"<>|]/g, '_').trim();
  if (!safeName || safeName === '.' || safeName === '..') {
    throw new RunnerFilesystemError('invalid_path', 'Invalid file or folder name.');
  }
  return safeName;
}

export function validateRepositoryRoot(
  repositoryPath: string,
  _workspaceRoot: string | null | undefined,
): {
  path: string;
  repositoryRootOrigin: 'runner_local';
  repositoryRootVerifiedAt: string;
} {
  if (!path.isAbsolute(repositoryPath)) {
    throw new RunnerFilesystemError(
      'invalid_path',
      `Repository root must be an absolute path: ${repositoryPath}`,
    );
  }
  const resolvedRepository = path.resolve(repositoryPath);
  requireAccessibleDirectory(resolvedRepository, 'not_found');

  return {
    path: resolvedRepository,
    repositoryRootOrigin: 'runner_local',
    repositoryRootVerifiedAt: new Date().toISOString(),
  };
}

function requireRunnerAgentWorkspaceRoot(
  workspacePath: string,
  workspaceRoot: string | null | undefined,
  options?: { create?: boolean; workspaceRootPath?: string },
): string {
  const authorityRoot = options?.workspaceRootPath ?? workspaceRoot;
  if (!authorityRoot) {
    throw new RunnerFilesystemError(
      'workspace_root_missing',
      'Runner did not receive an agent workspace authority root.',
    );
  }
  if (!path.isAbsolute(authorityRoot)) {
    throw new RunnerFilesystemError(
      'invalid_path',
      `Agent workspace authority root must be absolute: ${authorityRoot}`,
    );
  }
  if (!path.isAbsolute(workspacePath)) {
    throw new RunnerFilesystemError(
      'invalid_path',
      `Agent workspace path must be absolute: ${workspacePath}`,
    );
  }
  const resolvedRoot = path.resolve(authorityRoot);
  const resolvedWorkspace = path.resolve(workspacePath);
  if (!pathInsideRoot(resolvedWorkspace, resolvedRoot)) {
    throw new RunnerFilesystemError(
      'path_outside_workspace_root',
      `Agent workspace path is outside authority root ${resolvedRoot}: ${resolvedWorkspace}`,
    );
  }
  requireAccessibleDirectory(resolvedRoot, 'workspace_root_missing');
  rejectSymlinkAncestors(resolvedWorkspace, resolvedRoot);

  if (!fs.existsSync(resolvedWorkspace)) {
    if (!options?.create) {
      throw new RunnerFilesystemError(
        'not_found',
        `Agent workspace does not exist: ${resolvedWorkspace}`,
      );
    }
    try {
      fs.mkdirSync(resolvedWorkspace, { recursive: true, mode: 0o700 });
    } catch {
      throw new RunnerFilesystemError(
        'path_inaccessible',
        `Agent workspace could not be created: ${resolvedWorkspace}`,
      );
    }
  }

  if (fs.lstatSync(resolvedWorkspace).isSymbolicLink()) {
    throw new RunnerFilesystemError(
      'path_outside_workspace_root',
      `Agent workspace path must not be a symlink: ${resolvedWorkspace}`,
    );
  }
  requireAccessibleDirectory(resolvedWorkspace, 'path_inaccessible');

  const realRoot = fs.realpathSync(resolvedRoot);
  const realWorkspace = fs.realpathSync(resolvedWorkspace);
  if (!pathInsideRoot(realWorkspace, realRoot)) {
    throw new RunnerFilesystemError(
      'path_outside_workspace_root',
      `Agent workspace resolves outside authority root ${realRoot}: ${realWorkspace}`,
    );
  }
  return resolvedWorkspace;
}

function resolveAgentWorkspaceEntryPath(workspacePath: string, relativePath: string): string {
  const normalized = normalizeAgentRelativePath(relativePath);
  const resolved = path.resolve(workspacePath, `.${normalized}`);
  const rootPrefix = workspacePath.endsWith(path.sep) ? workspacePath : `${workspacePath}${path.sep}`;
  if (resolved !== workspacePath && !resolved.startsWith(rootPrefix)) {
    throw new RunnerFilesystemError('invalid_path', 'Path traversal detected.');
  }
  return resolved;
}

function runnerAgentFileEntry(
  workspacePath: string,
  fullPath: string,
  dirent: fs.Dirent,
): RunnerAgentWorkspaceFileEntry | null {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(fullPath);
  } catch {
    return null;
  }
  const type = stats.isFile() ? 'file' : stats.isDirectory() ? 'folder' : null;
  if (!type) return null;
  const relative = path.relative(workspacePath, fullPath).split(path.sep).join('/');
  const createdAtSource =
    Number.isFinite(stats.birthtimeMs) && stats.birthtimeMs > 0 ? stats.birthtime : stats.mtime;
  const entry: RunnerAgentWorkspaceFileEntry = {
    name: dirent.name,
    path: normalizeAgentRelativePath(`/${relative}`),
    type,
    size: type === 'file' ? stats.size : 0,
    createdAt: createdAtSource.toISOString(),
  };
  if (dirent.isSymbolicLink()) {
    entry.isReference = true;
    entry.target = fs.readlinkSync(fullPath);
  }
  return entry;
}

export function handleAgentWorkspaceFileRequest(
  request: Exclude<
    RunnerFilesystemRequest,
    | { action: 'browse' }
    | { action: 'pick_folder' }
    | { action: 'reveal' }
    | { action: 'validate_repository_root' }
    | { action: 'prepare_workspace' }
    | { action: 'import_attachment' }
  >,
  workspaceRoot: string | null | undefined,
  options?: { revealPath?: (targetPath: string) => void },
): RunnerFilesystemResult {
  const createRoot =
    request.action === 'write_agent_file' ||
    request.action === 'create_agent_folder' ||
    request.action === 'import_agent_files' ||
    (request.action === 'list_agent_files' && normalizeAgentRelativePath(request.path) === '/');
  const workspacePath = requireRunnerAgentWorkspaceRoot(request.workspacePath, workspaceRoot, {
    create: createRoot,
    workspaceRootPath: request.workspaceRootPath,
  });

  if (request.action === 'list_agent_files') {
    const targetPath = resolveAgentWorkspaceEntryPath(workspacePath, request.path);
    if (!fs.existsSync(targetPath)) {
      throw new RunnerFilesystemError('not_found', `Path does not exist: ${request.path}`);
    }
    if (!fs.statSync(targetPath).isDirectory()) {
      throw new RunnerFilesystemError('invalid_path', `Path is not a directory: ${request.path}`);
    }
    const entries = fs
      .readdirSync(targetPath, { withFileTypes: true })
      .map((entry) => runnerAgentFileEntry(workspacePath, path.join(targetPath, entry.name), entry))
      .filter((entry): entry is RunnerAgentWorkspaceFileEntry => entry !== null);
    return {
      action: 'list_agent_files',
      workspacePath,
      path: normalizeAgentRelativePath(request.path),
      entries,
    };
  }

  if (request.action === 'read_agent_file') {
    const targetPath = resolveAgentWorkspaceEntryPath(workspacePath, request.path);
    if (!fs.existsSync(targetPath)) {
      throw new RunnerFilesystemError('not_found', `File does not exist: ${request.path}`);
    }
    if (!fs.statSync(targetPath).isFile()) {
      throw new RunnerFilesystemError('invalid_path', `Path is not a file: ${request.path}`);
    }
    const buffer = fs.readFileSync(targetPath);
    return {
      action: 'read_agent_file',
      path: normalizeAgentRelativePath(request.path),
      content: request.encoding === 'base64' ? buffer.toString('base64') : buffer.toString('utf-8'),
      encoding: request.encoding,
      sizeBytes: buffer.length,
    };
  }

  if (request.action === 'write_agent_file') {
    const targetPath = resolveAgentWorkspaceEntryPath(workspacePath, request.path);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
      throw new RunnerFilesystemError('invalid_path', `Path is a directory: ${request.path}`);
    }
    const buffer =
      request.encoding === 'base64'
        ? Buffer.from(request.content, 'base64')
        : Buffer.from(request.content, 'utf-8');
    fs.writeFileSync(targetPath, buffer);
    return {
      action: 'write_agent_file',
      path: normalizeAgentRelativePath(request.path),
      sizeBytes: buffer.length,
      updatedAt: new Date().toISOString(),
    };
  }

  if (request.action === 'create_agent_folder') {
    const parentPath = resolveAgentWorkspaceEntryPath(workspacePath, request.path);
    if (!fs.existsSync(parentPath)) {
      throw new RunnerFilesystemError('not_found', `Path does not exist: ${request.path}`);
    }
    if (!fs.statSync(parentPath).isDirectory()) {
      throw new RunnerFilesystemError('invalid_path', `Path is not a directory: ${request.path}`);
    }
    const safeName = sanitizeAgentEntryName(request.name);
    const targetPath = path.join(parentPath, safeName);
    if (fs.existsSync(targetPath)) {
      throw new RunnerFilesystemError(
        'operation_failed',
        'A file or folder with this name already exists',
      );
    }
    fs.mkdirSync(targetPath, { recursive: false, mode: 0o700 });
    const entry = runnerAgentFileEntry(
      workspacePath,
      targetPath,
      { name: safeName, isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false } as fs.Dirent,
    );
    if (!entry) {
      throw new RunnerFilesystemError('operation_failed', 'Folder was created but could not be read');
    }
    return { action: 'create_agent_folder', entry };
  }

  if (request.action === 'delete_agent_path') {
    const normalized = normalizeAgentRelativePath(request.path);
    if (normalized === '/') {
      throw new RunnerFilesystemError('invalid_path', 'Cannot delete the agent workspace root.');
    }
    const targetPath = resolveAgentWorkspaceEntryPath(workspacePath, normalized);
    if (!fs.existsSync(targetPath)) return { action: 'delete_agent_path', deleted: false };
    fs.rmSync(targetPath, { recursive: true, force: true });
    return { action: 'delete_agent_path', deleted: true };
  }

  if (request.action === 'reveal_agent_path') {
    const targetPath = resolveAgentWorkspaceEntryPath(workspacePath, request.path);
    if (!fs.existsSync(targetPath)) {
      throw new RunnerFilesystemError('not_found', `Path does not exist: ${request.path}`);
    }
    options?.revealPath?.(targetPath);
    return { action: 'reveal_agent_path' };
  }

  let importedCount = 0;
  let skippedCount = 0;
  let totalBytes = 0;
  for (const file of request.files) {
    try {
      const targetPath = resolveAgentWorkspaceEntryPath(workspacePath, file.path);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      const buffer = Buffer.from(file.contentBase64, 'base64');
      fs.writeFileSync(targetPath, buffer);
      if (file.modifiedAt) {
        const modifiedAt = new Date(file.modifiedAt);
        if (!Number.isNaN(modifiedAt.getTime())) {
          fs.utimesSync(targetPath, modifiedAt, modifiedAt);
        }
      }
      importedCount++;
      totalBytes += buffer.length;
    } catch {
      skippedCount++;
    }
  }
  return {
    action: 'import_agent_files',
    importedCount,
    skippedCount,
    totalBytes,
    importedAt: new Date().toISOString(),
  };
}

function rejectSymlinkAncestors(targetPath: string, root: string) {
  const relative = path.relative(root, targetPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return;
  let current = root;
  const parts = relative.split(path.sep).filter(Boolean);
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) return;
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new RunnerFilesystemError(
        'path_outside_workspace_root',
        `Workspace path uses a symlinked parent outside the runner root: ${targetPath}`,
      );
    }
  }
}

export function prepareWorkspacePath(
  request: Extract<RunnerFilesystemRequest, { action: 'prepare_workspace' }>,
  workspaceRoot: string | null | undefined,
): RunnerFilesystemResult {
  if (request.purpose !== 'no_repository_agent' && request.purpose !== 'conversation_subfolder') {
    throw new RunnerFilesystemError(
      'invalid_path',
      `Unsupported workspace prepare purpose: ${request.purpose}`,
    );
  }
  if (!workspaceRoot) {
    throw new RunnerFilesystemError(
      'workspace_root_missing',
      'Runner did not advertise OPENWORK_RUNNER_WORKSPACE_ROOT.',
    );
  }
  if (!path.isAbsolute(request.path)) {
    throw new RunnerFilesystemError(
      'invalid_path',
      `Workspace path must be absolute: ${request.path}`,
    );
  }

  const resolvedTarget = path.resolve(request.path);
  const resolvedRoot = path.resolve(workspaceRoot);
  const shouldEnforceWorkspaceRoot = request.purpose === 'no_repository_agent';

  if (shouldEnforceWorkspaceRoot) {
    if (!pathInsideRoot(resolvedTarget, resolvedRoot)) {
      throw new RunnerFilesystemError(
        'path_outside_workspace_root',
        `Workspace path is outside runner root ${resolvedRoot}: ${resolvedTarget}`,
      );
    }
    requireAccessibleDirectory(resolvedRoot, 'workspace_root_missing');
    rejectSymlinkAncestors(resolvedTarget, resolvedRoot);
  }

  if (fs.existsSync(resolvedTarget)) {
    if (fs.lstatSync(resolvedTarget).isSymbolicLink()) {
      throw new RunnerFilesystemError(
        'path_outside_workspace_root',
        `Workspace path must not be a symlink: ${resolvedTarget}`,
      );
    }
    requireAccessibleDirectory(resolvedTarget, 'path_inaccessible');
  } else {
    try {
      fs.mkdirSync(resolvedTarget, { recursive: true, mode: 0o700 });
    } catch {
      throw new RunnerFilesystemError(
        'path_inaccessible',
        `Workspace path could not be created: ${resolvedTarget}`,
      );
    }
    requireAccessibleDirectory(resolvedTarget, 'path_inaccessible');
  }

  if (shouldEnforceWorkspaceRoot) {
    const realRoot = fs.realpathSync(resolvedRoot);
    const realTarget = fs.realpathSync(resolvedTarget);
    if (!pathInsideRoot(realTarget, realRoot)) {
      throw new RunnerFilesystemError(
        'path_outside_workspace_root',
        `Workspace path resolves outside runner root ${realRoot}: ${realTarget}`,
      );
    }
  }

  return {
    action: 'prepare_workspace',
    path: resolvedTarget,
    workspaceRoot: resolvedRoot,
    status: 'ready',
    preparedAt: new Date().toISOString(),
  };
}

function sha256Buffer(bytes: Buffer): string {
  const hash = crypto.createHash('sha256');
  hash.update(bytes);
  return hash.digest('hex');
}

async function downloadAttachmentBytes(
  request: Extract<RunnerFilesystemRequest, { action: 'import_attachment' }>,
  options: { serverUrl: string; credential: string },
): Promise<Buffer> {
  const url = new URL(request.source.download.path, options.serverUrl);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${options.credential}` } });
  if (!res.ok) {
    throw new RunnerFilesystemError(
      'operation_failed',
      `Attachment ${request.source.storagePath} download failed with HTTP ${res.status}: ${await res.text()}`,
    );
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength !== request.source.sizeBytes) {
    throw new RunnerFilesystemError(
      'operation_failed',
      `Attachment ${request.source.storagePath} size mismatch after download`,
    );
  }
  if (request.source.sha256 && sha256Buffer(bytes) !== request.source.sha256) {
    throw new RunnerFilesystemError(
      'operation_failed',
      `Attachment ${request.source.storagePath} hash mismatch after download`,
    );
  }
  return bytes;
}

export async function importAttachmentToWorkspace(
  request: Extract<RunnerFilesystemRequest, { action: 'import_attachment' }>,
  workspaceRoot: string | null | undefined,
  options: { serverUrl: string; credential: string },
): Promise<RunnerFilesystemResult> {
  if (!workspaceRoot) {
    throw new RunnerFilesystemError(
      'workspace_root_missing',
      'Runner did not advertise OPENWORK_RUNNER_WORKSPACE_ROOT.',
    );
  }
  if (!options.credential) {
    throw new RunnerFilesystemError(
      'operation_failed',
      'Runner credential is unavailable for attachment import.',
    );
  }
  if (!path.isAbsolute(request.destinationPath)) {
    throw new RunnerFilesystemError(
      'invalid_path',
      `Attachment import destination must be absolute: ${request.destinationPath}`,
    );
  }

  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedTarget = path.resolve(request.destinationPath);
  if (!pathInsideRoot(resolvedTarget, resolvedRoot)) {
    throw new RunnerFilesystemError(
      'path_outside_workspace_root',
      `Attachment import destination is outside runner root ${resolvedRoot}: ${resolvedTarget}`,
    );
  }

  requireAccessibleDirectory(resolvedRoot, 'workspace_root_missing');
  rejectSymlinkAncestors(resolvedTarget, resolvedRoot);
  const parentDir = path.dirname(resolvedTarget);
  fs.mkdirSync(parentDir, { recursive: true, mode: 0o700 });
  requireAccessibleDirectory(parentDir, 'path_inaccessible');
  rejectSymlinkAncestors(resolvedTarget, resolvedRoot);

  if (fs.existsSync(resolvedTarget)) {
    const stat = fs.lstatSync(resolvedTarget);
    if (stat.isSymbolicLink()) {
      throw new RunnerFilesystemError(
        'path_outside_workspace_root',
        `Attachment import destination must not be a symlink: ${resolvedTarget}`,
      );
    }
    if (stat.isDirectory()) {
      throw new RunnerFilesystemError(
        'invalid_path',
        `Attachment import destination is a directory: ${resolvedTarget}`,
      );
    }
    if (request.overwrite === false) {
      throw new RunnerFilesystemError(
        'invalid_path',
        `Attachment import destination already exists: ${resolvedTarget}`,
      );
    }
  }

  const bytes = await downloadAttachmentBytes(request, options);
  const actualHash = sha256Buffer(bytes);
  const tmpPath = path.join(parentDir, `.openwork-import-${process.pid}-${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmpPath, bytes, { mode: 0o600 });
    fs.renameSync(tmpPath, resolvedTarget);
  } catch {
    fs.rmSync(tmpPath, { force: true });
    throw new RunnerFilesystemError(
      'path_inaccessible',
      `Attachment import destination could not be written: ${resolvedTarget}`,
    );
  }

  const realRoot = fs.realpathSync(resolvedRoot);
  const realTarget = fs.realpathSync(resolvedTarget);
  if (!pathInsideRoot(realTarget, realRoot)) {
    fs.rmSync(resolvedTarget, { force: true });
    throw new RunnerFilesystemError(
      'path_outside_workspace_root',
      `Attachment import destination resolves outside runner root ${realRoot}: ${realTarget}`,
    );
  }

  return {
    action: 'import_attachment',
    path: resolvedTarget,
    sizeBytes: bytes.byteLength,
    sha256: actualHash,
    importedAt: new Date().toISOString(),
  };
}

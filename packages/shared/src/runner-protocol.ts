export const RUNNER_PROTOCOL_VERSION = '1.2';

export type RunnerProtocolVersion = typeof RUNNER_PROTOCOL_VERSION;
export type RunnerProvider = 'claude' | 'codex' | 'qwen' | 'cursor' | 'opencode';
export type RunnerSupportedTool = RunnerProvider;
export type RunnerApprovalMode = 'none' | 'on_request' | 'never' | 'dangerous';
export type RunnerOutputStream = 'stdout' | 'stderr';
export type RunnerWorkspaceMode = 'shared' | 'subfolder';
export type RunnerFilesystemOperation =
  | 'browse'
  | 'pick_folder'
  | 'reveal'
  | 'validate_repository_root'
  | 'prepare_workspace'
  | 'list_agent_files'
  | 'read_agent_file'
  | 'write_agent_file'
  | 'create_agent_folder'
  | 'delete_agent_path'
  | 'reveal_agent_path'
  | 'import_agent_files'
  | 'import_attachment';

export interface RunnerWorkspaceRootInventory {
  id: string;
  path: string;
  scope: 'workspace' | 'repository' | 'agent_files';
  writable: boolean;
}

export interface RunnerAgentInventoryEntry {
  agentId: string;
  workspaceId?: string | null;
  readiness: 'ready' | 'stale' | 'unknown' | 'repair_required';
  fileOperations: RunnerFilesystemOperation[];
  workspaceRootPath?: string;
  updatedAt: string;
}

export interface RunnerAgentInventoryAdvertisement {
  protocolVersion: 1;
  revision: string;
  advertisedAt: string;
  ttlMs: number;
  workspaceRoots: RunnerWorkspaceRootInventory[];
  fileOperations: RunnerFilesystemOperation[];
  agents: RunnerAgentInventoryEntry[];
}

export type RunnerAttachmentType = 'image' | 'file';
export type RunnerAttachmentTextExtractionStatus =
  | 'available'
  | 'not_applicable'
  | 'failed'
  | 'truncated'
  | 'unknown';

export interface RunnerAttachmentTextExtraction {
  status: RunnerAttachmentTextExtractionStatus;
  textPath?: string;
  charCount?: number;
  truncated?: boolean;
  error?: string;
}

export interface RunnerAttachment {
  type: RunnerAttachmentType;
  path: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  textExtraction: RunnerAttachmentTextExtraction;
  manifest?: Record<string, unknown>;
}

export interface RunnerStagedAttachmentManifestItem {
  id: string;
  kind: 'attachment';
  attachmentIndex: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256?: string;
  storageId: string;
  storagePath: string;
  download: {
    method: 'GET';
    path: string;
  };
  destination: string;
}

export interface RunnerStagingManifest {
  version: 1;
  root: string;
  policy: {
    scope: 'runner_job_workspace';
    materialization: 'download_before_launch';
    cleanup: 'runner_managed';
  };
  totalSizeBytes: number;
  attachments: RunnerStagedAttachmentManifestItem[];
}

export interface RunnerCapabilities {
  protocolVersion: RunnerProtocolVersion;
  os: string;
  arch: string;
  runnerVersion: string;
  workspaceRoot?: string;
  installedProviders?: RunnerProvider[];
  supportedProviders: RunnerProvider[];
  supportedTools?: RunnerSupportedTool[];
  approvalModes?: RunnerApprovalMode[];
  workspaceModes?: RunnerWorkspaceMode[];
  concurrency?: {
    activeJobs: number;
    maxJobs: number | null;
  };
  supportsCancellation: boolean;
  supportsArtifacts: boolean;
  supportsFilesystem?: boolean;
  filesystemOperations?: RunnerFilesystemOperation[];
  agentInventory?: RunnerAgentInventoryAdvertisement;
  policy: {
    workspaceRootRequired: boolean;
    allowedTools: RunnerProvider[];
    approvalModes: RunnerApprovalMode[];
    envAccess: boolean;
    secretAccess: boolean;
    network: boolean;
    shell: boolean;
  };
}

export interface RunnerFilesystemEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: string;
}

export interface RunnerAgentWorkspaceFileEntry {
  name: string;
  path: string;
  type: 'file' | 'folder';
  size: number;
  createdAt: string;
  isReference?: boolean;
  target?: string;
}

export interface RunnerAgentWorkspaceImportFile {
  path: string;
  contentBase64: string;
  sizeBytes: number;
  modifiedAt?: string;
}

export interface RunnerWorkspaceImportAttachmentSource {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256?: string;
  storageId?: string;
  storagePath: string;
  download: {
    method: 'GET';
    path: string;
  };
}

export type RunnerFilesystemRequest =
  | { action: 'browse'; path: string; mode?: 'file' | 'folder' }
  | { action: 'pick_folder'; startPath?: string }
  | { action: 'reveal'; path: string }
  | { action: 'validate_repository_root'; path: string }
  | {
      action: 'prepare_workspace';
      path: string;
      purpose: 'no_repository_agent' | 'conversation_subfolder';
      agentId: string;
      conversationId?: string;
      workspaceId?: string | null;
    }
  | {
      action: 'list_agent_files';
      workspacePath: string;
      workspaceRootPath?: string;
      path: string;
    }
  | {
      action: 'read_agent_file';
      workspacePath: string;
      workspaceRootPath?: string;
      path: string;
      encoding: 'utf8' | 'base64';
    }
  | {
      action: 'write_agent_file';
      workspacePath: string;
      workspaceRootPath?: string;
      path: string;
      content: string;
      encoding: 'utf8' | 'base64';
    }
  | {
      action: 'create_agent_folder';
      workspacePath: string;
      workspaceRootPath?: string;
      path: string;
      name: string;
    }
  | {
      action: 'delete_agent_path';
      workspacePath: string;
      workspaceRootPath?: string;
      path: string;
    }
  | {
      action: 'reveal_agent_path';
      workspacePath: string;
      workspaceRootPath?: string;
      path: string;
    }
  | {
      action: 'import_agent_files';
      workspacePath: string;
      workspaceRootPath?: string;
      files: RunnerAgentWorkspaceImportFile[];
    }
  | {
      action: 'import_attachment';
      source: RunnerWorkspaceImportAttachmentSource;
      destinationPath: string;
      overwrite?: boolean;
    };

export type RunnerFilesystemResult =
  | { action: 'browse'; path: string; entries: RunnerFilesystemEntry[] }
  | { action: 'pick_folder'; path: string | null }
  | { action: 'reveal' }
  | {
      action: 'validate_repository_root';
      path: string;
      repositoryRootOrigin: 'runner_local';
      repositoryRootVerifiedAt: string;
    }
  | {
      action: 'prepare_workspace';
      path: string;
      workspaceRoot: string;
      status: 'ready';
      preparedAt: string;
    }
  | {
      action: 'list_agent_files';
      workspacePath: string;
      path: string;
      entries: RunnerAgentWorkspaceFileEntry[];
    }
  | {
      action: 'read_agent_file';
      path: string;
      content: string;
      encoding: 'utf8' | 'base64';
      sizeBytes: number;
    }
  | {
      action: 'write_agent_file';
      path: string;
      sizeBytes: number;
      updatedAt: string;
    }
  | {
      action: 'create_agent_folder';
      entry: RunnerAgentWorkspaceFileEntry;
    }
  | {
      action: 'delete_agent_path';
      deleted: boolean;
    }
  | {
      action: 'reveal_agent_path';
    }
  | {
      action: 'import_agent_files';
      importedCount: number;
      skippedCount: number;
      totalBytes: number;
      importedAt: string;
    }
  | {
      action: 'import_attachment';
      path: string;
      sizeBytes: number;
      sha256?: string;
      importedAt: string;
    };

export interface RunnerJobIntent {
  runId: string;
  agentId: string;
  provider: RunnerProvider;
  modelPreference: {
    displayName: string;
    modelId?: string | null;
    thinkingLevel?: 'low' | 'medium' | 'high' | null;
  };
  prompt: string;
  messages?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  workspace: {
    type: 'local_path';
    path: string;
    workspaceId?: string | null;
  };
  attachments?: RunnerAttachment[];
  stagingManifest?: RunnerStagingManifest;
  allowedOperations: {
    tools: RunnerProvider[];
    approvalMode: RunnerApprovalMode;
    env: boolean;
    secrets: boolean;
    network: boolean;
    shell: boolean;
  };
  environment?: {
    variables: Array<{
      name: string;
      value: string;
      source: 'runtime' | 'workspace_api' | 'agent_env';
      secret: boolean;
    }>;
  };
  timeoutMs?: number;
}

export interface RunnerWorkspaceMaterializationFile {
  path: string;
  content: string;
  sizeBytes?: number;
  sha256?: string;
  mode?: number;
}

export interface RunnerWorkspaceMaterialization {
  strategy: 'runner_local_agent_workspace';
  cleanup: 'managed_files';
  agentContext: {
    revision: string;
    files: RunnerWorkspaceMaterializationFile[];
  };
  conversationWorkspace?: {
    conversationId: string;
    agentContextRoot: string;
    linkEntries: string[];
    markdownEntries?: string[];
  };
}

export interface RunnerWorkspaceSetupIntent {
  setupId: string;
  agentId: string;
  workspaceId?: string | null;
  workspace: {
    type: 'local_path';
    path: string;
    workspaceId?: string | null;
  };
  materialization: RunnerWorkspaceMaterialization;
}

export type RunnerRejectionCode =
  | 'protocol_version_mismatch'
  | 'unsupported_provider'
  | 'policy_denied'
  | 'invalid_job'
  | 'spawn_failed'
  | 'missing_final_message'
  | 'runner_failed'
  | 'runner_cancelled';

export type ServerRunnerMessage =
  | { type: 'server_hello'; protocolVersion: RunnerProtocolVersion; runnerId: string }
  | {
      type: 'job_offer';
      protocolVersion: RunnerProtocolVersion;
      jobId: string;
      job: RunnerJobIntent;
    }
  | {
      type: 'workspace_setup';
      protocolVersion: RunnerProtocolVersion;
      setupId: string;
      setup: RunnerWorkspaceSetupIntent;
    }
  | { type: 'cancel'; protocolVersion: RunnerProtocolVersion; jobId: string; runId: string }
  | {
      type: 'filesystem_request';
      protocolVersion: RunnerProtocolVersion;
      requestId: string;
      request: RunnerFilesystemRequest;
    };

export type RunnerServerMessage =
  | {
      type: 'runner_hello';
      protocolVersion: RunnerProtocolVersion;
      runnerId: string;
      name: string;
      capabilities: RunnerCapabilities;
    }
  | {
      type: 'runner_heartbeat';
      protocolVersion: RunnerProtocolVersion;
      runnerId: string;
      name: string;
      capabilities: RunnerCapabilities;
    }
  | { type: 'job_accepted'; protocolVersion: RunnerProtocolVersion; jobId: string; runId: string }
  | {
      type: 'job_rejected';
      protocolVersion: RunnerProtocolVersion;
      jobId: string;
      runId?: string;
      code: RunnerRejectionCode;
      message: string;
    }
  | {
      type: 'workspace_setup_completed';
      protocolVersion: RunnerProtocolVersion;
      setupId: string;
    }
  | {
      type: 'workspace_setup_failed';
      protocolVersion: RunnerProtocolVersion;
      setupId: string;
      message: string;
    }
  | {
      type: 'output_event';
      protocolVersion: RunnerProtocolVersion;
      jobId: string;
      runId: string;
      stream: RunnerOutputStream;
      text: string;
    }
  | {
      type: 'final_message';
      protocolVersion: RunnerProtocolVersion;
      jobId: string;
      runId: string;
      text: string;
    }
  | {
      type: 'artifact';
      protocolVersion: RunnerProtocolVersion;
      jobId: string;
      runId: string;
      artifact: { name: string; path: string; mimeType?: string };
    }
  | {
      type: 'completed';
      protocolVersion: RunnerProtocolVersion;
      jobId: string;
      runId: string;
      code: number | null;
      stdout: string;
      stderr: string;
    }
  | {
      type: 'failed';
      protocolVersion: RunnerProtocolVersion;
      jobId: string;
      runId: string;
      code: number | null;
      message: string;
      stdout: string;
      stderr: string;
    }
  | {
      type: 'cancelled';
      protocolVersion: RunnerProtocolVersion;
      jobId: string;
      runId: string;
      message?: string;
      stdout: string;
      stderr: string;
    }
  | {
      type: 'protocol_error';
      protocolVersion: RunnerProtocolVersion;
      jobId?: string;
      code: RunnerRejectionCode;
      message: string;
    }
  | {
      type: 'filesystem_response';
      protocolVersion: RunnerProtocolVersion;
      requestId: string;
      ok: true;
      result: RunnerFilesystemResult;
    }
  | {
      type: 'filesystem_response';
      protocolVersion: RunnerProtocolVersion;
      requestId: string;
      ok: false;
      code:
        | 'runner_filesystem_unsupported'
        | 'invalid_path'
        | 'not_found'
        | 'operation_failed'
        | 'workspace_root_missing'
        | 'path_outside_workspace_root'
        | 'path_inaccessible';
      message: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRunnerProvider(value: unknown): value is RunnerProvider {
  return (
    value === 'claude' ||
    value === 'codex' ||
    value === 'qwen' ||
    value === 'cursor' ||
    value === 'opencode'
  );
}

function isRunnerProviderArray(value: unknown): value is RunnerProvider[] {
  return Array.isArray(value) && value.every(isRunnerProvider);
}

function isRunnerApprovalMode(value: unknown): value is RunnerApprovalMode {
  return value === 'none' || value === 'on_request' || value === 'never' || value === 'dangerous';
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isValidRunnerAttachmentTextExtraction(
  value: unknown,
): value is RunnerAttachmentTextExtraction {
  if (!isRecord(value)) return false;
  if (
    value.status !== 'available' &&
    value.status !== 'not_applicable' &&
    value.status !== 'failed' &&
    value.status !== 'truncated' &&
    value.status !== 'unknown'
  ) {
    return false;
  }
  return (
    (value.textPath === undefined || typeof value.textPath === 'string') &&
    (value.charCount === undefined || isNonNegativeSafeInteger(value.charCount)) &&
    (value.truncated === undefined || typeof value.truncated === 'boolean') &&
    (value.error === undefined || typeof value.error === 'string')
  );
}

function isValidRunnerAttachment(value: unknown): value is RunnerAttachment {
  if (!isRecord(value)) return false;
  if (
    (value.type !== 'image' && value.type !== 'file') ||
    typeof value.path !== 'string' ||
    typeof value.filename !== 'string' ||
    typeof value.mimeType !== 'string' ||
    !isNonNegativeSafeInteger(value.sizeBytes) ||
    !isValidRunnerAttachmentTextExtraction(value.textExtraction)
  ) {
    return false;
  }
  return value.manifest === undefined || isRecord(value.manifest);
}

function isRunnerAttachmentArray(value: unknown): value is RunnerAttachment[] {
  return Array.isArray(value) && value.every(isValidRunnerAttachment);
}

function isValidRunnerStagedAttachmentManifestItem(
  value: unknown,
): value is RunnerStagedAttachmentManifestItem {
  if (!isRecord(value) || !isRecord(value.download)) return false;
  return (
    typeof value.id === 'string' &&
    value.kind === 'attachment' &&
    isNonNegativeSafeInteger(value.attachmentIndex) &&
    typeof value.filename === 'string' &&
    typeof value.mimeType === 'string' &&
    isNonNegativeSafeInteger(value.sizeBytes) &&
    (value.sha256 === undefined || typeof value.sha256 === 'string') &&
    typeof value.storageId === 'string' &&
    typeof value.storagePath === 'string' &&
    value.download.method === 'GET' &&
    typeof value.download.path === 'string' &&
    typeof value.destination === 'string'
  );
}

function isValidRunnerStagingManifest(value: unknown): value is RunnerStagingManifest {
  if (!isRecord(value)) return false;
  return (
    value.version === 1 &&
    typeof value.root === 'string' &&
    isRecord(value.policy) &&
    value.policy.scope === 'runner_job_workspace' &&
    value.policy.materialization === 'download_before_launch' &&
    value.policy.cleanup === 'runner_managed' &&
    isNonNegativeSafeInteger(value.totalSizeBytes) &&
    Array.isArray(value.attachments) &&
    value.attachments.every(isValidRunnerStagedAttachmentManifestItem)
  );
}

function isValidRunnerWorkspaceMaterializationFile(
  value: unknown,
): value is RunnerWorkspaceMaterializationFile {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    typeof value.content === 'string' &&
    (value.sizeBytes === undefined || isNonNegativeSafeInteger(value.sizeBytes)) &&
    (value.sha256 === undefined || typeof value.sha256 === 'string') &&
    (value.mode === undefined || isNonNegativeSafeInteger(value.mode))
  );
}

function isValidRunnerWorkspaceMaterialization(
  value: unknown,
): value is RunnerWorkspaceMaterialization {
  return (
    isRecord(value) &&
    value.strategy === 'runner_local_agent_workspace' &&
    value.cleanup === 'managed_files' &&
    isRecord(value.agentContext) &&
    typeof value.agentContext.revision === 'string' &&
    Array.isArray(value.agentContext.files) &&
    value.agentContext.files.every(isValidRunnerWorkspaceMaterializationFile) &&
    (value.conversationWorkspace === undefined ||
      (isRecord(value.conversationWorkspace) &&
        typeof value.conversationWorkspace.conversationId === 'string' &&
        typeof value.conversationWorkspace.agentContextRoot === 'string' &&
        Array.isArray(value.conversationWorkspace.linkEntries) &&
        value.conversationWorkspace.linkEntries.every((entry) => typeof entry === 'string') &&
        (value.conversationWorkspace.markdownEntries === undefined ||
          (Array.isArray(value.conversationWorkspace.markdownEntries) &&
            value.conversationWorkspace.markdownEntries.every(
              (entry) => typeof entry === 'string',
            )))))
  );
}

function isValidRunnerWorkspaceSetupIntent(value: unknown): value is RunnerWorkspaceSetupIntent {
  return (
    isRecord(value) &&
    typeof value.setupId === 'string' &&
    typeof value.agentId === 'string' &&
    (value.workspaceId === undefined || typeof value.workspaceId === 'string' || value.workspaceId === null) &&
    isRecord(value.workspace) &&
    value.workspace.type === 'local_path' &&
    typeof value.workspace.path === 'string' &&
    (value.workspace.workspaceId === undefined ||
      typeof value.workspace.workspaceId === 'string' ||
      value.workspace.workspaceId === null) &&
    isValidRunnerWorkspaceMaterialization(value.materialization)
  );
}

function isRunnerFilesystemRequest(value: unknown): value is RunnerFilesystemRequest {
  if (!isRecord(value) || typeof value.action !== 'string') return false;
  if (value.action === 'browse') {
    return (
      typeof value.path === 'string' &&
      (value.mode === undefined || value.mode === 'file' || value.mode === 'folder')
    );
  }
  if (value.action === 'pick_folder') {
    return value.startPath === undefined || typeof value.startPath === 'string';
  }
  if (value.action === 'reveal' || value.action === 'validate_repository_root') {
    return typeof value.path === 'string';
  }
  if (value.action === 'prepare_workspace') {
    return (
      typeof value.path === 'string' &&
      (value.purpose === 'no_repository_agent' || value.purpose === 'conversation_subfolder') &&
      typeof value.agentId === 'string' &&
      (value.conversationId === undefined || typeof value.conversationId === 'string') &&
      (value.workspaceId === undefined ||
        typeof value.workspaceId === 'string' ||
        value.workspaceId === null)
    );
  }
  if (value.action === 'list_agent_files') {
    return (
      typeof value.workspacePath === 'string' &&
      (value.workspaceRootPath === undefined || typeof value.workspaceRootPath === 'string') &&
      typeof value.path === 'string'
    );
  }
  if (value.action === 'read_agent_file') {
    return (
      typeof value.workspacePath === 'string' &&
      (value.workspaceRootPath === undefined || typeof value.workspaceRootPath === 'string') &&
      typeof value.path === 'string' &&
      (value.encoding === 'utf8' || value.encoding === 'base64')
    );
  }
  if (value.action === 'write_agent_file') {
    return (
      typeof value.workspacePath === 'string' &&
      (value.workspaceRootPath === undefined || typeof value.workspaceRootPath === 'string') &&
      typeof value.path === 'string' &&
      typeof value.content === 'string' &&
      (value.encoding === 'utf8' || value.encoding === 'base64')
    );
  }
  if (value.action === 'create_agent_folder') {
    return (
      typeof value.workspacePath === 'string' &&
      (value.workspaceRootPath === undefined || typeof value.workspaceRootPath === 'string') &&
      typeof value.path === 'string' &&
      typeof value.name === 'string'
    );
  }
  if (
    value.action === 'delete_agent_path' ||
    value.action === 'reveal_agent_path'
  ) {
    return (
      typeof value.workspacePath === 'string' &&
      (value.workspaceRootPath === undefined || typeof value.workspaceRootPath === 'string') &&
      typeof value.path === 'string'
    );
  }
  if (value.action === 'import_agent_files') {
    return (
      typeof value.workspacePath === 'string' &&
      (value.workspaceRootPath === undefined || typeof value.workspaceRootPath === 'string') &&
      Array.isArray(value.files) &&
      value.files.every(isRunnerAgentWorkspaceImportFile)
    );
  }
  if (value.action === 'import_attachment') {
    return (
      isRunnerWorkspaceImportAttachmentSource(value.source) &&
      typeof value.destinationPath === 'string' &&
      (value.overwrite === undefined || typeof value.overwrite === 'boolean')
    );
  }
  return false;
}

function isRunnerFilesystemEntry(value: unknown): value is RunnerFilesystemEntry {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.path === 'string' &&
    (value.type === 'file' || value.type === 'directory') &&
    (value.size === undefined || isNonNegativeSafeInteger(value.size)) &&
    (value.modifiedAt === undefined || typeof value.modifiedAt === 'string')
  );
}

function isRunnerAgentWorkspaceFileEntry(
  value: unknown,
): value is RunnerAgentWorkspaceFileEntry {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.path === 'string' &&
    (value.type === 'file' || value.type === 'folder') &&
    isNonNegativeSafeInteger(value.size) &&
    typeof value.createdAt === 'string' &&
    (value.isReference === undefined || typeof value.isReference === 'boolean') &&
    (value.target === undefined || typeof value.target === 'string')
  );
}

function isRunnerAgentWorkspaceImportFile(
  value: unknown,
): value is RunnerAgentWorkspaceImportFile {
  return (
    isRecord(value) &&
    typeof value.path === 'string' &&
    typeof value.contentBase64 === 'string' &&
    isNonNegativeSafeInteger(value.sizeBytes) &&
    (value.modifiedAt === undefined || typeof value.modifiedAt === 'string')
  );
}

function isRunnerWorkspaceImportAttachmentSource(
  value: unknown,
): value is RunnerWorkspaceImportAttachmentSource {
  return (
    isRecord(value) &&
    typeof value.filename === 'string' &&
    typeof value.mimeType === 'string' &&
    isNonNegativeSafeInteger(value.sizeBytes) &&
    (value.sha256 === undefined || typeof value.sha256 === 'string') &&
    (value.storageId === undefined || typeof value.storageId === 'string') &&
    typeof value.storagePath === 'string' &&
    isRecord(value.download) &&
    value.download.method === 'GET' &&
    typeof value.download.path === 'string'
  );
}

function isRunnerFilesystemResult(value: unknown): value is RunnerFilesystemResult {
  if (!isRecord(value) || typeof value.action !== 'string') return false;
  if (value.action === 'browse') {
    return (
      typeof value.path === 'string' &&
      Array.isArray(value.entries) &&
      value.entries.every(isRunnerFilesystemEntry)
    );
  }
  if (value.action === 'pick_folder') return typeof value.path === 'string' || value.path === null;
  if (value.action === 'reveal') return true;
  if (value.action === 'validate_repository_root') {
    return (
      typeof value.path === 'string' &&
      value.repositoryRootOrigin === 'runner_local' &&
      typeof value.repositoryRootVerifiedAt === 'string'
    );
  }
  if (value.action === 'prepare_workspace') {
    return (
      typeof value.path === 'string' &&
      typeof value.workspaceRoot === 'string' &&
      value.status === 'ready' &&
      typeof value.preparedAt === 'string'
    );
  }
  if (value.action === 'list_agent_files') {
    return (
      typeof value.workspacePath === 'string' &&
      typeof value.path === 'string' &&
      Array.isArray(value.entries) &&
      value.entries.every(isRunnerAgentWorkspaceFileEntry)
    );
  }
  if (value.action === 'read_agent_file') {
    return (
      typeof value.path === 'string' &&
      typeof value.content === 'string' &&
      (value.encoding === 'utf8' || value.encoding === 'base64') &&
      isNonNegativeSafeInteger(value.sizeBytes)
    );
  }
  if (value.action === 'write_agent_file') {
    return (
      typeof value.path === 'string' &&
      isNonNegativeSafeInteger(value.sizeBytes) &&
      typeof value.updatedAt === 'string'
    );
  }
  if (value.action === 'create_agent_folder') {
    return isRunnerAgentWorkspaceFileEntry(value.entry);
  }
  if (value.action === 'delete_agent_path') {
    return typeof value.deleted === 'boolean';
  }
  if (value.action === 'reveal_agent_path') return true;
  if (value.action === 'import_agent_files') {
    return (
      isNonNegativeSafeInteger(value.importedCount) &&
      isNonNegativeSafeInteger(value.skippedCount) &&
      isNonNegativeSafeInteger(value.totalBytes) &&
      typeof value.importedAt === 'string'
    );
  }
  if (value.action === 'import_attachment') {
    return (
      typeof value.path === 'string' &&
      isNonNegativeSafeInteger(value.sizeBytes) &&
      (value.sha256 === undefined || typeof value.sha256 === 'string') &&
      typeof value.importedAt === 'string'
    );
  }
  return false;
}

export function parseRunnerJobIntent(value: unknown): RunnerJobIntent | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.runId !== 'string' ||
    typeof value.agentId !== 'string' ||
    !isRunnerProvider(value.provider) ||
    typeof value.prompt !== 'string' ||
    !isRecord(value.modelPreference) ||
    typeof value.modelPreference.displayName !== 'string' ||
    !isRecord(value.workspace) ||
    value.workspace.type !== 'local_path' ||
    typeof value.workspace.path !== 'string' ||
    value.workspace.materialization !== undefined ||
    !isRecord(value.allowedOperations) ||
    !isRunnerProviderArray(value.allowedOperations.tools) ||
    !isRunnerApprovalMode(value.allowedOperations.approvalMode) ||
    typeof value.allowedOperations.env !== 'boolean' ||
    typeof value.allowedOperations.secrets !== 'boolean' ||
    typeof value.allowedOperations.network !== 'boolean' ||
    typeof value.allowedOperations.shell !== 'boolean' ||
    (value.attachments !== undefined && !isRunnerAttachmentArray(value.attachments)) ||
    (value.stagingManifest !== undefined && !isValidRunnerStagingManifest(value.stagingManifest))
  ) {
    return null;
  }
  return value as unknown as RunnerJobIntent;
}

export function parseServerRunnerMessage(value: unknown): ServerRunnerMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (value.protocolVersion !== RUNNER_PROTOCOL_VERSION) {
    if (value.type === 'job_offer' && typeof value.jobId === 'string') {
      return value as ServerRunnerMessage;
    }
    if (
      value.type === 'cancel' &&
      typeof value.jobId === 'string' &&
      typeof value.runId === 'string'
    ) {
      return value as ServerRunnerMessage;
    }
    return null;
  }
  if (value.type === 'server_hello' && typeof value.runnerId === 'string') {
    return value as ServerRunnerMessage;
  }
  if (
    value.type === 'job_offer' &&
    typeof value.jobId === 'string' &&
    parseRunnerJobIntent(value.job)
  ) {
    return value as ServerRunnerMessage;
  }
  if (
    value.type === 'workspace_setup' &&
    typeof value.setupId === 'string' &&
    isValidRunnerWorkspaceSetupIntent(value.setup) &&
    value.setup.setupId === value.setupId
  ) {
    return value as ServerRunnerMessage;
  }
  if (
    value.type === 'cancel' &&
    typeof value.jobId === 'string' &&
    typeof value.runId === 'string'
  ) {
    return value as ServerRunnerMessage;
  }
  if (
    value.type === 'filesystem_request' &&
    typeof value.requestId === 'string' &&
    isRunnerFilesystemRequest(value.request)
  ) {
    return value as ServerRunnerMessage;
  }
  return null;
}

export function parseRunnerServerMessage(value: unknown): RunnerServerMessage | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  if (value.protocolVersion !== RUNNER_PROTOCOL_VERSION) {
    if (
      (value.type === 'runner_hello' || value.type === 'runner_heartbeat') &&
      typeof value.protocolVersion === 'string' &&
      typeof value.runnerId === 'string' &&
      typeof value.name === 'string' &&
      isRecord(value.capabilities)
    ) {
      return value as RunnerServerMessage;
    }
    return value.type === 'protocol_error' ? (value as RunnerServerMessage) : null;
  }
  if (
    (value.type === 'runner_hello' || value.type === 'runner_heartbeat') &&
    typeof value.runnerId === 'string' &&
    typeof value.name === 'string' &&
    isRecord(value.capabilities)
  ) {
    return value as RunnerServerMessage;
  }
  if (
    value.type === 'job_accepted' &&
    typeof value.jobId === 'string' &&
    typeof value.runId === 'string'
  ) {
    return value as RunnerServerMessage;
  }
  if (
    value.type === 'job_rejected' &&
    typeof value.jobId === 'string' &&
    typeof value.code === 'string' &&
    typeof value.message === 'string'
  ) {
    return value as RunnerServerMessage;
  }
  if (value.type === 'workspace_setup_completed' && typeof value.setupId === 'string') {
    return value as RunnerServerMessage;
  }
  if (
    value.type === 'workspace_setup_failed' &&
    typeof value.setupId === 'string' &&
    typeof value.message === 'string'
  ) {
    return value as RunnerServerMessage;
  }
  if (
    value.type === 'output_event' &&
    typeof value.jobId === 'string' &&
    typeof value.runId === 'string' &&
    (value.stream === 'stdout' || value.stream === 'stderr') &&
    typeof value.text === 'string'
  ) {
    return value as RunnerServerMessage;
  }
  if (
    value.type === 'final_message' &&
    typeof value.jobId === 'string' &&
    typeof value.runId === 'string' &&
    typeof value.text === 'string'
  ) {
    return value as RunnerServerMessage;
  }
  if (
    value.type === 'artifact' &&
    typeof value.jobId === 'string' &&
    typeof value.runId === 'string' &&
    isRecord(value.artifact) &&
    typeof value.artifact.name === 'string' &&
    typeof value.artifact.path === 'string' &&
    (value.artifact.mimeType === undefined || typeof value.artifact.mimeType === 'string')
  ) {
    return value as RunnerServerMessage;
  }
  if (
    value.type === 'completed' &&
    typeof value.jobId === 'string' &&
    typeof value.runId === 'string' &&
    (typeof value.code === 'number' || value.code === null) &&
    typeof value.stdout === 'string' &&
    typeof value.stderr === 'string'
  ) {
    return value as RunnerServerMessage;
  }
  if (
    value.type === 'failed' &&
    typeof value.jobId === 'string' &&
    typeof value.runId === 'string' &&
    (typeof value.code === 'number' || value.code === null) &&
    typeof value.message === 'string' &&
    typeof value.stdout === 'string' &&
    typeof value.stderr === 'string'
  ) {
    return value as RunnerServerMessage;
  }
  if (
    value.type === 'cancelled' &&
    typeof value.jobId === 'string' &&
    typeof value.runId === 'string' &&
    (value.message === undefined || typeof value.message === 'string') &&
    typeof value.stdout === 'string' &&
    typeof value.stderr === 'string'
  ) {
    return value as RunnerServerMessage;
  }
  if (
    value.type === 'protocol_error' &&
    typeof value.code === 'string' &&
    typeof value.message === 'string'
  ) {
    return value as RunnerServerMessage;
  }
  if (value.type === 'filesystem_response' && typeof value.requestId === 'string') {
    if (value.ok === true && isRunnerFilesystemResult(value.result)) {
      return value as RunnerServerMessage;
    }
    if (
      value.ok === false &&
      typeof value.code === 'string' &&
      typeof value.message === 'string'
    ) {
      return value as RunnerServerMessage;
    }
  }
  return null;
}

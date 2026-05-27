import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  RunnerAgentInventoryAdvertisement,
  RunnerApprovalMode,
  RunnerFilesystemOperation,
  RunnerProvider,
  RunnerProtocolVersion,
  RunnerSupportedTool,
  RunnerWorkspaceMode,
} from 'shared';
import { store } from '../db/index.js';
import { createAuditLog } from './audit-log.js';
import { getWorkspaceById } from './workspaces.js';

export interface RunnerCapabilities {
  protocolVersion?: RunnerProtocolVersion;
  os?: string;
  arch?: string;
  runnerVersion?: string;
  version?: string;
  workspaceRoot?: string;
  installedProviders?: RunnerProvider[];
  supportedProviders?: RunnerProvider[];
  supportedTools?: RunnerSupportedTool[];
  approvalModes?: RunnerApprovalMode[];
  workspaceModes?: RunnerWorkspaceMode[];
  concurrency?: {
    activeJobs?: number;
    maxJobs?: number | null;
  };
  supportsCancellation?: boolean;
  supportsArtifacts?: boolean;
  supportsFilesystem?: boolean;
  filesystemOperations?: RunnerFilesystemOperation[];
  agentInventory?: RunnerAgentInventoryAdvertisement;
  policy?: {
    workspaceRootRequired?: boolean;
    allowedTools?: RunnerProvider[];
    approvalModes?: RunnerApprovalMode[];
    envAccess?: boolean;
    secretAccess?: boolean;
    network?: boolean;
    shell?: boolean;
  };
  models?: string[];
  commands?: string[];
}

export interface AuditCtx {
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export type RunnerConnectionScope = 'account' | 'project';

export interface RunnerConnectionBinding {
  connectionScope: RunnerConnectionScope;
  ownerAccountId: string;
  boundWorkspaceId: string;
  originalBoundWorkspaceId: string;
  legacyConnectionScope: boolean;
}

export interface RunnerRecord {
  id: string;
  userId: string;
  workspaceId: string;
  connectionScope?: RunnerConnectionScope | null;
  ownerAccountId?: string | null;
  boundWorkspaceId?: string | null;
  originalBoundWorkspaceId?: string | null;
  legacyConnectionScope?: boolean | null;
  displayName: string;
  credentialHash: string;
  credentialPrefix: string;
  status: string;
  lastSeenAt: string | null;
  version: string | null;
  capabilities: RunnerCapabilities;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RunnerConnectionValidationCode =
  | 'runner_connection_invalid_scope'
  | 'runner_connection_missing_owner'
  | 'runner_connection_missing_project_binding'
  | 'runner_connection_binding_mismatch';

export type RunnerActivationErrorCode =
  | 'runner_activation_forbidden'
  | 'runner_connection_forbidden'
  | 'runner_binding_immutable';

export type RunnerActivationDenialCategory =
  | 'ownership'
  | 'membership'
  | 'workspace_binding'
  | 'stale_runner'
  | 'capability';

export type RunnerActivationCheckResult =
  | { allowed: true; binding: RunnerConnectionBinding }
  | {
      allowed: false;
      code: 'runner_activation_forbidden';
      category: RunnerActivationDenialCategory;
      statusCode: 403 | 409;
      message: string;
      hint?: string;
    };

export class RunnerConnectionValidationError extends Error {
  readonly code: RunnerConnectionValidationCode;

  constructor(code: RunnerConnectionValidationCode, message: string) {
    super(message);
    this.name = 'RunnerConnectionValidationError';
    this.code = code;
  }
}

export class RunnerActivationError extends Error {
  readonly code: RunnerActivationErrorCode;
  readonly statusCode: 403 | 409;
  readonly category?: RunnerActivationDenialCategory;
  readonly hint?: string;

  constructor(
    code: RunnerActivationErrorCode,
    message: string,
    statusCode: 403 | 409 = 409,
    options?: { category?: RunnerActivationDenialCategory; hint?: string },
  ) {
    super(message);
    this.name = 'RunnerActivationError';
    this.code = code;
    this.statusCode = statusCode;
    this.category = options?.category;
    this.hint = options?.hint;
  }
}

const IMMUTABLE_RUNNER_BINDING_FIELDS = [
  'connectionScope',
  'ownerAccountId',
  'boundWorkspaceId',
  'originalBoundWorkspaceId',
  'userId',
  'workspaceId',
] as const;

export function rejectImmutableRunnerBindingPatch(patch: Record<string, unknown>): void {
  for (const field of IMMUTABLE_RUNNER_BINDING_FIELDS) {
    if (patch[field] !== undefined) {
      throw new RunnerActivationError(
        'runner_binding_immutable',
        `Runner binding field ${field} cannot be changed after pairing. Revoke and pair again to bind a different workspace or scope.`,
        409,
      );
    }
  }
}

function collectWorkspaceMemberIds(workspace: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) {
      ids.add(value.trim());
    }
  };
  const addArray = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (typeof item === 'string') {
        add(item);
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      add(record.id);
      add(record.userId);
      add(record.accountId);
      add(record.memberId);
    }
  };

  add(workspace.userId);
  add(workspace.ownerAccountId);
  add(workspace.ownerUserId);
  addArray(workspace.memberIds);
  addArray(workspace.userIds);
  addArray(workspace.accountIds);
  addArray(workspace.workspaceMemberIds);
  addArray(workspace.members);
  addArray(workspace.workspaceMembers);
  addArray(workspace.users);
  addArray(workspace.accounts);
  addArray(workspace.collaboratorIds);
  addArray(workspace.collaborators);
  return ids;
}

function userHasWorkspaceContentAccess(
  userId: string,
  workspace: Record<string, unknown>,
): boolean {
  const boardIds = new Set(
    Array.isArray(workspace.boardIds)
      ? workspace.boardIds.filter((id): id is string => typeof id === 'string')
      : [],
  );
  const collectionIds = new Set(
    Array.isArray(workspace.collectionIds)
      ? workspace.collectionIds.filter((id): id is string => typeof id === 'string')
      : [],
  );

  for (const board of store.getAll('boards')) {
    if (typeof board.id === 'string' && boardIds.has(board.id) && board.createdById === userId) {
      return true;
    }
  }

  for (const collection of store.getAll('collections')) {
    if (
      typeof collection.id === 'string' &&
      collectionIds.has(collection.id) &&
      collection.createdById === userId
    ) {
      return true;
    }
  }

  for (const card of store.getAll('cards')) {
    if (typeof card.collectionId !== 'string' || !collectionIds.has(card.collectionId)) continue;
    if (card.createdById === userId || card.assigneeId === userId) return true;
  }

  return false;
}

export function canAccessWorkspace(userId: string, workspaceId: string): boolean {
  const workspace = store.getAll('workspaces').find((record) => record.id === workspaceId);
  if (!workspace) return false;
  if (collectWorkspaceMemberIds(workspace).has(userId)) return true;
  return userHasWorkspaceContentAccess(userId, workspace);
}

export async function assertWorkspaceAccessible(userId: string, workspaceId: string): Promise<void> {
  if (!canAccessWorkspace(userId, workspaceId)) {
    throw new RunnerActivationError(
      'runner_connection_forbidden',
      'You do not have access to runner connections for this workspace.',
      403,
    );
  }
}

export function assertRunnerBindingMatchesRoutingWorkspace(
  binding: RunnerConnectionBinding,
  routingWorkspaceId: string,
): void {
  if (binding.boundWorkspaceId !== routingWorkspaceId) {
    throw new RunnerActivationError(
      'runner_activation_forbidden',
      'This runner is bound to a different workspace. Switch to the bound workspace or pair a runner for this project.',
      409,
    );
  }
}

export function getRunnerRecordBinding(runnerId: string): RunnerConnectionBinding | null {
  const record = store.getById('agentRunners', runnerId);
  if (!record) return null;
  try {
    return validateRunnerConnectionBinding(record);
  } catch {
    return null;
  }
}

async function updateRunnerRecord(runnerId: string, patch: Record<string, unknown>) {
  rejectImmutableRunnerBindingPatch(patch);
  return store.update('agentRunners', runnerId, patch);
}

export interface RunnerRoutingScope {
  userId: string;
  workspaceId: string;
}

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
export const RUNNER_STALE_AFTER_MS = 2 * 60 * 1000;
export type RunnerLiveStatus = 'online' | 'busy' | 'stale';

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function parseRunnerConnectionScope(value: unknown): RunnerConnectionScope | null {
  if (value === 'account' || value === 'project') return value;
  return null;
}

export function resolveRunnerConnectionBinding(
  record: Record<string, unknown>,
): RunnerConnectionBinding {
  const ownerAccountId =
    typeof record.ownerAccountId === 'string' && record.ownerAccountId
      ? record.ownerAccountId
      : typeof record.userId === 'string'
        ? record.userId
        : '';
  const boundWorkspaceId =
    typeof record.boundWorkspaceId === 'string' && record.boundWorkspaceId
      ? record.boundWorkspaceId
      : typeof record.workspaceId === 'string'
        ? record.workspaceId
        : '';
  const originalBoundWorkspaceId =
    typeof record.originalBoundWorkspaceId === 'string' && record.originalBoundWorkspaceId
      ? record.originalBoundWorkspaceId
      : boundWorkspaceId;
  const connectionScope =
    parseRunnerConnectionScope(record.connectionScope) ??
    ('account' satisfies RunnerConnectionScope);
  const legacyConnectionScope =
    typeof record.legacyConnectionScope === 'boolean' ? record.legacyConnectionScope : true;

  return {
    connectionScope,
    ownerAccountId,
    boundWorkspaceId,
    originalBoundWorkspaceId,
    legacyConnectionScope,
  };
}

export function validateRunnerConnectionBinding(
  record: Record<string, unknown>,
): RunnerConnectionBinding {
  const binding = resolveRunnerConnectionBinding(record);
  const declaredScope = record.connectionScope;
  const alternateScope =
    typeof record.scope === 'string'
      ? record.scope
      : typeof record.projectConnectionScope === 'string'
        ? record.projectConnectionScope
        : null;

  if (
    (declaredScope != null && !parseRunnerConnectionScope(declaredScope)) ||
    (alternateScope != null &&
      parseRunnerConnectionScope(alternateScope) &&
      parseRunnerConnectionScope(alternateScope) !== binding.connectionScope)
  ) {
    throw new RunnerConnectionValidationError(
      'runner_connection_invalid_scope',
      'Runner connection has conflicting or invalid scope metadata',
    );
  }

  if (!binding.ownerAccountId) {
    throw new RunnerConnectionValidationError(
      'runner_connection_missing_owner',
      'Runner connection is missing an owner account',
    );
  }

  if (binding.connectionScope === 'project' && !binding.boundWorkspaceId) {
    throw new RunnerConnectionValidationError(
      'runner_connection_missing_project_binding',
      'Project runner connections must be bound to a workspace',
    );
  }

  const userId = typeof record.userId === 'string' ? record.userId : null;
  const workspaceId = typeof record.workspaceId === 'string' ? record.workspaceId : null;
  if (
    (userId && binding.ownerAccountId !== userId) ||
    (workspaceId && binding.boundWorkspaceId !== workspaceId)
  ) {
    throw new RunnerConnectionValidationError(
      'runner_connection_binding_mismatch',
      'Runner connection binding fields do not match legacy owner/workspace columns',
    );
  }

  return binding;
}

export function assertRunnerConnectionActivatable(record: Record<string, unknown>): RunnerConnectionBinding {
  return validateRunnerConnectionBinding(record);
}

export function isWorkspaceActivationMember(accountId: string, workspaceId: string): boolean {
  return canAccessWorkspace(accountId, workspaceId);
}

export function evaluateRunnerActivation(params: {
  record: Record<string, unknown>;
  activationActorId: string;
  routingWorkspaceId: string;
  hasAgentRunPermission?: boolean;
}): RunnerActivationCheckResult {
  let binding: RunnerConnectionBinding;
  try {
    binding = validateRunnerConnectionBinding(params.record);
  } catch (error) {
    const code =
      error instanceof RunnerConnectionValidationError ? error.code : 'runner_connection_binding_mismatch';
    return {
      allowed: false,
      code: 'runner_activation_forbidden',
      category: 'capability',
      statusCode: 409,
      message: 'Runner connection metadata is invalid and cannot be activated.',
      hint: code,
    };
  }

  if (binding.boundWorkspaceId !== params.routingWorkspaceId) {
    return {
      allowed: false,
      code: 'runner_activation_forbidden',
      category: 'workspace_binding',
      statusCode: 409,
      message: 'This runner is bound to a different workspace than the agent routing scope.',
      hint: 'Pair a runner for the workspace that owns this agent group, or move the agent group to the runner workspace.',
    };
  }

  if (binding.connectionScope === 'account') {
    if (params.activationActorId !== binding.ownerAccountId) {
      return {
        allowed: false,
        code: 'runner_activation_forbidden',
        category: 'ownership',
        statusCode: 409,
        message: 'Only the account that paired this runner can start jobs on it.',
        hint: 'Use your own account-connected runner, ask the owner to run the work, or pair a project runner for shared activation.',
      };
    }
    return { allowed: true, binding };
  }

  if (!isWorkspaceActivationMember(params.activationActorId, binding.boundWorkspaceId)) {
    return {
      allowed: false,
      code: 'runner_activation_forbidden',
      category: 'membership',
      statusCode: 403,
      message: 'You are not a member of the workspace this project runner is bound to.',
      hint: 'Ask a workspace owner to grant access or use a runner in a workspace you belong to.',
    };
  }

  if (params.hasAgentRunPermission === false) {
    return {
      allowed: false,
      code: 'runner_activation_forbidden',
      category: 'capability',
      statusCode: 403,
      message: 'You do not have permission to run agents in this workspace.',
      hint: 'Request agent-run permission (settings:update) for this workspace before dispatching runner jobs.',
    };
  }

  return { allowed: true, binding };
}

export function assertRunnerActivationAllowed(params: {
  record: Record<string, unknown>;
  activationActorId: string;
  routingWorkspaceId: string;
  hasAgentRunPermission?: boolean;
}): RunnerConnectionBinding {
  const result = evaluateRunnerActivation(params);
  if (result.allowed) return result.binding;
  throw new RunnerActivationError(
    result.code,
    result.message,
    result.statusCode,
    { category: result.category, hint: result.hint },
  );
}

export async function assertRunnerActivationAllowedForBinding(
  binding: RunnerConnectionBinding,
  activationActorId: string,
  routingWorkspaceId: string,
  hasAgentRunPermission = true,
): Promise<void> {
  assertRunnerBindingMatchesRoutingWorkspace(binding, routingWorkspaceId);
  if (binding.connectionScope === 'account') {
    if (binding.ownerAccountId !== activationActorId) {
      throw new RunnerActivationError(
        'runner_activation_forbidden',
        'Only the account that paired this runner may use it for agent work.',
        409,
        { category: 'ownership' },
      );
    }
    return;
  }

  if (!canAccessWorkspace(activationActorId, binding.boundWorkspaceId)) {
    throw new RunnerActivationError(
      'runner_activation_forbidden',
      'You do not have permission to activate runners for this workspace.',
      403,
      { category: 'membership' },
    );
  }

  if (!hasAgentRunPermission) {
    throw new RunnerActivationError(
      'runner_activation_forbidden',
      'You do not have permission to run agents in this workspace.',
      403,
      { category: 'capability' },
    );
  }
}

export async function auditRunnerActivationDenied(params: {
  activationActorId: string;
  runnerId: string;
  category: RunnerActivationDenialCategory;
  routingWorkspaceId: string;
  audit?: AuditCtx;
}) {
  try {
    await createAuditLog({
      userId: params.audit?.userId ?? params.activationActorId,
      action: 'runner_activation_denied',
      entityType: 'agent_runner',
      entityId: params.runnerId,
      changes: {
        category: params.category,
        routingWorkspaceId: params.routingWorkspaceId,
      },
      ipAddress: params.audit?.ipAddress,
      userAgent: params.audit?.userAgent,
    });
  } catch {
    // Best-effort audit only; do not block runner error responses when persistence is unavailable.
  }
}

function publicRunner(
  record: Record<string, unknown>,
  liveStatus?: RunnerLiveStatus,
  liveCapabilities?: RunnerCapabilities,
) {
  const binding = resolveRunnerConnectionBinding(record);
  const lastSeenAt = typeof record.lastSeenAt === 'string' ? record.lastSeenAt : null;
  const revokedAt = typeof record.revokedAt === 'string' ? record.revokedAt : null;
  let status = 'offline';
  if (revokedAt) {
    status = 'revoked';
  } else if (liveStatus) {
    status = liveStatus;
  }
  const storedCapabilities =
    record.capabilities && typeof record.capabilities === 'object'
      ? (record.capabilities as RunnerCapabilities)
      : null;
  const capabilities = liveCapabilities ?? storedCapabilities ?? {};
  const inventory = capabilities.agentInventory;
  const inventoryExpiresAt =
    inventory && typeof inventory.advertisedAt === 'string' && typeof inventory.ttlMs === 'number'
      ? new Date(Date.parse(inventory.advertisedAt) + inventory.ttlMs).toISOString()
      : null;

  return {
    id: String(record.id),
    userId: binding.ownerAccountId,
    workspaceId: binding.boundWorkspaceId,
    connectionScope: binding.connectionScope,
    ownerAccountId: binding.ownerAccountId,
    boundWorkspaceId: binding.boundWorkspaceId,
    originalBoundWorkspaceId: binding.originalBoundWorkspaceId,
    legacyConnectionScope: binding.legacyConnectionScope,
    displayName: String(record.displayName),
    status,
    lastSeenAt,
    version: typeof record.version === 'string' ? record.version : null,
    capabilities,
    capabilitySource: liveCapabilities
      ? 'runner_advertisement'
      : storedCapabilities
        ? 'runner_snapshot'
        : 'unavailable',
    inventory: inventory
      ? {
          revision: inventory.revision,
          advertisedAt: inventory.advertisedAt,
          ttlMs: inventory.ttlMs,
          expiresAt: inventoryExpiresAt,
          stale: inventoryExpiresAt ? Date.parse(inventoryExpiresAt) <= Date.now() : true,
          workspaceRoots: inventory.workspaceRoots,
          fileOperations: inventory.fileOperations,
          agentCount: inventory.agents.length,
          readyAgentCount: inventory.agents.filter((agent) => agent.readiness === 'ready').length,
        }
      : {
          stale: true,
          unavailableReason: 'runner_inventory_not_advertised',
        },
    revoked: Boolean(revokedAt),
    revokedAt,
    createdAt: String(record.createdAt),
    updatedAt: String(record.updatedAt),
  };
}

function runnerConnectionScopeForCreate(scope: unknown): RunnerConnectionScope {
  const parsed = parseRunnerConnectionScope(scope);
  if (!parsed) {
    throw new Error('Invalid runner connection scope');
  }
  return parsed;
}

function normalizeCode(code: string): string {
  return code.trim().replace(/[\s-]/g, '').toUpperCase();
}

function generatePairingCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = randomBytes(8);
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return code;
}

function generateCredential(): string {
  return `owrun_${randomBytes(32).toString('base64url')}`;
}

export async function createRunnerPairingCode(
  params: {
    userId: string;
    workspaceId: string;
    displayName: string;
    connectionScope?: RunnerConnectionScope;
  },
  audit?: AuditCtx,
) {
  const workspace = await getWorkspaceById(params.workspaceId);
  if (!workspace || workspace.userId !== params.userId) {
    throw new Error('Workspace not found');
  }

  const connectionScope = runnerConnectionScopeForCreate(params.connectionScope ?? 'account');
  const code = generatePairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS).toISOString();
  const record = await store.insert('agentRunnerPairingCodes', {
    userId: params.userId,
    workspaceId: params.workspaceId,
    connectionScope,
    displayName: params.displayName.trim() || 'Runner',
    codeHash: hashSecret(normalizeCode(code)),
    expiresAt,
    usedAt: null,
  });

  await createAuditLog({
    userId: audit?.userId ?? params.userId,
    action: 'runner_pairing_code_created',
    entityType: 'agent_runner_pairing_code',
    entityId: String(record.id),
    changes: {
      workspaceId: params.workspaceId,
      displayName: params.displayName,
      connectionScope,
    },
    ipAddress: audit?.ipAddress,
    userAgent: audit?.userAgent,
  });

  return { id: String(record.id), code, expiresAt };
}

export async function pairRunnerWithCode(params: {
  code: string;
  displayName?: string;
  version?: string;
  capabilities?: RunnerCapabilities;
}) {
  const codeHash = hashSecret(normalizeCode(params.code));
  const now = new Date().toISOString();
  const pairing = store
    .getAll('agentRunnerPairingCodes')
    .find(
      (record) =>
        typeof record.codeHash === 'string' &&
        safeEqualHex(record.codeHash, codeHash) &&
        !record.usedAt &&
        new Date(String(record.expiresAt)).getTime() > Date.now(),
    );

  if (!pairing) {
    await createAuditLog({
      action: 'runner_pairing_failed',
      entityType: 'agent_runner',
      changes: { reason: 'invalid_or_expired_code' },
    });
    throw new Error('Invalid or expired pairing code');
  }

  const credential = generateCredential();
  const displayName =
    params.displayName?.trim() || String(pairing.displayName || '').trim() || 'Runner';
  const connectionScope = runnerConnectionScopeForCreate(pairing.connectionScope ?? 'account');
  const ownerAccountId = String(pairing.userId);
  const boundWorkspaceId = String(pairing.workspaceId);
  const runner = await store.insert('agentRunners', {
    userId: ownerAccountId,
    workspaceId: boundWorkspaceId,
    connectionScope,
    ownerAccountId,
    boundWorkspaceId,
    originalBoundWorkspaceId: boundWorkspaceId,
    legacyConnectionScope: false,
    displayName,
    credentialHash: hashSecret(credential),
    credentialPrefix: credential.slice(0, 12),
    status: 'offline',
    lastSeenAt: now,
    version: params.version ?? null,
    capabilities: {},
    revokedAt: null,
  });
  await store.update('agentRunnerPairingCodes', String(pairing.id), { usedAt: now });

  await createAuditLog({
    userId: String(pairing.userId),
    action: 'runner_paired',
    entityType: 'agent_runner',
    entityId: String(runner.id),
    changes: { workspaceId: boundWorkspaceId, displayName, connectionScope },
  });

  return { runner: publicRunner(runner), credential };
}

export async function authenticateRunnerCredential(credential: string): Promise<RunnerRecord | null> {
  const hash = hashSecret(credential);
  const record = store
    .getAll('agentRunners')
    .find((candidate) => typeof candidate.credentialHash === 'string' && safeEqualHex(candidate.credentialHash, hash));
  if (!record) {
    await createAuditLog({
      action: 'runner_auth_failed',
      entityType: 'agent_runner',
      changes: { reason: 'unknown_credential' },
    });
    return null;
  }
  if (record.revokedAt) {
    await createAuditLog({
      userId: String(record.userId),
      action: 'runner_auth_failed',
      entityType: 'agent_runner',
      entityId: String(record.id),
      changes: { reason: 'revoked' },
    });
    return null;
  }
  try {
    assertRunnerConnectionActivatable(record);
  } catch (error) {
    await createAuditLog({
      userId: String(record.userId),
      action: 'runner_auth_failed',
      entityType: 'agent_runner',
      entityId: String(record.id),
      changes: {
        reason: 'invalid_connection_binding',
        code: error instanceof RunnerConnectionValidationError ? error.code : 'unknown',
      },
    });
    return null;
  }
  return record as unknown as RunnerRecord;
}

export async function noteRunnerConnected(
  runnerId: string,
  params: { displayName?: string; version?: string; capabilities?: RunnerCapabilities },
) {
  const patch: Record<string, unknown> = {
    status: 'online',
    lastSeenAt: new Date().toISOString(),
  };
  if (params.displayName) patch.displayName = params.displayName;
  if (params.version !== undefined) patch.version = params.version;
  if (params.capabilities !== undefined) patch.capabilities = params.capabilities;
  const updated = await updateRunnerRecord(runnerId, patch);
  if (updated) {
    await createAuditLog({
      userId: String(updated.userId),
      action: 'runner_reconnected',
      entityType: 'agent_runner',
      entityId: runnerId,
      changes: { workspaceId: updated.workspaceId },
    });
  }
}

export function noteRunnerSeen(runnerId: string, status: 'online' | 'busy' = 'online') {
  void updateRunnerRecord(runnerId, {
    status,
    lastSeenAt: new Date().toISOString(),
  });
}

export function noteRunnerDisconnected(runnerId: string) {
  void updateRunnerRecord(runnerId, { status: 'offline' });
}

export interface ListRunnerDevicesOptions {
  workspaceId?: string;
  connectionScope?: RunnerConnectionScope;
}

export function listRunnerDevices(
  userId: string,
  options: ListRunnerDevicesOptions | string | undefined,
  liveStatus: Map<string, RunnerLiveStatus>,
  liveCapabilities?: Map<string, RunnerCapabilities>,
  workspaceAccess?: (workspaceId: string) => boolean,
) {
  const normalizedOptions: ListRunnerDevicesOptions =
    typeof options === 'string' ? { workspaceId: options } : (options ?? {});
  const { workspaceId, connectionScope } = normalizedOptions;
  const canAccess = workspaceAccess ?? (() => true);

  return store
    .getAll('agentRunners')
    .filter((record) => {
      let binding: RunnerConnectionBinding;
      try {
        binding = validateRunnerConnectionBinding(record);
      } catch {
        return false;
      }

      if (workspaceId && binding.boundWorkspaceId !== workspaceId) {
        return false;
      }

      if (connectionScope === 'account') {
        return binding.connectionScope === 'account' && binding.ownerAccountId === userId;
      }

      if (connectionScope === 'project') {
        if (binding.connectionScope !== 'project') return false;
        if (!workspaceId) return false;
        return canAccess(workspaceId);
      }

      if (workspaceId) {
        if (binding.connectionScope === 'project') {
          return canAccess(workspaceId) && binding.boundWorkspaceId === workspaceId;
        }
        return binding.ownerAccountId === userId && binding.boundWorkspaceId === workspaceId;
      }

      return binding.ownerAccountId === userId;
    })
    .sort((a, b) => new Date(String(b.createdAt)).getTime() - new Date(String(a.createdAt)).getTime())
    .map((record) =>
      publicRunner(
        record,
        liveStatus.get(String(record.id)),
        liveCapabilities?.get(String(record.id)),
      ),
    );
}

export async function renameRunnerDevice(
  userId: string,
  runnerId: string,
  displayName: string,
  audit?: AuditCtx,
) {
  const runner = store.getById('agentRunners', runnerId);
  if (!runner) return null;
  try {
    const binding = validateRunnerConnectionBinding(runner);
    if (binding.ownerAccountId !== userId) return null;
  } catch {
    return null;
  }
  const updated = await updateRunnerRecord(runnerId, { displayName: displayName.trim() });
  await createAuditLog({
    userId,
    action: 'runner_renamed',
    entityType: 'agent_runner',
    entityId: runnerId,
    changes: { displayName },
    ipAddress: audit?.ipAddress,
    userAgent: audit?.userAgent,
  });
  return updated ? publicRunner(updated) : null;
}

export async function revokeRunnerDevice(userId: string, runnerId: string, audit?: AuditCtx) {
  const runner = store.getById('agentRunners', runnerId);
  if (!runner) return null;
  try {
    const binding = validateRunnerConnectionBinding(runner);
    if (binding.ownerAccountId !== userId) return null;
  } catch {
    return null;
  }
  const updated = await updateRunnerRecord(runnerId, {
    revokedAt: new Date().toISOString(),
    status: 'revoked',
  });
  await createAuditLog({
    userId,
    action: 'runner_revoked',
    entityType: 'agent_runner',
    entityId: runnerId,
    changes: { workspaceId: runner.workspaceId },
    ipAddress: audit?.ipAddress,
    userAgent: audit?.userAgent,
  });
  return updated ? publicRunner(updated) : null;
}

export function workspaceIdsForAgentGroup(groupId: string | null | undefined): string[] {
  return runnerRoutingScopesForAgentGroup(groupId).map((scope) => scope.workspaceId);
}

export function runnerRoutingScopesForAgentGroup(
  groupId: string | null | undefined,
): RunnerRoutingScope[] {
  if (!groupId) return [];

  const seen = new Set<string>();
  const scopes: RunnerRoutingScope[] = [];

  for (const workspace of store.getAll('workspaces')) {
    if (!Array.isArray(workspace.agentGroupIds) || !workspace.agentGroupIds.includes(groupId)) {
      continue;
    }

    const userId = typeof workspace.userId === 'string' ? workspace.userId : '';
    const workspaceId = typeof workspace.id === 'string' ? workspace.id : '';
    if (!userId || !workspaceId) continue;

    const key = `${userId}:${workspaceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scopes.push({ userId, workspaceId });
  }

  return scopes;
}

import path from 'node:path';
import type { RunnerFilesystemRequest } from 'shared';
import { store } from '../db/index.js';
import type { AgentRecord } from './agents.js';
import {
  dispatchRunnerFilesystemRequest,
  getRunnerFilesystemAvailability,
  getRunnerFilesystemSelection,
} from './agent-runners.js';
import {
  deriveAgentWorkspacePath,
  isRepositoryRootRunnerVerified,
  normalizeRepositoryRoot,
  normalizeRepositoryRootOrigin,
} from './agent-workspaces.js';
import { canAccessWorkspace, runnerRoutingScopesForAgentGroup } from './runner-devices.js';

type AgentFileRequest = Extract<
  RunnerFilesystemRequest,
  | { action: 'list_agent_files' }
  | { action: 'read_agent_file' }
  | { action: 'write_agent_file' }
  | { action: 'create_agent_folder' }
  | { action: 'delete_agent_path' }
  | { action: 'reveal_agent_path' }
  | { action: 'import_agent_files' }
>;
type WithoutRunnerPaths<T> = T extends unknown
  ? Omit<T, 'workspacePath' | 'workspaceRootPath'>
  : never;
type AgentFileRequestInput = WithoutRunnerPaths<AgentFileRequest>;

function pathInsideRoot(candidate: string, root: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function noRepositoryAgentWorkspacePath(workspaceRoot: string, agentId: string): string {
  return path.join(workspaceRoot, '.openwork', 'no-repository-agents', agentId, 'workspace');
}

function resolveSingleRunnerScopeForAgent(params: {
  agent: Pick<AgentRecord, 'groupId'>;
  requestUserId: string;
  workspaceId?: string;
}): { userId: string; workspaceId: string } {
  const scopes = runnerRoutingScopesForAgentGroup(params.agent.groupId).filter(
    (scope) => canAccessWorkspace(params.requestUserId, scope.workspaceId),
  );
  const matchingScopes = params.workspaceId
    ? scopes.filter((scope) => scope.workspaceId === params.workspaceId)
    : scopes;
  if (matchingScopes.length === 0) {
    throw new Error(
      'agent_runner_workspace_missing: This agent is not assigned to a workspace with a runner.',
    );
  }
  if (matchingScopes.length > 1) {
    const workspaceList = matchingScopes.map((scope) => scope.workspaceId).join(', ');
    throw new Error(
      `agent_runner_workspace_ambiguous: This agent group is assigned to multiple runner workspaces (${workspaceList}). Choose one workspace before editing runner agent files.`,
    );
  }
  return matchingScopes[0];
}

export function agentUsesRunnerOwnedNoRepositoryFiles(agent: AgentRecord): boolean {
  return !(typeof agent.repositoryRoot === 'string' && agent.repositoryRoot.trim());
}

function runnerCapabilityRefs(params: {
  runnerId: string;
  workspaceId: string | null;
  capabilities: Record<string, unknown>;
}) {
  return {
    runnerId: params.runnerId,
    workspaceId: params.workspaceId,
    capabilitySource: 'agent_runners.capabilities',
    protocolVersion:
      typeof params.capabilities.protocolVersion === 'string'
        ? params.capabilities.protocolVersion
        : null,
    runnerVersion:
      typeof params.capabilities.runnerVersion === 'string'
        ? params.capabilities.runnerVersion
        : null,
  };
}

async function markNoRepositoryInventoryVerified(params: {
  agent: AgentRecord;
  runnerId: string;
  workspaceId: string;
  capabilities: Record<string, unknown>;
  verifiedAt: string;
  imported: boolean;
}) {
  await store.update('agents', params.agent.id, {
    runnerInventoryRunnerId: params.runnerId,
    runnerInventoryWorkspaceId: params.workspaceId,
    runnerInventoryVersion: 1,
    runnerInventoryCapabilityRefs: runnerCapabilityRefs({
      runnerId: params.runnerId,
      workspaceId: params.workspaceId,
      capabilities: params.capabilities,
    }),
    runnerInventoryWorkspaceRootOrigin: 'runner_advertised',
    runnerInventoryWorkspaceRootVerifiedAt: params.verifiedAt,
    runnerInventoryVerifiedAt: params.verifiedAt,
    legacyAgentFileRepairState:
      params.imported || params.agent.legacyAgentFileRepairState === 'runner_imported'
        ? 'runner_imported'
        : 'runner_validated',
    legacyAgentFileCheckedAt: params.verifiedAt,
  });
}

export async function dispatchNoRepositoryAgentFileRequest(params: {
  agent: AgentRecord;
  requestUserId: string;
  workspaceId?: string;
  request: AgentFileRequestInput;
}) {
  const scope = resolveSingleRunnerScopeForAgent({
    agent: params.agent,
    requestUserId: params.requestUserId,
    workspaceId: params.workspaceId,
  });
  const availability = getRunnerFilesystemAvailability(
    scope.userId,
    scope.workspaceId,
    params.requestUserId,
  );
  if (availability.state !== 'available') {
    throw new Error(`${availability.state}: ${availability.message}`);
  }
  const selection = getRunnerFilesystemSelection(
    scope.userId,
    scope.workspaceId,
    params.requestUserId,
  );
  if (!selection) {
    throw new Error('runner_unavailable: No paired runner is connected for this workspace.');
  }
  const workspaceRoot =
    typeof selection.capabilities.workspaceRoot === 'string' &&
    selection.capabilities.workspaceRoot.trim()
      ? selection.capabilities.workspaceRoot.trim()
      : null;
  if (!workspaceRoot) {
    throw new Error(
      'agent_runner_workspace_root_missing: No-repository agent file actions require a runner that advertises OPENWORK_RUNNER_WORKSPACE_ROOT.',
    );
  }
  if (!path.isAbsolute(workspaceRoot)) {
    throw new Error(
      `agent_runner_workspace_root_invalid: The selected runner advertised a relative workspace root: ${workspaceRoot}`,
    );
  }
  const workspacePath = noRepositoryAgentWorkspacePath(workspaceRoot, params.agent.id);
  if (!pathInsideRoot(workspacePath, workspaceRoot)) {
    throw new Error(
      `agent_runner_workspace_root_invalid: Derived workspace path is outside runner root ${workspaceRoot}`,
    );
  }
  const { runnerId, result } = await dispatchRunnerFilesystemRequest({
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    activationActorId: params.requestUserId,
    runnerId: selection.runnerId,
    request: { ...params.request, workspacePath } as AgentFileRequest,
  });
  const verifiedAt =
    (result.action === 'write_agent_file' && result.updatedAt) ||
    (result.action === 'import_agent_files' && result.importedAt) ||
    new Date().toISOString();
  await markNoRepositoryInventoryVerified({
    agent: params.agent,
    runnerId,
    workspaceId: scope.workspaceId,
    capabilities: selection.capabilities as Record<string, unknown>,
    verifiedAt,
    imported: result.action === 'import_agent_files',
  });
  return { runnerId, workspaceId: scope.workspaceId, workspacePath, result };
}

export async function dispatchAgentFileRequest(params: {
  agent: AgentRecord;
  requestUserId: string;
  workspaceId?: string;
  request: AgentFileRequestInput;
}) {
  if (agentUsesRunnerOwnedNoRepositoryFiles(params.agent)) {
    return dispatchNoRepositoryAgentFileRequest(params);
  }

  const repositoryRoot = normalizeRepositoryRoot(params.agent.repositoryRoot);
  if (!repositoryRoot) {
    throw new Error('agent_repository_root_repair_required: Repository root is missing.');
  }
  if (!isRepositoryRootRunnerVerified(params.agent as unknown as Record<string, unknown>)) {
    const origin = normalizeRepositoryRootOrigin(params.agent.repositoryRootOrigin);
    throw new Error(
      `agent_repository_root_repair_required: This repository root (${origin ?? 'unknown'} origin) must be verified on a paired runner before agent files can be read, written, downloaded, revealed, or deleted. Use /api/runner-filesystem/validate-repository-root first.`,
    );
  }

  const scope = resolveSingleRunnerScopeForAgent({
    agent: params.agent,
    requestUserId: params.requestUserId,
    workspaceId: params.workspaceId,
  });
  const availability = getRunnerFilesystemAvailability(
    scope.userId,
    scope.workspaceId,
    params.requestUserId,
  );
  if (availability.state !== 'available') {
    throw new Error(`${availability.state}: ${availability.message}`);
  }
  const selection = getRunnerFilesystemSelection(
    scope.userId,
    scope.workspaceId,
    params.requestUserId,
  );
  if (!selection) {
    throw new Error('runner_unavailable: No paired runner is connected for this workspace.');
  }
  if (
    typeof params.agent.repositoryRootRunnerId === 'string' &&
    params.agent.repositoryRootRunnerId.trim() &&
    params.agent.repositoryRootRunnerId !== selection.runnerId
  ) {
    throw new Error(
      'agent_repository_root_runner_mismatch: This repository root was verified on a different runner than the selected runner. Verify the repository root with the selected runner before editing agent files.',
    );
  }

  const workspacePath = deriveAgentWorkspacePath(repositoryRoot, params.agent.name);
  const { runnerId, result } = await dispatchRunnerFilesystemRequest({
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    activationActorId: params.requestUserId,
    runnerId: selection.runnerId,
    request: {
      ...params.request,
      workspacePath,
      workspaceRootPath: repositoryRoot,
    } as AgentFileRequest,
  });
  return { runnerId, workspaceId: scope.workspaceId, workspacePath, result };
}

import type { FastifyInstance, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import {
  dispatchRunnerFilesystemRequest,
  getRunnerFilesystemAvailability,
  getRunnerFilesystemSelection,
} from '../services/agent-runners.js';
import {
  isRepositoryRootRunnerVerified,
  normalizeRepositoryRootOrigin,
  resolveSubfolderProcessCwd,
} from '../services/agent-workspaces.js';
import { getAgent } from '../services/agents.js';
import { canAccessWorkspace, runnerRoutingScopesForAgentGroup } from '../services/runner-devices.js';
import { getFilePath } from '../services/storage.js';
import { store } from '../db/index.js';
import { env } from '../config/env.js';

function sendRunnerFilesystemError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : 'Runner filesystem action failed';
  if (message.startsWith('runner_unavailable:')) return reply.status(409).send({ code: 'runner_unavailable', message });
  if (message.startsWith('runner_filesystem_unsupported:')) {
    return reply.status(409).send({ code: 'runner_filesystem_unsupported', message });
  }
  if (message.startsWith('agent_runner_workspace_missing:')) {
    return reply.status(409).send({ code: 'agent_runner_workspace_missing', message });
  }
  if (message.startsWith('agent_runner_workspace_ambiguous:')) {
    return reply.status(409).send({ code: 'agent_runner_workspace_ambiguous', message });
  }
  if (message.startsWith('agent_repository_root_not_required:')) {
    return reply.status(409).send({ code: 'agent_repository_root_not_required', message });
  }
  if (message.startsWith('agent_repository_root_repair_required:')) {
    return reply.status(409).send({ code: 'agent_repository_root_repair_required', message });
  }
  if (message.startsWith('agent_repository_root_runner_mismatch:')) {
    return reply.status(409).send({ code: 'agent_repository_root_runner_mismatch', message });
  }
  if (
    message.startsWith('agent_runner_workspace_root_missing:') ||
    message.startsWith('workspace_root_missing:')
  ) {
    return reply.status(409).send({ code: 'agent_runner_workspace_root_missing', message });
  }
  if (
    message.startsWith('agent_runner_workspace_root_invalid:') ||
    message.startsWith('path_outside_workspace_root:')
  ) {
    return reply.status(409).send({ code: 'agent_runner_workspace_outside_root', message });
  }
  if (message.startsWith('path_inaccessible:')) {
    return reply.status(409).send({ code: 'agent_runner_workspace_inaccessible', message });
  }
  if (message.startsWith('not_found:')) return reply.status(404).send({ code: 'not_found', message });
  if (message.startsWith('invalid_path:')) return reply.status(400).send({ code: 'invalid_path', message });
  if (message.includes('Only the account that paired')) {
    return reply.status(409).send({ code: 'runner_activation_forbidden', message });
  }
  return reply.badRequest(message);
}

function pathInsideRoot(candidate: string, root: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveSingleRunnerScopeForAgent(params: {
  agent: { groupId?: string | null };
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
      `agent_runner_workspace_ambiguous: This agent group is assigned to multiple runner workspaces (${workspaceList}). Choose one workspace before preparing the runner workspace.`,
    );
  }
  return matchingScopes[0];
}

function noRepositoryAgentWorkspacePath(workspaceRoot: string, agentId: string): string {
  return path.join(workspaceRoot, '.openwork', 'no-repository-agents', agentId, 'workspace');
}

function runnerCapabilityRefs(params: {
  runnerId: string;
  workspaceId: string | null;
  capabilities?: Record<string, unknown> | null;
}) {
  return {
    runnerId: params.runnerId,
    workspaceId: params.workspaceId,
    capabilitySource: 'agent_runners.capabilities',
    protocolVersion:
      typeof params.capabilities?.protocolVersion === 'string'
        ? params.capabilities.protocolVersion
        : null,
    runnerVersion:
      typeof params.capabilities?.runnerVersion === 'string'
        ? params.capabilities.runnerVersion
        : null,
  };
}

function parseJsonRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function conversationBelongsToAgent(
  conversation: Record<string, unknown>,
  agentId: string,
): boolean {
  return parseJsonRecord(conversation.metadata).agentId === agentId;
}

function conversationUsesSubfolder(
  conversation: Record<string, unknown>,
  agent: { separateFolderPerChat?: boolean | null },
): boolean {
  const meta = parseJsonRecord(conversation.metadata);
  return meta.workspaceMode === 'subfolder' || agent.separateFolderPerChat === true;
}

function conversationRelativePath(conversation: Record<string, unknown>): string | undefined {
  const rel = parseJsonRecord(conversation.metadata).workspaceRelativePath;
  return typeof rel === 'string' ? rel : undefined;
}

function listAgentSubfolderConversations(
  agentId: string,
  agent: { separateFolderPerChat?: boolean | null },
): (Record<string, unknown> & { id: string })[] {
  const conversations = store.getAll('conversations');
  return (Array.isArray(conversations) ? conversations : [])
    .filter(
      (conversation): conversation is Record<string, unknown> & { id: string } =>
        typeof conversation.id === 'string' &&
        conversationBelongsToAgent(conversation, agentId) &&
        conversationUsesSubfolder(conversation, agent),
    );
}

function requireAgentConversation(
  agentId: string,
  conversationId: string,
  agent: { separateFolderPerChat?: boolean | null },
): Record<string, unknown> {
  const conversations = store.getAll('conversations');
  const conversation = (Array.isArray(conversations) ? conversations : [])
    .find(
      (candidate) =>
        typeof candidate.id === 'string' &&
        candidate.id === conversationId &&
        conversationBelongsToAgent(candidate, agentId),
    );
  if (!conversation) {
    throw new Error('not_found: Conversation not found for this agent.');
  }
  if (!conversationUsesSubfolder(conversation, agent)) {
    throw new Error(
      'agent_runner_workspace_missing: This conversation does not use a dedicated runner workspace subfolder.',
    );
  }
  return conversation;
}

function assertRunnerWorkspacePath(pathToPrepare: string, workspaceRoot: string): void {
  if (!path.isAbsolute(pathToPrepare)) {
    throw new Error(
      `agent_runner_workspace_root_invalid: Derived workspace path is not absolute: ${pathToPrepare}`,
    );
  }
  if (!pathInsideRoot(pathToPrepare, workspaceRoot)) {
    throw new Error(
      `agent_runner_workspace_root_invalid: Derived workspace path is outside runner root ${workspaceRoot}`,
    );
  }
}

function resolveRunnerExecutionRoot(params: {
  agent: {
    repositoryRoot?: string | null;
    repositoryRootOrigin?: string | null;
    repositoryRootRunnerId?: string | null;
    repositoryRootVerifiedAt?: string | Date | null;
    repositoryRootRepairRequired?: boolean | null;
  };
  agentId: string;
  workspaceRoot: string;
  runnerId: string;
}): { path: string; repositoryBacked: boolean } {
  const repositoryRoot =
    typeof params.agent.repositoryRoot === 'string' && params.agent.repositoryRoot.trim()
      ? params.agent.repositoryRoot.trim()
      : null;
  if (repositoryRoot) {
    if (!path.isAbsolute(repositoryRoot)) {
      throw new Error(
        `agent_runner_workspace_root_invalid: Repository root is not absolute: ${repositoryRoot}`,
      );
    }
    if (!isRepositoryRootRunnerVerified(params.agent as unknown as Record<string, unknown>)) {
      const origin = normalizeRepositoryRootOrigin(params.agent.repositoryRootOrigin);
      throw new Error(
        `agent_repository_root_repair_required: This repository root (${origin ?? 'unknown'} origin) must be verified on a paired runner before preparing conversation workspaces. Use /api/runner-filesystem/validate-repository-root first.`,
      );
    }
    if (
      typeof params.agent.repositoryRootRunnerId === 'string' &&
      params.agent.repositoryRootRunnerId.trim() &&
      params.agent.repositoryRootRunnerId !== params.runnerId
    ) {
      throw new Error(
        'agent_repository_root_runner_mismatch: This repository root was verified on a different runner. Verify the repository root with the selected runner before preparing conversation workspaces.',
      );
    }
    return { path: repositoryRoot, repositoryBacked: true };
  }
  const resolved = noRepositoryAgentWorkspacePath(params.workspaceRoot, params.agentId);
  assertRunnerWorkspacePath(resolved, params.workspaceRoot);
  return { path: resolved, repositoryBacked: Boolean(repositoryRoot) };
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function signRunnerAttachmentDownloadPath(itemId: string, storagePath: string): string {
  return crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(`${itemId}\0${storagePath}`)
    .digest('base64url');
}

export async function runnerFilesystemRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.get(
    '/api/runner-filesystem/status',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Runner Filesystem'],
        summary: 'Get runner-local filesystem availability',
        querystring: z.object({ workspaceId: z.uuid().optional() }),
      },
    },
    async (request, reply) => {
      return reply.send(getRunnerFilesystemAvailability(request.user.sub, request.query.workspaceId));
    },
  );

  typedApp.get(
    '/api/runner-filesystem/browse',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Runner Filesystem'],
        summary: 'Browse runner-local filesystem through a paired runner',
        querystring: z.object({
          path: z.string().default('/'),
          mode: z.enum(['file', 'folder']).default('folder'),
          workspaceId: z.uuid().optional(),
        }),
      },
    },
    async (request, reply) => {
      try {
        const { runnerId, result } = await dispatchRunnerFilesystemRequest({
          userId: request.user.sub,
          workspaceId: request.query.workspaceId,
          request: { action: 'browse', path: request.query.path, mode: request.query.mode },
        });
        if (result.action !== 'browse') return reply.badRequest('Unexpected runner response');
        return reply.send({ origin: 'runner', runnerId, path: result.path, entries: result.entries });
      } catch (error) {
        return sendRunnerFilesystemError(reply, error);
      }
    },
  );

  typedApp.post(
    '/api/runner-filesystem/pick-folder',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Runner Filesystem'],
        summary: 'Open a runner-local native folder picker',
        body: z.object({ startPath: z.string().optional(), workspaceId: z.uuid().optional() }),
      },
    },
    async (request, reply) => {
      try {
        const { runnerId, result } = await dispatchRunnerFilesystemRequest({
          userId: request.user.sub,
          workspaceId: request.body.workspaceId,
          request: { action: 'pick_folder', startPath: request.body.startPath },
        });
        if (result.action !== 'pick_folder') return reply.badRequest('Unexpected runner response');
        return reply.send({ origin: 'runner', runnerId, path: result.path });
      } catch (error) {
        return sendRunnerFilesystemError(reply, error);
      }
    },
  );

  typedApp.post(
    '/api/runner-filesystem/reveal',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Runner Filesystem'],
        summary: 'Reveal a runner-local path through a paired runner',
        body: z.object({
          path: z.string().min(1),
          agentId: z.string().min(1).optional(),
          workspaceId: z.uuid().optional(),
        }),
      },
    },
    async (request, reply) => {
      try {
        const { result } = await dispatchRunnerFilesystemRequest({
          userId: request.user.sub,
          workspaceId: request.body.workspaceId,
          request: { action: 'reveal', path: request.body.path },
        });
        if (result.action !== 'reveal') return reply.badRequest('Unexpected runner response');
        return reply.status(204).send();
      } catch (error) {
        return sendRunnerFilesystemError(reply, error);
      }
    },
  );

  typedApp.post(
    '/api/runner-filesystem/prepare-agent-workspace',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Runner Filesystem'],
        summary: 'Prepare or repair a runner-local no-repository agent workspace',
        body: z.object({
          agentId: z.uuid(),
          workspaceId: z.uuid().optional(),
        }),
      },
    },
    async (request, reply) => {
      try {
        const agent = getAgent(request.body.agentId);
        if (!agent) return reply.notFound('Agent not found');
        if (typeof agent.repositoryRoot === 'string' && agent.repositoryRoot.trim()) {
          throw new Error(
            'agent_repository_root_not_required: Repository-root agents do not need no-repository runner workspace setup.',
          );
        }
        const scope = resolveSingleRunnerScopeForAgent({
          agent,
          requestUserId: request.user.sub,
          workspaceId: request.body.workspaceId,
        });
        const availability = getRunnerFilesystemAvailability(
          scope.userId,
          scope.workspaceId,
          request.user.sub,
        );
        if (availability.state !== 'available') {
          throw new Error(`${availability.state}: ${availability.message}`);
        }
        const selection = getRunnerFilesystemSelection(
          scope.userId,
          scope.workspaceId,
          request.user.sub,
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
            'agent_runner_workspace_root_missing: No-repository agents require a runner that advertises OPENWORK_RUNNER_WORKSPACE_ROOT.',
          );
        }
        if (!path.isAbsolute(workspaceRoot)) {
          throw new Error(
            `agent_runner_workspace_root_invalid: The selected runner advertised a relative workspace root: ${workspaceRoot}`,
          );
        }
        const workspacePath = noRepositoryAgentWorkspacePath(workspaceRoot, request.body.agentId);
        assertRunnerWorkspacePath(workspacePath, workspaceRoot);
        const { runnerId, result } = await dispatchRunnerFilesystemRequest({
          userId: scope.userId,
          workspaceId: scope.workspaceId,
          activationActorId: request.user.sub,
          runnerId: selection.runnerId,
          request: {
            action: 'prepare_workspace',
            path: workspacePath,
            purpose: 'no_repository_agent',
            agentId: request.body.agentId,
            workspaceId: scope.workspaceId,
          },
        });
        if (result.action !== 'prepare_workspace') return reply.badRequest('Unexpected runner response');
        await store.update('agents', request.body.agentId, {
          runnerInventoryRunnerId: runnerId,
          runnerInventoryWorkspaceId: scope.workspaceId,
          runnerInventoryVersion: 1,
          runnerInventoryCapabilityRefs: runnerCapabilityRefs({
            runnerId,
            workspaceId: scope.workspaceId,
            capabilities: selection.capabilities as Record<string, unknown>,
          }),
          runnerInventoryWorkspaceRootOrigin: 'runner_advertised',
          runnerInventoryWorkspaceRootVerifiedAt: result.preparedAt,
          runnerInventoryVerifiedAt: result.preparedAt,
          legacyAgentFileRepairState:
            agent.legacyAgentFileRepairState === 'runner_imported'
              ? 'runner_imported'
              : 'runner_validated',
          legacyAgentFileCheckedAt: result.preparedAt,
        });
        const conversationPaths: string[] = [];
        for (const conversation of listAgentSubfolderConversations(request.body.agentId, agent)) {
          const conversationPath = resolveSubfolderProcessCwd(
            workspacePath,
            conversation.id,
            'subfolder',
            conversationRelativePath(conversation),
          );
          assertRunnerWorkspacePath(conversationPath, workspaceRoot);
          const prepared = await dispatchRunnerFilesystemRequest({
            userId: scope.userId,
            workspaceId: scope.workspaceId,
            activationActorId: request.user.sub,
            runnerId: selection.runnerId,
            request: {
              action: 'prepare_workspace',
              path: conversationPath,
              purpose: 'conversation_subfolder',
              agentId: request.body.agentId,
              conversationId: conversation.id,
              workspaceId: scope.workspaceId,
            },
          });
          if (prepared.result.action !== 'prepare_workspace') {
            return reply.badRequest('Unexpected runner response');
          }
          conversationPaths.push(prepared.result.path);
        }
        return reply.send({
          origin: 'runner',
          runnerId,
          agentId: request.body.agentId,
          workspaceId: scope.workspaceId,
          conversationPaths,
          ...result,
        });
      } catch (error) {
        return sendRunnerFilesystemError(reply, error);
      }
    },
  );

  typedApp.post(
    '/api/runner-filesystem/prepare-conversation-workspace',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Runner Filesystem'],
        summary: 'Prepare or repair a runner-local conversation subfolder workspace',
        body: z.object({
          agentId: z.uuid(),
          conversationId: z.uuid(),
          workspaceId: z.uuid().optional(),
        }),
      },
    },
    async (request, reply) => {
      try {
        const agent = getAgent(request.body.agentId);
        if (!agent) return reply.notFound('Agent not found');
        const scope = resolveSingleRunnerScopeForAgent({
          agent,
          requestUserId: request.user.sub,
          workspaceId: request.body.workspaceId,
        });
        const availability = getRunnerFilesystemAvailability(
          scope.userId,
          scope.workspaceId,
          request.user.sub,
        );
        if (availability.state !== 'available') {
          throw new Error(`${availability.state}: ${availability.message}`);
        }
        const selection = getRunnerFilesystemSelection(
          scope.userId,
          scope.workspaceId,
          request.user.sub,
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
            'agent_runner_workspace_root_missing: Conversation subfolders require a runner that advertises OPENWORK_RUNNER_WORKSPACE_ROOT.',
          );
        }
        if (!path.isAbsolute(workspaceRoot)) {
          throw new Error(
            `agent_runner_workspace_root_invalid: The selected runner advertised a relative workspace root: ${workspaceRoot}`,
          );
        }
        const conversation = requireAgentConversation(
          request.body.agentId,
          request.body.conversationId,
          agent,
        );
        const executionRoot = resolveRunnerExecutionRoot({
          agent,
          agentId: request.body.agentId,
          workspaceRoot,
          runnerId: selection.runnerId,
        });
        const conversationPath = resolveSubfolderProcessCwd(
          executionRoot.path,
          request.body.conversationId,
          'subfolder',
          conversationRelativePath(conversation),
        );
        if (!executionRoot.repositoryBacked) {
          assertRunnerWorkspacePath(conversationPath, workspaceRoot);
        }
        const { runnerId, result } = await dispatchRunnerFilesystemRequest({
          userId: scope.userId,
          workspaceId: scope.workspaceId,
          activationActorId: request.user.sub,
          runnerId: selection.runnerId,
          request: {
            action: 'prepare_workspace',
            path: conversationPath,
            purpose: 'conversation_subfolder',
            agentId: request.body.agentId,
            conversationId: request.body.conversationId,
            workspaceId: scope.workspaceId,
          },
        });
        if (result.action !== 'prepare_workspace') return reply.badRequest('Unexpected runner response');
        return reply.send({
          origin: 'runner',
          runnerId,
          agentId: request.body.agentId,
          conversationId: request.body.conversationId,
          workspaceId: scope.workspaceId,
          repositoryBacked: executionRoot.repositoryBacked,
          ...result,
        });
      } catch (error) {
        return sendRunnerFilesystemError(reply, error);
      }
    },
  );

  typedApp.post(
    '/api/runner-filesystem/import-attachment',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Runner Filesystem'],
        summary: 'Import a backend-stored attachment into the runner workspace',
        body: z.object({
          storagePath: z.string().min(1),
          destinationPath: z.string().min(1),
          workspaceId: z.uuid().optional(),
          overwrite: z.boolean().optional(),
          filename: z.string().min(1).optional(),
          mimeType: z.string().min(1).optional(),
        }),
      },
    },
    async (request, reply) => {
      try {
        const diskPath = getFilePath(request.body.storagePath);
        if (!diskPath) return reply.notFound('Attachment not found');
        const stat = fs.statSync(diskPath);
        if (!stat.isFile()) {
          return reply.badRequest('Attachment path is not a file');
        }
        const itemId = `import-${crypto
          .createHash('sha256')
          .update(request.body.storagePath)
          .digest('hex')
          .slice(0, 16)}`;
        const storagePath = request.body.storagePath;
        const { runnerId, result } = await dispatchRunnerFilesystemRequest({
          userId: request.user.sub,
          workspaceId: request.body.workspaceId,
          request: {
            action: 'import_attachment',
            destinationPath: request.body.destinationPath,
            overwrite: request.body.overwrite,
            source: {
              filename: request.body.filename ?? path.basename(diskPath),
              mimeType: request.body.mimeType ?? 'application/octet-stream',
              sizeBytes: stat.size,
              sha256: sha256File(diskPath),
              storageId: storagePath,
              storagePath,
              download: {
                method: 'GET',
                path: `/api/runner-attachments/download?itemId=${encodeURIComponent(itemId)}&path=${encodeURIComponent(storagePath)}&token=${encodeURIComponent(signRunnerAttachmentDownloadPath(itemId, storagePath))}`,
              },
            },
          },
        });
        if (result.action !== 'import_attachment') return reply.badRequest('Unexpected runner response');
        return reply.status(201).send({ origin: 'runner', runnerId, ...result });
      } catch (error) {
        return sendRunnerFilesystemError(reply, error);
      }
    },
  );

  typedApp.post(
    '/api/runner-filesystem/reveal-agent-file',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Runner Filesystem'],
        summary: 'Reveal a runner-owned no-repository agent workspace file',
        querystring: z.object({
          agentId: z.string().min(1),
          workspaceId: z.uuid().optional(),
        }),
        body: z.object({
          path: z.string().min(1),
        }),
      },
    },
    async (request, reply) => {
      try {
        const agent = getAgent(request.query.agentId);
        if (!agent) return reply.notFound('Agent not found');
        if (typeof agent.repositoryRoot === 'string' && agent.repositoryRoot.trim()) {
          throw new Error(
            'agent_repository_root_not_required: Repository-root agent file reveal should use a verified runner-local repository path.',
          );
        }
        const scope = resolveSingleRunnerScopeForAgent({
          agent,
          requestUserId: request.user.sub,
          workspaceId: request.query.workspaceId,
        });
        const availability = getRunnerFilesystemAvailability(
          scope.userId,
          scope.workspaceId,
          request.user.sub,
        );
        if (availability.state !== 'available') {
          throw new Error(`${availability.state}: ${availability.message}`);
        }
        const selection = getRunnerFilesystemSelection(
          scope.userId,
          scope.workspaceId,
          request.user.sub,
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
            'agent_runner_workspace_root_missing: No-repository agent file reveal requires a runner that advertises OPENWORK_RUNNER_WORKSPACE_ROOT.',
          );
        }
        if (!path.isAbsolute(workspaceRoot)) {
          throw new Error(
            `agent_runner_workspace_root_invalid: The selected runner advertised a relative workspace root: ${workspaceRoot}`,
          );
        }
        const workspacePath = noRepositoryAgentWorkspacePath(workspaceRoot, request.query.agentId);
        if (!pathInsideRoot(workspacePath, workspaceRoot)) {
          throw new Error(
            `agent_runner_workspace_root_invalid: Derived workspace path is outside runner root ${workspaceRoot}`,
          );
        }
        const { result } = await dispatchRunnerFilesystemRequest({
          userId: scope.userId,
          workspaceId: scope.workspaceId,
          activationActorId: request.user.sub,
          runnerId: selection.runnerId,
          request: {
            action: 'reveal_agent_path',
            workspacePath,
            path: request.body.path,
          },
        });
        if (result.action !== 'reveal_agent_path') return reply.badRequest('Unexpected runner response');
        return reply.status(204).send();
      } catch (error) {
        return sendRunnerFilesystemError(reply, error);
      }
    },
  );

  typedApp.post(
    '/api/runner-filesystem/validate-repository-root',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Runner Filesystem'],
        summary: 'Validate runner-local repository root metadata',
        body: z.object({
          path: z.string().min(1),
          workspaceId: z.uuid().optional(),
          agentId: z.uuid().optional(),
        }),
      },
    },
    async (request, reply) => {
      try {
        const { runnerId, result } = await dispatchRunnerFilesystemRequest({
          userId: request.user.sub,
          workspaceId: request.body.workspaceId,
          request: { action: 'validate_repository_root', path: request.body.path },
        });
        if (result.action !== 'validate_repository_root') return reply.badRequest('Unexpected runner response');
        const selection = getRunnerFilesystemSelection(request.user.sub, request.body.workspaceId);
        if (request.body.agentId) {
          const agent = getAgent(request.body.agentId);
          if (!agent) return reply.notFound('Agent not found');
          store.update('agents', request.body.agentId, {
            repositoryRoot: result.path,
            repositoryRootOrigin: result.repositoryRootOrigin,
            repositoryRootRunnerId: runnerId,
            repositoryRootVerifiedAt: result.repositoryRootVerifiedAt,
            repositoryRootRepairRequired: false,
            runnerInventoryRunnerId: runnerId,
            runnerInventoryWorkspaceId: request.body.workspaceId ?? null,
            runnerInventoryVersion: 1,
            runnerInventoryCapabilityRefs: runnerCapabilityRefs({
              runnerId,
              workspaceId: request.body.workspaceId ?? null,
              capabilities: selection?.capabilities as Record<string, unknown> | null,
            }),
            runnerInventoryWorkspaceRootOrigin: 'repository_root',
            runnerInventoryWorkspaceRootVerifiedAt: result.repositoryRootVerifiedAt,
            runnerInventoryVerifiedAt: result.repositoryRootVerifiedAt,
            legacyAgentFileState: 'not_applicable',
            legacyAgentFileRepairState: 'not_required',
            workspacePath: null,
          });
        }
        return reply.send({ origin: 'runner', runnerId, ...result });
      } catch (error) {
        return sendRunnerFilesystemError(reply, error);
      }
    },
  );
}

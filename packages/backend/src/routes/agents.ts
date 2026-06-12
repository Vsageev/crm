import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { requirePermission } from '../middleware/rbac.js';
import { getApiKeyRecord } from '../db/repositories/api-keys-repository.js';
import cron from 'node-cron';
import {
  listPresets,
  listCliDefinitions,
  listAgentAvatarPresets,
  createAgentAvatarPreset,
  updateAgentAvatarPreset,
  deleteAgentAvatarPreset,
  listAgentColorPresets,
  createAgentColorPreset,
  updateAgentColorPreset,
  deleteAgentColorPreset,
  asPublicAgent,
  createAgent,
  buildInitialAgentWorkspaceImportFiles,
  listAgents,
  getAgent,
  updateAgent,
  deleteAgent,
  rollbackCreatedAgentMetadata,
  listAgentGroups,
  createAgentGroup,
  updateAgentGroup,
  deleteAgentGroup,
  type AgentRecord,
} from '../services/agents.js';
import { collectLegacyAgentFilesForImport } from '../services/legacy-agent-files.js';
import {
  ensureDefaultWorkspaceForUser,
  ensureAgentGroupForWorkspace,
  ensureLegacyAgentsAssignedToWorkspace,
  getWorkspaceById,
  updateWorkspace,
} from '../services/workspaces.js';
import { listAgentCronJobsWithNextRun, syncAgentCronJobs } from '../services/agent-cron.js';
import { getProjectDefaultAgentKeyId } from '../services/project-settings.js';
import { getNativeRunnerPreflightStatus } from '../services/agent-chat.js';
import {
  dispatchRunnerFilesystemRequest,
  getAvailableRemoteAgentRunnerSelection,
} from '../services/agent-runners.js';
import {
  deriveAgentWorkspacePath,
  isRepositoryRootRunnerVerified,
} from '../services/agent-workspaces.js';
import {
  agentUsesRunnerOwnedNoRepositoryFiles,
  dispatchAgentFileRequest,
  dispatchNoRepositoryAgentFileRequest,
} from '../services/runner-agent-files.js';

const avatarIconSchema = z.string().max(128);
const avatarColorSchema = z.string().max(20);
const avatarPresetNameSchema = z.string().trim().min(1).max(80);
const queryBooleanSchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .optional()
  .transform((value) => value === true || value === 'true');
const optionalWorkspaceIdQuerySchema = z.object({ workspaceId: z.uuid().optional() });
const cliStatusQuerySchema = z.object({ workspaceId: z.uuid().optional() });

function sendRunnerAgentFileError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : 'Runner agent file action failed';
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
  return reply.badRequest(message);
}

type ExecutableOwnershipState = 'runner' | 'legacy_import_required' | 'unavailable';

function getAgentExecutableOwnership(agent: AgentRecord): {
  state: ExecutableOwnershipState;
  runnerId: string | null;
  workspaceId: string | null;
  reason: string;
} {
  const runnerId = agent.runnerInventoryRunnerId;
  const workspaceId = agent.runnerInventoryWorkspaceId;

  if (typeof agent.repositoryRoot === 'string' && agent.repositoryRoot.trim()) {
    if (isRepositoryRootRunnerVerified(agent as unknown as Record<string, unknown>)) {
      return {
        state: 'runner',
        runnerId: agent.repositoryRootRunnerId ?? runnerId,
        workspaceId,
        reason: 'repository_root_runner_verified',
      };
    }
    return {
      state: 'unavailable',
      runnerId,
      workspaceId,
      reason: `repository_root_${agent.repositoryRootOrigin ?? 'unknown'}_repair_required`,
    };
  }

  if (
    agent.legacyAgentFileState === 'legacy_importable' &&
    agent.legacyAgentFileRepairState !== 'runner_imported'
  ) {
    return {
      state: 'legacy_import_required',
      runnerId,
      workspaceId,
      reason: 'backend_legacy_agent_files_require_runner_import',
    };
  }

  if (
    runnerId &&
    agent.runnerInventoryVerifiedAt &&
    (agent.legacyAgentFileRepairState === 'runner_validated' ||
      agent.legacyAgentFileRepairState === 'runner_imported' ||
      agent.legacyAgentFileRepairState === 'not_required')
  ) {
    return {
      state: 'runner',
      runnerId,
      workspaceId,
      reason: 'no_repository_runner_workspace_verified',
    };
  }

  return {
    state: 'unavailable',
    runnerId,
    workspaceId,
    reason: 'runner_workspace_validation_required',
  };
}

function serializePublicAgent(
  agent: ReturnType<typeof getAgent> extends infer T ? NonNullable<T> : never,
) {
  syncAgentCronJobs(agent.id);
  const publicAgent = asPublicAgent(agent);

  return {
    ...publicAgent,
    executableOwnership: getAgentExecutableOwnership(agent),
    cronJobs: listAgentCronJobsWithNextRun(agent.id, publicAgent.cronJobs ?? []),
  };
}

export async function agentRoutes(app: FastifyInstance) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // Check CLI availability
  typedApp.get(
    '/api/agents/cli-status',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Agents'],
        summary: 'Check which agent CLIs are available to the native runner',
        querystring: cliStatusQuerySchema,
      },
    },
    async (request, reply) => {
      const selection = getAvailableRemoteAgentRunnerSelection(
        request.user.sub,
        request.query.workspaceId,
        undefined,
        request.user.sub,
      );
      const capabilities = selection?.capabilities;
      const advertisedProviders = new Set<string>([
        ...(Array.isArray(capabilities?.installedProviders) ? capabilities.installedProviders : []),
        ...(Array.isArray(capabilities?.supportedProviders) ? capabilities.supportedProviders : []),
      ]);
      return reply.send({
        clis: listCliDefinitions().map((def) => ({
          ...def,
          installed: advertisedProviders.has(def.id),
          resolvedCommand: null,
          runnerId: selection?.runnerId ?? null,
          source: selection ? 'runner_capabilities' : 'runner_unavailable',
        })),
      });
    },
  );

  // List presets
  typedApp.get(
    '/api/agents/presets',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Agents'],
        summary: 'List available agent presets',
      },
    },
    async (_request, reply) => {
      return reply.send({ presets: listPresets() });
    },
  );

  // List agents
  typedApp.get(
    '/api/agents',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Agents'],
        summary: 'List agents',
        querystring: z.object({
          workspaceId: z.uuid().optional(),
          includeArchived: queryBooleanSchema,
          limit: z.coerce.number().int().min(1).max(100).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
      },
    },
    async (request, reply) => {
      await ensureDefaultWorkspaceForUser(request.user.sub);
      let all = await listAgents();

      if (request.query.workspaceId) {
        const workspace =
          (await ensureLegacyAgentsAssignedToWorkspace(
            request.query.workspaceId,
            request.user.sub,
          )) ?? (await getWorkspaceById(request.query.workspaceId));
        if (workspace && Array.isArray(workspace.agentGroupIds)) {
          const idSet = new Set(workspace.agentGroupIds);
          all = all.filter((agent) => agent.groupId && idSet.has(agent.groupId));
        }
      }

      if (!request.query.includeArchived) {
        all = all.filter((agent) => !agent.archivedAt);
      }

      const { limit, offset } = request.query;
      const entries = all.slice(offset, offset + limit).map(serializePublicAgent);
      return reply.send({ total: all.length, limit, offset, entries });
    },
  );

  typedApp.get(
    '/api/agent-avatar-presets',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Agents'],
        summary: 'List saved agent avatar presets',
      },
    },
    async (_request, reply) => {
      return reply.send({ entries: listAgentAvatarPresets() });
    },
  );

  typedApp.post(
    '/api/agent-avatar-presets',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Agents'],
        summary: 'Create a saved agent avatar preset',
        body: z.object({
          name: avatarPresetNameSchema,
          avatarIcon: avatarIconSchema,
        }),
      },
    },
    async (request, reply) => {
      const preset = createAgentAvatarPreset(request.body);
      return reply.status(201).send(preset);
    },
  );

  typedApp.patch(
    '/api/agent-avatar-presets/:id',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Agents'],
        summary: 'Update a saved agent avatar preset',
        params: z.object({ id: z.string() }),
        body: z.object({
          name: avatarPresetNameSchema.optional(),
          avatarIcon: avatarIconSchema.optional(),
        }),
      },
    },
    async (request, reply) => {
      const preset = updateAgentAvatarPreset(request.params.id, request.body);
      if (!preset) return reply.notFound('Avatar preset not found');
      return reply.send(preset);
    },
  );

  typedApp.delete(
    '/api/agent-avatar-presets/:id',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Agents'],
        summary: 'Delete a saved agent avatar preset',
        params: z.object({ id: z.string() }),
      },
    },
    async (request, reply) => {
      const deleted = deleteAgentAvatarPreset(request.params.id);
      if (!deleted) return reply.notFound('Avatar preset not found');
      return reply.status(204).send();
    },
  );

  // ── Color presets ──

  typedApp.get(
    '/api/agent-color-presets',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Agents'],
        summary: 'List saved agent color presets',
      },
    },
    async (_request, reply) => {
      return reply.send({ entries: listAgentColorPresets() });
    },
  );

  typedApp.post(
    '/api/agent-color-presets',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Agents'],
        summary: 'Create a saved agent color preset',
        body: z.object({
          name: avatarPresetNameSchema,
          bgColor: avatarColorSchema,
          logoColor: avatarColorSchema,
        }),
      },
    },
    async (request, reply) => {
      const preset = createAgentColorPreset(request.body);
      return reply.status(201).send(preset);
    },
  );

  typedApp.patch(
    '/api/agent-color-presets/:id',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Agents'],
        summary: 'Update a saved agent color preset',
        params: z.object({ id: z.string() }),
        body: z.object({
          name: avatarPresetNameSchema.optional(),
          bgColor: avatarColorSchema.optional(),
          logoColor: avatarColorSchema.optional(),
        }),
      },
    },
    async (request, reply) => {
      const preset = updateAgentColorPreset(request.params.id, request.body);
      if (!preset) return reply.notFound('Color preset not found');
      return reply.send(preset);
    },
  );

  typedApp.delete(
    '/api/agent-color-presets/:id',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Agents'],
        summary: 'Delete a saved agent color preset',
        params: z.object({ id: z.string() }),
      },
    },
    async (request, reply) => {
      const deleted = deleteAgentColorPreset(request.params.id);
      if (!deleted) return reply.notFound('Color preset not found');
      return reply.status(204).send();
    },
  );

  // Create agent
  typedApp.post(
    '/api/agents',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Agents'],
        summary: 'Create a new agent',
        body: z.object({
          name: z.string().min(1).max(255),
          description: z.string().max(1000).default(''),
          model: z.string().min(1).max(100),
          modelId: z.string().max(200).nullable().optional(),
          thinkingLevel: z.enum(['low', 'medium', 'high']).nullable().optional(),
          preset: z.string().min(1).max(100),
          presetParameters: z.record(z.string().min(1).max(100), z.string().max(2000)).optional(),
          apiKeyId: z.string().min(1).optional(),
          workspaceId: z.uuid().optional(),
          skipPermissions: z.boolean().optional(),
          groupId: z.string().nullable().optional(),
          avatarIcon: avatarIconSchema.optional(),
          avatarBgColor: avatarColorSchema.optional(),
          avatarLogoColor: avatarColorSchema.optional(),
        }),
      },
    },
    async (request, reply) => {
      const {
        name,
        description,
        model,
        modelId,
        thinkingLevel,
        preset,
        presetParameters,
        apiKeyId,
        skipPermissions,
        groupId: requestedGroupId,
        avatarIcon,
        avatarBgColor,
        avatarLogoColor,
      } = request.body;

      let resolvedApiKeyId = apiKeyId;
      if (!resolvedApiKeyId) {
        resolvedApiKeyId = (await getProjectDefaultAgentKeyId()) ?? undefined;
      }

      if (!resolvedApiKeyId) {
        return reply.badRequest(
          'API key is required. Set apiKeyId or configure project default agent key',
        );
      }

      // Look up the API key to populate derived fields
      const apiKey = await getApiKeyRecord(resolvedApiKeyId);
      if (!apiKey || apiKey.isActive === false) {
        return reply.badRequest('API key not found');
      }

      const targetWorkspaceId =
        request.body.workspaceId ?? (await ensureDefaultWorkspaceForUser(request.user.sub)).id;
      let groupId = requestedGroupId;
      if (targetWorkspaceId) {
        const workspace = await getWorkspaceById(targetWorkspaceId);
        if (!workspace || workspace.userId !== request.user.sub) {
          return reply.badRequest('Workspace not found');
        }
        groupId = await ensureAgentGroupForWorkspace(targetWorkspaceId, requestedGroupId);
      }

      try {
        const requestedRepositoryRoot =
          typeof presetParameters?.workingDirectory === 'string' &&
          presetParameters.workingDirectory.trim()
            ? presetParameters.workingDirectory.trim()
            : null;
        let repositoryRootValidation:
          | { path: string; runnerId: string; workspaceId?: string | null; verifiedAt: string }
          | undefined;
        if (requestedRepositoryRoot) {
          const validation = await dispatchRunnerFilesystemRequest({
            userId: request.user.sub,
            workspaceId: targetWorkspaceId,
            request: { action: 'validate_repository_root', path: requestedRepositoryRoot },
          });
          if (validation.result.action !== 'validate_repository_root') {
            return reply.badRequest('Unexpected runner response');
          }
          repositoryRootValidation = {
            path: validation.result.path,
            runnerId: validation.runnerId,
            workspaceId: targetWorkspaceId,
            verifiedAt: validation.result.repositoryRootVerifiedAt,
          };
        }
        const agent = await createAgent({
          name,
          description,
          model,
          modelId,
          thinkingLevel,
          preset,
          presetParameters,
          apiKeyId: resolvedApiKeyId,
          apiKeyName: apiKey.name as string,
          apiKeyPrefix: apiKey.keyPrefix as string,
          capabilities: (apiKey.permissions as string[]) || [],
          skipPermissions,
          groupId,
          avatarIcon,
          avatarBgColor,
          avatarLogoColor,
          repositoryRootValidation,
        });
        const initialFiles = buildInitialAgentWorkspaceImportFiles(agent);
        if (initialFiles.length > 0) {
          try {
            const { result } = await dispatchAgentFileRequest({
              agent,
              requestUserId: request.user.sub,
              workspaceId: targetWorkspaceId,
              request: { action: 'import_agent_files', files: initialFiles },
            });
            if (result.action !== 'import_agent_files') {
              await rollbackCreatedAgentMetadata(agent);
              return reply.badRequest('Unexpected runner response');
            }
          } catch (err) {
            await rollbackCreatedAgentMetadata(agent);
            throw err;
          }
        }
        return reply.status(201).send(serializePublicAgent(agent));
      } catch (err) {
        return sendRunnerAgentFileError(reply, err);
      }
    },
  );

  // Get single agent
  typedApp.get(
    '/api/agents/:id',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Agents'],
        summary: 'Get a single agent',
        params: z.object({
          id: z.string(),
        }),
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');
      return reply.send(serializePublicAgent(agent));
    },
  );

  // Update agent
  typedApp.patch(
    '/api/agents/:id',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Agents'],
        summary: 'Update an agent',
        params: z.object({
          id: z.string(),
        }),
        body: z.object({
          name: z.string().min(1).max(255).optional(),
          description: z.string().max(1000).optional(),
          model: z.string().min(1).max(100).optional(),
          modelId: z.string().max(200).nullable().optional(),
          thinkingLevel: z.enum(['low', 'medium', 'high']).nullable().optional(),
          status: z.enum(['active', 'inactive', 'error']).optional(),
          apiKeyId: z.string().min(1).optional(),
          skipPermissions: z.boolean().optional(),
          separateFolderPerChat: z.boolean().optional(),
          groupId: z.string().nullable().optional(),
          workspaceId: z.uuid().optional(),
          avatarIcon: avatarIconSchema.optional(),
          avatarBgColor: avatarColorSchema.optional(),
          avatarLogoColor: avatarColorSchema.optional(),
          cronJobs: z
            .array(
              z.object({
                id: z.string().min(1),
                cron: z
                  .string()
                  .min(1)
                  .refine((val) => cron.validate(val), { message: 'Invalid cron expression' }),
                prompt: z.string().min(1).max(5000),
                enabled: z.boolean(),
              }),
            )
            .optional(),
        }),
      },
    },
    async (request, reply) => {
      let updated;
      try {
        const patch = { ...request.body };
        if ('groupId' in request.body) {
          const targetWorkspaceId =
            request.body.workspaceId ?? (await ensureDefaultWorkspaceForUser(request.user.sub)).id;
          const workspace = await getWorkspaceById(targetWorkspaceId);
          if (!workspace || workspace.userId !== request.user.sub) {
            return reply.badRequest('Workspace not found');
          }
          patch.groupId = await ensureAgentGroupForWorkspace(
            targetWorkspaceId,
            request.body.groupId,
          );
        }
        delete patch.workspaceId;
        updated = await updateAgent(request.params.id, patch, {
          instructionFileMigration: {
            requestUserId: request.user.sub,
            workspaceId: request.body.workspaceId,
          },
        });
      } catch (err) {
        return reply.badRequest((err as Error).message);
      }
      if (!updated) return reply.notFound('Agent not found');

      return reply.send(serializePublicAgent(updated));
    },
  );

  // Delete agent
  typedApp.delete(
    '/api/agents/:id',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Agents'],
        summary: 'Archive an agent',
        params: z.object({
          id: z.string(),
        }),
      },
    },
    async (request, reply) => {
      const deleted = await deleteAgent(request.params.id);
      if (!deleted) return reply.notFound('Agent not found');
      return reply.status(204).send();
    },
  );

  // ---------------------------------------------------------------------------
  // Agent Group endpoints
  // ---------------------------------------------------------------------------

  typedApp.get(
    '/api/agent-groups',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Agent Groups'],
        summary: 'List all agent groups',
        querystring: z.object({
          workspaceId: z.uuid().optional(),
        }),
      },
    },
    async (request, reply) => {
      let groups = await listAgentGroups();

      if (request.query.workspaceId) {
        const workspace =
          (await ensureLegacyAgentsAssignedToWorkspace(
            request.query.workspaceId,
            request.user.sub,
          )) ?? (await getWorkspaceById(request.query.workspaceId));
        if (workspace && Array.isArray(workspace.agentGroupIds)) {
          const idSet = new Set(workspace.agentGroupIds);
          groups = groups.filter((group) => idSet.has(group.id));
        }
      }

      return reply.send({ entries: groups });
    },
  );

  typedApp.post(
    '/api/agent-groups',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Agent Groups'],
        summary: 'Create an agent group',
        body: z.object({
          name: z.string().min(1).max(100),
          workspaceId: z.uuid().optional(),
        }),
      },
    },
    async (request, reply) => {
      let workspaceAgentGroupIds: string[] | null = null;
      if (request.body.workspaceId) {
        const workspace = await getWorkspaceById(request.body.workspaceId);
        if (!workspace || workspace.userId !== request.user.sub) {
          return reply.badRequest('Workspace not found');
        }
        workspaceAgentGroupIds = workspace.agentGroupIds;
      }

      const group = await createAgentGroup(request.body.name);
      if (request.body.workspaceId && workspaceAgentGroupIds) {
        await updateWorkspace(request.body.workspaceId, {
          agentGroupIds: [...workspaceAgentGroupIds, group.id],
        });
      }
      return reply.status(201).send(group);
    },
  );

  typedApp.patch(
    '/api/agent-groups/:id',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Agent Groups'],
        summary: 'Update an agent group',
        params: z.object({ id: z.string() }),
        body: z.object({
          name: z.string().min(1).max(100).optional(),
          order: z.number().int().min(0).optional(),
        }),
      },
    },
    async (request, reply) => {
      const updated = updateAgentGroup(request.params.id, request.body);
      if (!updated) return reply.notFound('Agent group not found');
      return reply.send(updated);
    },
  );

  typedApp.delete(
    '/api/agent-groups/:id',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Agent Groups'],
        summary: 'Delete an agent group (agents become ungrouped)',
        params: z.object({ id: z.string() }),
      },
    },
    async (request, reply) => {
      const deleted = await deleteAgentGroup(request.params.id);
      if (!deleted) return reply.notFound('Agent group not found');
      return reply.status(204).send();
    },
  );

  // ---------------------------------------------------------------------------
  // Workspace file endpoints
  // ---------------------------------------------------------------------------

  // List files
  typedApp.get(
    '/api/agents/:id/files',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Agents'],
        summary: 'List files in agent workspace',
        params: z.object({ id: z.string() }),
        querystring: z.object({
          path: z.string().default('/'),
          workspaceId: z.uuid().optional(),
        }),
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');
      try {
        const { runnerId, workspaceId, workspacePath, result } =
          await dispatchAgentFileRequest({
            agent,
            requestUserId: request.user.sub,
            workspaceId: request.query.workspaceId,
            request: { action: 'list_agent_files', path: request.query.path },
          });
        if (result.action !== 'list_agent_files') return reply.badRequest('Unexpected runner response');
        return reply.send({
          origin: 'runner',
          runnerId,
          workspaceId,
          workspacePath,
          entries: result.entries,
        });
      } catch (err) {
        return sendRunnerAgentFileError(reply, err);
      }
    },
  );

  typedApp.get(
    '/api/agents/:id/files/status',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Agents'],
        summary: 'Get runner-owned agent file status and backend legacy import summary',
        params: z.object({ id: z.string() }),
        querystring: optionalWorkspaceIdQuerySchema,
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');
      const legacy = collectLegacyAgentFilesForImport(request.params.id).summary;
      const legacyImportOwnership =
        legacy.importableFileCount > 0 && agent.legacyAgentFileRepairState !== 'runner_imported'
          ? {
              state: 'legacy_import_required' as const,
              runnerId: agent.runnerInventoryRunnerId,
              workspaceId: agent.runnerInventoryWorkspaceId,
              reason: 'backend_legacy_agent_files_require_runner_import',
            }
          : null;
      if (!agentUsesRunnerOwnedNoRepositoryFiles(agent)) {
        const executableOwnership = getAgentExecutableOwnership(agent);
        const repositoryWorkspacePath =
          executableOwnership.state === 'runner' && agent.repositoryRoot
            ? deriveAgentWorkspacePath(agent.repositoryRoot, agent.name)
            : null;
        return reply.send({
          mode: 'repository',
          executableOwnership,
          runner: repositoryWorkspacePath
            ? {
                state: 'available',
                runnerId: executableOwnership.runnerId ?? undefined,
                workspaceId: executableOwnership.workspaceId ?? undefined,
                workspacePath: repositoryWorkspacePath,
              }
            : {
                state: 'unavailable',
                message: executableOwnership.reason,
              },
          inventory: {
            runnerId: agent.runnerInventoryRunnerId,
            workspaceId: agent.runnerInventoryWorkspaceId,
            version: agent.runnerInventoryVersion,
            capabilityRefs: agent.runnerInventoryCapabilityRefs,
            workspaceRootOrigin: agent.runnerInventoryWorkspaceRootOrigin,
            workspaceRootVerifiedAt: agent.runnerInventoryWorkspaceRootVerifiedAt,
            verifiedAt: agent.runnerInventoryVerifiedAt,
          },
          legacy,
        });
      }
      try {
        const { runnerId, workspaceId, workspacePath } = await dispatchNoRepositoryAgentFileRequest({
          agent,
          requestUserId: request.user.sub,
          workspaceId: request.query.workspaceId,
          request: { action: 'list_agent_files', path: '/' },
        });
        const refreshedAgent = getAgent(agent.id) ?? agent;
        return reply.send({
          mode: 'no_repository',
          executableOwnership: legacyImportOwnership ?? getAgentExecutableOwnership(refreshedAgent),
          runner: { state: 'available', runnerId, workspaceId, workspacePath },
          inventory: {
            runnerId: refreshedAgent.runnerInventoryRunnerId,
            workspaceId: refreshedAgent.runnerInventoryWorkspaceId,
            version: refreshedAgent.runnerInventoryVersion,
            capabilityRefs: refreshedAgent.runnerInventoryCapabilityRefs,
            workspaceRootOrigin: refreshedAgent.runnerInventoryWorkspaceRootOrigin,
            workspaceRootVerifiedAt: refreshedAgent.runnerInventoryWorkspaceRootVerifiedAt,
            verifiedAt: refreshedAgent.runnerInventoryVerifiedAt,
          },
          legacyRepairState: refreshedAgent.legacyAgentFileRepairState,
          legacy,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Runner unavailable';
        return reply.send({
          mode: 'no_repository',
          executableOwnership: legacyImportOwnership ?? getAgentExecutableOwnership(agent),
          runner: { state: 'unavailable', message },
          inventory: {
            runnerId: agent.runnerInventoryRunnerId,
            workspaceId: agent.runnerInventoryWorkspaceId,
            version: agent.runnerInventoryVersion,
            capabilityRefs: agent.runnerInventoryCapabilityRefs,
            workspaceRootOrigin: agent.runnerInventoryWorkspaceRootOrigin,
            workspaceRootVerifiedAt: agent.runnerInventoryWorkspaceRootVerifiedAt,
            verifiedAt: agent.runnerInventoryVerifiedAt,
          },
          legacyRepairState: agent.legacyAgentFileRepairState,
          legacy,
        });
      }
    },
  );

  typedApp.get(
    '/api/agents/:id/runner-preflight',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Agents'],
        summary: 'Check runner readiness for agent execution without creating a run',
        params: z.object({ id: z.string() }),
        querystring: z.object({ conversationId: z.uuid().optional() }),
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');
      const status = await getNativeRunnerPreflightStatus(
        request.params.id,
        request.query.conversationId,
        request.user.sub,
      );
      return reply.send(status);
    },
  );

  // Read text file content
  typedApp.get(
    '/api/agents/:id/files/content',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Agents'],
        summary: 'Read text file content from agent workspace',
        params: z.object({ id: z.string() }),
        querystring: z.object({
          path: z.string(),
          workspaceId: z.uuid().optional(),
        }),
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');
      try {
        const { result } = await dispatchAgentFileRequest({
          agent,
          requestUserId: request.user.sub,
          workspaceId: request.query.workspaceId,
          request: { action: 'read_agent_file', path: request.query.path, encoding: 'utf8' },
        });
        if (result.action !== 'read_agent_file') return reply.badRequest('Unexpected runner response');
        return reply.send({ path: request.query.path, content: result.content, origin: 'runner' });
      } catch (err) {
        return sendRunnerAgentFileError(reply, err);
      }
    },
  );

  // Write text file content
  typedApp.put(
    '/api/agents/:id/files/content',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      config: {
        sanitization: {
          preserve: {
            body: ['content'],
          },
        },
      },
      schema: {
        tags: ['Agents'],
        summary: 'Write text file content to agent workspace',
        params: z.object({ id: z.string() }),
        querystring: optionalWorkspaceIdQuerySchema,
        body: z.object({
          path: z.string().min(1),
          content: z.string(),
        }),
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');
      try {
        const { result } = await dispatchAgentFileRequest({
          agent,
          requestUserId: request.user.sub,
          workspaceId: request.query.workspaceId,
          request: {
            action: 'write_agent_file',
            path: request.body.path,
            content: request.body.content,
            encoding: 'utf8',
          },
        });
        if (result.action !== 'write_agent_file') return reply.badRequest('Unexpected runner response');
        return reply.status(204).send();
      } catch (err) {
        return sendRunnerAgentFileError(reply, err);
      }
    },
  );

  // Download file
  typedApp.get(
    '/api/agents/:id/files/download',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Agents'],
        summary: 'Download a file from agent workspace',
        params: z.object({ id: z.string() }),
        querystring: z.object({
          path: z.string(),
          workspaceId: z.uuid().optional(),
        }),
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');
      try {
        const { result } = await dispatchAgentFileRequest({
          agent,
          requestUserId: request.user.sub,
          workspaceId: request.query.workspaceId,
          request: { action: 'read_agent_file', path: request.query.path, encoding: 'base64' },
        });
        if (result.action !== 'read_agent_file') return reply.badRequest('Unexpected runner response');
        const fileName = path.basename(request.query.path);
        return reply
          .header('Content-Type', 'application/octet-stream')
          .header('Content-Disposition', `attachment; filename="${fileName}"`)
          .send(Buffer.from(result.content, 'base64'));
      } catch (err) {
        return sendRunnerAgentFileError(reply, err);
      }
    },
  );

  // Reveal file/folder through runner-owned filesystem authority.
  typedApp.post(
    '/api/agents/:id/files/reveal',
    {
      onRequest: [app.authenticate, requirePermission('settings:read')],
      schema: {
        tags: ['Agents'],
        summary: 'Reveal a runner-owned agent file location through the selected runner',
        params: z.object({ id: z.string() }),
        querystring: optionalWorkspaceIdQuerySchema,
        body: z.object({
          path: z.string().min(1),
        }),
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');
      try {
        const { result } = await dispatchAgentFileRequest({
          agent,
          requestUserId: request.user.sub,
          workspaceId: request.query.workspaceId,
          request: { action: 'reveal_agent_path', path: request.body.path },
        });
        if (result.action !== 'reveal_agent_path') return reply.badRequest('Unexpected runner response');
        return reply.status(204).send();
      } catch (err) {
        return sendRunnerAgentFileError(reply, err);
      }
    },
  );

  // Upload file
  typedApp.post(
    '/api/agents/:id/files/upload',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Agents'],
        summary: 'Upload a file to agent workspace',
        params: z.object({ id: z.string() }),
        querystring: optionalWorkspaceIdQuerySchema,
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');

      const data = await request.file();
      if (!data) return reply.badRequest('No file uploaded');

      const dirPath = (data.fields.path as { value: string } | undefined)?.value || '/';
      const fileName = data.filename || 'unnamed';
      const mimeType = data.mimetype || 'application/octet-stream';

      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      try {
        void mimeType;
        const safeName = fileName.replace(/[/\\:*?"<>|]/g, '_').trim();
        if (!safeName) return reply.badRequest('Invalid file name');
        const targetPath = dirPath === '/' ? `/${safeName}` : `${dirPath}/${safeName}`;
        const { result } = await dispatchAgentFileRequest({
          agent,
          requestUserId: request.user.sub,
          workspaceId: request.query.workspaceId,
          request: {
            action: 'write_agent_file',
            path: targetPath,
            content: buffer.toString('base64'),
            encoding: 'base64',
          },
        });
        if (result.action !== 'write_agent_file') return reply.badRequest('Unexpected runner response');
        return reply.status(201).send({
          name: path.basename(targetPath),
          path: targetPath,
          type: 'file',
          size: result.sizeBytes,
          createdAt: result.updatedAt,
        });
      } catch (err) {
        return sendRunnerAgentFileError(reply, err);
      }
    },
  );

  // Create subfolder
  typedApp.post(
    '/api/agents/:id/files/folders',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Agents'],
        summary: 'Create a subfolder in agent workspace',
        params: z.object({ id: z.string() }),
        querystring: optionalWorkspaceIdQuerySchema,
        body: z.object({
          path: z.string().default('/'),
          name: z.string().min(1).max(255),
        }),
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');
      try {
        const { result } = await dispatchAgentFileRequest({
          agent,
          requestUserId: request.user.sub,
          workspaceId: request.query.workspaceId,
          request: {
            action: 'create_agent_folder',
            path: request.body.path,
            name: request.body.name,
          },
        });
        if (result.action !== 'create_agent_folder') return reply.badRequest('Unexpected runner response');
        return reply.status(201).send(result.entry);
      } catch (err) {
        return sendRunnerAgentFileError(reply, err);
      }
    },
  );

  typedApp.post(
    '/api/agents/:id/files/import-legacy',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Agents'],
        summary: 'Explicitly import backend legacy no-repository agent files into runner-owned storage',
        params: z.object({ id: z.string() }),
        querystring: optionalWorkspaceIdQuerySchema,
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');
      if (!agentUsesRunnerOwnedNoRepositoryFiles(agent)) {
        return reply.badRequest('Legacy import is only available for no-repository agents');
      }
      try {
        const legacy = collectLegacyAgentFilesForImport(request.params.id);
        const { runnerId, workspaceId, workspacePath, result } =
          await dispatchNoRepositoryAgentFileRequest({
            agent,
            requestUserId: request.user.sub,
            workspaceId: request.query.workspaceId,
            request: { action: 'import_agent_files', files: legacy.files },
          });
        if (result.action !== 'import_agent_files') return reply.badRequest('Unexpected runner response');
        return reply.send({
          origin: 'runner',
          runnerId,
          workspaceId,
          workspacePath,
          legacy: legacy.summary,
          result,
        });
      } catch (err) {
        return sendRunnerAgentFileError(reply, err);
      }
    },
  );

  // Legacy backend-host references are no longer executable agent authority.
  typedApp.post(
    '/api/agents/:id/files/references',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Agents'],
        summary: 'Reject legacy backend-host agent references',
        params: z.object({ id: z.string() }),
        body: z.object({
          path: z.string().default('/'),
          name: z.string().min(1).max(255),
          target: z.string().min(1),
        }),
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');
      void request.body;
      return reply.status(409).send({
        code: 'agent_runner_filesystem_required',
        message:
          'Agent file references to backend host paths are no longer executable agent authority. Use runner-owned file operations under /api/agents/:id/files, reveal runner-local paths through /api/runner-filesystem/reveal, or import files explicitly through /api/agents/:id/files/import-legacy.',
      });
    },
  );

  // Delete file/folder
  typedApp.delete(
    '/api/agents/:id/files',
    {
      onRequest: [app.authenticate, requirePermission('settings:update')],
      schema: {
        tags: ['Agents'],
        summary: 'Delete a file or folder from agent workspace',
        params: z.object({ id: z.string() }),
        querystring: z.object({
          path: z.string(),
          workspaceId: z.uuid().optional(),
        }),
      },
    },
    async (request, reply) => {
      const agent = getAgent(request.params.id);
      if (!agent) return reply.notFound('Agent not found');
      try {
        const { result } = await dispatchAgentFileRequest({
          agent,
          requestUserId: request.user.sub,
          workspaceId: request.query.workspaceId,
          request: { action: 'delete_agent_path', path: request.query.path },
        });
        if (result.action !== 'delete_agent_path') return reply.badRequest('Unexpected runner response');
        if (!result.deleted) return reply.notFound('Item not found');
        return reply.status(204).send();
      } catch (err) {
        return sendRunnerAgentFileError(reply, err);
      }
    },
  );
}

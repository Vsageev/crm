import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerErrorHandler } from '../plugins/error-handler.js';
import { runnerFilesystemRoutes } from './runner-filesystem.js';

const mocks = vi.hoisted(() => ({
  getRunnerFilesystemAvailability: vi.fn(),
  getRunnerFilesystemSelection: vi.fn(),
  dispatchRunnerFilesystemRequest: vi.fn(),
  getAgent: vi.fn(),
  runnerRoutingScopesForAgentGroup: vi.fn(),
  getFilePath: vi.fn(),
  storeGetAll: vi.fn(),
  storeUpdate: vi.fn(),
  canAccessWorkspace: vi.fn(),
}));

vi.mock('../services/agent-runners.js', () => mocks);
vi.mock('../services/agents.js', () => ({ getAgent: mocks.getAgent }));
vi.mock('../services/runner-devices.js', () => ({
  canAccessWorkspace: mocks.canAccessWorkspace,
  runnerRoutingScopesForAgentGroup: mocks.runnerRoutingScopesForAgentGroup,
}));
vi.mock('../services/storage.js', () => ({ getFilePath: mocks.getFilePath }));
vi.mock('../db/index.js', () => ({ store: { getAll: mocks.storeGetAll, update: mocks.storeUpdate } }));
vi.mock('../middleware/rbac.js', () => ({
  requirePermission: vi.fn(() => async () => undefined),
}));

async function buildRouteApp() {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(sensible);
  app.decorate('authenticate', async (request: { user?: { sub: string } }) => {
    request.user = { sub: 'user-1' };
  });
  registerErrorHandler(app);
  await app.register(runnerFilesystemRoutes);
  return app;
}

describe('runner filesystem routes', () => {
  beforeEach(() => {
    mocks.getRunnerFilesystemAvailability.mockReset();
    mocks.getRunnerFilesystemSelection.mockReset();
    mocks.dispatchRunnerFilesystemRequest.mockReset();
    mocks.getAgent.mockReset();
    mocks.runnerRoutingScopesForAgentGroup.mockReset();
    mocks.getFilePath.mockReset();
    mocks.storeGetAll.mockReset();
    mocks.storeUpdate.mockReset();
    mocks.canAccessWorkspace.mockReset();
    mocks.canAccessWorkspace.mockReturnValue(true);
    mocks.getRunnerFilesystemAvailability.mockReturnValue({
      state: 'available',
      runnerId: 'runner-1',
    });
  });

  it('returns no-runner state without dispatching a filesystem request', async () => {
    mocks.getRunnerFilesystemAvailability.mockReturnValue({
      state: 'runner_unavailable',
      message: 'No paired runner is connected for this workspace.',
    });
    const app = await buildRouteApp();

    const response = await app.inject({ method: 'GET', url: '/api/runner-filesystem/status' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ state: 'runner_unavailable' });
    expect(mocks.dispatchRunnerFilesystemRequest).not.toHaveBeenCalled();
  });

  it('surfaces old-runner filesystem unsupported errors', async () => {
    mocks.dispatchRunnerFilesystemRequest.mockRejectedValue(
      new Error('runner_filesystem_unsupported: update runner'),
    );
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/runner-filesystem/reveal',
      payload: { path: '/repo' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'runner_filesystem_unsupported' });
  });

  it('proxies browse through a connected runner and annotates runner origin', async () => {
    mocks.dispatchRunnerFilesystemRequest.mockResolvedValue({
      runnerId: 'runner-1',
      result: { action: 'browse', path: '/repo', entries: [] },
    });
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/runner-filesystem/browse?path=%2Frepo&mode=folder',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      origin: 'runner',
      runnerId: 'runner-1',
      path: '/repo',
      entries: [],
    });
    expect(mocks.dispatchRunnerFilesystemRequest).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: undefined,
      request: { action: 'browse', path: '/repo', mode: 'folder' },
    });
  });

  it('persists validated repository-root metadata and recomputes workspace path', async () => {
    mocks.getAgent.mockReturnValue({ id: 'agent-1', name: 'Runner Fix', groupId: 'group-1' });
    mocks.runnerRoutingScopesForAgentGroup.mockReturnValue([
      { userId: 'user-1', workspaceId: '22222222-2222-4222-8222-222222222222' },
    ]);
    mocks.getRunnerFilesystemSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: { workspaceRoot: '/runner/root' },
    });
    mocks.dispatchRunnerFilesystemRequest.mockResolvedValue({
      runnerId: 'runner-1',
      result: {
        action: 'validate_repository_root',
        path: '/runner/repo',
        repositoryRootOrigin: 'runner_local',
        repositoryRootVerifiedAt: '2026-05-23T10:00:00.000Z',
      },
    });
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/runner-filesystem/validate-repository-root',
      payload: { path: '/runner/repo', agentId: '11111111-1111-4111-8111-111111111111' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      origin: 'runner',
      runnerId: 'runner-1',
      path: '/runner/repo',
      repositoryRootOrigin: 'runner_local',
    });
    expect(mocks.storeUpdate).toHaveBeenCalledWith(
      'agents',
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({
        repositoryRoot: '/runner/repo',
        repositoryRootOrigin: 'runner_local',
        repositoryRootRunnerId: 'runner-1',
        repositoryRootRepairRequired: false,
        workspacePath: null,
      }),
    );
    expect(mocks.dispatchRunnerFilesystemRequest).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      activationActorId: 'user-1',
      request: { action: 'validate_repository_root', path: '/runner/repo' },
    });
    expect(mocks.storeUpdate).toHaveBeenCalledWith(
      'agents',
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({
        runnerInventoryWorkspaceId: '22222222-2222-4222-8222-222222222222',
        runnerInventoryCapabilityRefs: expect.objectContaining({
          workspaceId: '22222222-2222-4222-8222-222222222222',
        }),
      }),
    );
  });

  it('reveals an agent-scoped runner path after resolving the workspace from the agent', async () => {
    mocks.getAgent.mockReturnValue({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Runner Fix',
      groupId: 'group-1',
    });
    mocks.runnerRoutingScopesForAgentGroup.mockReturnValue([
      { userId: 'user-1', workspaceId: '22222222-2222-4222-8222-222222222222' },
    ]);
    mocks.dispatchRunnerFilesystemRequest.mockResolvedValue({
      runnerId: 'runner-1',
      result: { action: 'reveal' },
    });
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/runner-filesystem/reveal',
      payload: {
        path: '/runner/root/.openwork/no-repository-agents/11111111-1111-4111-8111-111111111111/workspace/conversations/33333333-3333-4333-8333-333333333333',
        agentId: '11111111-1111-4111-8111-111111111111',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(mocks.dispatchRunnerFilesystemRequest).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      activationActorId: 'user-1',
      request: {
        action: 'reveal',
        path: '/runner/root/.openwork/no-repository-agents/11111111-1111-4111-8111-111111111111/workspace/conversations/33333333-3333-4333-8333-333333333333',
      },
    });
  });

  it('prepares a no-repository agent workspace through the selected runner root', async () => {
    mocks.getAgent.mockReturnValue({ id: '11111111-1111-4111-8111-111111111111', name: 'No Repo', groupId: 'group-1', repositoryRoot: null });
    mocks.runnerRoutingScopesForAgentGroup.mockReturnValue([
      { userId: 'user-1', workspaceId: '22222222-2222-4222-8222-222222222222' },
    ]);
    mocks.getRunnerFilesystemSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: { workspaceRoot: '/runner/root' },
    });
    mocks.dispatchRunnerFilesystemRequest.mockResolvedValue({
      runnerId: 'runner-1',
      result: {
        action: 'prepare_workspace',
        path: '/runner/root/.openwork/no-repository-agents/11111111-1111-4111-8111-111111111111/workspace',
        workspaceRoot: '/runner/root',
        status: 'ready',
        preparedAt: '2026-05-23T10:00:00.000Z',
      },
    });
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/runner-filesystem/prepare-agent-workspace',
      payload: {
        agentId: '11111111-1111-4111-8111-111111111111',
        workspaceId: '22222222-2222-4222-8222-222222222222',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      origin: 'runner',
      runnerId: 'runner-1',
      agentId: '11111111-1111-4111-8111-111111111111',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      path: '/runner/root/.openwork/no-repository-agents/11111111-1111-4111-8111-111111111111/workspace',
      conversationPaths: [],
      status: 'ready',
    });
    expect(mocks.dispatchRunnerFilesystemRequest).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      activationActorId: 'user-1',
      runnerId: 'runner-1',
      request: {
        action: 'prepare_workspace',
        path: '/runner/root/.openwork/no-repository-agents/11111111-1111-4111-8111-111111111111/workspace',
        purpose: 'no_repository_agent',
        agentId: '11111111-1111-4111-8111-111111111111',
        workspaceId: '22222222-2222-4222-8222-222222222222',
      },
    });
  });

  it('prepares existing no-repository conversation subfolders during workspace repair', async () => {
    mocks.getAgent.mockReturnValue({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'No Repo',
      groupId: 'group-1',
      repositoryRoot: null,
      separateFolderPerChat: true,
    });
    mocks.runnerRoutingScopesForAgentGroup.mockReturnValue([
      { userId: 'user-1', workspaceId: '22222222-2222-4222-8222-222222222222' },
    ]);
    mocks.getRunnerFilesystemSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: { workspaceRoot: '/runner/root' },
    });
    mocks.storeGetAll.mockReturnValue([
      {
        id: '33333333-3333-4333-8333-333333333333',
        metadata: JSON.stringify({
          agentId: '11111111-1111-4111-8111-111111111111',
          workspaceMode: 'subfolder',
          workspaceRelativePath: 'conversations/33333333-3333-4333-8333-333333333333',
        }),
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        metadata: JSON.stringify({ agentId: 'other-agent', workspaceMode: 'subfolder' }),
      },
    ]);
    mocks.dispatchRunnerFilesystemRequest
      .mockResolvedValueOnce({
        runnerId: 'runner-1',
        result: {
          action: 'prepare_workspace',
          path: '/runner/root/.openwork/no-repository-agents/11111111-1111-4111-8111-111111111111/workspace',
          workspaceRoot: '/runner/root',
          status: 'ready',
          preparedAt: '2026-05-23T10:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        runnerId: 'runner-1',
        result: {
          action: 'prepare_workspace',
          path: '/runner/root/.openwork/no-repository-agents/11111111-1111-4111-8111-111111111111/workspace/conversations/33333333-3333-4333-8333-333333333333',
          workspaceRoot: '/runner/root',
          status: 'ready',
          preparedAt: '2026-05-23T10:00:01.000Z',
        },
      });
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/runner-filesystem/prepare-agent-workspace',
      payload: {
        agentId: '11111111-1111-4111-8111-111111111111',
        workspaceId: '22222222-2222-4222-8222-222222222222',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      conversationPaths: [
        '/runner/root/.openwork/no-repository-agents/11111111-1111-4111-8111-111111111111/workspace/conversations/33333333-3333-4333-8333-333333333333',
      ],
    });
    expect(mocks.dispatchRunnerFilesystemRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        request: expect.objectContaining({
          action: 'prepare_workspace',
          purpose: 'conversation_subfolder',
          path: '/runner/root/.openwork/no-repository-agents/11111111-1111-4111-8111-111111111111/workspace/conversations/33333333-3333-4333-8333-333333333333',
          conversationId: '33333333-3333-4333-8333-333333333333',
        }),
      }),
    );
  });

  it('prepares a repository-backed conversation subfolder before reveal or execution', async () => {
    mocks.getAgent.mockReturnValue({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Repo Agent',
      groupId: 'group-1',
      repositoryRoot: '/runner/root/repo',
      repositoryRootOrigin: 'runner_local',
      repositoryRootRunnerId: 'runner-1',
      repositoryRootVerifiedAt: '2026-05-23T09:00:00.000Z',
      repositoryRootRepairRequired: false,
      separateFolderPerChat: true,
    });
    mocks.runnerRoutingScopesForAgentGroup.mockReturnValue([
      { userId: 'user-1', workspaceId: '22222222-2222-4222-8222-222222222222' },
    ]);
    mocks.getRunnerFilesystemSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: { workspaceRoot: '/runner/root' },
    });
    mocks.storeGetAll.mockReturnValue([
      {
        id: '33333333-3333-4333-8333-333333333333',
        metadata: JSON.stringify({
          agentId: '11111111-1111-4111-8111-111111111111',
          workspaceMode: 'subfolder',
          workspaceRelativePath: 'conversations/33333333-3333-4333-8333-333333333333',
        }),
      },
    ]);
    mocks.dispatchRunnerFilesystemRequest.mockResolvedValue({
      runnerId: 'runner-1',
      result: {
        action: 'prepare_workspace',
        path: '/runner/root/repo/conversations/33333333-3333-4333-8333-333333333333',
        workspaceRoot: '/runner/root',
        status: 'ready',
        preparedAt: '2026-05-23T10:00:00.000Z',
      },
    });
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/runner-filesystem/prepare-conversation-workspace',
      payload: {
        agentId: '11111111-1111-4111-8111-111111111111',
        conversationId: '33333333-3333-4333-8333-333333333333',
        workspaceId: '22222222-2222-4222-8222-222222222222',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      origin: 'runner',
      runnerId: 'runner-1',
      repositoryBacked: true,
      path: '/runner/root/repo/conversations/33333333-3333-4333-8333-333333333333',
      status: 'ready',
    });
    expect(mocks.dispatchRunnerFilesystemRequest).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      activationActorId: 'user-1',
      runnerId: 'runner-1',
      request: {
        action: 'prepare_workspace',
        path: '/runner/root/repo/conversations/33333333-3333-4333-8333-333333333333',
        purpose: 'conversation_subfolder',
        agentId: '11111111-1111-4111-8111-111111111111',
        conversationId: '33333333-3333-4333-8333-333333333333',
        workspaceId: '22222222-2222-4222-8222-222222222222',
      },
    });
  });

  it('prepares a verified repository-backed conversation outside the advertised runner root', async () => {
    mocks.getAgent.mockReturnValue({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Repo Agent',
      groupId: 'group-1',
      repositoryRoot: '/mnt/checkouts/repo',
      repositoryRootOrigin: 'runner_local',
      repositoryRootRunnerId: 'runner-1',
      repositoryRootVerifiedAt: '2026-05-23T09:00:00.000Z',
      repositoryRootRepairRequired: false,
      separateFolderPerChat: true,
    });
    mocks.runnerRoutingScopesForAgentGroup.mockReturnValue([
      { userId: 'user-1', workspaceId: '22222222-2222-4222-8222-222222222222' },
    ]);
    mocks.getRunnerFilesystemSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: { workspaceRoot: '/runner/root' },
    });
    mocks.storeGetAll.mockReturnValue([
      {
        id: '33333333-3333-4333-8333-333333333333',
        metadata: JSON.stringify({
          agentId: '11111111-1111-4111-8111-111111111111',
          workspaceMode: 'subfolder',
          workspaceRelativePath: 'conversations/33333333-3333-4333-8333-333333333333',
        }),
      },
    ]);
    mocks.dispatchRunnerFilesystemRequest.mockResolvedValue({
      runnerId: 'runner-1',
      result: {
        action: 'prepare_workspace',
        path: '/mnt/checkouts/repo/conversations/33333333-3333-4333-8333-333333333333',
        workspaceRoot: '/runner/root',
        status: 'ready',
        preparedAt: '2026-05-23T10:00:00.000Z',
      },
    });
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/runner-filesystem/prepare-conversation-workspace',
      payload: {
        agentId: '11111111-1111-4111-8111-111111111111',
        conversationId: '33333333-3333-4333-8333-333333333333',
        workspaceId: '22222222-2222-4222-8222-222222222222',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      repositoryBacked: true,
      path: '/mnt/checkouts/repo/conversations/33333333-3333-4333-8333-333333333333',
      status: 'ready',
    });
    expect(mocks.dispatchRunnerFilesystemRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        runnerId: 'runner-1',
        request: expect.objectContaining({
          path: '/mnt/checkouts/repo/conversations/33333333-3333-4333-8333-333333333333',
          purpose: 'conversation_subfolder',
        }),
      }),
    );
  });

  it('rejects unverified repository-backed conversation prepare with repair guidance', async () => {
    mocks.getAgent.mockReturnValue({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Repo Agent',
      groupId: 'group-1',
      repositoryRoot: '/mnt/checkouts/repo',
      repositoryRootOrigin: 'unknown',
      repositoryRootRepairRequired: true,
      separateFolderPerChat: true,
    });
    mocks.runnerRoutingScopesForAgentGroup.mockReturnValue([
      { userId: 'user-1', workspaceId: '22222222-2222-4222-8222-222222222222' },
    ]);
    mocks.getRunnerFilesystemSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: { workspaceRoot: '/runner/root' },
    });
    mocks.storeGetAll.mockReturnValue([
      {
        id: '33333333-3333-4333-8333-333333333333',
        metadata: JSON.stringify({
          agentId: '11111111-1111-4111-8111-111111111111',
          workspaceMode: 'subfolder',
          workspaceRelativePath: 'conversations/33333333-3333-4333-8333-333333333333',
        }),
      },
    ]);
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/runner-filesystem/prepare-conversation-workspace',
      payload: {
        agentId: '11111111-1111-4111-8111-111111111111',
        conversationId: '33333333-3333-4333-8333-333333333333',
        workspaceId: '22222222-2222-4222-8222-222222222222',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'agent_repository_root_repair_required',
    });
    expect(response.json().message).toContain('/api/runner-filesystem/validate-repository-root');
    expect(mocks.dispatchRunnerFilesystemRequest).not.toHaveBeenCalled();
  });

  it('reveals a no-repository agent file through the runner workspace', async () => {
    mocks.getAgent.mockReturnValue({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'No Repo',
      groupId: 'group-1',
      repositoryRoot: null,
    });
    mocks.runnerRoutingScopesForAgentGroup.mockReturnValue([
      { userId: 'user-1', workspaceId: '22222222-2222-4222-8222-222222222222' },
    ]);
    mocks.getRunnerFilesystemSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: { workspaceRoot: '/runner/root' },
    });
    mocks.dispatchRunnerFilesystemRequest.mockResolvedValue({
      runnerId: 'runner-1',
      result: { action: 'reveal_agent_path' },
    });
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/runner-filesystem/reveal-agent-file?agentId=11111111-1111-4111-8111-111111111111&workspaceId=22222222-2222-4222-8222-222222222222',
      payload: { path: '/AGENTS.md' },
    });

    expect(response.statusCode).toBe(204);
    expect(mocks.dispatchRunnerFilesystemRequest).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      activationActorId: 'user-1',
      runnerId: 'runner-1',
      request: {
        action: 'reveal_agent_path',
        workspacePath: '/runner/root/.openwork/no-repository-agents/11111111-1111-4111-8111-111111111111/workspace',
        path: '/AGENTS.md',
      },
    });
  });

  it('rejects no-repository prepare when the runner does not advertise a workspace root', async () => {
    mocks.getAgent.mockReturnValue({ id: '11111111-1111-4111-8111-111111111111', name: 'No Repo', groupId: 'group-1', repositoryRoot: null });
    mocks.runnerRoutingScopesForAgentGroup.mockReturnValue([
      { userId: 'user-1', workspaceId: '22222222-2222-4222-8222-222222222222' },
    ]);
    mocks.getRunnerFilesystemSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: {},
    });
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/runner-filesystem/prepare-agent-workspace',
      payload: {
        agentId: '11111111-1111-4111-8111-111111111111',
        workspaceId: '22222222-2222-4222-8222-222222222222',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'agent_runner_workspace_root_missing' });
    expect(mocks.dispatchRunnerFilesystemRequest).not.toHaveBeenCalled();
  });

  it('surfaces runner-side outside-root prepare rejection with a stable API code', async () => {
    mocks.getAgent.mockReturnValue({ id: '11111111-1111-4111-8111-111111111111', name: 'No Repo', groupId: 'group-1', repositoryRoot: null });
    mocks.runnerRoutingScopesForAgentGroup.mockReturnValue([
      { userId: 'user-1', workspaceId: '22222222-2222-4222-8222-222222222222' },
    ]);
    mocks.getRunnerFilesystemSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: { workspaceRoot: '/runner/root' },
    });
    mocks.dispatchRunnerFilesystemRequest.mockRejectedValue(
      new Error('path_outside_workspace_root: Workspace path is outside runner root /runner/root'),
    );
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/runner-filesystem/prepare-agent-workspace',
      payload: {
        agentId: '11111111-1111-4111-8111-111111111111',
        workspaceId: '22222222-2222-4222-8222-222222222222',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'agent_runner_workspace_outside_root' });
  });

  it('imports a backend-stored attachment through runner filesystem authority', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-runner-import-route-'));
    const diskPath = path.join(tmpDir, 'brief.txt');
    fs.writeFileSync(diskPath, 'runner import bytes');
    mocks.getFilePath.mockReturnValue(diskPath);
    mocks.dispatchRunnerFilesystemRequest.mockResolvedValue({
      runnerId: 'runner-1',
      result: {
        action: 'import_attachment',
        path: '/runner/root/imports/brief.txt',
        sizeBytes: 19,
        sha256: 'runner-side-hash',
        importedAt: '2026-05-23T10:00:00.000Z',
      },
    });
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/runner-filesystem/import-attachment',
      payload: {
        storagePath: '/chat-uploads/brief.txt',
        destinationPath: '/runner/root/imports/brief.txt',
        workspaceId: '22222222-2222-4222-8222-222222222222',
        overwrite: true,
        mimeType: 'text/plain',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      origin: 'runner',
      runnerId: 'runner-1',
      action: 'import_attachment',
      path: '/runner/root/imports/brief.txt',
    });
    expect(mocks.dispatchRunnerFilesystemRequest).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      request: expect.objectContaining({
        action: 'import_attachment',
        destinationPath: '/runner/root/imports/brief.txt',
        overwrite: true,
        source: expect.objectContaining({
          filename: 'brief.txt',
          mimeType: 'text/plain',
          sizeBytes: 19,
          storagePath: '/chat-uploads/brief.txt',
          download: expect.objectContaining({
            method: 'GET',
          }),
        }),
      }),
    });
    const request = mocks.dispatchRunnerFilesystemRequest.mock.calls[0][0].request;
    expect(request.source.download.path).toContain('/api/runner-attachments/download');
    expect(request.source.download.path).toContain('token=');
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not dispatch explicit attachment import when the backend storage record is missing', async () => {
    mocks.getFilePath.mockReturnValue(null);
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/runner-filesystem/import-attachment',
      payload: {
        storagePath: '/chat-uploads/missing.txt',
        destinationPath: '/runner/root/imports/missing.txt',
      },
    });

    expect(response.statusCode).toBe(404);
    expect(mocks.dispatchRunnerFilesystemRequest).not.toHaveBeenCalled();
  });
});

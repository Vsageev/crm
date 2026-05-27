import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerErrorHandler } from '../plugins/error-handler.js';
import { agentRoutes } from './agents.js';
import { env } from '../config/env.js';

const mocks = vi.hoisted(() => {
  const activeAgent = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Active Agent',
    description: '',
    model: 'codex',
    modelId: null,
    thinkingLevel: null,
    preset: 'codex',
    presetParameters: {},
    repositoryRoot: null,
    workspacePath: '/tmp/active-agent',
    status: 'active',
    apiKeyId: 'source-key',
    apiKeyName: 'Source key',
    apiKeyPrefix: 'sk',
    capabilities: [],
    skipPermissions: false,
    separateFolderPerChat: false,
    cronJobs: [],
    skillIds: [],
    groupId: null,
    serviceUserId: null,
    lastActivity: null,
    archivedAt: null,
    avatarIcon: 'spark',
    avatarBgColor: '#1a1a2e',
    avatarLogoColor: '#e94560',
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
  };
  const archivedAgent = {
    ...activeAgent,
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Archived Agent',
    archivedAt: '2026-05-19T01:00:00.000Z',
  };

  return {
    activeAgent,
    archivedAgent,
    deleteAgent: vi.fn(async (id: string) => id === activeAgent.id || id === archivedAgent.id),
    listAgents: vi.fn(async () => [activeAgent, archivedAgent]),
    getAgent: vi.fn((id: string) =>
      id === activeAgent.id ? activeAgent : id === archivedAgent.id ? archivedAgent : null,
    ),
    createAgent: vi.fn(),
    rollbackCreatedAgentMetadata: vi.fn(),
    buildInitialAgentWorkspaceImportFiles: vi.fn(() => [
      {
        path: '/AGENTS.md',
        contentBase64: Buffer.from('instructions\n').toString('base64'),
        sizeBytes: 13,
      },
    ]),
    collectLegacyAgentFilesForImport: vi.fn(() => ({
      files: [{ path: '/AGENTS.md', contentBase64: Buffer.from('legacy\n').toString('base64'), sizeBytes: 7 }],
      summary: {
        exists: true,
        rootPath: '/backend/data/agents/00000000-0000-4000-8000-000000000001',
        fileCount: 1,
        directoryCount: 0,
        symlinkCount: 0,
        importableFileCount: 1,
        skippedCount: 0,
        totalBytes: 7,
      },
    })),
    getAvailableRemoteAgentRunnerSelection: vi.fn((): unknown => null),
    getRunnerFilesystemAvailability: vi.fn(),
    getRunnerFilesystemSelection: vi.fn(),
    dispatchRunnerFilesystemRequest: vi.fn(),
    runnerRoutingScopesForAgentGroup: vi.fn(),
    store: {
      update: vi.fn(async () => ({})),
    },
    getApiKeyRecord: vi.fn(async () => ({
      id: 'source-key',
      name: 'Source key',
      keyPrefix: 'sk',
      isActive: true,
      permissions: ['settings:read', 'messages:write'],
    })),
    ensureDefaultWorkspaceForUser: vi.fn(async () => ({ id: '22222222-2222-4222-8222-222222222222' })),
    ensureAgentGroupForWorkspace: vi.fn(async (_workspaceId: string, groupId?: string | null) =>
      groupId ?? 'group-1',
    ),
    getWorkspaceById: vi.fn(async () => ({
      id: '22222222-2222-4222-8222-222222222222',
      userId: 'user-1',
    })),
    spawn: vi.fn(() => ({ unref: vi.fn() })),
  };
});

vi.mock('node:child_process', () => ({
  spawn: mocks.spawn,
}));
vi.mock('../db/index.js', () => ({
  store: mocks.store,
}));
vi.mock('../middleware/rbac.js', () => ({
  requirePermission: vi.fn(() => async () => undefined),
}));
vi.mock('../services/agent-cron.js', () => ({
  listAgentCronJobsWithNextRun: vi.fn((_agentId: string, jobs: unknown[]) => jobs),
  syncAgentCronJobs: vi.fn(),
}));
vi.mock('../services/workspaces.js', () => ({
  ensureDefaultWorkspaceForUser: mocks.ensureDefaultWorkspaceForUser,
  ensureAgentGroupForWorkspace: mocks.ensureAgentGroupForWorkspace,
  ensureLegacyAgentsAssignedToWorkspace: vi.fn(async () => null),
  getWorkspaceById: mocks.getWorkspaceById,
  updateWorkspace: vi.fn(async () => null),
}));
vi.mock('../services/project-settings.js', () => ({
  getProjectDefaultAgentKeyId: vi.fn(async () => null),
}));
vi.mock('../db/repositories/api-keys-repository.js', () => ({
  getApiKeyRecord: mocks.getApiKeyRecord,
}));
vi.mock('../services/agents.js', () => ({
  checkCliStatus: vi.fn(() => []),
  listCliDefinitions: vi.fn(() => [
    {
      id: 'codex',
      name: 'Codex',
      command: 'codex',
      downloadUrl: 'https://developers.openai.com/codex/quickstart/',
    },
    {
      id: 'cursor',
      name: 'Cursor',
      command: 'cursor-agent',
      downloadUrl: 'https://docs.cursor.com/cli/using',
    },
  ]),
  listPresets: vi.fn(() => []),
  listAgentAvatarPresets: vi.fn(() => []),
  createAgentAvatarPreset: vi.fn(),
  updateAgentAvatarPreset: vi.fn(),
  deleteAgentAvatarPreset: vi.fn(),
  listAgentColorPresets: vi.fn(() => []),
  createAgentColorPreset: vi.fn(),
  updateAgentColorPreset: vi.fn(),
  deleteAgentColorPreset: vi.fn(),
  asPublicAgent: vi.fn((agent: Record<string, unknown>) => agent),
  createAgent: mocks.createAgent,
  rollbackCreatedAgentMetadata: mocks.rollbackCreatedAgentMetadata,
  buildInitialAgentWorkspaceImportFiles: mocks.buildInitialAgentWorkspaceImportFiles,
  listAgents: mocks.listAgents,
  getAgent: mocks.getAgent,
  updateAgent: vi.fn(),
  deleteAgent: mocks.deleteAgent,
  listAgentGroups: vi.fn(async () => []),
  createAgentGroup: vi.fn(),
  updateAgentGroup: vi.fn(),
  deleteAgentGroup: vi.fn(),
}));
vi.mock('../services/legacy-agent-files.js', () => ({
  collectLegacyAgentFilesForImport: mocks.collectLegacyAgentFilesForImport,
}));
vi.mock('../services/agent-runners.js', () => ({
  getAvailableRemoteAgentRunnerSelection: mocks.getAvailableRemoteAgentRunnerSelection,
  getRunnerFilesystemAvailability: mocks.getRunnerFilesystemAvailability,
  getRunnerFilesystemSelection: mocks.getRunnerFilesystemSelection,
  dispatchRunnerFilesystemRequest: mocks.dispatchRunnerFilesystemRequest,
}));
vi.mock('../services/runner-devices.js', () => ({
  canAccessWorkspace: vi.fn(() => true),
  runnerRoutingScopesForAgentGroup: mocks.runnerRoutingScopesForAgentGroup,
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
  await app.register(agentRoutes);
  return app;
}

describe('agent archive routes', () => {
  let originalSameHostGate: boolean;

  beforeEach(() => {
    originalSameHostGate = env.OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM;
    env.OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM = false;
    vi.clearAllMocks();
    mocks.runnerRoutingScopesForAgentGroup.mockReturnValue([
      { userId: 'user-1', workspaceId: '22222222-2222-4222-8222-222222222222' },
    ]);
    mocks.getRunnerFilesystemAvailability.mockReturnValue({
      state: 'available',
      runnerId: 'runner-1',
    });
    mocks.getRunnerFilesystemSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: { workspaceRoot: '/runner/root' },
    });
    mocks.getApiKeyRecord.mockResolvedValue({
      id: 'source-key',
      name: 'Source key',
      keyPrefix: 'sk',
      isActive: true,
      permissions: ['settings:read', 'messages:write'],
    });
    mocks.rollbackCreatedAgentMetadata.mockResolvedValue(undefined);
    mocks.createAgent.mockResolvedValue({
      ...mocks.activeAgent,
      id: '00000000-0000-4000-8000-000000000003',
      name: 'Created Agent',
      model: 'codex',
      preset: 'basic',
      repositoryRoot: '/runner/repo',
      repositoryRootOrigin: 'runner_local',
      repositoryRootRunnerId: 'runner-1',
      repositoryRootVerifiedAt: '2026-05-24T21:54:00.000Z',
      repositoryRootRepairRequired: false,
      runnerInventoryRunnerId: 'runner-1',
      runnerInventoryWorkspaceId: '22222222-2222-4222-8222-222222222222',
      workspacePath: '/runner/repo/.openwork/agents/created-agent',
      groupId: 'group-1',
    });
    mocks.buildInitialAgentWorkspaceImportFiles.mockReturnValue([
      {
        path: '/AGENTS.md',
        contentBase64: Buffer.from('instructions\n').toString('base64'),
        sizeBytes: 13,
      },
    ]);
    mocks.dispatchRunnerFilesystemRequest.mockResolvedValue({
      runnerId: 'runner-1',
      result: {
        action: 'import_agent_files',
        importedCount: 1,
        skippedCount: 0,
        totalBytes: 13,
        importedAt: '2026-05-24T21:55:00.000Z',
      },
    });
  });

  afterEach(() => {
    env.OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM = originalSameHostGate;
  });

  it('hides archived agents from the default list and includes them on request', async () => {
    const app = await buildRouteApp();

    const defaultResponse = await app.inject({ method: 'GET', url: '/api/agents' });
    const archivedResponse = await app.inject({
      method: 'GET',
      url: '/api/agents?includeArchived=true',
    });

    expect(defaultResponse.statusCode).toBe(200);
    expect(defaultResponse.json()).toMatchObject({
      total: 1,
      entries: [expect.objectContaining({ id: mocks.activeAgent.id, archivedAt: null })],
    });
    expect(archivedResponse.statusCode).toBe(200);
    expect(archivedResponse.json()).toMatchObject({
      total: 2,
      entries: [
        expect.objectContaining({ id: mocks.activeAgent.id, archivedAt: null }),
        expect.objectContaining({
          id: mocks.archivedAgent.id,
          archivedAt: mocks.archivedAgent.archivedAt,
        }),
      ],
    });

    await app.close();
  });

  it('derives CLI status from selected runner capabilities instead of backend PATH', async () => {
    mocks.getAvailableRemoteAgentRunnerSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: {
        installedProviders: ['codex'],
        supportedProviders: ['codex'],
      },
    });
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/agents/cli-status?workspaceId=22222222-2222-4222-8222-222222222222',
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.getAvailableRemoteAgentRunnerSelection).toHaveBeenCalledWith(
      'user-1',
      '22222222-2222-4222-8222-222222222222',
      undefined,
      'user-1',
    );
    expect(response.json()).toMatchObject({
      clis: [
        {
          id: 'codex',
          installed: true,
          resolvedCommand: null,
          runnerId: 'runner-1',
          source: 'runner_capabilities',
        },
        {
          id: 'cursor',
          installed: false,
          resolvedCommand: null,
          runnerId: 'runner-1',
          source: 'runner_capabilities',
        },
      ],
    });

    await app.close();
  });

  it('reports CLIs unavailable when no runner is selected', async () => {
    mocks.getAvailableRemoteAgentRunnerSelection.mockReturnValue(null);
    const app = await buildRouteApp();

    const response = await app.inject({ method: 'GET', url: '/api/agents/cli-status' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      clis: [
        { id: 'codex', installed: false, resolvedCommand: null, runnerId: null, source: 'runner_unavailable' },
        { id: 'cursor', installed: false, resolvedCommand: null, runnerId: null, source: 'runner_unavailable' },
      ],
    });

    await app.close();
  });

  it('routes DELETE /api/agents/:id to archive behavior', async () => {
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/agents/${mocks.activeAgent.id}`,
    });

    expect(response.statusCode).toBe(204);
    expect(mocks.deleteAgent).toHaveBeenCalledWith(mocks.activeAgent.id);

    await app.close();
  });

  it('imports initial preset files into the runner workspace when creating an agent', async () => {
    mocks.dispatchRunnerFilesystemRequest
      .mockResolvedValueOnce({
        runnerId: 'runner-1',
        result: {
          action: 'validate_repository_root',
          path: '/runner/repo',
          repositoryRootOrigin: 'runner_local',
          repositoryRootVerifiedAt: '2026-05-24T21:54:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        runnerId: 'runner-1',
        result: {
          action: 'import_agent_files',
          importedCount: 1,
          skippedCount: 0,
          totalBytes: 13,
          importedAt: '2026-05-24T21:55:00.000Z',
        },
      });
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: {
        name: 'Created Agent',
        description: 'created through settings',
        model: 'codex',
        preset: 'basic',
        presetParameters: { workingDirectory: '/runner/repo' },
        apiKeyId: 'source-key',
        workspaceId: '22222222-2222-4222-8222-222222222222',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mocks.createAgent).toHaveBeenCalled();
    expect(mocks.buildInitialAgentWorkspaceImportFiles).toHaveBeenCalledWith(
      expect.objectContaining({ id: '00000000-0000-4000-8000-000000000003' }),
    );
    expect(mocks.dispatchRunnerFilesystemRequest).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: 'user-1',
        runnerId: 'runner-1',
        workspaceId: '22222222-2222-4222-8222-222222222222',
        request: expect.objectContaining({
          action: 'import_agent_files',
          files: [
            {
              path: '/AGENTS.md',
              contentBase64: Buffer.from('instructions\n').toString('base64'),
              sizeBytes: 13,
            },
          ],
        }),
      }),
    );

    await app.close();
  });

  it('rolls back backend agent metadata when runner initial file import fails', async () => {
    mocks.dispatchRunnerFilesystemRequest
      .mockResolvedValueOnce({
        runnerId: 'runner-1',
        result: {
          action: 'validate_repository_root',
          path: '/runner/repo',
          repositoryRootOrigin: 'runner_local',
          repositoryRootVerifiedAt: '2026-05-24T21:54:00.000Z',
        },
      })
      .mockRejectedValueOnce(new Error('runner_unavailable: runner disconnected'));
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: {
        name: 'Created Agent',
        description: 'created through settings',
        model: 'codex',
        preset: 'basic',
        presetParameters: { workingDirectory: '/runner/repo' },
        apiKeyId: 'source-key',
        workspaceId: '22222222-2222-4222-8222-222222222222',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(mocks.createAgent).toHaveBeenCalled();
    expect(mocks.rollbackCreatedAgentMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ id: '00000000-0000-4000-8000-000000000003' }),
    );

    await app.close();
  });
});

describe('agent backend-local filesystem routes', () => {
  let originalSameHostGate: boolean;

  beforeEach(() => {
    originalSameHostGate = env.OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM;
    env.OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM = false;
    vi.clearAllMocks();
    mocks.getAgent.mockImplementation((id: string) =>
      id === mocks.activeAgent.id
        ? mocks.activeAgent
        : id === mocks.archivedAgent.id
          ? mocks.archivedAgent
          : null,
    );
    mocks.runnerRoutingScopesForAgentGroup.mockReturnValue([
      { userId: 'user-1', workspaceId: '22222222-2222-4222-8222-222222222222' },
    ]);
    mocks.getRunnerFilesystemAvailability.mockReturnValue({
      state: 'available',
      runnerId: 'runner-1',
    });
    mocks.getRunnerFilesystemSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: { workspaceRoot: '/runner/root' },
    });
  });

  afterEach(() => {
    env.OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM = originalSameHostGate;
  });

  it('rejects unverified repository agent file reveal and host references in hosted mode', async () => {
    mocks.getAgent.mockImplementation((id: string): typeof mocks.activeAgent | null =>
      id === mocks.activeAgent.id
        ? ({
            ...mocks.activeAgent,
            repositoryRoot: '/repo',
            workspacePath: '/repo/.openwork/agents/active',
          } as unknown as typeof mocks.activeAgent)
        : null,
    );
    const app = await buildRouteApp();

    const revealResponse = await app.inject({
      method: 'POST',
      url: `/api/agents/${mocks.activeAgent.id}/files/reveal`,
      payload: { path: '/file.txt' },
    });
    const referenceResponse = await app.inject({
      method: 'POST',
      url: `/api/agents/${mocks.activeAgent.id}/files/references`,
      payload: { path: '/', name: 'host-ref', target: '/tmp/host-ref' },
    });

    expect(revealResponse.statusCode).toBe(409);
    expect(revealResponse.json()).toMatchObject({
      code: 'agent_repository_root_repair_required',
    });
    expect(revealResponse.json().message).toMatch(/verified on a paired runner/i);
    expect(referenceResponse.statusCode).toBe(409);
    expect(referenceResponse.json()).toMatchObject({
      code: 'agent_runner_filesystem_required',
    });
    expect(referenceResponse.json().message).toMatch(/runner-owned file operations/i);
    expect(mocks.spawn).not.toHaveBeenCalled();

    await app.close();
  });

  it('proxies verified repository agent file list and writes to the runner workspace', async () => {
    mocks.getAgent.mockImplementation((id: string): typeof mocks.activeAgent | null =>
      id === mocks.activeAgent.id
        ? ({
            ...mocks.activeAgent,
            repositoryRoot: '/runner/repo',
            repositoryRootOrigin: 'runner_local',
            repositoryRootRunnerId: 'runner-1',
            repositoryRootVerifiedAt: '2026-05-23T00:00:00.000Z',
            repositoryRootRepairRequired: false,
            workspacePath: '/runner/repo/.openwork/agents/active-agent',
          } as unknown as typeof mocks.activeAgent)
        : null,
    );
    mocks.dispatchRunnerFilesystemRequest
      .mockResolvedValueOnce({
        runnerId: 'runner-1',
        result: {
          action: 'list_agent_files',
          workspacePath: '/runner/repo/.openwork/agents/active-agent',
          path: '/',
          entries: [{ name: 'AGENTS.md', path: '/AGENTS.md', type: 'file', size: 12, createdAt: '2026-05-23T00:00:00.000Z' }],
        },
      })
      .mockResolvedValueOnce({
        runnerId: 'runner-1',
        result: {
          action: 'write_agent_file',
          path: '/AGENTS.md',
          sizeBytes: 14,
          updatedAt: '2026-05-23T00:01:00.000Z',
        },
      });
    const app = await buildRouteApp();

    const listResponse = await app.inject({
      method: 'GET',
      url: `/api/agents/${mocks.activeAgent.id}/files?path=/&workspaceId=22222222-2222-4222-8222-222222222222`,
    });
    const writeResponse = await app.inject({
      method: 'PUT',
      url: `/api/agents/${mocks.activeAgent.id}/files/content?workspaceId=22222222-2222-4222-8222-222222222222`,
      payload: { path: '/AGENTS.md', content: 'runner edit\n' },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      origin: 'runner',
      runnerId: 'runner-1',
      workspacePath: '/runner/repo/.openwork/agents/active-agent',
    });
    expect(writeResponse.statusCode).toBe(204);
    expect(mocks.dispatchRunnerFilesystemRequest).toHaveBeenNthCalledWith(1, {
      userId: 'user-1',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      activationActorId: 'user-1',
      runnerId: 'runner-1',
      request: {
        action: 'list_agent_files',
        path: '/',
        workspacePath: '/runner/repo/.openwork/agents/active-agent',
        workspaceRootPath: '/runner/repo',
      },
    });
    expect(mocks.dispatchRunnerFilesystemRequest).toHaveBeenNthCalledWith(2, {
      userId: 'user-1',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      activationActorId: 'user-1',
      runnerId: 'runner-1',
      request: {
        action: 'write_agent_file',
        path: '/AGENTS.md',
        content: 'runner edit\n',
        encoding: 'utf8',
        workspacePath: '/runner/repo/.openwork/agents/active-agent',
        workspaceRootPath: '/runner/repo',
      },
    });
    await app.close();
  });

  it('proxies no-repository agent file list and writes to the runner workspace', async () => {
    const backendDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-backend-data-'));
    const backendAgentDir = path.join(backendDataDir, 'agents', mocks.activeAgent.id);
    const backendAgentsFile = path.join(backendAgentDir, 'AGENTS.md');
    fs.mkdirSync(backendAgentDir, { recursive: true });
    fs.writeFileSync(backendAgentsFile, 'backend legacy copy\n');
    const beforeContent = fs.readFileSync(backendAgentsFile, 'utf-8');
    const beforeMtimeMs = fs.statSync(backendAgentsFile).mtimeMs;
    mocks.getAgent.mockImplementation((id: string): typeof mocks.activeAgent | null =>
      id === mocks.activeAgent.id
        ? ({
            ...mocks.activeAgent,
            workspacePath: backendAgentDir,
          } as unknown as typeof mocks.activeAgent)
        : null,
    );
    mocks.dispatchRunnerFilesystemRequest
      .mockResolvedValueOnce({
        runnerId: 'runner-1',
        result: {
          action: 'list_agent_files',
          workspacePath: '/runner/root/.openwork/no-repository-agents/00000000-0000-4000-8000-000000000001/workspace',
          path: '/',
          entries: [{ name: 'AGENTS.md', path: '/AGENTS.md', type: 'file', size: 12, createdAt: '2026-05-23T00:00:00.000Z' }],
        },
      })
      .mockResolvedValueOnce({
        runnerId: 'runner-1',
        result: {
          action: 'write_agent_file',
          path: '/AGENTS.md',
          sizeBytes: 14,
          updatedAt: '2026-05-23T00:01:00.000Z',
        },
      });
    const app = await buildRouteApp();

    const listResponse = await app.inject({
      method: 'GET',
      url: `/api/agents/${mocks.activeAgent.id}/files?path=/&workspaceId=22222222-2222-4222-8222-222222222222`,
    });
    const writeResponse = await app.inject({
      method: 'PUT',
      url: `/api/agents/${mocks.activeAgent.id}/files/content?workspaceId=22222222-2222-4222-8222-222222222222`,
      payload: { path: '/AGENTS.md', content: 'runner edit\n' },
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({ origin: 'runner', runnerId: 'runner-1' });
    expect(writeResponse.statusCode).toBe(204);
    expect(mocks.dispatchRunnerFilesystemRequest).toHaveBeenNthCalledWith(1, {
      userId: 'user-1',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      activationActorId: 'user-1',
      runnerId: 'runner-1',
      request: {
        action: 'list_agent_files',
        path: '/',
        workspacePath: '/runner/root/.openwork/no-repository-agents/00000000-0000-4000-8000-000000000001/workspace',
      },
    });
    expect(mocks.dispatchRunnerFilesystemRequest).toHaveBeenNthCalledWith(2, {
      userId: 'user-1',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      activationActorId: 'user-1',
      runnerId: 'runner-1',
      request: {
        action: 'write_agent_file',
        path: '/AGENTS.md',
        content: 'runner edit\n',
        encoding: 'utf8',
        workspacePath: '/runner/root/.openwork/no-repository-agents/00000000-0000-4000-8000-000000000001/workspace',
      },
    });
    expect(fs.readFileSync(backendAgentsFile, 'utf-8')).toBe(beforeContent);
    expect(fs.statSync(backendAgentsFile).mtimeMs).toBe(beforeMtimeMs);

    await app.close();
  });

  it('labels legacy backend no-repository files as import-required metadata, not executable ownership', async () => {
    mocks.dispatchRunnerFilesystemRequest.mockResolvedValueOnce({
      runnerId: 'runner-1',
      result: {
        action: 'list_agent_files',
        workspacePath: '/runner/root/.openwork/no-repository-agents/00000000-0000-4000-8000-000000000001/workspace',
        path: '/',
        entries: [],
      },
    });
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'GET',
      url: `/api/agents/${mocks.activeAgent.id}/files/status?workspaceId=22222222-2222-4222-8222-222222222222`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mode: 'no_repository',
      executableOwnership: {
        state: 'legacy_import_required',
        reason: 'backend_legacy_agent_files_require_runner_import',
      },
      runner: { state: 'available', runnerId: 'runner-1' },
      legacy: { importableFileCount: 1 },
    });
    expect(response.json()).not.toHaveProperty('executableOrigin');

    await app.close();
  });

  it('labels unverified repository roots as unavailable instead of backend workspace success', async () => {
    mocks.getAgent.mockImplementation((id: string): typeof mocks.activeAgent | null =>
      id === mocks.activeAgent.id
        ? ({
            ...mocks.activeAgent,
            repositoryRoot: '/backend/data/repo',
            repositoryRootOrigin: 'backend_local_legacy',
            repositoryRootRepairRequired: true,
            workspacePath: '/backend/data/repo/.openwork/agents/active',
          } as unknown as typeof mocks.activeAgent)
        : null,
    );
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'GET',
      url: `/api/agents/${mocks.activeAgent.id}/files/status`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mode: 'repository',
      executableOwnership: {
        state: 'unavailable',
        reason: 'repository_root_backend_local_legacy_repair_required',
      },
    });
    expect(response.json()).not.toHaveProperty('executableOrigin');

    await app.close();
  });

  it('imports backend legacy no-repository files only through an explicit runner action', async () => {
    mocks.dispatchRunnerFilesystemRequest.mockResolvedValue({
      runnerId: 'runner-1',
      result: {
        action: 'import_agent_files',
        importedCount: 1,
        skippedCount: 0,
        totalBytes: 7,
        importedAt: '2026-05-23T00:02:00.000Z',
      },
    });
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'POST',
      url: `/api/agents/${mocks.activeAgent.id}/files/import-legacy?workspaceId=22222222-2222-4222-8222-222222222222`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      origin: 'runner',
      result: { importedCount: 1, totalBytes: 7 },
      legacy: { importableFileCount: 1 },
    });
    expect(mocks.dispatchRunnerFilesystemRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          action: 'import_agent_files',
          files: [{ path: '/AGENTS.md', contentBase64: Buffer.from('legacy\n').toString('base64'), sizeBytes: 7 }],
        }),
      }),
    );

    await app.close();
  });
});

import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerErrorHandler } from '../plugins/error-handler.js';
import { agentRoutes } from './agents.js';

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
  };
});

vi.mock('../middleware/rbac.js', () => ({
  requirePermission: vi.fn(() => async () => undefined),
}));
vi.mock('../services/agent-cron.js', () => ({
  listAgentCronJobsWithNextRun: vi.fn((_agentId: string, jobs: unknown[]) => jobs),
  syncAgentCronJobs: vi.fn(),
}));
vi.mock('../services/workspaces.js', () => ({
  ensureDefaultWorkspaceForUser: vi.fn(async () => ({ id: 'workspace-1' })),
  ensureAgentGroupForWorkspace: vi.fn(async (_workspaceId: string, groupId?: string | null) =>
    groupId ?? null,
  ),
  ensureLegacyAgentsAssignedToWorkspace: vi.fn(async () => null),
  getWorkspaceById: vi.fn(async () => null),
  updateWorkspace: vi.fn(async () => null),
}));
vi.mock('../services/project-settings.js', () => ({
  getProjectDefaultAgentKeyId: vi.fn(async () => null),
}));
vi.mock('../db/repositories/api-keys-repository.js', () => ({
  getApiKeyRecord: vi.fn(async () => null),
}));
vi.mock('../services/agents.js', () => ({
  checkCliStatus: vi.fn(() => []),
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
  createAgent: vi.fn(),
  listAgents: mocks.listAgents,
  getAgent: mocks.getAgent,
  updateAgent: vi.fn(),
  deleteAgent: mocks.deleteAgent,
  listAgentFiles: vi.fn(() => []),
  getAgentFilePath: vi.fn(),
  getAgentEntryPath: vi.fn(),
  readAgentFileContent: vi.fn(),
  writeAgentFileContent: vi.fn(),
  uploadAgentFile: vi.fn(),
  createAgentFolder: vi.fn(),
  createAgentReference: vi.fn(),
  deleteAgentFile: vi.fn(),
  listAgentGroups: vi.fn(async () => []),
  createAgentGroup: vi.fn(),
  updateAgentGroup: vi.fn(),
  deleteAgentGroup: vi.fn(),
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
  beforeEach(() => {
    vi.clearAllMocks();
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
});

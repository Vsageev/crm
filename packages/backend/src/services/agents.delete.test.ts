import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const records: Record<string, Array<Record<string, unknown>>> = {};

  const getCollection = (collection: string) => {
    records[collection] ??= [];
    return records[collection];
  };

  const store = {
    getAll: vi.fn((collection: string) => [...getCollection(collection)]),
    getById: vi.fn((collection: string, id: string) =>
      getCollection(collection).find((record) => record.id === id) ?? null,
    ),
    insert: vi.fn((collection: string, data: Record<string, unknown>) => {
      const row = {
        id: data.id ?? `${collection}-${getCollection(collection).length + 1}`,
        createdAt: data.createdAt ?? new Date().toISOString(),
        updatedAt: data.updatedAt ?? new Date().toISOString(),
        ...data,
      };
      getCollection(collection).push(row);
      return row;
    }),
    update: vi.fn((collection: string, id: string, data: Record<string, unknown>) => {
      const rows = getCollection(collection);
      const index = rows.findIndex((record) => record.id === id);
      if (index < 0) return null;
      rows[index] = { ...rows[index], ...data };
      return rows[index];
    }),
    delete: vi.fn((collection: string, id: string) => {
      const rows = getCollection(collection);
      const index = rows.findIndex((record) => record.id === id);
      if (index < 0) return null;
      const [removed] = rows.splice(index, 1);
      return removed;
    }),
    transaction: vi.fn(async <T>(operation: () => Promise<T> | T) => operation()),
  };

  return {
    records,
    store,
    deleteAgentEnvVarsByAgentId: vi.fn(async () => undefined),
    deleteApiKey: vi.fn(async (id: string) => {
      store.update('apiKeys', id, { isActive: false });
      return true;
    }),
    deleteRefreshTokensForUserId: vi.fn(async () => undefined),
    stopAllAgentCronJobs: vi.fn(),
  };
});

vi.mock('../db/index.js', () => ({ store: mocks.store }));
vi.mock('../db/connection.js', () => ({ store: mocks.store }));
vi.mock('./api-keys.js', () => ({
  createApiKey: vi.fn(),
  deleteApiKey: mocks.deleteApiKey,
  validateApiKey: vi.fn(),
}));
vi.mock('../db/repositories/api-keys-repository.js', () => ({
  getApiKeyRecord: vi.fn(),
}));
vi.mock('../db/repositories/refresh-tokens-repository.js', () => ({
  deleteRefreshTokensForUserId: mocks.deleteRefreshTokensForUserId,
}));
vi.mock('../db/repositories/agents-query-repository.js', () => ({
  listAgentGroupRecordsOrdered: vi.fn(() => []),
  listAgentIdsWithGroupId: vi.fn(() => []),
  listAgentRecordsByApiKeyId: vi.fn(() => []),
  listAgentRecordsOrdered: vi.fn(() => []),
  listAllAgentRecordIds: vi.fn(() => []),
  maxAgentGroupOrder: vi.fn(() => 0),
}));
vi.mock('../db/repositories/skills-repository.js', () => ({
  findSkillRecordByNameLower: vi.fn(),
}));
vi.mock('./agent-env-vars.js', () => ({
  deleteAgentEnvVarsByAgentId: mocks.deleteAgentEnvVarsByAgentId,
}));
vi.mock('./agent-cron.js', () => ({
  stopAllAgentCronJobs: mocks.stopAllAgentCronJobs,
}));
vi.mock('./auth.js', () => ({ hashPassword: vi.fn(async () => 'hash') }));
vi.mock('./agent-workspaces.js', () => ({
  deriveAgentWorkspacePath: vi.fn(() => '/tmp/openwork-agent-delete-test/workspace'),
  getLegacyAgentWorkspacePath: vi.fn(() => '/tmp/openwork-agent-delete-test/legacy'),
  getLegacyAgentsDir: vi.fn(() => '/tmp/openwork-agent-delete-test/agents'),
  normalizeRepositoryRoot: vi.fn((value: string | null) => value),
  resolveAgentWorkspacePath: vi.fn(() => '/tmp/openwork-agent-delete-test/workspace'),
  resolveAgentWorkspacePathFromRecord: vi.fn(() => '/tmp/openwork-agent-delete-test/workspace'),
}));
vi.mock('./skills.js', () => ({ attachSkillToAgent: vi.fn() }));

import { deleteAgent } from './agents.js';

describe('deleteAgent', () => {
  beforeEach(() => {
    for (const collection of Object.keys(mocks.records)) {
      delete mocks.records[collection];
    }
    vi.clearAllMocks();
    mocks.store.transaction.mockImplementation(async <T>(operation: () => Promise<T> | T) =>
      operation(),
    );
  });

  it('archives an agent while preserving run and turn history references', async () => {
    mocks.store.insert('agents', {
      id: 'agent-1',
      name: 'History Agent',
      status: 'active',
      apiKeyId: 'source-key',
      workspaceApiKeyId: 'workspace-key',
      workspaceApiKey: 'raw-workspace-key',
      serviceUserId: 'service-user-1',
      archivedAt: null,
      cronJobs: [{ id: 'cron-1', enabled: true }],
    });
    mocks.store.insert('users', {
      id: 'service-user-1',
      isActive: true,
      type: 'agent',
      agentId: 'agent-1',
    });
    mocks.store.insert('apiKeys', { id: 'workspace-key', isActive: true });
    mocks.store.insert('agent_runs', {
      id: 'run-1',
      agentId: 'agent-1',
      status: 'completed',
    });
    mocks.store.insert('agentChatTurns', {
      id: 'turn-1',
      agentId: 'agent-1',
      runId: 'run-1',
    });
    mocks.store.insert('boardColumns', {
      id: 'column-1',
      assignAgentId: 'agent-1',
      assignAgentPrompt: 'Do work',
    });
    mocks.store.insert('boardCronTemplates', {
      id: 'template-1',
      agentId: 'agent-1',
      assigneeId: 'agent-1',
      enabled: true,
    });
    mocks.store.insert('agentChatQueue', {
      id: 'queue-1',
      agentId: 'agent-1',
      status: 'queued',
      runId: 'run-queued',
      nextAttemptAt: new Date().toISOString(),
    });
    mocks.store.insert('agentBatchRuns', {
      id: 'batch-run-1',
      agentId: 'agent-1',
      status: 'running',
    });
    mocks.store.insert('agentBatchRunItems', {
      id: 'batch-item-1',
      agentId: 'agent-1',
      status: 'processing',
    });
    mocks.store.insert('agentExternalApiKeys', {
      id: 'external-key-1',
      agentId: 'agent-1',
    });

    await expect(deleteAgent('agent-1')).resolves.toBe(true);

    expect(mocks.store.delete).not.toHaveBeenCalledWith('agents', 'agent-1');
    expect(mocks.store.getById('agents', 'agent-1')).toMatchObject({
      id: 'agent-1',
      status: 'inactive',
      archivedAt: expect.any(String),
      cronJobs: [],
      workspaceApiKeyId: null,
      workspaceApiKey: null,
    });
    expect(mocks.store.getById('agent_runs', 'run-1')).toMatchObject({ agentId: 'agent-1' });
    expect(mocks.store.getById('agentChatTurns', 'turn-1')).toMatchObject({
      agentId: 'agent-1',
      runId: 'run-1',
    });
    expect(mocks.store.getById('boardColumns', 'column-1')).toMatchObject({
      assignAgentId: null,
      assignAgentPrompt: null,
    });
    expect(mocks.store.getById('boardCronTemplates', 'template-1')).toMatchObject({
      agentId: null,
      assigneeId: null,
      enabled: false,
    });
    expect(mocks.store.getById('agentChatQueue', 'queue-1')).toMatchObject({
      status: 'cancelled',
      runId: null,
      nextAttemptAt: null,
      errorMessage: 'Agent archived',
    });
    expect(mocks.store.getById('agentBatchRuns', 'batch-run-1')).toMatchObject({
      status: 'cancelled',
      errorMessage: 'Agent archived',
    });
    expect(mocks.store.getById('agentBatchRunItems', 'batch-item-1')).toMatchObject({
      status: 'cancelled',
      errorMessage: 'Agent archived',
    });
    expect(mocks.store.getById('agentExternalApiKeys', 'external-key-1')).toBeNull();
    expect(mocks.deleteAgentEnvVarsByAgentId).toHaveBeenCalledWith('agent-1');
    expect(mocks.deleteRefreshTokensForUserId).toHaveBeenCalledWith('service-user-1');
    expect(mocks.deleteApiKey).toHaveBeenCalledWith('workspace-key');
  });
});

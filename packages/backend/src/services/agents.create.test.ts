import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const store = {
    getById: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getAll: vi.fn(),
  };

  return {
    store,
    createApiKey: vi.fn(),
    deleteApiKey: vi.fn(),
    listSkillRecords: vi.fn(),
  };
});

vi.mock('../db/index.js', () => ({ store: mocks.store }));
vi.mock('./api-keys.js', () => ({
  createApiKey: mocks.createApiKey,
  deleteApiKey: mocks.deleteApiKey,
  validateApiKey: vi.fn(),
}));
vi.mock('../db/repositories/api-keys-repository.js', () => ({ getApiKeyRecord: vi.fn() }));
vi.mock('../db/repositories/refresh-tokens-repository.js', () => ({
  deleteRefreshTokensForUserId: vi.fn(),
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
  listSkillRecords: mocks.listSkillRecords,
}));
vi.mock('./agent-env-vars.js', () => ({ deleteAgentEnvVarsByAgentId: vi.fn() }));
vi.mock('./agent-cron.js', () => ({ stopAllAgentCronJobs: vi.fn() }));
vi.mock('./auth.js', () => ({ hashPassword: vi.fn(async () => 'hashed-password') }));

import { buildInitialAgentWorkspaceImportFiles, createAgent } from './agents.js';

describe('createAgent repository root metadata', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-agent-create-'));
    mocks.store.getById.mockReset();
    mocks.store.insert.mockReset();
    mocks.store.update.mockReset();
    mocks.store.delete.mockReset();
    mocks.store.getAll.mockReset();
    mocks.createApiKey.mockReset();
    mocks.deleteApiKey.mockReset();
    mocks.listSkillRecords.mockReset();

    mocks.createApiKey.mockResolvedValue({ id: 'workspace-key-1', rawKey: 'owk_test' });
    mocks.listSkillRecords.mockReturnValue([]);
    mocks.store.insert.mockImplementation((collection: string, data: Record<string, unknown>) => ({
      ...data,
      id:
        typeof data.id === 'string'
          ? data.id
          : collection === 'users'
            ? 'service-user-1'
            : `${collection}-1`,
      createdAt: '2026-05-23T10:00:00.000Z',
      updatedAt: '2026-05-23T10:00:00.000Z',
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores a runner-validated working directory as immediately runnable', async () => {
    const repositoryRoot = path.join(tmpDir, 'repo');
    fs.mkdirSync(repositoryRoot, { recursive: true });

    const agent = await createAgent({
      name: 'Runner Repo Agent',
      description: 'repo agent',
      model: 'codex',
      preset: 'basic',
      presetParameters: { workingDirectory: repositoryRoot },
      apiKeyId: 'api-key-1',
      apiKeyName: 'Agent key',
      apiKeyPrefix: 'owk',
      capabilities: ['settings:read'],
      groupId: 'group-1',
      repositoryRootValidation: {
        path: repositoryRoot,
        runnerId: 'runner-1',
        verifiedAt: '2026-05-23T10:01:00.000Z',
      },
    });

    expect(agent.repositoryRoot).toBe(repositoryRoot);
    expect(agent.repositoryRootOrigin).toBe('runner_local');
    expect(agent.repositoryRootRunnerId).toBe('runner-1');
    expect(agent.repositoryRootVerifiedAt).toBe('2026-05-23T10:01:00.000Z');
    expect(agent.repositoryRootRepairRequired).toBe(false);
    expect(agent.runnerInventoryRunnerId).toBe('runner-1');
    expect(agent.runnerInventoryVersion).toBe(1);
    expect(agent.runnerInventoryWorkspaceRootOrigin).toBe('repository_root');
    expect(agent.runnerInventoryVerifiedAt).toBe('2026-05-23T10:01:00.000Z');
    expect(agent.legacyAgentFileState).toBe('not_applicable');
    expect(agent.legacyAgentFileRepairState).toBe('not_required');
    expect(agent.workspacePath).toBeNull();
    const agentInsert = mocks.store.insert.mock.calls.find((call) => call[0] === 'agents')?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(agentInsert?.workspacePath).toBeNull();
    expect(fs.existsSync(path.join(repositoryRoot, '.openwork'))).toBe(false);
  });

  it('does not derive a backend DATA_DIR workspace path for no-repository agents', async () => {
    const agent = await createAgent({
      name: 'No Repo Agent',
      description: 'no repo agent',
      model: 'codex',
      preset: 'basic',
      presetParameters: {},
      apiKeyId: 'api-key-1',
      apiKeyName: 'Agent key',
      apiKeyPrefix: 'owk',
      capabilities: ['settings:read'],
      groupId: 'group-1',
    });

    const agentInsert = mocks.store.insert.mock.calls.find((call) => call[0] === 'agents')?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(agent.repositoryRoot).toBeNull();
    expect(agent.workspacePath).toBeNull();
    expect(agentInsert?.workspacePath).toBeNull();
    expect(agent.runnerInventoryWorkspaceRootOrigin).toBe('unknown');
    expect(agent.legacyAgentFileRepairState).toBe('needs_runner_validation');
  });

  it('rejects agents without a workspace group', async () => {
    await expect(
      createAgent({
        name: 'Ungrouped Agent',
        description: 'no group',
        model: 'codex',
        preset: 'basic',
        presetParameters: {},
        apiKeyId: 'api-key-1',
        apiKeyName: 'Agent key',
        apiKeyPrefix: 'owk',
        capabilities: ['settings:read'],
      }),
    ).rejects.toThrow('Agent group is required');

    expect(mocks.store.insert).not.toHaveBeenCalledWith('agents', expect.anything());
  });

  it('builds model-specific initial preset files for runner import', () => {
    const files = buildInitialAgentWorkspaceImportFiles({
      name: 'Runner Repo Agent',
      description: 'repo agent',
      model: 'claude',
      preset: 'basic',
      presetParameters: { workingDirectory: '/runner/repo' },
    });

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('/CLAUDE.MD');
    expect(Buffer.from(files[0].contentBase64, 'base64').toString('utf-8')).toContain(
      '- The project repository root is `/runner/repo`.',
    );
  });
});

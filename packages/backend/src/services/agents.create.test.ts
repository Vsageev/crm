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
    dispatchAgentFileRequest: vi.fn(),
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
vi.mock('./runner-agent-files.js', () => ({
  dispatchAgentFileRequest: mocks.dispatchAgentFileRequest,
}));

import { buildInitialAgentWorkspaceImportFiles, createAgent, updateAgent } from './agents.js';

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
    mocks.dispatchAgentFileRequest.mockReset();

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

  it('renames the agent instruction file when the provider changes from Claude to Codex', async () => {
    const currentAgent = {
      id: 'agent-1',
      name: 'Provider Switcher',
      description: 'switch agent',
      model: 'claude',
      modelId: null,
      preset: 'basic',
      presetParameters: {},
      archivedAt: null,
    };
    mocks.store.getById.mockReturnValue(currentAgent);
    mocks.store.update.mockImplementation((_collection: string, _id: string, patch: Record<string, unknown>) => ({
      ...currentAgent,
      ...patch,
      updatedAt: '2026-05-23T10:02:00.000Z',
    }));
    mocks.dispatchAgentFileRequest.mockImplementation(async ({ request }: { request: Record<string, unknown> }) => {
      if (request.action === 'read_agent_file' && request.path === 'CLAUDE.MD') {
        return {
          result: {
            action: 'read_agent_file',
            path: 'CLAUDE.MD',
            content: '# Instructions\n',
            encoding: 'utf8',
            sizeBytes: 15,
          },
        };
      }
      if (request.action === 'read_agent_file' && request.path === 'CLAUDE.md') {
        throw new Error('not_found: File does not exist: CLAUDE.md');
      }
      if (request.action === 'read_agent_file' && request.path === 'AGENTS.md') {
        throw new Error('not_found: File does not exist: AGENTS.md');
      }
      if (request.action === 'write_agent_file') {
        return { result: { action: 'write_agent_file', path: request.path, sizeBytes: 15, updatedAt: 'now' } };
      }
      if (request.action === 'delete_agent_path') {
        return { result: { action: 'delete_agent_path', deleted: true } };
      }
      throw new Error(`unexpected request ${String(request.action)}`);
    });

    const updated = await updateAgent(
      'agent-1',
      { model: 'codex' },
      { instructionFileMigration: { requestUserId: 'user-1', workspaceId: 'workspace-1' } },
    );

    expect(updated?.model).toBe('codex');
    expect(mocks.dispatchAgentFileRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestUserId: 'user-1',
        workspaceId: 'workspace-1',
        request: { action: 'write_agent_file', path: 'AGENTS.md', content: '# Instructions\n', encoding: 'utf8' },
      }),
    );
    expect(mocks.dispatchAgentFileRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        request: { action: 'delete_agent_path', path: 'CLAUDE.MD' },
      }),
    );
    expect(mocks.store.update).toHaveBeenCalledWith('agents', 'agent-1', { model: 'codex' });
  });

  it('rejects model changes when the target instruction file has different content', async () => {
    const currentAgent = {
      id: 'agent-1',
      name: 'Provider Switcher',
      description: 'switch agent',
      model: 'claude',
      modelId: null,
      preset: 'basic',
      presetParameters: {},
      archivedAt: null,
    };
    mocks.store.getById.mockReturnValue(currentAgent);
    mocks.dispatchAgentFileRequest.mockImplementation(async ({ request }: { request: Record<string, unknown> }) => {
      if (request.action === 'read_agent_file' && request.path === 'CLAUDE.MD') {
        return {
          result: {
            action: 'read_agent_file',
            path: 'CLAUDE.MD',
            content: 'claude instructions\n',
            encoding: 'utf8',
            sizeBytes: 20,
          },
        };
      }
      if (request.action === 'read_agent_file' && request.path === 'CLAUDE.md') {
        throw new Error('not_found: File does not exist: CLAUDE.md');
      }
      if (request.action === 'read_agent_file' && request.path === 'AGENTS.md') {
        return {
          result: {
            action: 'read_agent_file',
            path: 'AGENTS.md',
            content: 'codex instructions\n',
            encoding: 'utf8',
            sizeBytes: 19,
          },
        };
      }
      throw new Error(`unexpected request ${String(request.action)}`);
    });

    await expect(
      updateAgent(
        'agent-1',
        { model: 'codex' },
        { instructionFileMigration: { requestUserId: 'user-1', workspaceId: 'workspace-1' } },
      ),
    ).rejects.toThrow('instruction_file_conflict');

    expect(mocks.store.update).not.toHaveBeenCalled();
    expect(mocks.dispatchAgentFileRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({ request: expect.objectContaining({ action: 'write_agent_file' }) }),
    );
  });
});

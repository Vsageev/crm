import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { env } from '../config/env.js';

const mocks = vi.hoisted(() => {
  const store = {
    getAll: vi.fn(),
    getById: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
    lockAgentChatQueueConversation: vi.fn(),
  };

  return {
    store,
    getAgent: vi.fn(),
    getAvailableRemoteAgentRunnerCapabilities: vi.fn(),
    getAvailableRemoteAgentRunnerSelection: vi.fn(),
    hasConnectedRemoteAgentRunner: vi.fn(),
    hasAvailableRemoteAgentRunner: vi.fn(),
    assertRunnerWorkspaceApiUrlReachable: vi.fn(),
    dispatchRunnerFilesystemRequest: vi.fn(),
  };
});

vi.mock('../db/index.js', () => ({ store: mocks.store }));
vi.mock('../db/connection.js', () => ({ store: mocks.store }));
vi.mock('./agents.js', () => ({
  getAgent: mocks.getAgent,
  isAgentArchived: vi.fn(() => false),
  listAgents: vi.fn(() => []),
  prepareAgentWorkspaceAccess: vi.fn(),
}));
vi.mock('./agent-runners.js', () => ({
  dispatchRemoteAgentJob: vi.fn(),
  dispatchRunnerFilesystemRequest: mocks.dispatchRunnerFilesystemRequest,
  getAvailableRemoteAgentRunnerCapabilities: mocks.getAvailableRemoteAgentRunnerCapabilities,
  getAvailableRemoteAgentRunnerSelection: mocks.getAvailableRemoteAgentRunnerSelection,
  getRemoteAgentRunnerUnavailableMessage: vi.fn(
    (workspaceId?: string | null) =>
      workspaceId
        ? 'No remote agent runner is connected. Start or pair an OpenWork runner, then try again.'
        : 'No remote agent runner is connected. Start or pair an OpenWork runner, then try again.',
  ),
  hasAvailableRemoteAgentRunner: mocks.hasAvailableRemoteAgentRunner,
  hasConnectedRemoteAgentRunner: mocks.hasConnectedRemoteAgentRunner,
}));
vi.mock('./runner-public-api-url.js', () => ({
  assertRunnerWorkspaceApiUrlReachable: mocks.assertRunnerWorkspaceApiUrlReachable,
}));

import {
  AgentChatError,
  __agentChatTestUtils,
  enqueueAgentPrompt,
  preflightAgentRunner,
} from './agent-chat.js';

function runnerAgentInventory(workspaceRoot: string, agentId = 'agent-1') {
  return {
    protocolVersion: 1,
    revision: `test-${agentId}`,
    advertisedAt: new Date().toISOString(),
    ttlMs: 60_000,
    workspaceRoots: [{ id: 'default', path: workspaceRoot, scope: 'workspace', writable: true }],
    fileOperations: ['list_agent_files', 'read_agent_file', 'write_agent_file'],
    agents: [
      {
        agentId,
        readiness: 'ready',
        fileOperations: ['list_agent_files', 'read_agent_file', 'write_agent_file'],
        workspaceRootPath: `${workspaceRoot}/.openwork/no-repository-agents/${agentId}/workspace`,
        updatedAt: new Date().toISOString(),
      },
    ],
  };
}

describe('enqueueAgentPrompt runner workspace validation', () => {
  beforeEach(() => {
    const records = new Map<string, Record<string, unknown>>();
    const keyFor = (collection: string, id: string) => `${collection}:${id}`;

    mocks.store.getAll.mockReset();
    mocks.store.getById.mockReset();
    mocks.store.insert.mockReset();
    mocks.store.update.mockReset();
    mocks.store.transaction.mockReset();
    mocks.store.lockAgentChatQueueConversation.mockReset();
    mocks.store.transaction.mockImplementation(async (fn: () => unknown) => fn());
    mocks.store.getById.mockImplementation((collection: string, id: string) =>
      records.get(keyFor(collection, id)) ?? null,
    );
    mocks.store.insert.mockImplementation((collection: string, data: Record<string, unknown>) => {
      const record = {
        ...data,
        id: typeof data.id === 'string' ? data.id : `${collection}-1`,
        createdAt: '2026-05-16T12:00:00.000Z',
        updatedAt: '2026-05-16T12:00:00.000Z',
      };
      records.set(keyFor(collection, record.id), record);
      return record;
    });
    mocks.store.update.mockImplementation(
      (collection: string, id: string, data: Record<string, unknown>) => {
        const record = {
          ...(records.get(keyFor(collection, id)) ?? {}),
          ...data,
          id,
          updatedAt: '2026-05-16T12:00:01.000Z',
        };
        records.set(keyFor(collection, id), record);
        return record;
      },
    );
    mocks.getAgent.mockReset();
    mocks.getAvailableRemoteAgentRunnerCapabilities.mockReset();
    mocks.getAvailableRemoteAgentRunnerSelection.mockReset();
    mocks.hasConnectedRemoteAgentRunner.mockReset();
    mocks.hasAvailableRemoteAgentRunner.mockReset();
    mocks.assertRunnerWorkspaceApiUrlReachable.mockReset();
    mocks.dispatchRunnerFilesystemRequest.mockReset();
    mocks.assertRunnerWorkspaceApiUrlReachable.mockReturnValue('http://localhost:3847');
    mocks.dispatchRunnerFilesystemRequest.mockRejectedValue(
      new Error('runner_unavailable: No paired runner is connected for this workspace.'),
    );
    env.OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM = false;
    mocks.getAvailableRemoteAgentRunnerCapabilities.mockReturnValue({
      workspaceRoot: undefined,
      supportedProviders: ['codex'],
      policy: { workspaceRootRequired: false },
    });
    mocks.getAvailableRemoteAgentRunnerSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: {
        workspaceRoot: undefined,
        supportedProviders: ['codex'],
        policy: { workspaceRootRequired: false },
      },
    });
  });

  it('persists a failed prompt turn when the agent is not assigned to a workspace', async () => {
    mocks.getAgent.mockReturnValue({ id: 'agent-1', groupId: null, model: 'codex' });
    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces' ? [{ id: 'workspace-1', agentGroupIds: [] }] : [],
    );

    await expect(
      enqueueAgentPrompt('agent-1', 'conversation-1', 'hello', {
        queuedMessageId: 'message-1',
      })
    ).rejects.toThrow(/not assigned to a workspace/i);
    expect(mocks.hasConnectedRemoteAgentRunner).not.toHaveBeenCalled();
    expect(mocks.store.insert).toHaveBeenCalledWith(
      'messages',
      expect.objectContaining({ id: 'message-1', content: 'hello' }),
    );
    expect(mocks.store.insert).toHaveBeenCalledWith(
      'agentChatTurns',
      expect.objectContaining({ userMessageId: 'message-1', status: 'queued' }),
    );
    expect(mocks.store.insert).not.toHaveBeenCalledWith(
      'agentChatQueue',
      expect.anything(),
    );
    expect(mocks.store.update).toHaveBeenCalledWith(
      'agentChatTurns',
      'agentChatTurns-1',
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('preflights zero, one, and multiple matching runner workspace scopes', () => {
    mocks.hasConnectedRemoteAgentRunner.mockReturnValue(true);
    mocks.hasAvailableRemoteAgentRunner.mockReturnValue(true);
    mocks.getAgent.mockReturnValue({ id: 'agent-1', groupId: 'group-1', model: 'codex' });

    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces' ? [] : [],
    );
    expect(() => preflightAgentRunner('agent-1')).toThrow(/not assigned to a workspace/i);

    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces'
        ? [{ id: 'workspace-1', userId: 'user-1', agentGroupIds: ['group-1'] }]
        : [],
    );
    expect(preflightAgentRunner('agent-1')).toMatchObject({
      agentId: 'agent-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      provider: 'codex',
      eligible: true,
    });

    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces'
        ? [
            { id: 'workspace-1', userId: 'user-1', agentGroupIds: ['group-1'] },
            { id: 'workspace-2', userId: 'user-1', agentGroupIds: ['group-1'] },
          ]
        : [],
    );
    try {
      preflightAgentRunner('agent-1');
      throw new Error('Expected ambiguous workspace preflight to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AgentChatError);
      expect(error).toMatchObject({
        code: 'agent_runner_workspace_ambiguous',
        statusCode: 409,
      });
      expect((error as AgentChatError).message).toContain('workspace-1, workspace-2');
      expect((error as AgentChatError).hint).toContain('Remove this agent group');
    }
  });

  it('fails with the shared runner error before queueing when the provider is unsupported', async () => {
    mocks.getAgent.mockReturnValue({ id: 'agent-1', groupId: 'group-1', model: 'unknown-model' });
    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces'
        ? [{ id: 'workspace-1', userId: 'user-1', agentGroupIds: ['group-1'] }]
        : [],
    );

    await expect(
      enqueueAgentPrompt('agent-1', 'conversation-1', 'hello', {
        queuedMessageId: 'message-1',
      })
    ).rejects.toThrow(/supported remote runner provider/i);
    expect(mocks.hasConnectedRemoteAgentRunner).not.toHaveBeenCalled();
    expect(mocks.store.insert).not.toHaveBeenCalledWith(
      'agentChatQueue',
      expect.anything(),
    );
  });

  it('fails shared preflight when the agent group maps to multiple workspaces', async () => {
    mocks.getAgent.mockReturnValue({ id: 'agent-1', groupId: 'group-1', model: 'codex' });
    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces'
        ? [
            { id: 'workspace-1', userId: 'user-1', agentGroupIds: ['group-1'] },
            { id: 'workspace-2', userId: 'user-1', agentGroupIds: ['group-1'] },
          ]
        : [],
    );

    await expect(
      enqueueAgentPrompt('agent-1', 'conversation-1', 'hello', {
        queuedMessageId: 'message-1',
      })
    ).rejects.toThrow(/multiple runner workspaces \(workspace-1, workspace-2\)/i);
    expect(mocks.hasConnectedRemoteAgentRunner).not.toHaveBeenCalled();
    expect(mocks.store.insert).not.toHaveBeenCalledWith(
      'agentChatQueue',
      expect.anything(),
    );
  });

  it('checks runner availability in the agent workspace, not globally', async () => {
    mocks.getAgent.mockReturnValue({ id: 'agent-1', groupId: 'group-1', model: 'codex' });
    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces'
        ? [{ id: 'workspace-1', userId: 'user-1', agentGroupIds: ['group-1'] }]
        : [],
    );
    mocks.hasConnectedRemoteAgentRunner.mockReturnValue(false);

    await expect(
      enqueueAgentPrompt('agent-1', 'conversation-1', 'hello', {
        queuedMessageId: 'message-1',
      })
    ).rejects.toThrow(/No remote agent runner is connected/i);
    expect(mocks.hasConnectedRemoteAgentRunner).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
      'user-1',
    );
    expect(mocks.store.insert).toHaveBeenCalledWith(
      'messages',
      expect.objectContaining({ id: 'message-1', content: 'hello' }),
    );
    expect(mocks.store.insert).not.toHaveBeenCalledWith(
      'agentChatQueue',
      expect.anything(),
    );
    expect(mocks.store.update).toHaveBeenCalledWith(
      'agentChatTurns',
      'agentChatTurns-1',
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('fails shared preflight before queueing when hosted public API URL is missing', async () => {
    mocks.getAgent.mockReturnValue({ id: 'agent-1', groupId: 'group-1', model: 'codex' });
    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces'
        ? [{ id: 'workspace-1', userId: 'user-1', agentGroupIds: ['group-1'] }]
        : [],
    );
    mocks.hasConnectedRemoteAgentRunner.mockReturnValue(true);
    mocks.hasAvailableRemoteAgentRunner.mockReturnValue(true);
    mocks.assertRunnerWorkspaceApiUrlReachable.mockImplementationOnce(() => {
      throw new Error(
        'WORKSPACE_API_URL must be runner-reachable; set OPENWORK_PUBLIC_API_URL or use a reachable HOST/PORT for local development.',
      );
    });

    await expect(
      enqueueAgentPrompt('agent-1', 'conversation-1', 'hello', {
        queuedMessageId: 'message-1',
      })
    ).rejects.toThrow(/OPENWORK_PUBLIC_API_URL/i);
    expect(mocks.store.insert).not.toHaveBeenCalledWith(
      'agentChatQueue',
      expect.anything(),
    );
  });

  it('rejects a relative configured runner cwd before enqueueing', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      groupId: 'group-1',
      model: 'codex',
      repositoryRoot: 'relative/repo',
    });
    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces'
        ? [{ id: 'workspace-1', userId: 'user-1', agentGroupIds: ['group-1'] }]
        : [],
    );
    mocks.hasConnectedRemoteAgentRunner.mockReturnValue(true);
    mocks.hasAvailableRemoteAgentRunner.mockReturnValue(true);

    await expect(
      enqueueAgentPrompt('agent-1', 'conversation-1', 'hello', {
        queuedMessageId: 'message-1',
      })
    ).rejects.toThrow(/absolute runner-local path/i);
    expect(mocks.store.insert).not.toHaveBeenCalledWith(
      'agentChatQueue',
      expect.anything(),
    );
  });

  it('resolves no-repository agents under the runner root without staging backend files', async () => {
    const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-backend-agent-'));
    const legacyAgentsFile = path.join(legacyRoot, 'AGENTS.md');
    fs.writeFileSync(legacyAgentsFile, 'local agent instructions\n');
    fs.mkdirSync(path.join(legacyRoot, 'skills', 'session-start'), { recursive: true });
    fs.writeFileSync(path.join(legacyRoot, 'skills', 'session-start', 'index.md'), 'start here\n');
    const beforeContent = fs.readFileSync(legacyAgentsFile, 'utf-8');
    const beforeMtimeMs = fs.statSync(legacyAgentsFile).mtimeMs;
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      groupId: 'group-1',
      model: 'codex',
      workspacePath: legacyRoot,
    });
    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces'
        ? [{ id: 'workspace-1', userId: 'user-1', agentGroupIds: ['group-1'] }]
        : [],
    );
    mocks.hasConnectedRemoteAgentRunner.mockReturnValue(true);
    mocks.hasAvailableRemoteAgentRunner.mockReturnValue(true);
    const runnerRoot = '/runner/workspaces';
    mocks.getAvailableRemoteAgentRunnerCapabilities.mockReturnValue({
      workspaceRoot: runnerRoot,
      supportedProviders: ['codex'],
      agentInventory: runnerAgentInventory(runnerRoot),
      policy: { workspaceRootRequired: true },
    });
    mocks.getAvailableRemoteAgentRunnerSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: {
        workspaceRoot: runnerRoot,
        supportedProviders: ['codex'],
        agentInventory: runnerAgentInventory(runnerRoot),
        policy: { workspaceRootRequired: true },
      },
    });

    const workspace = __agentChatTestUtils.buildNoRepositoryRunnerWorkspace({
      agentId: 'agent-1',
      agent: { id: 'agent-1', workspacePath: legacyRoot },
      workspaceRoot: runnerRoot,
    });
    expect(workspace?.workDir).toBe(
      '/runner/workspaces/.openwork/no-repository-agents/agent-1/workspace',
    );
    expect(workspace?.workDir).not.toContain('/data/agents/');
    expect(workspace).not.toHaveProperty('materialization');

    const result = await enqueueAgentPrompt('agent-1', 'conversation-1', 'hello', {
      queuedMessageId: 'message-1',
    });
    expect(result.queueItem).toMatchObject({ agentId: 'agent-1', status: 'queued' });
    expect(mocks.store.insert).toHaveBeenCalledWith(
      'agentChatQueue',
      expect.objectContaining({ agentId: 'agent-1', conversationId: 'conversation-1' }),
    );
    expect(fs.readFileSync(legacyAgentsFile, 'utf-8')).toBe(beforeContent);
    expect(fs.statSync(legacyAgentsFile).mtimeMs).toBe(beforeMtimeMs);
  });

  it('does not require backend agent context files before enqueueing no-repository agents', async () => {
    const missingRoot = path.join(os.tmpdir(), `openwork-missing-agent-${Date.now()}`);
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      groupId: 'group-1',
      model: 'codex',
      workspacePath: missingRoot,
    });
    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces'
        ? [{ id: 'workspace-1', userId: 'user-1', agentGroupIds: ['group-1'] }]
        : [],
    );
    mocks.hasConnectedRemoteAgentRunner.mockReturnValue(true);
    mocks.hasAvailableRemoteAgentRunner.mockReturnValue(true);
    mocks.getAvailableRemoteAgentRunnerCapabilities.mockReturnValue({
      workspaceRoot: '/runner/workspaces',
      supportedProviders: ['codex'],
      agentInventory: runnerAgentInventory('/runner/workspaces'),
      policy: { workspaceRootRequired: true },
    });
    mocks.getAvailableRemoteAgentRunnerSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: {
        workspaceRoot: '/runner/workspaces',
        supportedProviders: ['codex'],
        agentInventory: runnerAgentInventory('/runner/workspaces'),
        policy: { workspaceRootRequired: true },
      },
    });

    expect(
      __agentChatTestUtils.buildNoRepositoryRunnerWorkspace({
        agentId: 'agent-1',
        agent: { id: 'agent-1', workspacePath: missingRoot },
        workspaceRoot: '/runner/workspaces',
      }),
    ).toMatchObject({
      workDir: '/runner/workspaces/.openwork/no-repository-agents/agent-1/workspace',
    });
    await expect(
      enqueueAgentPrompt('agent-1', 'conversation-1', 'hello', {
        queuedMessageId: 'message-1',
      }),
    ).resolves.toMatchObject({
      queueItem: { agentId: 'agent-1', status: 'queued' },
    });
    expect(mocks.dispatchRunnerFilesystemRequest).not.toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ action: 'prepare_workspace' }),
      }),
    );
  });

  it('allows verified repository cwd outside the advertised runner root before enqueueing', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-preflight-outside-'));
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside);
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      groupId: 'group-1',
      model: 'codex',
      repositoryRoot: outside,
      repositoryRootOrigin: 'runner_local',
      repositoryRootRunnerId: 'runner-1',
      repositoryRootVerifiedAt: '2026-05-23T10:00:00.000Z',
      repositoryRootRepairRequired: false,
    });
    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces'
        ? [{ id: 'workspace-1', userId: 'user-1', agentGroupIds: ['group-1'] }]
        : [],
    );
    mocks.hasConnectedRemoteAgentRunner.mockReturnValue(true);
    mocks.hasAvailableRemoteAgentRunner.mockReturnValue(true);
    mocks.getAvailableRemoteAgentRunnerCapabilities.mockReturnValue({
      workspaceRoot: path.join(tmp, 'runner-root'),
      supportedProviders: ['codex'],
      policy: { workspaceRootRequired: true },
    });
    mocks.getAvailableRemoteAgentRunnerSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: {
        workspaceRoot: path.join(tmp, 'runner-root'),
        supportedProviders: ['codex'],
        policy: { workspaceRootRequired: true },
      },
    });

    await expect(
      enqueueAgentPrompt('agent-1', 'conversation-1', 'hello', {
        queuedMessageId: 'message-1',
      })
    ).resolves.toMatchObject({
      queueItem: { agentId: 'agent-1', status: 'queued' },
    });
  });

  it('allows verified repository cwd outside the advertised runner root even when the backend can see both paths', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-preflight-outside-detail-'));
    const runnerRoot = path.join(tmp, 'runner-root');
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(runnerRoot);
    fs.mkdirSync(outside);
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      groupId: 'group-1',
      model: 'codex',
      repositoryRoot: outside,
      repositoryRootOrigin: 'runner_local',
      repositoryRootRunnerId: 'runner-1',
      repositoryRootVerifiedAt: '2026-05-23T10:00:00.000Z',
      repositoryRootRepairRequired: false,
    });
    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces'
        ? [{ id: 'workspace-1', userId: 'user-1', agentGroupIds: ['group-1'] }]
        : [],
    );
    mocks.hasConnectedRemoteAgentRunner.mockReturnValue(true);
    mocks.hasAvailableRemoteAgentRunner.mockReturnValue(true);
    mocks.getAvailableRemoteAgentRunnerCapabilities.mockReturnValue({
      workspaceRoot: runnerRoot,
      supportedProviders: ['codex'],
      policy: { workspaceRootRequired: true },
    });
    mocks.getAvailableRemoteAgentRunnerSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: {
        workspaceRoot: runnerRoot,
        supportedProviders: ['codex'],
        policy: { workspaceRootRequired: true },
      },
    });

    await expect(
      enqueueAgentPrompt('agent-1', 'conversation-1', 'hello', {
        queuedMessageId: 'message-1',
      }),
    ).resolves.toMatchObject({
      queueItem: { agentId: 'agent-1', status: 'queued' },
    });
  });

  it('allows verified repository subfolder conversation cwd outside the advertised runner root before enqueueing', async () => {
    const conversationId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const runnerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-preflight-conv-root-'));
    const outsideRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-preflight-conv-outside-'));
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      groupId: 'group-1',
      model: 'codex',
      name: 'Test Agent',
      repositoryRoot: outsideRepo,
      repositoryRootOrigin: 'runner_local',
      repositoryRootRunnerId: 'runner-1',
      repositoryRootVerifiedAt: '2026-05-23T10:00:00.000Z',
      repositoryRootRepairRequired: false,
      separateFolderPerChat: true,
    });
    mocks.store.getById.mockImplementation((collection: string, id: string) => {
      if (collection === 'conversations' && id === conversationId) {
        return {
          id,
          metadata: JSON.stringify({
            agentId: 'agent-1',
            workspaceMode: 'subfolder',
            workspaceRelativePath: `conversations/${conversationId}`,
          }),
        };
      }
      return null;
    });
    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces'
        ? [{ id: 'workspace-1', userId: 'user-1', agentGroupIds: ['group-1'] }]
        : [],
    );
    mocks.hasConnectedRemoteAgentRunner.mockReturnValue(true);
    mocks.hasAvailableRemoteAgentRunner.mockReturnValue(true);
    mocks.getAvailableRemoteAgentRunnerCapabilities.mockReturnValue({
      workspaceRoot: runnerRoot,
      supportedProviders: ['codex'],
      policy: { workspaceRootRequired: true },
    });
    mocks.getAvailableRemoteAgentRunnerSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: {
        workspaceRoot: runnerRoot,
        supportedProviders: ['codex'],
        policy: { workspaceRootRequired: true },
      },
    });

    await expect(
      enqueueAgentPrompt('agent-1', conversationId, 'hello', {
        queuedMessageId: 'message-1',
      })
    ).resolves.toMatchObject({
      queueItem: { agentId: 'agent-1', status: 'queued' },
    });
  });

  it('does not use backend filesystem visibility to reject a verified repository path', async () => {
    const runnerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-preflight-root-'));
    const missingWorkspace = path.join(runnerRoot, 'missing-workspace');
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      groupId: 'group-1',
      model: 'codex',
      repositoryRoot: missingWorkspace,
      repositoryRootOrigin: 'runner_local',
      repositoryRootRunnerId: 'runner-1',
      repositoryRootVerifiedAt: '2026-05-23T10:00:00.000Z',
      repositoryRootRepairRequired: false,
    });
    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces'
        ? [{ id: 'workspace-1', userId: 'user-1', agentGroupIds: ['group-1'] }]
        : [],
    );
    mocks.hasConnectedRemoteAgentRunner.mockReturnValue(true);
    mocks.hasAvailableRemoteAgentRunner.mockReturnValue(true);
    mocks.getAvailableRemoteAgentRunnerCapabilities.mockReturnValue({
      workspaceRoot: runnerRoot,
      supportedProviders: ['codex'],
      policy: { workspaceRootRequired: true },
    });
    mocks.getAvailableRemoteAgentRunnerSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: {
        workspaceRoot: runnerRoot,
        supportedProviders: ['codex'],
        policy: { workspaceRootRequired: true },
      },
    });

    await expect(
      enqueueAgentPrompt('agent-1', 'conversation-1', 'hello', {
        queuedMessageId: 'message-1',
      })
    ).resolves.toMatchObject({
      queueItem: { agentId: 'agent-1', status: 'queued' },
    });
  });

  it('does not require repository-backed runners to advertise a workspace root', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-preflight-good-'));
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      groupId: 'group-1',
      model: 'codex',
      repositoryRoot: tmp,
      repositoryRootOrigin: 'runner_local',
      repositoryRootRunnerId: 'runner-1',
      repositoryRootVerifiedAt: '2026-05-23T10:00:00.000Z',
      repositoryRootRepairRequired: false,
    });
    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces'
        ? [{ id: 'workspace-1', userId: 'user-1', agentGroupIds: ['group-1'] }]
        : [],
    );
    mocks.hasConnectedRemoteAgentRunner.mockReturnValue(true);
    mocks.hasAvailableRemoteAgentRunner.mockReturnValue(true);
    mocks.getAvailableRemoteAgentRunnerCapabilities.mockReturnValue({
      supportedProviders: ['codex'],
      policy: { workspaceRootRequired: true },
    });
    mocks.getAvailableRemoteAgentRunnerSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: {
        supportedProviders: ['codex'],
        policy: { workspaceRootRequired: true },
      },
    });

    await expect(
      enqueueAgentPrompt('agent-1', 'conversation-1', 'hello', {
        queuedMessageId: 'message-1',
      })
    ).resolves.toMatchObject({
      queueItem: { agentId: 'agent-1', status: 'queued' },
    });
  });

  it('queues a known-good local runner workspace path', async () => {
    const runnerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-preflight-local-'));
    const repo = path.join(runnerRoot, 'repo');
    fs.mkdirSync(repo);
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      groupId: 'group-1',
      model: 'codex',
      repositoryRoot: repo,
      repositoryRootOrigin: 'runner_local',
      repositoryRootRunnerId: 'runner-1',
      repositoryRootVerifiedAt: '2026-05-23T10:00:00.000Z',
      repositoryRootRepairRequired: false,
    });
    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces'
        ? [{ id: 'workspace-1', userId: 'user-1', agentGroupIds: ['group-1'] }]
        : [],
    );
    mocks.hasConnectedRemoteAgentRunner.mockReturnValue(true);
    mocks.hasAvailableRemoteAgentRunner.mockReturnValue(true);
    mocks.getAvailableRemoteAgentRunnerCapabilities.mockReturnValue({
      workspaceRoot: runnerRoot,
      supportedProviders: ['codex'],
      policy: { workspaceRootRequired: true },
    });
    mocks.getAvailableRemoteAgentRunnerSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: {
        workspaceRoot: runnerRoot,
        supportedProviders: ['codex'],
        policy: { workspaceRootRequired: true },
      },
    });

    const result = await enqueueAgentPrompt('agent-1', 'conversation-1', 'hello', {
      queuedMessageId: 'message-1',
    });

    expect(result.queueItem).toMatchObject({ agentId: 'agent-1', status: 'queued' });
    expect(mocks.store.insert).toHaveBeenCalledWith(
      'agentChatQueue',
      expect.objectContaining({ agentId: 'agent-1', conversationId: 'conversation-1' }),
    );
  });

  it('rejects repository roots verified on a different runner before queueing', async () => {
    const runnerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-preflight-runner-mismatch-'));
    const repo = path.join(runnerRoot, 'repo');
    fs.mkdirSync(repo);
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      groupId: 'group-1',
      model: 'codex',
      repositoryRoot: repo,
      repositoryRootOrigin: 'runner_local',
      repositoryRootRunnerId: 'runner-verified',
      repositoryRootVerifiedAt: '2026-05-23T10:00:00.000Z',
      repositoryRootRepairRequired: false,
    });
    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces'
        ? [{ id: 'workspace-1', userId: 'user-1', agentGroupIds: ['group-1'] }]
        : [],
    );
    mocks.hasConnectedRemoteAgentRunner.mockReturnValue(true);
    mocks.hasAvailableRemoteAgentRunner.mockReturnValue(true);
    mocks.getAvailableRemoteAgentRunnerSelection.mockReturnValue({
      runnerId: 'runner-selected',
      capabilities: {
        workspaceRoot: runnerRoot,
        supportedProviders: ['codex'],
        policy: { workspaceRootRequired: true },
      },
    });

    await expect(
      enqueueAgentPrompt('agent-1', 'conversation-1', 'hello', {
        queuedMessageId: 'message-1',
      })
    ).rejects.toThrow(/different runner/i);
    expect(mocks.store.insert).not.toHaveBeenCalledWith(
      'agentChatQueue',
      expect.anything(),
    );
  });

  it('rejects unverified repository roots before queueing in hosted mode', async () => {
    const runnerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-preflight-unverified-'));
    const repo = path.join(runnerRoot, 'repo');
    fs.mkdirSync(repo);
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      groupId: 'group-1',
      model: 'codex',
      repositoryRoot: repo,
      repositoryRootOrigin: 'unknown',
      repositoryRootRepairRequired: true,
    });
    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces'
        ? [{ id: 'workspace-1', userId: 'user-1', agentGroupIds: ['group-1'] }]
        : [],
    );
    mocks.hasConnectedRemoteAgentRunner.mockReturnValue(true);
    mocks.hasAvailableRemoteAgentRunner.mockReturnValue(true);
    mocks.getAvailableRemoteAgentRunnerCapabilities.mockReturnValue({
      workspaceRoot: runnerRoot,
      supportedProviders: ['codex'],
      policy: { workspaceRootRequired: true },
    });
    mocks.getAvailableRemoteAgentRunnerSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: {
        workspaceRoot: runnerRoot,
        supportedProviders: ['codex'],
        policy: { workspaceRootRequired: true },
      },
    });

    await expect(
      enqueueAgentPrompt('agent-1', 'conversation-1', 'hello', {
        queuedMessageId: 'message-1',
      })
    ).rejects.toThrow(/verified on the selected runner/i);
    expect(mocks.store.insert).not.toHaveBeenCalledWith(
      'agentChatQueue',
      expect.anything(),
    );
  });

  it('rejects backend-local legacy repository roots and workspace paths as executable in hosted mode', async () => {
    const legacyRepo = path.resolve(env.DATA_DIR, 'agents', 'agent-1', 'repo');
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      groupId: 'group-1',
      model: 'codex',
      repositoryRoot: legacyRepo,
      repositoryRootOrigin: 'backend_local_legacy',
      repositoryRootRepairRequired: false,
      workspacePath: path.join(legacyRepo, '.openwork', 'agents', 'legacy'),
    });
    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces'
        ? [{ id: 'workspace-1', userId: 'user-1', agentGroupIds: ['group-1'] }]
        : [],
    );
    mocks.hasConnectedRemoteAgentRunner.mockReturnValue(true);
    mocks.hasAvailableRemoteAgentRunner.mockReturnValue(true);
    mocks.getAvailableRemoteAgentRunnerCapabilities.mockReturnValue({
      workspaceRoot: '/runner/workspaces',
      supportedProviders: ['codex'],
      policy: { workspaceRootRequired: true },
    });
    mocks.getAvailableRemoteAgentRunnerSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: {
        workspaceRoot: '/runner/workspaces',
        supportedProviders: ['codex'],
        policy: { workspaceRootRequired: true },
      },
    });

    await expect(
      enqueueAgentPrompt('agent-1', 'conversation-1', 'hello', {
        queuedMessageId: 'message-1',
      }),
    ).rejects.toThrow(/verified on the selected runner/i);
    expect(mocks.store.insert).not.toHaveBeenCalledWith(
      'agentChatQueue',
      expect.anything(),
    );
  });

  it('auto-verifies repository roots with the selected runner before queueing', async () => {
    const runnerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-preflight-autoverify-'));
    const repo = path.join(runnerRoot, 'repo');
    fs.mkdirSync(repo);
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      name: 'Repo Agent',
      groupId: 'group-1',
      model: 'codex',
      repositoryRoot: repo,
      repositoryRootOrigin: 'unknown',
      repositoryRootRepairRequired: true,
    });
    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces'
        ? [{ id: 'workspace-1', userId: 'user-1', agentGroupIds: ['group-1'] }]
        : [],
    );
    mocks.hasConnectedRemoteAgentRunner.mockReturnValue(true);
    mocks.hasAvailableRemoteAgentRunner.mockReturnValue(true);
    mocks.getAvailableRemoteAgentRunnerCapabilities.mockReturnValue({
      workspaceRoot: runnerRoot,
      supportedProviders: ['codex'],
      policy: { workspaceRootRequired: true },
    });
    mocks.getAvailableRemoteAgentRunnerSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: {
        workspaceRoot: runnerRoot,
        supportedProviders: ['codex'],
        policy: { workspaceRootRequired: true },
      },
    });
    mocks.dispatchRunnerFilesystemRequest.mockResolvedValue({
      runnerId: 'runner-1',
      result: {
        action: 'validate_repository_root',
        path: repo,
        repositoryRootOrigin: 'runner_local',
        repositoryRootVerifiedAt: '2026-05-23T12:00:00.000Z',
      },
    });

    const result = await enqueueAgentPrompt('agent-1', 'conversation-1', 'hello', {
      queuedMessageId: 'message-1',
    });

    expect(result.queueItem).toMatchObject({ agentId: 'agent-1', status: 'queued' });
    expect(mocks.dispatchRunnerFilesystemRequest).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      runnerId: 'runner-1',
      request: { action: 'validate_repository_root', path: repo },
    });
    expect(mocks.store.update).toHaveBeenCalledWith(
      'agents',
      'agent-1',
      expect.objectContaining({
        repositoryRootOrigin: 'runner_local',
        repositoryRootRunnerId: 'runner-1',
        repositoryRootRepairRequired: false,
      }),
    );
  });

  it('allows explicit same-host local-dev legacy repository roots', async () => {
    const runnerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-preflight-localdev-'));
    const repo = path.join(runnerRoot, 'repo');
    fs.mkdirSync(repo);
    env.OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM = true;
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      groupId: 'group-1',
      model: 'codex',
      repositoryRoot: repo,
      repositoryRootOrigin: 'backend_local_legacy',
      repositoryRootRepairRequired: false,
    });
    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces'
        ? [{ id: 'workspace-1', userId: 'user-1', agentGroupIds: ['group-1'] }]
        : [],
    );
    mocks.hasConnectedRemoteAgentRunner.mockReturnValue(true);
    mocks.hasAvailableRemoteAgentRunner.mockReturnValue(true);
    mocks.getAvailableRemoteAgentRunnerCapabilities.mockReturnValue({
      workspaceRoot: runnerRoot,
      supportedProviders: ['codex'],
      policy: { workspaceRootRequired: true },
    });
    mocks.getAvailableRemoteAgentRunnerSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: {
        workspaceRoot: runnerRoot,
        supportedProviders: ['codex'],
        policy: { workspaceRootRequired: true },
      },
    });

    const result = await enqueueAgentPrompt('agent-1', 'conversation-1', 'hello', {
      queuedMessageId: 'message-1',
    });

    expect(result.queueItem).toMatchObject({ agentId: 'agent-1', status: 'queued' });
    expect(mocks.store.insert).toHaveBeenCalledWith(
      'agentChatQueue',
      expect.objectContaining({ agentId: 'agent-1', conversationId: 'conversation-1' }),
    );
  });

  it('reconciles migrated unknown repository roots in same-host local development', async () => {
    const runnerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-preflight-localdev-unknown-'));
    const repo = path.join(runnerRoot, 'repo');
    fs.mkdirSync(repo);
    env.OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM = true;
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      name: 'Repo Agent',
      groupId: 'group-1',
      model: 'codex',
      repositoryRoot: repo,
      repositoryRootOrigin: 'unknown',
      repositoryRootRepairRequired: true,
    });
    mocks.store.getAll.mockImplementation((collection: string) =>
      collection === 'workspaces'
        ? [{ id: 'workspace-1', userId: 'user-1', agentGroupIds: ['group-1'] }]
        : [],
    );
    mocks.hasConnectedRemoteAgentRunner.mockReturnValue(true);
    mocks.hasAvailableRemoteAgentRunner.mockReturnValue(true);
    mocks.getAvailableRemoteAgentRunnerCapabilities.mockReturnValue({
      workspaceRoot: runnerRoot,
      supportedProviders: ['codex'],
      policy: { workspaceRootRequired: true },
    });
    mocks.getAvailableRemoteAgentRunnerSelection.mockReturnValue({
      runnerId: 'runner-1',
      capabilities: {
        workspaceRoot: runnerRoot,
        supportedProviders: ['codex'],
        policy: { workspaceRootRequired: true },
      },
    });

    const result = await enqueueAgentPrompt('agent-1', 'conversation-1', 'hello', {
      queuedMessageId: 'message-1',
    });

    expect(result.queueItem).toMatchObject({ agentId: 'agent-1', status: 'queued' });
    expect(mocks.dispatchRunnerFilesystemRequest).not.toHaveBeenCalled();
    expect(mocks.store.update).toHaveBeenCalledWith(
      'agents',
      'agent-1',
      expect.objectContaining({
        repositoryRootOrigin: 'backend_local_legacy',
        repositoryRootRunnerId: 'runner-1',
        repositoryRootRepairRequired: false,
      }),
    );
  });
});

describe('agent chat fallback retry guard', () => {
  beforeEach(() => {
    mocks.store.getById.mockReset();
  });

  it('does not retry with fallback after a user-stopped run', () => {
    mocks.store.getById.mockReturnValue({
      id: 'run-1',
      killedByUser: true,
      errorMessage: 'Killed by user',
    });

    expect(
      __agentChatTestUtils.shouldAttemptFallbackRetry({
        runId: 'run-1',
        errorMessage: 'Remote runner cancelled the job',
        isFallback: false,
        hasFallback: true,
      }),
    ).toBe(false);
  });

  it('allows fallback for ordinary primary-run failures', () => {
    mocks.store.getById.mockReturnValue({
      id: 'run-1',
      killedByUser: false,
      errorMessage: 'Remote runner exited with code 1',
    });

    expect(
      __agentChatTestUtils.shouldAttemptFallbackRetry({
        runId: 'run-1',
        errorMessage: 'Remote runner exited with code 1',
        isFallback: false,
        hasFallback: true,
      }),
    ).toBe(true);
  });
});

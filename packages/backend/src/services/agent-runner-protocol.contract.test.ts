import Fastify, { type FastifyRequest } from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  RUNNER_PROTOCOL_VERSION,
  parseRunnerServerMessage,
  type RunnerCapabilities,
  type RunnerJobIntent,
} from 'shared';
import {
  __runnerTestUtils,
  dispatchRemoteAgentJob,
} from './agent-runners.js';
import { agentRunRoutes } from '../routes/agent-runs.js';
import { cardRoutes } from '../routes/cards.js';
import { completeAgentRun, createAgentRun, getAgentRun } from './agent-runs.js';
import { createAgentChatTurn, markAgentChatTurnRunning } from './agent-chat-turns.js';

type RecordMap = Map<string, Map<string, Record<string, unknown>>>;

const mocks = vi.hoisted(() => {
  const records: RecordMap = new Map();

  function collection(name: string) {
    let map = records.get(name);
    if (!map) {
      map = new Map();
      records.set(name, map);
    }
    return map;
  }

  const store = {
    reset() {
      records.clear();
    },
    getAll(name: string) {
      return [...collection(name).values()];
    },
    getById(name: string, id: string) {
      return collection(name).get(id) ?? null;
    },
    insert(name: string, data: Record<string, unknown>) {
      const now = new Date().toISOString();
      const generatedId = `00000000-0000-4000-8000-${String(collection(name).size + 1).padStart(12, '0')}`;
      const record = {
        ...data,
        id: typeof data.id === 'string' ? data.id : generatedId,
        createdAt: typeof data.createdAt === 'string' ? data.createdAt : now,
        updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : now,
      };
      collection(name).set(String(record.id), record);
      return record;
    },
    update(name: string, id: string, data: Record<string, unknown>) {
      const existing = collection(name).get(id);
      if (!existing) return null;
      const record = { ...existing, ...data, id, updatedAt: new Date().toISOString() };
      collection(name).set(id, record);
      return record;
    },
    async transaction<T>(operation: () => T | Promise<T>) {
      return operation();
    },
    async lockAgentChatQueueConversation() {},
    async lockAgentRunRowForUpdate() {},
    async reload() {},
    async flush() {},
  };

  return { store };
});

vi.mock('../db/index.js', () => ({ store: mocks.store }));
vi.mock('../db/connection.js', () => ({ store: mocks.store }));

function makeOpenSocket() {
  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
  } as unknown as WebSocket & { send: ReturnType<typeof vi.fn> };
}

function addRunner(runnerId: string, ws = makeOpenSocket(), caps?: Partial<RunnerCapabilities>) {
  const now = new Date().toISOString();
  const capabilities: RunnerCapabilities = {
    protocolVersion: RUNNER_PROTOCOL_VERSION,
    os: 'test',
    arch: 'test',
    runnerVersion: 'test',
    supportedProviders: ['codex'],
    supportsCancellation: true,
    supportsArtifacts: true,
    agentInventory: {
      protocolVersion: 1,
      revision: 'contract-inventory',
      advertisedAt: now,
      ttlMs: 120_000,
      workspaceRoots: [{ id: 'default', path: '/runner/root', scope: 'workspace', writable: true }],
      fileOperations: ['browse', 'list_agent_files'],
      agents: [],
    },
    policy: {
      workspaceRootRequired: false,
      allowedTools: ['codex'],
      approvalModes: ['dangerous'],
      envAccess: true,
      secretAccess: true,
      network: true,
      shell: true,
    },
    ...caps,
  };
  const runner = {
    id: runnerId,
    userId: 'user-contract',
    workspaceId: 'ws-contract',
    connectionScope: 'account' as const,
    ownerAccountId: 'user-contract',
    boundWorkspaceId: 'ws-contract',
    name: 'contract-runner',
    ws,
    capabilities,
    connectedAt: now,
    lastSeenAt: now,
    activeJobIds: new Set<string>(),
  };
  __runnerTestUtils.runners.set(runnerId, runner);
  return runner;
}

function readOfferedJobId(ws: WebSocket & { send: ReturnType<typeof vi.fn> }): string {
  const raw = ws.send.mock.calls[0]?.[0];
  expect(typeof raw).toBe('string');
  const payload = JSON.parse(raw as string) as { jobId: string };
  return payload.jobId;
}

async function buildContractApi() {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(sensible);
  app.decorate('authenticate', async (request: FastifyRequest) => {
    request.user = { sub: 'user-contract' };
  });
  await app.register(agentRunRoutes);
  await app.register(cardRoutes);
  return app;
}

afterEach(() => {
  __runnerTestUtils.runners.clear();
  __runnerTestUtils.jobsById.clear();
  __runnerTestUtils.jobRunnerById.clear();
  __runnerTestUtils.jobIdByRunId.clear();
});

describe('runner protocol → agent_runs + card comment contract', () => {
  it('dispatches a prepared job to the same selected runner id', () => {
    mocks.store.reset();
    const preferredWs = makeOpenSocket();
    const otherWs = makeOpenSocket();
    addRunner('runner-prepared', preferredWs);
    addRunner('runner-other', otherWs);

    void dispatchRemoteAgentJob({
      userId: 'user-contract',
      workspaceId: 'ws-contract',
      runnerId: 'runner-prepared',
      timeoutMs: 0,
      intent: {
        runId: 'run-prepared-runner',
        agentId: 'agent-prepared-runner',
        provider: 'codex',
        modelPreference: { displayName: 'Codex' },
        prompt: 'hi',
        workspace: { type: 'local_path', path: '/runner/root/.openwork/no-repository-agents/agent-prepared-runner/workspace', workspaceId: 'ws-contract' },
        allowedOperations: {
          tools: ['codex'],
          approvalMode: 'dangerous',
          env: true,
          secrets: true,
          network: true,
          shell: true,
        },
      },
    });

    expect(preferredWs.send).toHaveBeenCalledTimes(1);
    expect(otherWs.send).not.toHaveBeenCalled();
    const raw = preferredWs.send.mock.calls[0]?.[0];
    expect(typeof raw).toBe('string');
    const offered = JSON.parse(raw as string);
    expect(offered).toMatchObject({
      type: 'job_offer',
      job: { runId: 'run-prepared-runner' },
    });
  });

  it('does not let an older failed run overwrite a turn already linked to a newer run', async () => {
    mocks.store.reset();
    createAgentChatTurn({
      id: 'turn-stale-run',
      agentId: 'agent-stale-run',
      conversationId: 'conversation-stale-run',
      userMessageId: 'message-stale-run',
      assistantMessageId: 'assistant-newer-run',
      status: 'completed',
      runId: 'run-newer-success',
      metadata: { mode: 'respond_to_message' },
      completedAt: '2026-05-23T15:43:30.000Z',
    });
    createAgentRun({
      id: 'run-older-failed',
      agentId: 'agent-stale-run',
      agentName: 'contract agent',
      model: 'codex',
      triggerType: 'chat',
      conversationId: 'conversation-stale-run',
      responseParentId: 'message-stale-run',
      turnId: 'turn-stale-run',
      executor: 'remote',
      status: 'running',
    } as Parameters<typeof createAgentRun>[0]);

    await completeAgentRun('run-older-failed', 'invalid_job: Workspace path does not exist', {
      stdout: '',
      stderr: 'invalid_job: Workspace path does not exist',
    });

    expect(mocks.store.getById('agent_runs', 'run-older-failed')).toMatchObject({
      status: 'error',
    });
    expect(mocks.store.getById('agentChatTurns', 'turn-stale-run')).toMatchObject({
      status: 'completed',
      runId: 'run-newer-success',
      assistantMessageId: 'assistant-newer-run',
      metadata: { mode: 'respond_to_message' },
    });
  });

  it('clears stale terminal turn errors when a retry starts a newer run', () => {
    mocks.store.reset();
    createAgentChatTurn({
      id: 'turn-retry-after-error',
      agentId: 'agent-retry',
      conversationId: 'conversation-retry',
      userMessageId: 'message-retry',
      status: 'failed',
      runId: 'run-older-failed',
      metadata: {
        mode: 'append_prompt',
        queuedMessageId: 'message-retry',
        errorMessage: 'invalid_job: Workspace path does not exist: /backend/.openwork/workspace',
      },
      completedAt: '2026-05-23T15:58:43.000Z',
    });

    markAgentChatTurnRunning('turn-retry-after-error', {
      runId: 'run-newer-running',
      userMessageId: 'message-retry',
    });

    expect(mocks.store.getById('agentChatTurns', 'turn-retry-after-error')).toMatchObject({
      status: 'running',
      runId: 'run-newer-running',
      userMessageId: 'message-retry',
      completedAt: null,
      metadata: {
        mode: 'append_prompt',
        queuedMessageId: 'message-retry',
      },
    });
  });

  it('buffers output_event + final_message before completed, merges for persistence, and exposes API-shaped evidence', async () => {
    mocks.store.reset();
    const ids = {
      agent: 'qa-contract-agent',
      collection: 'qa-contract-collection',
      card: '00000000-0000-4000-8000-00000000aa01',
      run: 'qa-contract-run-happy',
    };
    mocks.store.insert('agents', {
      id: ids.agent,
      name: 'contract agent',
      model: 'codex',
      modelId: 'gpt-test',
      status: 'active',
    });
    mocks.store.insert('collections', {
      id: ids.collection,
      name: 'contract collection',
    });
    mocks.store.insert('cards', {
      id: ids.card,
      collectionId: ids.collection,
      name: 'contract card',
      description: '',
    });

    createAgentRun({
      id: ids.run,
      agentId: ids.agent,
      agentName: 'contract agent',
      model: 'codex',
      modelId: 'gpt-test',
      triggerType: 'card_assignment',
      cardId: ids.card,
      executor: 'remote',
      status: 'running',
    } as Parameters<typeof createAgentRun>[0]);

    const ws = makeOpenSocket();
    const runner = addRunner('runner-contract-1', ws);
    const finalAnswer = [
      'QA_RUNNER_PROTOCOL_CONTRACT_OK',
      '',
      'Verification commands/API checks used:',
      '- pnpm --filter backend test -- src/services/agent-runner-protocol.contract.test.ts',
      `- GET /api/agent-runs/${ids.run}`,
      `- GET /api/cards/${ids.card}/comments`,
    ].join('\n');

    const jobPromise = dispatchRemoteAgentJob({
      userId: 'user-contract',
      workspaceId: 'ws-contract',
      intent: {
        runId: ids.run,
        agentId: ids.agent,
        provider: 'codex',
        modelPreference: { displayName: 'Codex' },
        prompt: 'hi',
        workspace: { type: 'local_path', path: '/tmp', workspaceId: 'ws-contract' },
        allowedOperations: {
          tools: ['codex'],
          approvalMode: 'dangerous',
          env: true,
          secrets: true,
          network: true,
          shell: true,
        },
      },
    });

    const jobId = readOfferedJobId(ws);
    __runnerTestUtils.handleRunnerMessage(runner, {
      type: 'job_accepted',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId,
      runId: ids.run,
    });
    __runnerTestUtils.handleRunnerMessage(runner, {
      type: 'output_event',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId,
      runId: ids.run,
      stream: 'stdout',
      text: `${JSON.stringify({ type: 'turn.completed' })}\n`,
    });
    __runnerTestUtils.handleRunnerMessage(runner, {
      type: 'final_message',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId,
      runId: ids.run,
      text: finalAnswer,
    });
    __runnerTestUtils.handleRunnerMessage(runner, {
      type: 'completed',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId,
      runId: ids.run,
      code: 0,
      stdout: JSON.stringify({ type: 'turn.started' }),
      stderr: '',
    });

    const remote = await jobPromise;
    expect(remote.stdout).toContain('openwork_final_message');
    expect(remote.stdout).toContain('turn.completed');

    await completeAgentRun(ids.run, null, { stdout: remote.stdout, stderr: remote.stderr });
    const run = getAgentRun(ids.run) as Record<string, unknown> | null;
    expect(run).toMatchObject({
      id: ids.run,
      status: 'completed',
      triggerType: 'card_assignment',
      agentId: ids.agent,
      cardId: ids.card,
      responseText: finalAnswer,
    });

    const comment = mocks.store
      .getAll('cardComments')
      .find((c: Record<string, unknown>) => c.agentRunId === ids.run && c.cardId === ids.card);
    expect(comment).toMatchObject({ authorId: ids.agent, agentRunId: ids.run });
    expect(String(comment?.content ?? '')).toContain(finalAnswer);
    expect(String(comment?.content ?? '')).toContain(`Run: ${ids.run}`);
    expect(String(comment?.content ?? '')).toContain('Status: completed');
    expect(String(comment?.content ?? '')).toContain(`GET /api/agent-runs/${ids.run}`);

    const app = await buildContractApi();
    try {
      const runRes = await app.inject({ method: 'GET', url: `/api/agent-runs/${ids.run}` });
      expect(runRes.statusCode).toBe(200);
      expect(runRes.json()).toMatchObject({
        id: ids.run,
        triggerType: 'card_assignment',
        agentId: ids.agent,
        cardId: ids.card,
        status: 'completed',
      });
      const commentsRes = await app.inject({ method: 'GET', url: `/api/cards/${ids.card}/comments` });
      expect(commentsRes.statusCode).toBe(200);
      const apiComment = commentsRes
        .json()
        .entries.find((e: Record<string, unknown>) => e.agentRunId === ids.run);
      expect(apiComment?.content).toContain(finalAnswer);
    } finally {
      await app.close();
    }
  });

  it('negative: omits final_message so completion lacks extractable final answer and card run becomes error with evidence', async () => {
    mocks.store.reset();
    const ids = {
      agent: 'qa-contract-agent-neg',
      collection: 'qa-contract-collection-neg',
      card: '00000000-0000-4000-8000-00000000aa02',
      run: 'qa-contract-run-no-final',
    };
    mocks.store.insert('agents', {
      id: ids.agent,
      name: 'contract agent neg',
      model: 'codex',
      modelId: 'gpt-test',
      status: 'active',
    });
    mocks.store.insert('collections', {
      id: ids.collection,
      name: 'contract collection neg',
    });
    mocks.store.insert('cards', {
      id: ids.card,
      collectionId: ids.collection,
      name: 'contract card neg',
      description: '',
    });
    createAgentRun({
      id: ids.run,
      agentId: ids.agent,
      agentName: 'contract agent neg',
      model: 'codex',
      modelId: 'gpt-test',
      triggerType: 'card_assignment',
      cardId: ids.card,
      executor: 'remote',
      status: 'running',
    } as Parameters<typeof createAgentRun>[0]);

    const ws = makeOpenSocket();
    const runner = addRunner('runner-contract-neg', ws);
    const jobPromise = dispatchRemoteAgentJob({
      userId: 'user-contract',
      workspaceId: 'ws-contract',
      intent: {
        runId: ids.run,
        agentId: ids.agent,
        provider: 'codex',
        modelPreference: { displayName: 'Codex' },
        prompt: 'hi',
        workspace: { type: 'local_path', path: '/tmp', workspaceId: 'ws-contract' },
        allowedOperations: {
          tools: ['codex'],
          approvalMode: 'dangerous',
          env: true,
          secrets: true,
          network: true,
          shell: true,
        },
      },
    });
    const jobId = readOfferedJobId(ws);
    __runnerTestUtils.handleRunnerMessage(runner, {
      type: 'output_event',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId,
      runId: ids.run,
      stream: 'stdout',
      text: `${JSON.stringify({ type: 'turn.completed' })}\n`,
    });
    __runnerTestUtils.handleRunnerMessage(runner, {
      type: 'completed',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId,
      runId: ids.run,
      code: 0,
      stdout: '',
      stderr: '',
    });
    const remote = await jobPromise;
    await completeAgentRun(ids.run, null, { stdout: remote.stdout, stderr: remote.stderr });
    const run = getAgentRun(ids.run) as Record<string, unknown> | null;
    expect(run?.status).toBe('error');
    expect(String(run?.errorMessage ?? '')).toMatch(/Agent run completed without a final response/i);
    const comment = mocks.store
      .getAll('cardComments')
      .find((c: Record<string, unknown>) => c.agentRunId === ids.run);
    expect(comment).toBeTruthy();
    expect(String(comment?.content ?? '')).toMatch(/Agent run completed without a final response/i);
  });

  it('keeps a Codex chat run completed when transient error events precede terminal success', async () => {
    mocks.store.reset();
    const ids = {
      agent: 'qa-contract-agent-transient-error',
      conversation: 'qa-contract-conversation-transient-error',
      turn: 'qa-contract-turn-transient-error',
      run: 'qa-contract-run-transient-error',
    };
    mocks.store.insert('agents', {
      id: ids.agent,
      name: 'contract transient agent',
      model: 'codex',
      modelId: 'gpt-test',
      status: 'active',
    });
    mocks.store.insert('conversations', {
      id: ids.conversation,
      agentId: ids.agent,
      title: 'transient error completion',
    });
    createAgentChatTurn({
      id: ids.turn,
      agentId: ids.agent,
      conversationId: ids.conversation,
      status: 'running',
      runId: ids.run,
      turnType: 'follow_up',
    });
    createAgentRun({
      id: ids.run,
      agentId: ids.agent,
      agentName: 'contract transient agent',
      model: 'codex',
      modelId: 'gpt-test',
      triggerType: 'chat',
      conversationId: ids.conversation,
      executor: 'remote',
      status: 'running',
      turnId: ids.turn,
    });

    const stdout = [
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({
        type: 'error',
        message: 'Reconnecting... 4/5 (unexpected status 403 Forbidden)',
      }),
      JSON.stringify({ type: 'turn.completed' }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: `openwork-final-message-${ids.run}`,
          type: 'openwork_final_message',
          text: 'Recovered final answer',
        },
      }),
    ].join('\n');

    await completeAgentRun(ids.run, null, { stdout, stderr: 'provider transport warning' });

    expect(getAgentRun(ids.run)).toMatchObject({
      id: ids.run,
      status: 'completed',
      errorMessage: null,
      responseText: 'Recovered final answer',
    });
    expect(mocks.store.getById('agentChatTurns', ids.turn)).toMatchObject({
      id: ids.turn,
      status: 'completed',
      runId: ids.run,
    });
  });

  it('rejects dispatch before spawn when runner lacks provider support (no job_offer sent)', async () => {
    mocks.store.reset();
    const ws = makeOpenSocket();
    addRunner('runner-claude-only', ws, { supportedProviders: ['claude'] });
    await expect(
      dispatchRemoteAgentJob({
        userId: 'user-contract',
        workspaceId: 'ws-contract',
        intent: {
          runId: 'run-x',
        agentId: 'agent-1',
        provider: 'codex',
          modelPreference: { displayName: 'Codex' },
          prompt: 'hi',
          workspace: { type: 'local_path', path: '/tmp', workspaceId: 'ws-contract' },
          allowedOperations: {
            tools: ['codex'],
            approvalMode: 'dangerous',
            env: true,
            secrets: true,
            network: true,
            shell: true,
          },
        },
      }),
    ).rejects.toThrow(/No eligible remote agent runner supports codex/i);
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('rejects ordinary job dispatch that carries workspace materialization', async () => {
    mocks.store.reset();
    const ws = makeOpenSocket();
    addRunner('runner-contract-materialization', ws);

    await expect(
      dispatchRemoteAgentJob({
        userId: 'user-contract',
        workspaceId: 'ws-contract',
        intent: {
          runId: 'run-materialization',
        agentId: 'agent-1',
        provider: 'codex',
          modelPreference: { displayName: 'Codex' },
          prompt: 'hi',
          workspace: {
            type: 'local_path',
            path: '/tmp',
            workspaceId: 'ws-contract',
            materialization: {
              strategy: 'runner_local_agent_workspace',
              cleanup: 'managed_files',
              agentContext: {
                revision: 'rev-1',
                files: [{ path: 'AGENTS.md', content: '# Instructions\n' }],
              },
            },
          },
          allowedOperations: {
            tools: ['codex'],
            approvalMode: 'dangerous',
            env: true,
            secrets: true,
            network: true,
            shell: true,
          },
        } as RunnerJobIntent,
      }),
    ).rejects.toThrow(
      'Workspace materialization is not part of ordinary runner job execution',
    );
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('preserves native runner concurrency: busy runner can accept another independent job', async () => {
    mocks.store.reset();
    const ws = makeOpenSocket();
    const runner = addRunner('runner-concurrent', ws);

    const first = dispatchRemoteAgentJob({
      userId: 'user-contract',
      workspaceId: 'ws-contract',
      intent: {
        runId: 'run-concurrent-a',
        agentId: 'agent-1',
        provider: 'codex',
        modelPreference: { displayName: 'Codex' },
        prompt: 'first',
        workspace: { type: 'local_path', path: '/tmp', workspaceId: 'ws-contract' },
        allowedOperations: {
          tools: ['codex'],
          approvalMode: 'dangerous',
          env: true,
          secrets: true,
          network: true,
          shell: true,
        },
      },
    });
    const firstJobId = readOfferedJobId(ws);
    __runnerTestUtils.handleRunnerMessage(runner, {
      type: 'job_accepted',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId: firstJobId,
      runId: 'run-concurrent-a',
    });
    expect(runner.activeJobIds.has(firstJobId)).toBe(true);

    const second = dispatchRemoteAgentJob({
      userId: 'user-contract',
      workspaceId: 'ws-contract',
      intent: {
        runId: 'run-concurrent-b',
        agentId: 'agent-1',
        provider: 'codex',
        modelPreference: { displayName: 'Codex' },
        prompt: 'second',
        workspace: { type: 'local_path', path: '/tmp', workspaceId: 'ws-contract' },
        allowedOperations: {
          tools: ['codex'],
          approvalMode: 'dangerous',
          env: true,
          secrets: true,
          network: true,
          shell: true,
        },
      },
    });

    expect(ws.send).toHaveBeenCalledTimes(2);
    const secondRaw = ws.send.mock.calls[1]?.[0];
    expect(typeof secondRaw).toBe('string');
    const secondOffer = JSON.parse(secondRaw as string);
    expect(secondOffer).toMatchObject({
      type: 'job_offer',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      job: { runId: 'run-concurrent-b' },
    });
    const secondJobId = secondOffer.jobId as string;

    __runnerTestUtils.handleRunnerMessage(runner, {
      type: 'completed',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId: firstJobId,
      runId: 'run-concurrent-a',
      code: 0,
      stdout: '',
      stderr: '',
    });
    __runnerTestUtils.handleRunnerMessage(runner, {
      type: 'completed',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId: secondJobId,
      runId: 'run-concurrent-b',
      code: 0,
      stdout: '',
      stderr: '',
    });

    await expect(first).resolves.toMatchObject({ code: 0 });
    await expect(second).resolves.toMatchObject({ code: 0 });
  });

  it('malformed terminal JSON is ignored; job_rejected still surfaces as dispatch failure', async () => {
    mocks.store.reset();
    const ws = makeOpenSocket();
    const runner = addRunner('runner-malformed', ws);
    const p = dispatchRemoteAgentJob(
      {
        userId: 'user-contract',
        workspaceId: 'ws-contract',
        timeoutMs: 5_000,
        intent: {
          runId: 'run-malformed',
        agentId: 'agent-1',
        provider: 'codex',
          modelPreference: { displayName: 'Codex' },
          prompt: 'hi',
          workspace: { type: 'local_path', path: '/tmp', workspaceId: 'ws-contract' },
          allowedOperations: {
            tools: ['codex'],
            approvalMode: 'dangerous',
            env: true,
            secrets: true,
            network: true,
            shell: true,
          },
        },
      },
      {},
    );
    const jobId = readOfferedJobId(ws);
    __runnerTestUtils.handleRunnerMessage(runner, parseRunnerServerMessage({ not: 'a message' }));
    expect(__runnerTestUtils.jobsById.has(jobId)).toBe(true);
    __runnerTestUtils.handleRunnerMessage(runner, {
      type: 'job_rejected',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId,
      runId: 'run-malformed',
      code: 'invalid_job',
      message: 'bad payload',
    });
    await expect(p).rejects.toThrow(/invalid_job/);
  });
});

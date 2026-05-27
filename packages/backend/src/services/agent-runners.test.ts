import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  RUNNER_PROTOCOL_VERSION,
  type RunnerCapabilities,
  type RunnerServerMessage,
} from 'shared';
import {
  __runnerTestUtils,
  dispatchRunnerFilesystemRequest,
  dispatchRemoteAgentJob,
  getRunnerFilesystemAvailability,
  hasConnectedRemoteAgentRunner,
} from './agent-runners.js';

const agentRunsMocks = vi.hoisted(() => ({
  appendAgentRunLifecycleEvent: vi.fn(),
  appendAgentRunOutput: vi.fn(),
  completeAgentRun: vi.fn(),
}));

const { appendAgentRunLifecycleEvent, appendAgentRunOutput, completeAgentRun } = agentRunsMocks;

vi.mock('./agent-runs.js', () => agentRunsMocks);

vi.mock('./runner-devices.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./runner-devices.js')>();
  return {
    ...actual,
    noteRunnerConnected: vi.fn(),
    noteRunnerDisconnected: vi.fn(),
    noteRunnerSeen: vi.fn(),
  };
});

function makeOpenSocket() {
  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
  } as unknown as WebSocket & { send: ReturnType<typeof vi.fn> };
}

function addRunner(
  runnerId: string,
  ws = makeOpenSocket(),
  scope?: { userId?: string; workspaceId?: string; connectionScope?: 'account' | 'project' },
  capabilityPatch?: Partial<RunnerCapabilities>,
) {
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
      revision: 'test-inventory',
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
    ...capabilityPatch,
  };
  const userId = scope?.userId ?? 'user-1';
  const workspaceId = scope?.workspaceId ?? 'workspace-1';
  const connectionScope = scope?.connectionScope ?? 'account';
  const runner = {
    id: runnerId,
    userId,
    workspaceId,
    connectionScope,
    ownerAccountId: userId,
    boundWorkspaceId: workspaceId,
    name: 'test-runner',
    ws,
    capabilities,
    connectedAt: now,
    lastSeenAt: now,
    activeJobIds: new Set<string>(),
  };
  __runnerTestUtils.runners.set(runnerId, runner);
  return runner;
}

afterEach(() => {
  for (const runnerId of [...__runnerTestUtils.runnerReconnectGraceTimers.keys()]) {
    __runnerTestUtils.clearRunnerReconnectGrace(runnerId);
  }
  __runnerTestUtils.runners.clear();
  __runnerTestUtils.jobsById.clear();
  __runnerTestUtils.jobRunnerById.clear();
  __runnerTestUtils.jobIdByRunId.clear();
  appendAgentRunOutput.mockReset();
  appendAgentRunLifecycleEvent.mockReset();
  completeAgentRun.mockReset();
});

describe('project-connected runner routing', () => {
  it('matches project runners by workspace even when routing user differs from owner', () => {
    const ws = makeOpenSocket();
    addRunner(
      'project-runner',
      ws,
      {
        userId: 'owner-a',
        workspaceId: 'workspace-1',
        connectionScope: 'project',
      },
      { supportsFilesystem: true },
    );

    expect(hasConnectedRemoteAgentRunner('workspace-owner', 'workspace-1')).toBe(true);
  });

  it('denies dispatch when activation actor is not a workspace member', async () => {
    const ws = makeOpenSocket();
    addRunner(
      'project-runner',
      ws,
      {
        userId: 'owner-a',
        workspaceId: 'workspace-1',
        connectionScope: 'project',
      },
      { supportsFilesystem: true },
    );

    await expect(
      dispatchRemoteAgentJob({
        userId: 'owner-a',
        workspaceId: 'workspace-1',
        activationActorId: 'outsider-9',
        intent: {
          runId: 'run-project-deny',
          agentId: 'agent-1',
          provider: 'codex',
          modelPreference: { displayName: 'Codex' },
          prompt: 'hello',
          workspace: { type: 'local_path', path: '/tmp', workspaceId: 'workspace-1' },
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
    ).rejects.toThrow(/not a member|No eligible remote agent runner/i);

    expect(ws.send).not.toHaveBeenCalled();
  });
});

describe('runner-local filesystem dispatch', () => {
  it('reports no-runner state without falling back to backend filesystem', () => {
    expect(getRunnerFilesystemAvailability('user-1', 'workspace-1')).toMatchObject({
      state: 'runner_unavailable',
    });
  });

  it('reports old-runner state when connected runner lacks inventory capability', () => {
    addRunner('runner-old', undefined, undefined, { agentInventory: undefined });

    expect(getRunnerFilesystemAvailability('user-1', 'workspace-1')).toMatchObject({
      state: 'runner_filesystem_unsupported',
    });
  });

  it('rejects job dispatch when the current runner does not advertise agent inventory authority', async () => {
    const ws = makeOpenSocket();
    addRunner('runner-no-inventory', ws, undefined, { agentInventory: undefined });

    await expect(
      dispatchRemoteAgentJob({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        intent: {
          runId: 'run-no-inventory',
          agentId: 'agent-1',
          provider: 'codex',
          modelPreference: { displayName: 'Codex' },
          prompt: 'hello',
          workspace: { type: 'local_path', path: '/tmp/ws', workspaceId: 'workspace-1' },
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
    ).rejects.toThrow(/advertise runner-owned agent inventory/i);

    expect(ws.send).not.toHaveBeenCalled();
  });

  it('sends runner filesystem requests only to a connected filesystem-capable runner', async () => {
    const ws = makeOpenSocket();
    const runner = addRunner('runner-fs', ws, undefined, { supportsFilesystem: true });

    const result = dispatchRunnerFilesystemRequest({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      request: { action: 'browse', path: '/repo', mode: 'folder' },
    });

    expect(ws.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(ws.send.mock.calls[0][0] as string);
    expect(payload).toMatchObject({
      type: 'filesystem_request',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      request: { action: 'browse', path: '/repo', mode: 'folder' },
    });

    __runnerTestUtils.handleRunnerMessage(runner, {
      type: 'filesystem_response',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      requestId: payload.requestId,
      ok: true,
      result: { action: 'browse', path: '/repo', entries: [] },
    });

    await expect(result).resolves.toEqual({
      runnerId: 'runner-fs',
      result: { action: 'browse', path: '/repo', entries: [] },
    });
  });

  it('rejects filesystem operations not advertised by the selected runner', async () => {
    const ws = makeOpenSocket();
    addRunner('runner-fs-limited', ws, undefined, {
      supportsFilesystem: true,
      filesystemOperations: ['browse'],
    });

    await expect(
      dispatchRunnerFilesystemRequest({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        request: { action: 'reveal', path: '/repo' },
      }),
    ).rejects.toThrow('does not advertise filesystem operation reveal');
    expect(ws.send).not.toHaveBeenCalled();
  });
});

describe('structured runner job dispatch', () => {
  it('sends job_offer with RunnerJobIntent only (no legacy CLI command/argv/cwd/env on the wire)', async () => {
    const ws = makeOpenSocket();
    const runner = addRunner('runner-1', ws);

    const result = dispatchRemoteAgentJob({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      intent: {
        runId: 'run-struct-1',
        agentId: 'agent-1',
        provider: 'codex',
        modelPreference: { displayName: 'Codex' },
        prompt: 'hello',
        workspace: { type: 'local_path', path: '/tmp/ws', workspaceId: 'workspace-1' },
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

    expect(ws.send).toHaveBeenCalledTimes(1);
    const raw = ws.send.mock.calls[0][0] as string;
    const payload = JSON.parse(raw) as Record<string, unknown>;

    expect(payload.type).toBe('job_offer');
    expect(payload.protocolVersion).toBe(RUNNER_PROTOCOL_VERSION);
    expect(typeof payload.jobId).toBe('string');

    const forbiddenRoot = ['command', 'argv', 'args', 'cwd', 'env', 'shell', 'executable'];
    for (const key of forbiddenRoot) {
      expect(payload).not.toHaveProperty(key);
    }

    expect(payload.job).toMatchObject({
      runId: 'run-struct-1',
      provider: 'codex',
      prompt: 'hello',
    });
    const job = payload.job as Record<string, unknown>;
    for (const key of ['command', 'argv', 'args', 'cwd', 'env']) {
      expect(job).not.toHaveProperty(key);
    }
    expect(job.workspace).toEqual(
      expect.objectContaining({ type: 'local_path', path: '/tmp/ws', workspaceId: 'workspace-1' }),
    );

    const jobId = payload.jobId as string;
    __runnerTestUtils.handleRunnerMessage(runner, {
      type: 'completed',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId,
      runId: 'run-struct-1',
      code: 0,
      stdout: '',
      stderr: '',
    });
    await expect(result).resolves.toMatchObject({ code: 0 });
  });

  it('does not offer attachment staging jobs to old protocol runners', async () => {
    const ws = makeOpenSocket();
    addRunner('runner-old-protocol', ws, undefined, {
      protocolVersion: '1.1' as RunnerCapabilities['protocolVersion'],
    });

    await expect(
      dispatchRemoteAgentJob({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        intent: {
          runId: 'run-staging-unavailable',
          agentId: 'agent-1',
          provider: 'codex',
          modelPreference: { displayName: 'Codex' },
          prompt: 'hello',
          workspace: { type: 'local_path', path: '/tmp/ws', workspaceId: 'workspace-1' },
          attachments: [
            {
              type: 'file',
              path: '.openwork/staging/attachment-1/attachments/spec.txt',
              filename: 'spec.txt',
              mimeType: 'text/plain',
              sizeBytes: 4,
              textExtraction: { status: 'available', textPath: '.openwork/staging/attachment-1/attachments/spec.txt' },
            },
          ],
          stagingManifest: {
            version: 1,
            root: '.openwork/staging',
            policy: { scope: 'runner_job_workspace', materialization: 'download_before_launch', cleanup: 'runner_managed' },
            totalSizeBytes: 4,
            attachments: [
              {
                id: 'attachment-1',
                kind: 'attachment',
                attachmentIndex: 0,
                filename: 'spec.txt',
                mimeType: 'text/plain',
                sizeBytes: 4,
                storageId: '/chat-uploads/spec.txt',
                storagePath: '/chat-uploads/spec.txt',
                download: {
                  method: 'GET',
                  path: '/api/runner-attachments/download?itemId=attachment-1&path=%2Fchat-uploads%2Fspec.txt&token=x',
                },
                destination: 'attachments/spec.txt',
              },
            ],
          },
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
    ).rejects.toThrow('must be upgraded to advertise runner-owned agent inventory');
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('does not offer agent-context materialization on ordinary runner jobs', async () => {
    const ws = makeOpenSocket();
    addRunner('runner-context', ws);

    await expect(
      dispatchRemoteAgentJob({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        intent: {
          runId: 'run-context-staging-unavailable',
        agentId: 'agent-1',
        provider: 'codex',
          modelPreference: { displayName: 'Codex' },
          prompt: 'hello',
          workspace: {
            type: 'local_path',
            path: '/tmp/ws',
            workspaceId: 'workspace-1',
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
        } as Parameters<typeof dispatchRemoteAgentJob>[0]['intent'],
      }),
    ).rejects.toThrow(
      'Workspace materialization is not part of ordinary runner job execution',
    );
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('does not offer jobs when the runner advertisement denies the required tool policy', async () => {
    const ws = makeOpenSocket();
    addRunner('runner-policy', ws, undefined, { supportedTools: [] });

    await expect(
      dispatchRemoteAgentJob({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        intent: {
          runId: 'run-policy-denied',
          agentId: 'agent-1',
          provider: 'codex',
          modelPreference: { displayName: 'Codex' },
          prompt: 'hello',
          workspace: { type: 'local_path', path: '/tmp/ws', workspaceId: 'workspace-1' },
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
    ).rejects.toThrow('allows the required codex tool');
    expect(ws.send).not.toHaveBeenCalled();
  });

});

describe('native runner availability invariant', () => {
  it('keeps a busy eligible runner available for independent jobs', async () => {
    const ws = makeOpenSocket();
    const runner = addRunner('runner-1', ws);

    const first = dispatchRemoteAgentJob({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      intent: {
        runId: 'run-1',
        agentId: 'agent-1',
        provider: 'codex',
        modelPreference: { displayName: 'Codex' },
        prompt: 'first',
        workspace: { type: 'local_path', path: '/tmp/ws', workspaceId: 'workspace-1' },
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

    expect(__runnerTestUtils.getConnectedRunnerLiveStatus(runner)).toBe('busy');

    const second = dispatchRemoteAgentJob({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      intent: {
        runId: 'run-2',
        agentId: 'agent-1',
        provider: 'codex',
        modelPreference: { displayName: 'Codex' },
        prompt: 'second independent job',
        workspace: { type: 'local_path', path: '/tmp/ws', workspaceId: 'workspace-1' },
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
    expect(runner.activeJobIds.size).toBe(2);

    const [firstOffer, secondOffer] = ws.send.mock.calls.map(
      ([raw]) => JSON.parse(raw as string) as { jobId: string; job: { runId: string } },
    );
    expect(firstOffer.job.runId).toBe('run-1');
    expect(secondOffer.job.runId).toBe('run-2');
    expect(firstOffer.jobId).not.toBe(secondOffer.jobId);

    for (const offer of [firstOffer, secondOffer]) {
      __runnerTestUtils.handleRunnerMessage(runner, {
        type: 'completed',
        protocolVersion: RUNNER_PROTOCOL_VERSION,
        jobId: offer.jobId,
        runId: offer.job.runId,
        code: 0,
        stdout:
          '{"type":"turn.completed"}\n{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\n',
        stderr: '',
      });
    }

    await expect(first).resolves.toMatchObject({ code: 0 });
    await expect(second).resolves.toMatchObject({ code: 0 });
    expect(runner.activeJobIds.size).toBe(0);
  });
});

describe('agent runner routing scope', () => {
  it('does not pick an account runner when activation actor is not the owner', async () => {
    const ws = makeOpenSocket();
    addRunner('runner-account', ws, {
      userId: 'owner-1',
      workspaceId: 'workspace-1',
      connectionScope: 'account',
    });

    await expect(
      dispatchRemoteAgentJob({
        userId: 'owner-1',
        workspaceId: 'workspace-1',
        activationActorId: 'teammate-2',
        intent: {
          runId: 'run-account-deny',
          agentId: 'agent-1',
          provider: 'codex',
          modelPreference: { displayName: 'Codex' },
          prompt: 'hello',
          workspace: { type: 'local_path', path: '/tmp', workspaceId: 'workspace-1' },
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
    ).rejects.toThrow(/Only the account that paired this runner|No eligible remote agent runner/i);

    expect(ws.send).not.toHaveBeenCalled();
  });

  it('does not pick a runner registered to a different user', async () => {
    const otherWs = makeOpenSocket();
    addRunner('runner-other', otherWs, { userId: 'user-2', workspaceId: 'workspace-1' });

    await expect(
      dispatchRemoteAgentJob({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        intent: {
          runId: 'run-1',
        agentId: 'agent-1',
        provider: 'codex',
          modelPreference: { displayName: 'Codex' },
          prompt: 'hello',
          workspace: { type: 'local_path', path: '/tmp', workspaceId: 'workspace-1' },
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
    ).rejects.toThrow(/Only the account that paired this runner|No eligible remote agent runner/i);

    expect(otherWs.send).not.toHaveBeenCalled();
  });

  it('does not pick a runner for a different workspace', async () => {
    const ws = makeOpenSocket();
    addRunner('runner-ws2', ws, { userId: 'user-1', workspaceId: 'workspace-2' });

    await expect(
      dispatchRemoteAgentJob({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        intent: {
          runId: 'run-1',
        agentId: 'agent-1',
        provider: 'codex',
          modelPreference: { displayName: 'Codex' },
          prompt: 'hello',
          workspace: { type: 'local_path', path: '/tmp', workspaceId: 'workspace-1' },
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
    ).rejects.toThrow(/No eligible remote agent runner is connected for this workspace/i);

    expect(ws.send).not.toHaveBeenCalled();
  });
});

describe('agent runner resilience', () => {
  it('keeps an in-flight job pending and reattaches it to a reconnecting runner', async () => {
    const firstSocket = makeOpenSocket();
    const firstRunner = addRunner('runner-1', firstSocket);

    const result = dispatchRemoteAgentJob({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      intent: {
        runId: 'run-1',
        agentId: 'agent-1',
        provider: 'codex',
        modelPreference: { displayName: 'Codex' },
        prompt: 'hello',
        workspace: { type: 'local_path', path: '/tmp', workspaceId: 'workspace-1' },
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

    const offered = JSON.parse(firstSocket.send.mock.calls[0][0] as string) as { jobId: string };
    const jobId = offered.jobId;
    expect(firstRunner.activeJobIds.has(jobId)).toBe(true);

    __runnerTestUtils.runners.delete('runner-1');
    const secondRunner = addRunner('runner-1');
    __runnerTestUtils.reattachInFlightJobsToRunner(secondRunner);

    expect(secondRunner.activeJobIds.has(jobId)).toBe(true);

    __runnerTestUtils.handleRunnerMessage(secondRunner, {
      type: 'completed',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId,
      runId: 'run-1',
      code: 0,
      stdout:
        '{"type":"turn.completed"}\n{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\n',
      stderr: '',
    });

    await expect(result).resolves.toMatchObject({ code: 0 });
    expect(__runnerTestUtils.jobIdByRunId.has('run-1')).toBe(false);
  });

  it('finalizes a terminal message after backend in-memory job state is gone', async () => {
    const runner = addRunner('runner-1');
    const message: RunnerServerMessage = {
      type: 'completed',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId: 'lost-job',
      runId: 'run-after-restart',
      code: 0,
      stdout:
        '{"type":"turn.completed"}\n{"type":"item.completed","item":{"type":"agent_message","text":"done"}}\n',
      stderr: '',
    };

    __runnerTestUtils.handleRunnerMessage(runner, message);
    await vi.waitFor(() => {
      expect(completeAgentRun).toHaveBeenCalledWith('run-after-restart', null, {
        stdout: message.stdout,
        stderr: '',
      });
    });
  });

  it('persists output events after backend in-memory job state is gone', async () => {
    const runner = addRunner('runner-1');
    const message: RunnerServerMessage = {
      type: 'output_event',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId: 'lost-job',
      runId: 'run-after-restart',
      stream: 'stdout',
      text: 'still working\n',
    };

    __runnerTestUtils.handleRunnerMessage(runner, message);

    await vi.waitFor(() => {
      expect(appendAgentRunOutput).toHaveBeenCalledWith(
        'run-after-restart',
        'stdout',
        'still working\n',
      );
    });
  });

  it('excludes stale runners from new offers', async () => {
    const ws = makeOpenSocket();
    const runner = addRunner('runner-stale', ws);
    runner.lastSeenAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    await expect(
      dispatchRemoteAgentJob({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        intent: {
          runId: 'run-stale',
        agentId: 'agent-1',
        provider: 'codex',
          modelPreference: { displayName: 'Codex' },
          prompt: 'hello',
          workspace: { type: 'local_path', path: '/tmp', workspaceId: 'workspace-1' },
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
    ).rejects.toThrow(/No remote agent runner is connected|No eligible remote agent runner/i);

    expect(ws.send).not.toHaveBeenCalled();
  });

  it('tracks recovered accepted jobs so reconnecting runners are shown busy and cancellable', async () => {
    const runner = addRunner('runner-1');

    __runnerTestUtils.handleRunnerMessage(runner, {
      type: 'job_accepted',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId: 'recovered-job',
      runId: 'recovered-run',
    });

    expect(runner.activeJobIds.has('recovered-job')).toBe(true);
    expect(__runnerTestUtils.jobIdByRunId.get('recovered-run')).toBe('recovered-job');

    __runnerTestUtils.handleRunnerMessage(runner, {
      type: 'completed',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId: 'recovered-job',
      runId: 'recovered-run',
      code: 0,
      stdout:
        '{"type":"turn.completed"}\n{"type":"item.completed","item":{"type":"agent_message","text":"done"}}\n',
      stderr: '',
    });

    expect(runner.activeJobIds.has('recovered-job')).toBe(false);
    expect(__runnerTestUtils.jobIdByRunId.has('recovered-run')).toBe(false);
    expect(__runnerTestUtils.jobRunnerById.has('recovered-job')).toBe(false);
  });

  it('persists recovered final messages for unknown in-memory jobs by runId', async () => {
    const runner = addRunner('runner-1');

    __runnerTestUtils.handleRunnerMessage(runner, {
      type: 'final_message',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId: 'recovered-job',
      runId: 'recovered-run',
      text: 'Recovered final answer',
    });

    await vi.waitFor(() => {
      expect(appendAgentRunOutput).toHaveBeenCalledWith(
        'recovered-run',
        'stdout',
        expect.stringContaining('Recovered final answer'),
      );
    });
    expect(String(appendAgentRunOutput.mock.calls[0][2])).toContain('openwork_final_message');
  });

  it('finalizes recovered jobs when their runner disconnect grace expires', async () => {
    const runner = addRunner('runner-1');

    __runnerTestUtils.handleRunnerMessage(runner, {
      type: 'job_accepted',
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      jobId: 'recovered-job',
      runId: 'recovered-run',
    });

    __runnerTestUtils.failJobsForDisconnectedRunner('runner-1', 'Runner runner-1 disconnected');

    expect(__runnerTestUtils.jobIdByRunId.has('recovered-run')).toBe(false);
    expect(__runnerTestUtils.jobRunnerById.has('recovered-job')).toBe(false);
  });

  it('does not finalize recovered jobs before reconnect grace expires', () => {
    vi.useFakeTimers();
    try {
      addRunner('runner-1');
      __runnerTestUtils.jobRunnerById.set('recovered-job', 'runner-1');
      __runnerTestUtils.jobIdByRunId.set('recovered-run', 'recovered-job');
      __runnerTestUtils.runners.delete('runner-1');

      __runnerTestUtils.scheduleRunnerDisconnectGrace('runner-1');
      vi.advanceTimersByTime(119_999);

      expect(completeAgentRun).not.toHaveBeenCalled();
      expect(__runnerTestUtils.jobIdByRunId.get('recovered-run')).toBe('recovered-job');
    } finally {
      vi.useRealTimers();
    }
  });

  it('finalizes recovered jobs after reconnect grace expires', async () => {
    vi.useFakeTimers();
    try {
      addRunner('runner-1');
      __runnerTestUtils.jobRunnerById.set('recovered-job', 'runner-1');
      __runnerTestUtils.jobIdByRunId.set('recovered-run', 'recovered-job');
      __runnerTestUtils.runners.delete('runner-1');

      __runnerTestUtils.scheduleRunnerDisconnectGrace('runner-1');
      await vi.advanceTimersByTimeAsync(120_000);

      await vi.waitFor(() => {
        expect(completeAgentRun).toHaveBeenCalledWith(
          'recovered-run',
          'Runner runner-1 disconnected (reconnect grace expired after 120000ms)',
        );
      });
      expect(__runnerTestUtils.jobIdByRunId.has('recovered-run')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

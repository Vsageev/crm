import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
    lockAgentRunRowForUpdate: vi.fn(async () => {}),
  };

  const isRemoteAgentRunPending = vi.fn(() => false);

  return { records, store, isRemoteAgentRunPending };
});

vi.mock('../config/env.js', () => ({
  env: {
    DATA_DIR: '/tmp/openwork-agent-runs-retention-test',
    REMOTE_AGENT_RUN_TIMEOUT_MS: 60 * 60 * 1000,
    REMOTE_AGENT_RUNNER_RECONNECT_GRACE_MS: 0,
  },
}));
vi.mock('../db/index.js', () => ({ store: mocks.store }));
vi.mock('../db/connection.js', () => ({ store: mocks.store }));
vi.mock('./agent-runners.js', () => ({
  cancelRemoteAgentRun: vi.fn(),
  isRemoteAgentRunPending: mocks.isRemoteAgentRunPending,
}));
vi.mock('./agent-chat-turns.js', () => ({
  markAgentChatTurnCompleted: vi.fn(),
  markAgentChatTurnFailed: vi.fn(),
  markAgentChatTurnStopped: vi.fn(),
}));

import {
  appendAgentRunOutput,
  cleanupOldRunRecords,
  completeAgentRun,
  getActiveRuns,
  getAgentRun,
  reconcileUnrecoveredRemoteRuns,
} from './agent-runs.js';

describe('cleanupOldRunRecords', () => {
  beforeEach(() => {
    for (const collection of Object.keys(mocks.records)) {
      delete mocks.records[collection];
    }
    vi.clearAllMocks();
    mocks.isRemoteAgentRunPending.mockReturnValue(false);
    mocks.store.transaction.mockImplementation(async <T>(operation: () => Promise<T> | T) =>
      operation(),
    );
  });

  it('clears nullable retention references before deleting old terminal runs only', async () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const freshDate = new Date().toISOString();

    mocks.store.insert('agent_runs', {
      id: 'run-old',
      status: 'completed',
      startedAt: oldDate,
      finishedAt: oldDate,
    });
    mocks.store.insert('agent_runs', {
      id: 'run-queued',
      status: 'queued',
      startedAt: oldDate,
      finishedAt: null,
    });
    mocks.store.insert('agent_runs', {
      id: 'run-running',
      status: 'running',
      startedAt: oldDate,
      finishedAt: null,
    });
    mocks.store.insert('agent_runs', {
      id: 'run-fresh',
      status: 'completed',
      startedAt: freshDate,
      finishedAt: freshDate,
    });
    mocks.store.insert('agentChatTurns', { id: 'turn-old', runId: 'run-old' });
    mocks.store.insert('agentChatQueue', {
      id: 'queue-old',
      runId: 'run-old',
      lastRunId: 'run-old',
    });
    mocks.store.insert('agentBatchRunItems', { id: 'batch-item-old', agentRunId: 'run-old' });

    await expect(cleanupOldRunRecords(1)).resolves.toBe(1);

    expect(mocks.store.getById('agent_runs', 'run-old')).toBeNull();
    expect(mocks.store.getById('agent_runs', 'run-queued')).toMatchObject({ status: 'queued' });
    expect(mocks.store.getById('agent_runs', 'run-running')).toMatchObject({ status: 'running' });
    expect(mocks.store.getById('agent_runs', 'run-fresh')).toMatchObject({ status: 'completed' });
    expect(mocks.store.getById('agentChatTurns', 'turn-old')).toMatchObject({ runId: null });
    expect(mocks.store.getById('agentChatQueue', 'queue-old')).toMatchObject({
      runId: null,
      lastRunId: null,
    });
    expect(mocks.store.getById('agentBatchRunItems', 'batch-item-old')).toMatchObject({
      agentRunId: null,
    });
    expect(mocks.store.transaction).toHaveBeenCalledTimes(1);

    const runDeleteIndex = mocks.store.delete.mock.calls.findIndex(
      (call) => call[0] === 'agent_runs' && call[1] === 'run-old',
    );
    expect(runDeleteIndex).toBeGreaterThanOrEqual(0);
    const deleteOrder = mocks.store.delete.mock.invocationCallOrder[runDeleteIndex];
    for (const updateOrder of mocks.store.update.mock.invocationCallOrder) {
      expect(updateOrder).toBeLessThan(deleteOrder);
    }
  });

  it('reconciles unrecovered queued remote runs after the restart grace window', async () => {
    const oldDate = new Date(Date.now() - 10_000).toISOString();
    mocks.store.insert('agent_runs', {
      id: 'run-queued-remote',
      status: 'queued',
      executor: 'remote',
      startedAt: oldDate,
      finishedAt: null,
      stdout: '',
      stderr: '',
    });

    await expect(reconcileUnrecoveredRemoteRuns()).resolves.toBe(1);

    expect(mocks.store.getById('agent_runs', 'run-queued-remote')).toMatchObject({
      status: 'error',
      errorMessage: 'Remote runner job was not recovered after backend restart',
    });
  });

  it('finalizes timed-out remote runs before returning active monitor entries', async () => {
    const staleDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const freshDate = new Date(Date.now() - 5_000).toISOString();
    mocks.store.insert('agent_runs', {
      id: 'run-stale-remote',
      agentId: 'agent-1',
      agentName: 'Agent',
      triggerType: 'chat',
      status: 'running',
      executor: 'remote',
      pid: null,
      startedAt: staleDate,
      finishedAt: null,
      stdout: '',
      stderr: '',
    });
    mocks.store.insert('agent_runs', {
      id: 'run-fresh-remote',
      agentId: 'agent-1',
      agentName: 'Agent',
      triggerType: 'chat',
      status: 'running',
      executor: 'remote',
      pid: null,
      startedAt: freshDate,
      finishedAt: null,
      stdout: '',
      stderr: '',
    });

    const active = await getActiveRuns();

    expect(active.map((run) => run.id)).toEqual(['run-fresh-remote']);
    expect(mocks.store.getById('agent_runs', 'run-stale-remote')).toMatchObject({
      status: 'error',
      errorMessage: 'Remote agent run timed out after 3600000ms without a terminal runner message',
    });
  });

  it('keeps timed-out remote runs active while this backend still owns the pending job', async () => {
    const staleDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    mocks.isRemoteAgentRunPending.mockReturnValue(true);
    mocks.store.insert('agent_runs', {
      id: 'run-owned-remote',
      agentId: 'agent-1',
      agentName: 'Agent',
      triggerType: 'chat',
      status: 'running',
      executor: 'remote',
      pid: null,
      startedAt: staleDate,
      finishedAt: null,
      stdout: '',
      stderr: '',
    });

    const active = await getActiveRuns();

    expect(active.map((run) => run.id)).toEqual(['run-owned-remote']);
    expect(mocks.store.getById('agent_runs', 'run-owned-remote')).toMatchObject({
      status: 'running',
    });
  });

  it('persists remote output history in backend storage without reading runner workspace files', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-run-history-'));
    const backendRunDir = path.join(tempRoot, 'backend-data', 'agent-runs', 'run-history');
    const runnerWorkspace = path.join(tempRoot, 'runner-workspace');
    const runnerOnlyFile = path.join(runnerWorkspace, 'repo', 'AGENTS.md');
    const stdoutPath = path.join(backendRunDir, 'stdout.log');
    const stderrPath = path.join(backendRunDir, 'stderr.log');

    fs.mkdirSync(path.dirname(runnerOnlyFile), { recursive: true });
    fs.writeFileSync(runnerOnlyFile, 'runner-owned instructions');
    fs.mkdirSync(backendRunDir, { recursive: true });
    fs.writeFileSync(stdoutPath, '');
    fs.writeFileSync(stderrPath, '');

    mocks.store.insert('agent_runs', {
      id: 'run-history',
      agentId: 'agent-history',
      agentName: 'history agent',
      model: 'codex',
      triggerType: 'chat',
      status: 'running',
      executor: 'remote',
      pid: null,
      stdoutPath,
      stderrPath,
      stdout: null,
      stderr: null,
      responseText: null,
      errorMessage: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      runnerLifecycle: {
        events: [
          {
            at: new Date().toISOString(),
            event: 'backend_job_offer_sent',
            message: `Runner workspace was ${runnerWorkspace}`,
          },
        ],
      },
    });

    const originalReadFileSync = fs.readFileSync;
    const readSpy = vi.spyOn(fs, 'readFileSync');
    readSpy.mockImplementation((filePath, ...args) => {
      const normalized = typeof filePath === 'string' ? filePath : filePath.toString();
      if (normalized.startsWith(runnerWorkspace)) {
        throw new Error(`backend attempted to read runner workspace file: ${normalized}`);
      }
      return Reflect.apply(originalReadFileSync, fs, [
        filePath,
        ...args,
      ]) as ReturnType<typeof fs.readFileSync>;
    });

    try {
      appendAgentRunOutput(
        'run-history',
        'stdout',
        `${JSON.stringify({
          type: 'item.completed',
          item: {
            id: 'openwork-final-message-run-history',
            type: 'openwork_final_message',
            text: 'Readable while runner is offline',
          },
        })}\n`,
      );
      fs.rmSync(runnerWorkspace, { recursive: true, force: true });

      await completeAgentRun('run-history', null);
      const run = getAgentRun('run-history');

      expect(run).toMatchObject({
        id: 'run-history',
        status: 'completed',
        responseText: 'Readable while runner is offline',
      });
      expect(String(run?.stdout ?? '')).toContain('openwork_final_message');
      expect(
        readSpy.mock.calls.some((call) => String(call[0]).startsWith(runnerWorkspace)),
      ).toBe(false);
    } finally {
      readSpy.mockRestore();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

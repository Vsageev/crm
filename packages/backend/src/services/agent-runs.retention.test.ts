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

  return { records, store };
});

vi.mock('../config/env.js', () => ({
  env: {
    DATA_DIR: '/tmp/openwork-agent-runs-retention-test',
    REMOTE_AGENT_RUNNER_RECONNECT_GRACE_MS: 0,
  },
}));
vi.mock('../db/index.js', () => ({ store: mocks.store }));
vi.mock('../db/connection.js', () => ({ store: mocks.store }));
vi.mock('./agent-runners.js', () => ({
  cancelRemoteAgentRun: vi.fn(),
  isRemoteAgentRunPending: vi.fn(() => false),
}));
vi.mock('./agent-chat-turns.js', () => ({
  markAgentChatTurnCompleted: vi.fn(),
  markAgentChatTurnFailed: vi.fn(),
  markAgentChatTurnStopped: vi.fn(),
}));

import { cleanupOldRunRecords } from './agent-runs.js';

describe('cleanupOldRunRecords', () => {
  beforeEach(() => {
    for (const collection of Object.keys(mocks.records)) {
      delete mocks.records[collection];
    }
    vi.clearAllMocks();
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
});

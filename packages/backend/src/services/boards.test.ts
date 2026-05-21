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
    flush: vi.fn(async () => undefined),
    reload: vi.fn(async () => undefined),
  };

  return {
    records,
    store,
    createAuditLog: vi.fn(),
  };
});

vi.mock('../db/index.js', () => ({ store: mocks.store }));
vi.mock('../db/connection.js', () => ({ store: mocks.store }));
vi.mock('./audit-log.js', () => ({ createAuditLog: mocks.createAuditLog }));
vi.mock('./collections.js', () => ({
  getOrCreateGeneralCollection: vi.fn(async () => ({ id: 'collection-general' })),
}));
vi.mock('./cards.js', () => ({ updateCard: vi.fn() }));

import { deleteBoard } from './boards.js';

describe('deleteBoard', () => {
  beforeEach(() => {
    for (const collection of Object.keys(mocks.records)) {
      delete mocks.records[collection];
    }
    vi.clearAllMocks();
    mocks.store.transaction.mockImplementation(async <T>(operation: () => Promise<T> | T) =>
      operation(),
    );
  });

  it('removes board dependents before deleting the board', async () => {
    mocks.store.insert('boards', { id: 'board-1', name: 'Board' });
    mocks.store.insert('boardColumns', { id: 'column-1', boardId: 'board-1' });
    mocks.store.insert('boardCards', {
      id: 'board-card-1',
      boardId: 'board-1',
      columnId: 'column-1',
      cardId: 'card-1',
    });
    mocks.store.insert('boardCronTemplates', { id: 'template-1', boardId: 'board-1' });

    await expect(deleteBoard('board-1')).resolves.toMatchObject({ id: 'board-1' });

    expect(mocks.store.getAll('boardCards')).toHaveLength(0);
    expect(mocks.store.getAll('boardCronTemplates')).toHaveLength(0);
    expect(mocks.store.getAll('boardColumns')).toHaveLength(0);
    expect(mocks.store.getById('boards', 'board-1')).toBeNull();

    const calls = mocks.store.delete.mock.calls.map(([collection, id]) => `${collection}:${id}`);
    expect(calls).toEqual([
      'boardCards:board-card-1',
      'boardCronTemplates:template-1',
      'boardColumns:column-1',
      'boards:board-1',
    ]);
    expect(mocks.store.reload).toHaveBeenCalledOnce();
  });
});

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

import { clearColumnCards, deleteBoard, moveColumnCards } from './boards.js';

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

describe('column card bulk actions', () => {
  beforeEach(() => {
    for (const collection of Object.keys(mocks.records)) {
      delete mocks.records[collection];
    }
    vi.clearAllMocks();
    mocks.store.transaction.mockImplementation(async <T>(operation: () => Promise<T> | T) =>
      operation(),
    );
  });

  it('moves all cards from one column to another and appends them in order', async () => {
    mocks.store.insert('boardColumns', { id: 'source', boardId: 'board-1', position: 0 });
    mocks.store.insert('boardColumns', { id: 'target', boardId: 'board-1', position: 1 });
    mocks.store.insert('boardCards', {
      id: 'existing-target',
      boardId: 'board-1',
      columnId: 'target',
      cardId: 'card-target',
      position: 0,
    });
    mocks.store.insert('boardCards', {
      id: 'source-2',
      boardId: 'board-1',
      columnId: 'source',
      cardId: 'card-2',
      position: 1,
    });
    mocks.store.insert('boardCards', {
      id: 'source-1',
      boardId: 'board-1',
      columnId: 'source',
      cardId: 'card-1',
      position: 0,
    });

    await expect(moveColumnCards('board-1', 'source', 'target')).resolves.toEqual({ moved: 2 });

    expect(mocks.store.getById('boardCards', 'source-1')).toMatchObject({
      columnId: 'target',
      position: 1,
    });
    expect(mocks.store.getById('boardCards', 'source-2')).toMatchObject({
      columnId: 'target',
      position: 2,
    });
    expect(mocks.store.getById('boardColumns', 'source')).toMatchObject({ id: 'source' });
    expect(mocks.store.getById('boardColumns', 'target')).toMatchObject({ id: 'target' });
  });

  it('removes cards from a column without deleting the column', async () => {
    mocks.store.insert('boardColumns', { id: 'source', boardId: 'board-1', position: 0 });
    mocks.store.insert('boardCards', {
      id: 'source-1',
      boardId: 'board-1',
      columnId: 'source',
      cardId: 'card-1',
      position: 0,
    });
    mocks.store.insert('boardCards', {
      id: 'other-board-card',
      boardId: 'board-2',
      columnId: 'source',
      cardId: 'card-2',
      position: 0,
    });

    await expect(clearColumnCards('board-1', 'source')).resolves.toEqual({ removed: 1 });

    expect(mocks.store.getById('boardCards', 'source-1')).toBeNull();
    expect(mocks.store.getById('boardCards', 'other-board-card')).toMatchObject({ id: 'other-board-card' });
    expect(mocks.store.getById('boardColumns', 'source')).toMatchObject({ id: 'source' });
  });

  it('rejects moving cards to the same column', async () => {
    mocks.store.insert('boardColumns', { id: 'source', boardId: 'board-1', position: 0 });

    await expect(moveColumnCards('board-1', 'source', 'source')).resolves.toBeNull();
  });
});

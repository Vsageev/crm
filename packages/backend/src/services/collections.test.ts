import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../utils/api-errors.js';

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
    createAuditLog: vi.fn(),
  };
});

vi.mock('../db/index.js', () => ({ store: mocks.store }));
vi.mock('../db/connection.js', () => ({ store: mocks.store }));
vi.mock('./audit-log.js', () => ({ createAuditLog: mocks.createAuditLog }));

import { deleteCollection } from './collections.js';

describe('deleteCollection', () => {
  beforeEach(() => {
    for (const collection of Object.keys(mocks.records)) {
      delete mocks.records[collection];
    }
    vi.clearAllMocks();
    mocks.store.transaction.mockImplementation(async <T>(operation: () => Promise<T> | T) =>
      operation(),
    );
  });

  it('deletes an empty collection and removes workspace membership', async () => {
    mocks.store.insert('collections', {
      id: 'collection-empty',
      name: 'Empty',
      description: null,
      createdById: 'user-1',
    });
    mocks.store.insert('workspaces', {
      id: 'workspace-1',
      collectionIds: ['collection-empty', 'collection-other'],
    });

    await expect(
      deleteCollection('collection-empty', {
        userId: 'user-1',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      }),
    ).resolves.toMatchObject({ id: 'collection-empty' });

    expect(mocks.store.getById('collections', 'collection-empty')).toBeNull();
    expect(mocks.store.getById('workspaces', 'workspace-1')).toMatchObject({
      collectionIds: ['collection-other'],
    });
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delete',
        entityType: 'collection',
        entityId: 'collection-empty',
      }),
    );
  });

  it.each([
    ['cards', 'cards', { id: 'card-1', collectionId: 'collection-used' }],
    ['boards', 'boards', { id: 'board-1', collectionId: 'collection-used' }],
    [
      'default board collections',
      'boards',
      { id: 'board-1', defaultCollectionId: 'collection-used' },
    ],
    [
      'agent batch run items',
      'agentBatchRunItems',
      { id: 'item-1', cardCollectionId: 'collection-used' },
    ],
  ])('rejects collection delete when blocked by %s', async (_label, table, row) => {
    mocks.store.insert('collections', {
      id: 'collection-used',
      name: 'Used',
      description: null,
      createdById: 'user-1',
    });
    mocks.store.insert(table, row);

    await expect(deleteCollection('collection-used')).rejects.toMatchObject({
      code: 'collection_delete_blocked',
      statusCode: 409,
    });

    expect(mocks.store.getById('collections', 'collection-used')).toMatchObject({
      id: 'collection-used',
    });
    expect(mocks.store.delete).not.toHaveBeenCalledWith('collections', 'collection-used');
  });

  it('maps late Postgres foreign-key failures to a clear conflict', async () => {
    mocks.store.insert('collections', {
      id: 'collection-racy',
      name: 'Racy',
      description: null,
      createdById: 'user-1',
    });
    mocks.store.delete.mockImplementationOnce(() => {
      throw Object.assign(new Error('violates foreign key constraint'), { code: '23503' });
    });

    const deletion = deleteCollection('collection-racy');

    await expect(deletion).rejects.toBeInstanceOf(ApiError);
    await expect(deletion).rejects.toMatchObject({
      code: 'collection_delete_blocked',
      statusCode: 409,
    });
  });
});

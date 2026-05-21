import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerErrorHandler } from '../plugins/error-handler.js';
import { collectionRoutes } from './collections.js';

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
vi.mock('../services/audit-log.js', () => ({ createAuditLog: mocks.createAuditLog }));

async function buildRouteApp() {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(sensible);
  app.decorate('authenticate', async (request: { user?: { sub: string } }) => {
    request.user = { sub: 'user-1' };
  });
  registerErrorHandler(app);
  await app.register(collectionRoutes);
  return app;
}

describe('DELETE /api/collections/:id', () => {
  beforeEach(() => {
    for (const collection of Object.keys(mocks.records)) {
      delete mocks.records[collection];
    }
    vi.clearAllMocks();
    mocks.store.transaction.mockImplementation(async <T>(operation: () => Promise<T> | T) =>
      operation(),
    );
  });

  it('returns 204 for an empty collection delete', async () => {
    const app = await buildRouteApp();
    mocks.store.insert('collections', {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Empty',
      description: null,
      isGeneral: false,
      createdById: 'user-1',
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/collections/00000000-0000-4000-8000-000000000001',
    });

    expect(response.statusCode).toBe(204);
    expect(mocks.store.getById('collections', '00000000-0000-4000-8000-000000000001')).toBeNull();
  });

  it('returns a clear 409 when a collection delete is blocked', async () => {
    const app = await buildRouteApp();
    mocks.store.insert('collections', {
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Used',
      description: null,
      isGeneral: false,
      createdById: 'user-1',
    });
    mocks.store.insert('cards', {
      id: '00000000-0000-4000-8000-000000000003',
      collectionId: '00000000-0000-4000-8000-000000000002',
      name: 'Card',
      description: null,
      customFields: {},
      createdById: 'user-1',
      assigneeId: null,
      position: 0,
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/collections/00000000-0000-4000-8000-000000000002',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'collection_delete_blocked',
      message: expect.stringContaining('1 cards'),
    });
    expect(mocks.store.getById('collections', '00000000-0000-4000-8000-000000000002')).toMatchObject({
      id: '00000000-0000-4000-8000-000000000002',
    });
  });
});

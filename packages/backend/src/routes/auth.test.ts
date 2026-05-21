import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerErrorHandler } from '../plugins/error-handler.js';

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
  };

  const findUserByEmailLower = vi.fn(async (emailLower: string) =>
    getCollection('users').find(
      (user) => typeof user.email === 'string' && user.email.toLowerCase() === emailLower,
    ) ?? null,
  );

  const getUserRecordById = vi.fn(async (id: string) =>
    getCollection('users').find((user) => user.id === id) ?? null,
  );

  return {
    records,
    store,
    findUserByEmailLower,
    getUserRecordById,
    createAuditLog: vi.fn(async () => undefined),
    deleteRefreshTokensForUserId: vi.fn(async () => undefined),
    findValidRefreshTokenByHash: vi.fn(async () => null),
  };
});

vi.mock('../db/index.js', () => ({ store: mocks.store }));
vi.mock('../db/connection.js', () => ({ store: mocks.store }));
vi.mock('../db/repositories/users-repository.js', () => ({
  findUserByEmailLower: mocks.findUserByEmailLower,
  getUserRecordById: mocks.getUserRecordById,
}));
vi.mock('../db/repositories/refresh-tokens-repository.js', () => ({
  deleteRefreshTokensForUserId: mocks.deleteRefreshTokensForUserId,
  findValidRefreshTokenByHash: mocks.findValidRefreshTokenByHash,
}));
vi.mock('../services/audit-log.js', () => ({ createAuditLog: mocks.createAuditLog }));

import { authRoutes } from './auth.js';
import { hashPassword } from '../services/auth.js';

async function buildRouteApp() {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(sensible);
  await app.register(jwt, {
    secret: 'auth-route-test-secret-at-least-32-chars',
  });
  app.decorate('authenticate', async (request: { user?: { sub: string } }) => {
    request.user = { sub: 'user-1' };
  });
  registerErrorHandler(app);
  await app.register(authRoutes);
  return app;
}

async function seedUser(overrides: Record<string, unknown> = {}) {
  return mocks.store.insert('users', {
    id: 'user-1',
    email: 'person@example.com',
    passwordHash: await hashPassword('CorrectHorse1!'),
    firstName: 'Ada',
    lastName: 'Lovelace',
    type: 'human',
    isActive: true,
    totpSecret: null,
    totpEnabled: false,
    recoveryCodes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    for (const collection of Object.keys(mocks.records)) {
      delete mocks.records[collection];
    }
    vi.clearAllMocks();
  });

  it('returns normal auth tokens for password login', async () => {
    const app = await buildRouteApp();
    await seedUser();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'Person@Example.com',
        password: 'CorrectHorse1!',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      user: {
        id: 'user-1',
        email: 'person@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        type: 'human',
      },
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
    expect(body).not.toHaveProperty('twoFactorRequired');
    expect(body).not.toHaveProperty('twoFactorToken');
    expect(mocks.store.getAll('refreshTokens')).toHaveLength(1);

    await app.close();
  });

  it('ignores legacy TOTP state and returns normal auth tokens', async () => {
    const app = await buildRouteApp();
    await seedUser({
      totpSecret: 'LEGACYTOTPSECRET',
      totpEnabled: true,
      recoveryCodes: JSON.stringify(['legacy-code-hash']),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'person@example.com',
        password: 'CorrectHorse1!',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.refreshToken).toEqual(expect.any(String));
    expect(body).not.toHaveProperty('twoFactorRequired');
    expect(body).not.toHaveProperty('twoFactorToken');
    expect(mocks.store.getById('users', 'user-1')).toMatchObject({
      totpEnabled: true,
      totpSecret: 'LEGACYTOTPSECRET',
    });

    await app.close();
  });

  it('does not advertise legacy TOTP state from the current-user response', async () => {
    const app = await buildRouteApp();
    await seedUser({
      totpSecret: 'LEGACYTOTPSECRET',
      totpEnabled: true,
      recoveryCodes: JSON.stringify(['legacy-code-hash']),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        authorization: 'Bearer ignored-by-test-auth-decorator',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.user).toMatchObject({
      id: 'user-1',
      email: 'person@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      type: 'human',
      isActive: true,
    });
    expect(body.user).not.toHaveProperty('totpEnabled');
    expect(body.user).not.toHaveProperty('totpSecret');
    expect(body.user).not.toHaveProperty('recoveryCodes');

    await app.close();
  });

  it('does not expose working 2FA/TOTP endpoints', async () => {
    const app = await buildRouteApp();
    await seedUser({
      totpSecret: 'LEGACYTOTPSECRET',
      totpEnabled: true,
      recoveryCodes: JSON.stringify(['legacy-code-hash']),
    });

    const endpoints = [
      { url: '/api/auth/2fa/verify', payload: { twoFactorToken: 'legacy', code: '123456' } },
      { url: '/api/auth/2fa/setup', payload: {} },
      { url: '/api/auth/2fa/confirm', payload: { token: '123456' } },
      { url: '/api/auth/2fa/disable', payload: { password: 'CorrectHorse1!' } },
      { url: '/api/auth/2fa/recovery-codes', payload: {} },
    ];

    for (const endpoint of endpoints) {
      const response = await app.inject({
        method: 'POST',
        url: endpoint.url,
        payload: endpoint.payload,
      });

      expect(response.statusCode).toBe(404);
    }
    expect(mocks.store.getById('users', 'user-1')).toMatchObject({
      totpEnabled: true,
      totpSecret: 'LEGACYTOTPSECRET',
      recoveryCodes: JSON.stringify(['legacy-code-hash']),
    });

    await app.close();
  });
});

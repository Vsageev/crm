import Fastify from 'fastify';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
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

  const deleteRefreshTokensForUserId = vi.fn(async (userId: string) => {
    const rows = getCollection('refreshTokens');
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (rows[index].userId === userId) {
        rows.splice(index, 1);
      }
    }
  });

  const consumeValidRefreshTokenByHash = vi.fn(async (tokenHash: string) => {
    const rows = getCollection('refreshTokens');
    const index = rows.findIndex(
      (token) =>
        token.tokenHash === tokenHash &&
        typeof token.expiresAt === 'string' &&
        new Date(token.expiresAt).getTime() > Date.now(),
    );
    if (index < 0) return null;
    const [token] = rows.splice(index, 1);
    return token;
  });

  return {
    records,
    store,
    findUserByEmailLower,
    getUserRecordById,
    createAuditLog: vi.fn(async () => undefined),
    deleteRefreshTokensForUserId,
    consumeValidRefreshTokenByHash,
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
  consumeValidRefreshTokenByHash: mocks.consumeValidRefreshTokenByHash,
}));
vi.mock('../services/audit-log.js', () => ({ createAuditLog: mocks.createAuditLog }));

import { authRoutes } from './auth.js';
import { hashPassword } from '../services/auth.js';

async function buildRouteApp(authenticatedUserId = 'user-1') {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(sensible);
  await app.register(jwt, {
    secret: 'auth-route-test-secret-at-least-32-chars',
  });
  app.decorate('authenticate', async (request: { user?: { sub: string } }) => {
    request.user = { sub: authenticatedUserId };
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

async function expectSessionBody(
  app: FastifyInstance,
  body: Record<string, unknown>,
  expectedUser: Record<string, unknown>,
) {
  expect(body).toEqual({
    user: expectedUser,
    accessToken: expect.stringMatching(/\S/),
    refreshToken: expect.stringMatching(/\S/),
  });

  const decoded = await app.jwt.verify(body.accessToken as string) as { sub?: string };
  expect(decoded.sub).toBe(expectedUser.id);
}

function expectAuthError(
  response: LightMyRequestResponse,
  statusCode: number,
  code: string,
) {
  expect(response.statusCode).toBe(statusCode);
  expect(response.json()).toMatchObject({
    statusCode,
    code,
  });
}

describe('auth routes', () => {
  beforeEach(() => {
    for (const collection of Object.keys(mocks.records)) {
      delete mocks.records[collection];
    }
    vi.clearAllMocks();
  });

  it('registers a human user and returns a complete session response', async () => {
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'New.Person@Example.com',
        password: 'CorrectHorse1!',
        firstName: 'Grace',
        lastName: 'Hopper',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    await expectSessionBody(app, body, {
      id: 'users-1',
      email: 'new.person@example.com',
      firstName: 'Grace',
      lastName: 'Hopper',
      type: 'human',
      createdAt: expect.any(String),
    });
    expect(mocks.store.getById('users', 'users-1')).toMatchObject({
      email: 'new.person@example.com',
      firstName: 'Grace',
      lastName: 'Hopper',
      type: 'human',
      isActive: true,
      totpEnabled: false,
      passwordHash: expect.stringMatching(/\S/),
    });
    expect(mocks.store.getAll('refreshTokens')).toHaveLength(1);

    await app.close();
  });

  it.each([
    {
      name: 'missing uppercase',
      password: 'correcthorse1',
      messageIncludes: 'uppercase',
    },
    {
      name: 'missing lowercase',
      password: 'CORRECTHORSE1',
      messageIncludes: 'lowercase',
    },
    {
      name: 'missing digit',
      password: 'CorrectHorse',
      messageIncludes: 'digit',
    },
    {
      name: 'too common',
      password: 'password123',
      messageIncludes: 'too common',
    },
  ])('rejects registration for $name passwords', async ({ password, messageIncludes }) => {
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'weak.password@example.com',
        password,
        firstName: 'Weak',
        lastName: 'Password',
      },
    });

    expectAuthError(response, 400, 'weak_password');
    const body = response.json();
    expect(body.message.toLowerCase()).toContain(messageIncludes);
    expect(body.hint).toBe(
      'Password must be at least 8 characters with uppercase, lowercase, and a number',
    );
    expect(body.hint.toLowerCase()).not.toContain('special');
    expect(mocks.store.getAll('users')).toHaveLength(0);

    await app.close();
  });

  it('accepts registration without a special character when policy rules are met', async () => {
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'no.special@example.com',
        password: 'CorrectHorse1',
        firstName: 'No',
        lastName: 'Special',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mocks.store.getAll('users')).toHaveLength(1);

    await app.close();
  });

  it('rejects duplicate registration email without creating a session', async () => {
    const app = await buildRouteApp();
    await seedUser({ email: 'taken@example.com' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'Taken@Example.com',
        password: 'CorrectHorse1!',
        firstName: 'Duplicate',
        lastName: 'Person',
      },
    });

    expectAuthError(response, 409, 'duplicate_email');
    expect(mocks.store.getAll('users')).toHaveLength(1);
    expect(mocks.store.getAll('refreshTokens')).toHaveLength(0);

    await app.close();
  });

  it('returns a complete session response for human password login', async () => {
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
    await expectSessionBody(app, body, {
      id: 'user-1',
      email: 'person@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      type: 'human',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(mocks.store.getAll('refreshTokens')).toEqual([
      expect.objectContaining({
        userId: 'user-1',
        tokenHash: expect.stringMatching(/\S/),
        expiresAt: expect.any(String),
      }),
    ]);

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
    await expectSessionBody(app, body, {
      id: 'user-1',
      email: 'person@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      type: 'human',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(mocks.store.getById('users', 'user-1')).toMatchObject({
      totpEnabled: true,
      totpSecret: 'LEGACYTOTPSECRET',
    });

    await app.close();
  });

  it.each([
    {
      name: 'missing user',
      user: null,
      password: 'CorrectHorse1!',
      statusCode: 401,
      code: 'invalid_credentials',
    },
    {
      name: 'invalid password',
      user: { email: 'person@example.com' },
      password: 'WrongPassword1!',
      statusCode: 401,
      code: 'invalid_credentials',
    },
    {
      name: 'inactive user',
      user: { isActive: false },
      password: 'CorrectHorse1!',
      statusCode: 403,
      code: 'account_deactivated',
    },
    {
      name: 'agent/service user',
      user: { type: 'agent', agentId: 'agent-1' },
      password: 'CorrectHorse1!',
      statusCode: 403,
      code: 'agent_account_login_forbidden',
    },
  ])('rejects login for $name', async ({ user, password, statusCode, code }) => {
    const app = await buildRouteApp();
    if (user) {
      await seedUser(user);
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'person@example.com',
        password,
      },
    });

    expectAuthError(response, statusCode, code);
    expect(mocks.store.getAll('refreshTokens')).toHaveLength(0);

    await app.close();
  });

  it('rotates a valid refresh token and rejects replay of the old token', async () => {
    const app = await buildRouteApp();
    await seedUser();

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'person@example.com',
        password: 'CorrectHorse1!',
      },
    });
    const oldRefreshToken = loginResponse.json().refreshToken as string;

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: oldRefreshToken },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toEqual({
      accessToken: expect.stringMatching(/\S/),
      refreshToken: expect.stringMatching(/\S/),
    });
    expect(body.refreshToken).not.toBe(oldRefreshToken);
    const decoded = await app.jwt.verify(body.accessToken) as { sub?: string };
    expect(decoded.sub).toBe('user-1');
    expect(mocks.store.getAll('refreshTokens')).toHaveLength(1);

    const replayResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: oldRefreshToken },
    });

    expectAuthError(replayResponse, 401, 'invalid_refresh_token');
    expect(mocks.store.getAll('refreshTokens')).toHaveLength(1);

    await app.close();
  });

  it('supports the rotated refresh token after rejecting the old token replay', async () => {
    const app = await buildRouteApp();
    await seedUser();

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'person@example.com',
        password: 'CorrectHorse1!',
      },
    });
    const oldRefreshToken = loginResponse.json().refreshToken as string;

    const firstRefreshResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: oldRefreshToken },
    });
    const rotatedRefreshToken = firstRefreshResponse.json().refreshToken as string;

    const replayResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: oldRefreshToken },
    });

    expectAuthError(replayResponse, 401, 'invalid_refresh_token');

    const secondRefreshResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: rotatedRefreshToken },
    });

    expect(secondRefreshResponse.statusCode).toBe(200);
    expect(secondRefreshResponse.json()).toEqual({
      accessToken: expect.stringMatching(/\S/),
      refreshToken: expect.stringMatching(/\S/),
    });
    expect(secondRefreshResponse.json().refreshToken).not.toBe(rotatedRefreshToken);

    await app.close();
  });

  it('rejects invalid refresh tokens', async () => {
    const app = await buildRouteApp();
    await seedUser();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: 'not-a-valid-refresh-token' },
    });

    expectAuthError(response, 401, 'invalid_refresh_token');

    await app.close();
  });

  it.each([
    { name: 'expired', mutate: (token: Record<string, unknown>) => { token.expiresAt = '2000-01-01T00:00:00.000Z'; } },
    { name: 'revoked', mutate: (_token: Record<string, unknown>, rows: Array<Record<string, unknown>>) => { rows.splice(0, rows.length); } },
  ])('rejects $name refresh tokens', async ({ mutate }) => {
    const app = await buildRouteApp();
    await seedUser();

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'person@example.com',
        password: 'CorrectHorse1!',
      },
    });
    const refreshToken = loginResponse.json().refreshToken as string;
    const rows = mocks.records.refreshTokens;
    mutate(rows[0], rows);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    });

    expectAuthError(response, 401, 'invalid_refresh_token');
    expect(mocks.store.getAll('refreshTokens')).toHaveLength(rows.length);

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

  it('rejects current-user lookup when the authenticated subject is missing', async () => {
    const app = await buildRouteApp('missing-user');

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        authorization: 'Bearer ignored-by-test-auth-decorator',
      },
    });

    expectAuthError(response, 401, 'user_not_found');

    await app.close();
  });

  it('logs out by revoking refresh tokens for the authenticated user', async () => {
    const app = await buildRouteApp();
    await seedUser();
    mocks.store.insert('refreshTokens', {
      id: 'refresh-1',
      userId: 'user-1',
      tokenHash: 'hash-1',
      expiresAt: '2026-01-02T00:00:00.000Z',
    });
    mocks.store.insert('refreshTokens', {
      id: 'refresh-2',
      userId: 'other-user',
      tokenHash: 'hash-2',
      expiresAt: '2026-01-02T00:00:00.000Z',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        authorization: 'Bearer ignored-by-test-auth-decorator',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: 'Logged out successfully' });
    expect(mocks.deleteRefreshTokensForUserId).toHaveBeenCalledWith('user-1');
    expect(mocks.store.getAll('refreshTokens')).toEqual([
      expect.objectContaining({ id: 'refresh-2', userId: 'other-user' }),
    ]);

    await app.close();
  });

  it('changes the authenticated user password', async () => {
    const app = await buildRouteApp();
    await seedUser();
    const oldHash = mocks.store.getById('users', 'user-1')!.passwordHash;

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/auth/password',
      headers: {
        authorization: 'Bearer ignored-by-test-auth-decorator',
      },
      payload: {
        currentPassword: 'CorrectHorse1!',
        newPassword: 'BetterHorse2!',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: 'Password changed successfully' });
    expect(mocks.store.getById('users', 'user-1')).toMatchObject({
      passwordHash: expect.stringMatching(/\S/),
    });
    expect(mocks.store.getById('users', 'user-1')!.passwordHash).not.toBe(oldHash);
    expect(mocks.createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        action: 'password_changed',
        entityType: 'user',
        entityId: 'user-1',
      }),
    );

    await app.close();
  });

  it('rejects password changes with the wrong current password', async () => {
    const app = await buildRouteApp();
    await seedUser();
    const oldHash = mocks.store.getById('users', 'user-1')!.passwordHash;

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/auth/password',
      headers: {
        authorization: 'Bearer ignored-by-test-auth-decorator',
      },
      payload: {
        currentPassword: 'WrongHorse1!',
        newPassword: 'BetterHorse2!',
      },
    });

    expectAuthError(response, 401, 'invalid_password');
    expect(mocks.store.getById('users', 'user-1')!.passwordHash).toBe(oldHash);

    await app.close();
  });

  it('rejects password changes for a missing authenticated subject', async () => {
    const app = await buildRouteApp('missing-user');

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/auth/password',
      headers: {
        authorization: 'Bearer ignored-by-test-auth-decorator',
      },
      payload: {
        currentPassword: 'CorrectHorse1!',
        newPassword: 'BetterHorse2!',
      },
    });

    expectAuthError(response, 401, 'user_not_found');

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

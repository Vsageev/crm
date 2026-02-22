import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 3000,
    HOST: '0.0.0.0',
    DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/crm',
    REDIS_URL: 'redis://localhost:6379',
    CORS_ORIGIN: 'http://localhost:5173',
    JWT_SECRET: 'test-secret-that-is-at-least-32-chars-long!!',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
    BACKUP_DIR: './backups',
    BACKUP_CRON: '0 2 * * *',
    BACKUP_RETENTION_DAYS: 30,
    BACKUP_ENABLED: false,
  },
}));

const { buildApp } = await import('../app.js');

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

function signToken(payload: { sub: string; role: string }) {
  return app.jwt.sign(payload);
}

/**
 * Register tiny test routes that use the middleware under test.
 * This exercises the real Fastify request lifecycle.
 */
async function registerTestRoutes(app: App) {
  const { authenticate } = await import('./authenticate.js');
  const { requireRole, requirePermission, requireAnyPermission } = await import('./rbac.js');

  // Route: admin-only by role
  app.get('/test/admin-only', { preHandler: [authenticate, requireRole('admin')] }, async () => {
    return { ok: true };
  });

  // Route: manager or admin by role
  app.get(
    '/test/manager-up',
    { preHandler: [authenticate, requireRole('admin', 'manager')] },
    async () => {
      return { ok: true };
    },
  );

  // Route: any authenticated user
  app.get('/test/authenticated', { preHandler: [authenticate] }, async () => {
    return { ok: true };
  });

  // Route: requires specific permission
  app.delete(
    '/test/delete-user',
    { preHandler: [authenticate, requirePermission('users:delete')] },
    async () => {
      return { ok: true };
    },
  );

  // Route: requires any of several permissions
  app.get(
    '/test/view-reports',
    {
      preHandler: [authenticate, requireAnyPermission('reports:read', 'settings:read')],
    },
    async () => {
      return { ok: true };
    },
  );
}

beforeAll(async () => {
  app = await buildApp();
  await registerTestRoutes(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('authenticate middleware', () => {
  it('rejects requests without Authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/authenticated' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests with invalid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/test/authenticated',
      headers: { authorization: 'Bearer invalid-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('allows requests with valid token', async () => {
    const token = signToken({ sub: 'user-1', role: 'agent' });
    const res = await app.inject({
      method: 'GET',
      url: '/test/authenticated',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe('requireRole', () => {
  it('allows admin to access admin-only route', async () => {
    const token = signToken({ sub: 'user-1', role: 'admin' });
    const res = await app.inject({
      method: 'GET',
      url: '/test/admin-only',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects manager from admin-only route', async () => {
    const token = signToken({ sub: 'user-2', role: 'manager' });
    const res = await app.inject({
      method: 'GET',
      url: '/test/admin-only',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects agent from admin-only route', async () => {
    const token = signToken({ sub: 'user-3', role: 'agent' });
    const res = await app.inject({
      method: 'GET',
      url: '/test/admin-only',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows admin to access manager-up route', async () => {
    const token = signToken({ sub: 'user-1', role: 'admin' });
    const res = await app.inject({
      method: 'GET',
      url: '/test/manager-up',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('allows manager to access manager-up route', async () => {
    const token = signToken({ sub: 'user-2', role: 'manager' });
    const res = await app.inject({
      method: 'GET',
      url: '/test/manager-up',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects agent from manager-up route', async () => {
    const token = signToken({ sub: 'user-3', role: 'agent' });
    const res = await app.inject({
      method: 'GET',
      url: '/test/manager-up',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('requirePermission', () => {
  it('allows admin to delete users (has users:delete)', async () => {
    const token = signToken({ sub: 'user-1', role: 'admin' });
    const res = await app.inject({
      method: 'DELETE',
      url: '/test/delete-user',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects manager from deleting users (no users:delete)', async () => {
    const token = signToken({ sub: 'user-2', role: 'manager' });
    const res = await app.inject({
      method: 'DELETE',
      url: '/test/delete-user',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects agent from deleting users (no users:delete)', async () => {
    const token = signToken({ sub: 'user-3', role: 'agent' });
    const res = await app.inject({
      method: 'DELETE',
      url: '/test/delete-user',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('requireAnyPermission', () => {
  it('allows manager to view reports (has reports:read)', async () => {
    const token = signToken({ sub: 'user-2', role: 'manager' });
    const res = await app.inject({
      method: 'GET',
      url: '/test/view-reports',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects agent from viewing reports (has neither reports:read nor settings:read)', async () => {
    const token = signToken({ sub: 'user-3', role: 'agent' });
    const res = await app.inject({
      method: 'GET',
      url: '/test/view-reports',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows admin to view reports', async () => {
    const token = signToken({ sub: 'user-1', role: 'admin' });
    const res = await app.inject({
      method: 'GET',
      url: '/test/view-reports',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('roleHasPermission helper', () => {
  it('returns correct results for each role', async () => {
    const { roleHasPermission } = await import('./rbac.js');

    expect(roleHasPermission('admin', 'users:delete')).toBe(true);
    expect(roleHasPermission('admin', 'backups:create')).toBe(true);
    expect(roleHasPermission('manager', 'users:delete')).toBe(false);
    expect(roleHasPermission('manager', 'reports:read')).toBe(true);
    expect(roleHasPermission('agent', 'contacts:read')).toBe(true);
    expect(roleHasPermission('agent', 'users:read')).toBe(false);
    expect(roleHasPermission('agent', 'backups:read')).toBe(false);
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerErrorHandler } from '../plugins/error-handler.js';
import { storageRoutes } from './storage.js';
import { env } from '../config/env.js';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

vi.mock('node:child_process', () => ({
  spawn: mocks.spawn,
}));

async function buildRouteApp() {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(sensible);
  app.decorate('authenticate', async (request: { user?: { sub: string } }) => {
    request.user = { sub: 'test-user' };
  });
  registerErrorHandler(app);
  await app.register(storageRoutes);
  return app;
}

describe('storage local path reveal endpoint', () => {
  let tmpDir: string;
  let originalSameHostGate: boolean;

  beforeEach(() => {
    originalSameHostGate = env.OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM;
    env.OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM = false;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-reveal-local-'));
    mocks.spawn.mockClear();
  });

  afterEach(() => {
    env.OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM = originalSameHostGate;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects backend host filesystem endpoints in hosted mode', async () => {
    const app = await buildRouteApp();

    const browseResponse = await app.inject({
      method: 'GET',
      url: `/api/storage/browse-fs?path=${encodeURIComponent(tmpDir)}`,
    });
    const pickResponse = await app.inject({
      method: 'POST',
      url: '/api/storage/pick-folder',
      payload: { startPath: tmpDir },
    });
    const referenceResponse = await app.inject({
      method: 'POST',
      url: '/api/storage/references',
      payload: { path: '/', name: 'tmp', target: tmpDir },
    });
    const storageRevealResponse = await app.inject({
      method: 'POST',
      url: '/api/storage/reveal',
      payload: { path: '/tmp' },
    });
    const localRevealResponse = await app.inject({
      method: 'POST',
      url: '/api/storage/reveal-local',
      payload: { path: tmpDir },
    });

    for (const response of [
      browseResponse,
      pickResponse,
      referenceResponse,
      storageRevealResponse,
      localRevealResponse,
    ]) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 'backend_local_filesystem_unavailable',
      });
    }
    expect(localRevealResponse.json().message).toMatch(/server-local paths, not runner workspace paths/i);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('reveals an existing absolute host path through the OS file manager when same-host dev is enabled', async () => {
    env.OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM = true;
    const app = await buildRouteApp();
    const filePath = path.join(tmpDir, 'file.ts');
    fs.writeFileSync(filePath, 'export const value = 1;\n');

    const response = await app.inject({
      method: 'POST',
      url: '/api/storage/reveal-local',
      payload: { path: filePath },
    });

    expect(response.statusCode).toBe(204);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  it('allows backend host filesystem browsing when same-host dev is enabled', async () => {
    env.OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM = true;
    const app = await buildRouteApp();
    fs.writeFileSync(path.join(tmpDir, 'file.ts'), 'export const value = 1;\n');

    const response = await app.inject({
      method: 'GET',
      url: `/api/storage/browse-fs?path=${encodeURIComponent(tmpDir)}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      path: tmpDir,
      entries: [expect.objectContaining({ name: 'file.ts', type: 'file' })],
    });
  });

  it('rejects relative paths', async () => {
    env.OPENWORK_LOCAL_DEV_SAME_HOST_FILESYSTEM = true;
    const app = await buildRouteApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/storage/reveal-local',
      payload: { path: 'relative/file.ts' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ message: 'Path must be absolute' });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});

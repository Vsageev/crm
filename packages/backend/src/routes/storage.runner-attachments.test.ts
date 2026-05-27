import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env.js';
import { registerErrorHandler } from '../plugins/error-handler.js';
import { storageRoutes } from './storage.js';

const mocks = vi.hoisted(() => ({
  authenticateRunnerCredential: vi.fn(async (credential: string) => credential === 'runner-secret'),
  getFilePath: vi.fn(),
  uploadFile: vi.fn(),
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

vi.mock('../services/runner-devices.js', () => ({
  authenticateRunnerCredential: mocks.authenticateRunnerCredential,
}));

vi.mock('../services/storage.js', async () => {
  const actual = await vi.importActual<typeof import('../services/storage.js')>(
    '../services/storage.js',
  );
  return {
    ...actual,
    getFilePath: mocks.getFilePath,
    uploadFile: mocks.uploadFile,
  };
});

vi.mock('node:child_process', () => ({
  spawn: mocks.spawn,
}));

function signRunnerAttachmentDownloadPath(itemId: string, storagePath: string): string {
  return crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(`${itemId}\0${storagePath}`)
    .digest('base64url');
}

async function buildRouteApp() {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(sensible);
  await app.register(multipart);
  app.decorate('authenticate', async (request: { user?: { sub: string } }) => {
    request.user = { sub: 'test-user' };
  });
  registerErrorHandler(app);
  await app.register(storageRoutes);
  return app;
}

describe('runner attachment download endpoint', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openwork-runner-attachment-route-'));
    filePath = path.join(tmpDir, 'brief.txt');
    fs.writeFileSync(filePath, 'runner attachment bytes');
    mocks.getFilePath.mockReturnValue(filePath);
    mocks.uploadFile.mockResolvedValue({
      name: 'uploaded.txt',
      path: '/manual-uploads/uploaded.txt',
      type: 'file',
      mimeType: 'text/plain',
      size: 14,
    });
    mocks.authenticateRunnerCredential.mockClear();
    mocks.getFilePath.mockClear();
    mocks.uploadFile.mockClear();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('requires a valid runner credential', async () => {
    const app = await buildRouteApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/runner-attachments/download?itemId=attachment-1&path=%2Fcard-uploads%2Fbrief.txt&token=x',
    });

    expect(response.statusCode).toBe(401);
    expect(mocks.getFilePath).not.toHaveBeenCalled();
  });

  it('rejects tokens not scoped to the exact manifest item and path', async () => {
    const app = await buildRouteApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/runner-attachments/download?itemId=attachment-1&path=%2Fcard-uploads%2Fbrief.txt&token=wrong',
      headers: { authorization: 'Bearer runner-secret' },
    });

    expect(response.statusCode).toBe(403);
    expect(mocks.getFilePath).not.toHaveBeenCalled();
  });

  it('downloads the storage object for an authorized manifest item', async () => {
    const app = await buildRouteApp();
    const storagePath = '/card-uploads/brief.txt';
    const token = signRunnerAttachmentDownloadPath('attachment-1', storagePath);
    const response = await app.inject({
      method: 'GET',
      url: `/api/runner-attachments/download?itemId=attachment-1&path=${encodeURIComponent(storagePath)}&token=${encodeURIComponent(token)}`,
      headers: { authorization: 'Bearer runner-secret' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('runner attachment bytes');
    expect(mocks.getFilePath).toHaveBeenCalledWith(storagePath);
  });

  it('keeps normal backend-managed upload and download routes on their original auth surface', async () => {
    const app = await buildRouteApp();
    const boundary = 'openwork-storage-boundary';
    const uploadBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from('Content-Disposition: form-data; name="path"\r\n\r\n/manual-uploads\r\n'),
      Buffer.from(`--${boundary}\r\n`),
      Buffer.from(
        'Content-Disposition: form-data; name="file"; filename="uploaded.txt"\r\nContent-Type: text/plain\r\n\r\nuploaded bytes\r\n',
      ),
      Buffer.from(`--${boundary}--\r\n`),
    ]);

    const uploadResponse = await app.inject({
      method: 'POST',
      url: '/api/storage/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: uploadBody,
    });
    expect(uploadResponse.statusCode).toBe(201);
    expect(uploadResponse.json()).toMatchObject({ path: '/manual-uploads/uploaded.txt' });
    expect(mocks.uploadFile).toHaveBeenCalledWith(
      '/manual-uploads',
      'uploaded.txt',
      'text/plain',
      Buffer.from('uploaded bytes'),
    );

    const downloadResponse = await app.inject({
      method: 'GET',
      url: '/api/storage/download?path=%2Fmanual-uploads%2Fuploaded.txt',
    });
    expect(downloadResponse.statusCode).toBe(200);
    expect(downloadResponse.body).toBe('runner attachment bytes');
    expect(mocks.getFilePath).toHaveBeenCalledWith('/manual-uploads/uploaded.txt');
  });
});

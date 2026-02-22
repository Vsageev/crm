import { describe, it, expect } from 'vitest';
import { buildApp } from './app.js';

describe('App', () => {
  it('should build the fastify app', async () => {
    const app = await buildApp();
    expect(app).toBeDefined();
    expect(app.server).toBeDefined();
    await app.close();
  });
});

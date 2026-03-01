import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'tmp-test.ts',
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'off',
  },
  reporter: 'list',
  timeout: 30000,
});

import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: 2,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4173/network-test/',
    viewport: { width: 1440, height: 1080 },
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // First-visit tours would cover the workspaces; tests that want them clear this (see tour.spec.ts).
    storageState: { cookies: [], origins: [{ origin: 'http://127.0.0.1:4173', localStorage: ['playground', 'aws', 'terraform'].map(id => ({ name: `path:${id}-tour`, value: '1' })) }] },
  },
  webServer: { command: 'node tests/serve.mjs', port: 4173, reuseExistingServer: !process.env.CI },
});

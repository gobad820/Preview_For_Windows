import { defineConfig, devices } from '@playwright/test';

// Each worktree/agent can pick its own port so concurrent runs never share a preview server.
const port = Number(process.env['PW_PORT'] ?? 4173);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  use: { baseURL, viewport: { width: 1200, height: 800 } },
  webServer: {
    command: `npm run build && npm run preview -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1200, height: 800 } } },
    {
      name: 'chromium-hidpi',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 },
      testMatch: /viewer\.spec\.ts/,
    },
  ],
});

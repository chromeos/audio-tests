import { defineConfig, devices } from '@playwright/test';

const isDev = process.env.TEST_ENV === 'dev';
// Override with PREVIEW_PORT when 8080 is taken. Playwright reuses whatever
// already answers on the port, so a collision means testing the wrong server.
const previewPort = Number(process.env.PREVIEW_PORT) || 8080;
const port = isDev ? 8000 : previewPort;
const command = isDev ? 'pnpm run serve:dev' : 'pnpm run serve:dist';

export default defineConfig({
  testDir: './tests',
  // Browser tests only; tests/unit/*.test.ts run under vitest (pnpm test:unit).
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run local dev server before starting tests */
  webServer: {
    command: command,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 20 * 1000, // Dev server compilation might take slightly longer
  },
});

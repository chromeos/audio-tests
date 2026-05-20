import { defineConfig, devices } from '@playwright/test';

const isDev = process.env.TEST_ENV === 'dev';
const port = isDev ? 8000 : 8080;
const command = isDev ? 'yarn run serve:dev' : 'yarn run serve:dist';

export default defineConfig({
  testDir: './tests',
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

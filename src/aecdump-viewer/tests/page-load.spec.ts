import { test, expect } from '@playwright/test';

test.describe('AECDump Web Viewer Page Load', () => {
  const errors: Error[] = [];
  const consoleErrors: string[] = [];
  const networkFailures: string[] = [];

  test.beforeEach(({ page }) => {
    // Clear error logs before each test
    errors.length = 0;
    consoleErrors.length = 0;
    networkFailures.length = 0;

    // 1. Catch unhandled exceptions
    page.on('pageerror', (exception) => {
      console.error(`[Page Error] ${exception.stack || exception.message}`);
      errors.push(exception);
    });

    // 2. Catch console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error(`[Console Error] ${msg.text()}`);
        consoleErrors.push(msg.text());
      }
    });

    // 3. Catch network failures and incorrect MIME-types
    page.on('response', (response) => {
      const status = response.status();
      const url = response.url();

      if (status >= 400) {
        const failure = `${url} (HTTP ${status})`;
        console.error(`[Network Failure] ${failure}`);
        networkFailures.push(failure);
      }

      // Verify that Javascript assets are served with correct MIME-types to prevent loading crashes
      const contentType = response.headers()['content-type'] || '';
      if (url.endsWith('.js') && !contentType.includes('javascript')) {
        const failure = `${url} (Invalid MIME: "${contentType}", expected "application/javascript")`;
        console.error(`[MIME Type Error] ${failure}`);
        networkFailures.push(failure);
      }
    });
  });

  test('should boot successfully with clean logs and correct visuals', async ({ page }) => {
    // Navigate to the app root
    await page.goto('/');

    // Assert that the main drag-and-drop area is visible
    const dropzone = page.locator('.dropzone');
    await expect(dropzone).toBeVisible();
    
    const dropzoneText = await dropzone.locator('p').innerText();
    expect(dropzoneText).toContain('Drag & drop an aecdump/protobuf file here');

    // Assert there are no unhandled JS exceptions
    expect(errors, 'Uncaught exceptions were thrown during load').toHaveLength(0);

    // Assert there are no console errors
    expect(consoleErrors, 'Errors were logged to the browser console').toHaveLength(0);

    // Assert there are no network or MIME-type resolution failures
    expect(networkFailures, 'Asset requests failed to load').toHaveLength(0);
  });
});

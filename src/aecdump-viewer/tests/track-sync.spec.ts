import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, 'fixtures', 'synthetic-2s.aecdump.binpb');

const TRACK_IDS = ['ref', 'mic', 'out'] as const;

/** Reads each track's wavesurfer clock straight off the component. */
async function currentTimes(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const el = document.querySelector('aecdump-viewer') as any;
    const tracks = el.tracks;
    return {
      ref: tracks.ref.ws.getCurrentTime(),
      mic: tracks.mic.ws.getCurrentTime(),
      out: tracks.out.ws.getCurrentTime(),
      duration: tracks.mic.ws.getDuration(),
    };
  });
}

test.describe('synchronized seeking', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('#fileInput').setInputFiles(FIXTURE);
    // Every track must have decoded before its clock means anything.
    await page.waitForFunction(
      (ids) => {
        const el = document.querySelector('aecdump-viewer') as any;
        return el?.tracks && ids.every((id: string) => el.tracks[id].ws?.getDuration() > 0);
      },
      TRACK_IDS as unknown as string[],
      { timeout: 20000 }
    );
  });

  test('dragging a waveform moves every track to the dragged position', async ({ page }) => {
    // wavesurfer emits 'interaction' as soon as the drag starts but debounces
    // the actual seek by 200ms while paused, so a handler that reads
    // getCurrentTime() sees the pre-drag position and leaves the other tracks
    // behind. The event argument carries the correct target time.
    const box = await page.locator('#waveform-ref').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const targetFraction = 0.7;
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * targetFraction, box.y + box.height / 2, {
      steps: 12,
    });
    await page.mouse.up();

    // Wait past the drag-to-seek debounce so the dragged track has settled too.
    await page.waitForTimeout(600);
    const times = await currentTimes(page);

    const target = times.duration * targetFraction;
    const tolerance = times.duration * 0.05;
    for (const id of TRACK_IDS) {
      expect(
        Math.abs(times[id] - target),
        `${id} should be at the dragged position`
      ).toBeLessThan(tolerance);
    }
  });

  test('clicking a waveform moves every track to the clicked position', async ({ page }) => {
    const box = await page.locator('#waveform-mic').boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    const targetFraction = 0.4;
    await page.mouse.click(box.x + box.width * targetFraction, box.y + box.height / 2);
    await page.waitForTimeout(300);

    const times = await currentTimes(page);
    const target = times.duration * targetFraction;
    const tolerance = times.duration * 0.05;
    for (const id of TRACK_IDS) {
      expect(Math.abs(times[id] - target), `${id} should be at the clicked position`).toBeLessThan(
        tolerance
      );
    }
  });
});

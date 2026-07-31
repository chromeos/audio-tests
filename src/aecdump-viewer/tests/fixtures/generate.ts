/**
 * Writes the committed test fixtures. Run with `yarn fixtures:generate` after
 * changing make-dump.ts; the output is committed so the browser tests can run
 * without a generation step.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeInt16Dump } from './make-dump.js';

const here = dirname(fileURLToPath(import.meta.url));

// 2 seconds is long enough for a drag across the waveform to land somewhere
// unambiguous, and small enough (~200KB) to keep in the repo.
const dump = makeInt16Dump({ frames: 200, sampleRate: 16000, channels: 1 });
const target = join(here, 'synthetic-2s.aecdump.binpb');
writeFileSync(target, Buffer.from(dump));
console.log(`wrote ${target} (${dump.byteLength} bytes)`);

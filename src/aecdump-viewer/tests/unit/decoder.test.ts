import { describe, it, expect } from 'vitest';
import { parseAecDump } from '../../src/decoder.js';
import {
  makeInt16Dump,
  makeFloatDump,
  countUnalignedInt16Payloads,
  samplesPerFrame,
} from '../fixtures/make-dump.js';

const RATE = 16000;
const PER_FRAME = samplesPerFrame(RATE);

/** Position of the signal's energy on the timeline, in capture frames. */
function energyCentroidFrames(channel: Float32Array): number {
  let energy = 0;
  let weighted = 0;
  for (let i = 0; i < channel.length; i++) {
    const e = channel[i] * channel[i];
    energy += e;
    weighted += e * i;
  }
  return energy === 0 ? NaN : weighted / energy / PER_FRAME;
}

describe('int16 payloads', () => {
  it('decodes payloads that land on an unaligned byteOffset', () => {
    // protobufjs returns bytes fields as subarray views into the dump buffer at
    // an arbitrary byteOffset, but Int16Array requires 2-byte alignment.
    const frames = 20;
    const dump = makeInt16Dump({ frames, sampleRate: RATE, channels: 1 });

    // Guard the premise: if the fixture ever stops producing odd offsets, this
    // test would pass without exercising anything.
    expect(countUnalignedInt16Payloads(dump)).toBeGreaterThan(0);

    const result = parseAecDump(dump);
    expect(result.input.channelData[0].length).toBe(frames * PER_FRAME);
    expect(result.output.channelData[0].length).toBe(frames * PER_FRAME);
    expect(result.reference.channelData[0].length).toBe(frames * PER_FRAME);
  });

  it('preserves sample values through the alignment copy', () => {
    const dump = makeInt16Dump({ frames: 4, sampleRate: RATE, channels: 1 });
    const result = parseAecDump(dump);
    // Fixture writes ((seed + i) % 1000) * 30, seed 100 for input frame 0.
    expect(result.input.channelData[0][0]).toBeCloseTo((100 * 30) / 32768, 6);
    expect(result.input.channelData[0][1]).toBeCloseTo((101 * 30) / 32768, 6);
  });

  it('reports the format from the INIT event', () => {
    const dump = makeInt16Dump({ frames: 4, sampleRate: 48000, channels: 2 });
    const result = parseAecDump(dump);
    expect(result.input.sampleRate).toBe(48000);
    expect(result.input.channels).toBe(2);
    expect(result.input.channelData).toHaveLength(2);
  });
});

describe('input/output lockstep', () => {
  it('keeps both streams the same length when neither is dropped', () => {
    const frames = 20;
    const result = parseAecDump(makeFloatDump({ frames, sampleRate: RATE }));
    expect(result.input.channelData[0].length).toBe(frames * PER_FRAME);
    expect(result.output.channelData[0].length).toBe(frames * PER_FRAME);
  });

  it('pads a gap so later audio keeps its position', () => {
    const frames = 20;
    const result = parseAecDump(
      makeFloatDump({ frames, sampleRate: RATE, dropOutput: [5, 6, 7] })
    );
    // Without padding the output would be three frames short and everything
    // after the gap would sit 30ms early.
    expect(result.output.channelData[0].length).toBe(frames * PER_FRAME);
    expect(result.input.channelData[0].length).toBe(frames * PER_FRAME);

    // The gap itself must be silent.
    const out = result.output.channelData[0];
    const gap = out.subarray(5 * PER_FRAME, 8 * PER_FRAME);
    expect(gap.every((s) => s === 0)).toBe(true);
  });

  it('places a late-starting stream at its true offset, not at zero', () => {
    const frames = 20;
    const startFrame = 10;
    const dropOutput = Array.from({ length: startFrame }, (_, i) => i);
    const result = parseAecDump(makeFloatDump({ frames, sampleRate: RATE, dropOutput }));

    const out = result.output.channelData[0];
    expect(out.length).toBe(frames * PER_FRAME);
    // Everything before startFrame is silence...
    expect(out.subarray(0, startFrame * PER_FRAME).every((s) => s === 0)).toBe(true);
    // ...and the energy sits in the second half, not at the beginning.
    expect(energyCentroidFrames(out)).toBeGreaterThan(startFrame);
  });

  it('pads a gap at the very end of the dump', () => {
    // Padding is triggered by the next append, so trailing gaps have no
    // following chunk to trigger it and the stream would otherwise end short.
    const frames = 20;
    const result = parseAecDump(
      makeFloatDump({ frames, sampleRate: RATE, dropOutput: [17, 18, 19] })
    );
    expect(result.output.channelData[0].length).toBe(frames * PER_FRAME);
    expect(result.input.channelData[0].length).toBe(frames * PER_FRAME);

    const tail = result.output.channelData[0].subarray(17 * PER_FRAME);
    expect(tail.every((s) => s === 0)).toBe(true);
  });

  it('pads a trailing gap on the input stream too', () => {
    const frames = 20;
    const result = parseAecDump(
      makeFloatDump({ frames, sampleRate: RATE, dropInput: [18, 19] })
    );
    expect(result.input.channelData[0].length).toBe(frames * PER_FRAME);
    expect(result.output.channelData[0].length).toBe(frames * PER_FRAME);
  });

  it('handles the input stream dropping out too', () => {
    const frames = 20;
    const result = parseAecDump(
      makeFloatDump({ frames, sampleRate: RATE, dropInput: [2, 3] })
    );
    expect(result.input.channelData[0].length).toBe(frames * PER_FRAME);
    expect(result.output.channelData[0].length).toBe(frames * PER_FRAME);
  });

  it('leaves a stream that never appears empty rather than padding it', () => {
    const frames = 20;
    const dropOutput = Array.from({ length: frames }, (_, i) => i);
    const result = parseAecDump(makeFloatDump({ frames, sampleRate: RATE, dropOutput }));
    // A full-length silent track would render as a real but silent stream.
    expect(result.output.channelData[0].length).toBe(0);
    expect(result.input.channelData[0].length).toBe(frames * PER_FRAME);
  });
});

describe('malformed input', () => {
  it('stops cleanly at a truncated message rather than throwing', () => {
    const full = makeInt16Dump({ frames: 10, sampleRate: RATE });
    const truncated = full.slice(0, Math.floor(full.byteLength * 0.6));
    const result = parseAecDump(truncated);
    expect(result.input.channelData[0].length).toBeGreaterThan(0);
    expect(result.input.channelData[0].length).toBeLessThan(10 * PER_FRAME);
  });

  it('returns empty streams for an empty buffer', () => {
    const result = parseAecDump(new ArrayBuffer(0));
    expect(result.input.channelData).toHaveLength(0);
    expect(result.reference.channelData).toHaveLength(0);
  });
});

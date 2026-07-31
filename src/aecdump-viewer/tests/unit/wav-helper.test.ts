import { describe, it, expect } from 'vitest';
import { audioBufferToWav } from '../../src/wav-helper.js';

const RATE = 16000;
const FRAMES = 1600; // 100ms

/**
 * Minimal stand-in for AudioBuffer; audioBufferToWav only reads these three
 * members, and there is no Web Audio API under the unit test runner.
 */
function fakeBuffer(numChannels: number): AudioBuffer {
  const channels = Array.from({ length: numChannels }, (_, c) => {
    const data = new Float32Array(FRAMES);
    for (let i = 0; i < FRAMES; i++) {
      data[i] = (Math.sin(i / 10) * (c + 1)) / numChannels;
    }
    return data;
  });
  return {
    numberOfChannels: numChannels,
    sampleRate: RATE,
    getChannelData: (c: number) => channels[c],
  } as unknown as AudioBuffer;
}

function readWavHeader(wav: ArrayBuffer) {
  const view = new DataView(wav);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitDepth = view.getUint16(34, true);
  const dataBytes = view.getUint32(40, true);
  const frames = dataBytes / (channels * (bitDepth / 8));
  return { channels, sampleRate, bitDepth, frames, durationMs: (frames / sampleRate) * 1000 };
}

describe('audioBufferToWav', () => {
  it.each([1, 2, 3, 4, 8])(
    'writes a header describing the data actually written (%i channels)',
    (numChannels) => {
      // A header claiming N channels for downmixed mono data makes the file
      // play N times too fast and come out 1/N the length.
      const header = readWavHeader(audioBufferToWav(fakeBuffer(numChannels)));
      expect(header.durationMs).toBeCloseTo(100, 6);
      expect(header.sampleRate).toBe(RATE);
      expect(header.frames).toBe(FRAMES);
    }
  );

  it('keeps both channels for stereo', () => {
    const header = readWavHeader(audioBufferToWav(fakeBuffer(2)));
    expect(header.channels).toBe(2);
  });

  it('downmixes more than two channels to mono', () => {
    const header = readWavHeader(audioBufferToWav(fakeBuffer(4)));
    expect(header.channels).toBe(1);
  });

  it('writes 16-bit PCM by default and 32-bit float on request', () => {
    expect(readWavHeader(audioBufferToWav(fakeBuffer(1))).bitDepth).toBe(16);
    const float = audioBufferToWav(fakeBuffer(1), { float32: true });
    const header = readWavHeader(float);
    expect(header.bitDepth).toBe(32);
    expect(header.durationMs).toBeCloseTo(100, 6);
  });
});

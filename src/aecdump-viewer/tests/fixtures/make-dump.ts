/**
 * Synthesizes aecdump files for tests.
 *
 * The dump format is a sequence of [int32 little-endian length][Event protobuf]
 * records, matching what WebRTC's AecDump writer produces and what
 * rtc_tools/unpack_aecdump reads. One STREAM event is one 10ms capture frame.
 */
import { webrtc } from '../../src/proto/debug.js';

const Event = webrtc.audioproc.Event;

/** Samples per channel in one 10ms APM frame, as unpack.cc computes it. */
export function samplesPerFrame(sampleRate: number): number {
  return Math.round(sampleRate / 100);
}

function frameMessage(payload: webrtc.audioproc.IEvent): Uint8Array {
  const body = Event.encode(payload).finish();
  const out = new Uint8Array(4 + body.length);
  new DataView(out.buffer).setInt32(0, body.length, true);
  out.set(body, 4);
  return out;
}

function concat(parts: Uint8Array[]): ArrayBuffer {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out.buffer;
}

/** Interleaved int16 payload: `samples` per channel across `channels`. */
function int16Payload(samples: number, channels: number, seed: number): Uint8Array {
  const bytes = new Uint8Array(samples * channels * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples * channels; i++) {
    view.setInt16(i * 2, ((seed + i) % 1000) * 30, true);
  }
  return bytes;
}

/** Deinterleaved float payload for a single channel. */
function floatPayload(samples: number, seed: number): Uint8Array {
  const floats = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    floats[i] = Math.sin((seed + i) / 20) * 0.5;
  }
  return new Uint8Array(floats.buffer);
}

function initMessage(sampleRate: number, channels: number): Uint8Array {
  return frameMessage({
    type: Event.Type.INIT,
    init: {
      sampleRate,
      outputSampleRate: sampleRate,
      reverseSampleRate: sampleRate,
      numInputChannels: channels,
      numOutputChannels: channels,
      numReverseChannels: channels,
    },
  });
}

export interface DumpOptions {
  frames?: number;
  sampleRate?: number;
  channels?: number;
}

/**
 * int16 dump: each capture frame is preceded by a render frame.
 *
 * Payload sizes vary enough that roughly half the `bytes` fields land on an odd
 * byteOffset once protobufjs hands back its subarray views, which is what
 * exercises the Int16Array alignment path in the decoder.
 */
export function makeInt16Dump({
  frames = 100,
  sampleRate = 16000,
  channels = 1,
}: DumpOptions = {}): ArrayBuffer {
  const perFrame = samplesPerFrame(sampleRate);
  const parts = [initMessage(sampleRate, channels)];
  for (let i = 0; i < frames; i++) {
    parts.push(
      frameMessage({
        type: Event.Type.REVERSE_STREAM,
        reverseStream: { data: int16Payload(perFrame, channels, i) },
      })
    );
    parts.push(
      frameMessage({
        type: Event.Type.STREAM,
        stream: {
          inputData: int16Payload(perFrame, channels, i + 100),
          outputData: int16Payload(perFrame, channels, i + 200),
          delay: 40 + (i % 20),
        },
      })
    );
  }
  return concat(parts);
}

export interface FloatDumpOptions extends DumpOptions {
  /** Capture frame indices whose STREAM event omits the output stream. */
  dropOutput?: number[];
  /** Capture frame indices whose STREAM event omits the input stream. */
  dropInput?: number[];
}

/** Deinterleaved-float dump, optionally with streams missing from some frames. */
export function makeFloatDump({
  frames = 100,
  sampleRate = 16000,
  channels = 1,
  dropOutput = [],
  dropInput = [],
}: FloatDumpOptions = {}): ArrayBuffer {
  const perFrame = samplesPerFrame(sampleRate);
  const parts = [initMessage(sampleRate, channels)];
  for (let i = 0; i < frames; i++) {
    const stream: webrtc.audioproc.IStream = { delay: 40 };
    if (!dropInput.includes(i)) {
      stream.inputChannel = Array.from({ length: channels }, (_, c) =>
        floatPayload(perFrame, i + c * 7)
      );
    }
    if (!dropOutput.includes(i)) {
      stream.outputChannel = Array.from({ length: channels }, (_, c) =>
        floatPayload(perFrame, i + 50 + c * 7)
      );
    }
    parts.push(frameMessage({ type: Event.Type.STREAM, stream }));
  }
  return concat(parts);
}

/**
 * Counts int16 payloads that land on an odd byteOffset when the dump is
 * re-read, i.e. how many would hit the unaligned path in the decoder.
 */
export function countUnalignedInt16Payloads(dump: ArrayBuffer): number {
  const view = new DataView(dump);
  let offset = 0;
  let unaligned = 0;
  while (offset < dump.byteLength) {
    const size = view.getInt32(offset, true);
    offset += 4;
    const event = Event.decode(new Uint8Array(dump, offset, size));
    const payloads = [
      event.stream?.inputData,
      event.stream?.outputData,
      event.reverseStream?.data,
    ];
    for (const payload of payloads) {
      if (payload && payload.byteLength > 0 && payload.byteOffset % 2 !== 0) {
        unaligned++;
      }
    }
    offset += size;
  }
  return unaligned;
}

import { webrtc } from './proto/debug.js';

const Event = webrtc.audioproc.Event;

export interface ParsedAudioStream {
  sampleRate: number;
  channels: number;
  channelData: Float32Array[];
}

export interface DecoderResult {
  reference: ParsedAudioStream;
  input: ParsedAudioStream;
  output: ParsedAudioStream;
}

class ChannelAccumulator {
  private chunks: Float32Array[] = [];
  private totalLength = 0;

  append(chunk: Float32Array) {
    this.chunks.push(chunk);
    this.totalLength += chunk.length;
  }

  get length() {
    return this.totalLength;
  }

  getMerged(): Float32Array {
    const merged = new Float32Array(this.totalLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }
}

class StreamAccumulator {
  public accumulators: ChannelAccumulator[] = [];
  public sampleRate = 0;
  public channels = 0;

  init(sampleRate: number, channels: number) {
    if (this.sampleRate === 0) {
      this.sampleRate = sampleRate;
      this.channels = channels;
      this.accumulators = Array.from({ length: channels }, () => new ChannelAccumulator());
    } else if (this.sampleRate !== sampleRate || this.channels !== channels) {
      console.warn(
        `StreamAccumulator: Audio format changed mid-dump! ` +
        `Old: ${this.sampleRate}Hz/${this.channels}ch, ` +
        `New: ${sampleRate}Hz/${channels}ch. V1 ignores mid-dump format changes.`
      );
    }
  }

  appendInterleavedInt16(bytes: Uint8Array) {
    if (this.channels === 0) return;
    const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    const numSamples = int16.length / this.channels;
    
    // Temporary chunks for each channel
    const chunks = Array.from({ length: this.channels }, () => new Float32Array(numSamples));
    
    let index = 0;
    for (let i = 0; i < numSamples; i++) {
      for (let c = 0; c < this.channels; c++) {
        chunks[c][i] = int16[index++] / 32768.0;
      }
    }

    for (let c = 0; c < this.channels; c++) {
      this.accumulators[c].append(chunks[c]);
    }
  }

  appendDeinterleavedFloat(channelsBytes: Uint8Array[]) {
    if (this.channels === 0) return;
    const actualChannels = Math.min(this.channels, channelsBytes.length);
    for (let c = 0; c < actualChannels; c++) {
      const bytes = channelsBytes[c];
      let floatData: Float32Array;
      if (bytes.byteOffset % 4 === 0) {
        floatData = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
      } else {
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        floatData = new Float32Array(copy.buffer, 0, copy.byteLength / 4);
      }
      this.accumulators[c].append(floatData);
    }
  }

  toParsedStream(): ParsedAudioStream {
    return {
      sampleRate: this.sampleRate || 16000, // fallback
      channels: this.channels || 1,
      channelData: this.accumulators.map((acc) => acc.getMerged()),
    };
  }
}

export function parseAecDump(arrayBuffer: ArrayBuffer): DecoderResult {
  const view = new DataView(arrayBuffer);
  let offset = 0;

  const refAcc = new StreamAccumulator();
  const inputAcc = new StreamAccumulator();
  const outputAcc = new StreamAccumulator();

  let eventCount = 0;

  while (offset < arrayBuffer.byteLength) {
    if (offset + 4 > arrayBuffer.byteLength) {
      console.warn('parseAecDump: Unexpected EOF while reading message size.');
      break;
    }
    const size = view.getInt32(offset, true);
    offset += 4;

    if (offset + size > arrayBuffer.byteLength) {
      console.warn('parseAecDump: Unexpected EOF while reading message payload.');
      break;
    }

    const eventBytes = new Uint8Array(arrayBuffer, offset, size);
    offset += size;

    let event: webrtc.audioproc.Event;
    try {
      event = Event.decode(eventBytes);
    } catch (e) {
      console.error(`parseAecDump: Failed to decode event #${eventCount} at offset ${offset - size - 4}:`, e);
      continue;
    }

    eventCount++;

    switch (event.type) {
      case Event.Type.INIT: {
        const init = event.init;
        if (!init) break;
        
        const sampleRate = init.sampleRate || 16000;
        const reverseSampleRate = init.reverseSampleRate || sampleRate;
        const outputSampleRate = init.outputSampleRate || sampleRate;

        const inputChannels = init.numInputChannels || 1;
        const outputChannels = init.numOutputChannels || 1;
        const reverseChannels = init.numReverseChannels || 1;

        refAcc.init(reverseSampleRate, reverseChannels);
        inputAcc.init(sampleRate, inputChannels);
        outputAcc.init(outputSampleRate, outputChannels);
        break;
      }

      case Event.Type.REVERSE_STREAM: {
        const rev = event.reverseStream;
        if (!rev) break;

        if (rev.data && rev.data.length > 0) {
          refAcc.appendInterleavedInt16(rev.data);
        } else if (rev.channel && rev.channel.length > 0) {
          refAcc.appendDeinterleavedFloat(rev.channel);
        }
        break;
      }

      case Event.Type.STREAM: {
        const stream = event.stream;
        if (!stream) break;

        // Input
        if (stream.inputData && stream.inputData.length > 0) {
          inputAcc.appendInterleavedInt16(stream.inputData);
        } else if (stream.inputChannel && stream.inputChannel.length > 0) {
          inputAcc.appendDeinterleavedFloat(stream.inputChannel);
        }

        // Output
        if (stream.outputData && stream.outputData.length > 0) {
          outputAcc.appendInterleavedInt16(stream.outputData);
        } else if (stream.outputChannel && stream.outputChannel.length > 0) {
          outputAcc.appendDeinterleavedFloat(stream.outputChannel);
        }
        break;
      }

      default:
        // Config, RuntimeSetting, Unknown are ignored in V1 decoder
        break;
    }
  }

  console.log(`parseAecDump: Successfully parsed ${eventCount} events.`);

  return {
    reference: refAcc.toParsedStream(),
    input: inputAcc.toParsedStream(),
    output: outputAcc.toParsedStream(),
  };
}

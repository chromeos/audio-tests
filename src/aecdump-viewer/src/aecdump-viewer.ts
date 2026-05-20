import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import WaveSurfer from 'wavesurfer.js';
import { parseAecDump, DecoderResult } from './decoder.js';
import { audioBufferToWav } from './wav-helper.js';

interface Track {
  id: 'ref' | 'mic' | 'out';
  name: string;
  ws: WaveSurfer | null;
  muted: boolean;
  soloed: boolean;
  volume: number;
  url: string | null;
}

@customElement('aecdump-viewer')
export class AecDumpViewer extends LitElement {
  @state() private loading = false;
  @state() private loadingStatus = '';
  @state() private isPlaying = false;
  @state() private duration = 0;
  @state() private currentTime = 0;

  @state() private tracks: Record<string, Track> = {
    ref: { id: 'ref', name: 'Reference (Playout)', ws: null, muted: false, soloed: false, volume: 1.0, url: null },
    mic: { id: 'mic', name: 'Microphone Input', ws: null, muted: false, soloed: false, volume: 1.0, url: null },
    out: { id: 'out', name: 'Processed Output', ws: null, muted: false, soloed: false, volume: 1.0, url: null },
  };

  private audioCtx: AudioContext | null = null;
  private syncSeeking = false;

  static override styles = css`
    :host {
      display: block;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
    }

    header {
      margin-bottom: 30px;
      border-bottom: 1px solid #eee;
      padding-bottom: 20px;
    }

    h1 {
      margin: 0 0 10px 0;
      font-size: 24px;
      color: #1a73e8;
    }

    .description {
      margin: 0;
      color: #666;
      font-size: 14px;
    }

    .dropzone {
      border: 2px dashed #ccc;
      border-radius: 8px;
      padding: 40px 20px;
      text-align: center;
      background: #fafafa;
      cursor: pointer;
      transition: border-color 0.2s, background-color 0.2s;
      margin-bottom: 20px;
    }

    .dropzone:hover, .dropzone.dragover {
      border-color: #1a73e8;
      background: #f1f3f4;
    }

    .dropzone p {
      margin: 0;
      font-size: 16px;
      color: #5f6368;
    }

    .dropzone input {
      display: none;
    }

    .status {
      padding: 10px 15px;
      border-radius: 4px;
      background: #e8f0fe;
      color: #1a73e8;
      margin-bottom: 20px;
      font-size: 14px;
    }

    .controls {
      display: flex;
      align-items: center;
      gap: 15px;
      margin-bottom: 25px;
      background: #f8f9fa;
      padding: 15px;
      border-radius: 8px;
      border: 1px solid #e0e0e0;
    }

    button {
      background: #1a73e8;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
      font-size: 14px;
    }

    button:hover {
      background: #1557b0;
    }

    button:disabled {
      background: #ccc;
      cursor: not-allowed;
    }

    button.secondary {
      background: #f1f3f4;
      color: #3c4043;
      border: 1px solid #dadce0;
    }

    button.secondary:hover {
      background: #e8eaed;
    }

    button.active {
      background: #d93025;
    }

    button.active:hover {
      background: #b0251a;
    }

    .time-display {
      font-family: monospace;
      font-size: 14px;
      color: #5f6368;
      margin-left: auto;
    }

    .tracks-container {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .track-card {
      border: 1px solid #dadce0;
      border-radius: 8px;
      background: white;
      overflow: hidden;
      box-shadow: 0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 3px 1px rgba(60,64,67,0.15);
    }

    .track-header {
      background: #f8f9fa;
      padding: 10px 15px;
      border-bottom: 1px solid #dadce0;
      display: flex;
      align-items: center;
      gap: 15px;
    }

    .track-title {
      font-weight: 600;
      font-size: 14px;
      color: #3c4043;
    }

    .track-controls {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
    }

    .track-controls button {
      padding: 4px 8px;
      font-size: 12px;
    }

    .track-controls button.mute.active {
      background: #f28b82;
      color: #b00020;
      border-color: #f28b82;
    }

    .track-controls button.solo.active {
      background: #fdd663;
      color: #875900;
      border-color: #fdd663;
    }

    .volume-slider {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      color: #5f6368;
    }

    .volume-slider input {
      width: 80px;
    }

    .track-body {
      padding: 15px;
      background: #fafafa;
      position: relative;
    }

    .waveform-container {
      background: white;
      border: 1px solid #eee;
      border-radius: 4px;
      min-height: 80px;
    }
  `;

  override render() {
    const hasTracks = Object.values(this.tracks).some(t => t.url !== null);

    return html`
      <header>
        <h1>AECDump Web Viewer (V1)</h1>
        <p class="description">In-browser parser and synchronized waveform player for WebRTC APM audio dumps.</p>
      </header>

      <div 
        class="dropzone" 
        @dragover=${this.onDragOver}
        @dragleave=${this.onDragLeave}
        @drop=${this.onDrop}
        @click=${this.triggerFileSelect}
      >
        <p>${this.loading ? 'Parsing dump...' : 'Drag & drop an aecdump/protobuf file here, or click to select'}</p>
        <input type="file" id="fileInput" accept=".pb,.aecdump,*" @change=${this.onFileSelected}>
      </div>

      ${this.loadingStatus ? html`<div class="status">${this.loadingStatus}</div>` : ''}

      ${hasTracks ? html`
        <div class="controls">
          <button @click=${this.togglePlay}>${this.isPlaying ? 'Pause' : 'Play'}</button>
          <button class="secondary" @click=${this.stopAll}>Stop</button>
          
          <div class="time-display">
            ${this.formatTime(this.currentTime)} / ${this.formatTime(this.duration)}
          </div>
        </div>

        <div class="tracks-container">
          ${Object.values(this.tracks).map(track => this.renderTrackCard(track))}
        </div>
      ` : ''}
    `;
  }

  private renderTrackCard(track: Track) {
    if (!track.url) return '';

    return html`
      <div class="track-card">
        <div class="track-header">
          <span class="track-title">${track.name}</span>
          
          <div class="track-controls">
            <div class="volume-slider">
              <span>Vol:</span>
              <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.05" 
                .value=${track.volume.toString()}
                @input=${(e: Event) => this.onVolumeChange(track.id, e)}
              >
            </div>

            <button 
              class="secondary mute ${track.muted ? 'active' : ''}" 
              @click=${() => this.toggleMute(track.id)}
            >
              Mute
            </button>
            <button 
              class="secondary solo ${track.soloed ? 'active' : ''}" 
              @click=${() => this.toggleSolo(track.id)}
            >
              Solo
            </button>
          </div>
        </div>
        <div class="track-body">
          <div class="waveform-container" id="waveform-${track.id}"></div>
        </div>
      </div>
    `;
  }

  // File selection & drag-drop handling
  private triggerFileSelect() {
    this.shadowRoot?.getElementById('fileInput')?.click();
  }

  private onDragOver(e: DragEvent) {
    e.preventDefault();
    this.shadowRoot?.querySelector('.dropzone')?.classList.add('dragover');
  }

  private onDragLeave() {
    this.shadowRoot?.querySelector('.dropzone')?.classList.remove('dragover');
  }

  private onDrop(e: DragEvent) {
    e.preventDefault();
    this.onDragLeave();
    const file = e.dataTransfer?.files[0];
    if (file) this.processFile(file);
  }

  private onFileSelected(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) this.processFile(file);
  }

  private async processFile(file: File) {
    this.loading = true;
    this.loadingStatus = `Loading file: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)...`;
    this.stopAll();
    this.destroyWaveSurfers();

    try {
      const arrayBuffer = await file.arrayBuffer();
      this.loadingStatus = 'Parsing AECDump protobuf data...';
      
      // Small delay to allow UI to update
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const parsed = parseAecDump(arrayBuffer);
      
      this.loadingStatus = 'Decoding audio and preparing tracks...';
      await new Promise(resolve => setTimeout(resolve, 50));

      await this.initializeTracks(parsed);
      this.loadingStatus = 'AECDump loaded successfully!';
    } catch (error) {
      console.error(error);
      this.loadingStatus = `Error: ${(error as Error).message}`;
    } finally {
      this.loading = false;
    }
  }

  // Convert parsed raw PCM streams into WAV Blob URLs
  private async initializeTracks(parsed: DecoderResult) {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    // Helper to convert ParsedAudioStream to Blob URL
    const createWavUrl = (stream: typeof parsed.reference) => {
      if (stream.channelData.length === 0 || stream.channelData[0].length === 0) {
        return null;
      }
      // Create AudioBuffer
      const buffer = this.audioCtx!.createBuffer(
        stream.channels,
        stream.channelData[0].length,
        stream.sampleRate
      );
      for (let c = 0; c < stream.channels; c++) {
        buffer.copyToChannel(stream.channelData[c] as any, c);
      }
      // Encode to WAV
      const wavBytes = audioBufferToWav(buffer);
      const blob = new Blob([wavBytes], { type: 'audio/wav' });
      return URL.createObjectURL(blob);
    };

    // Generate URLs
    const refUrl = createWavUrl(parsed.reference);
    const micUrl = createWavUrl(parsed.input);
    const outUrl = createWavUrl(parsed.output);

    // Update track state
    this.tracks = {
      ref: { ...this.tracks.ref, url: refUrl },
      mic: { ...this.tracks.mic, url: micUrl },
      out: { ...this.tracks.out, url: outUrl },
    };

    // Request Lit update so track-cards render, then initialize WaveSurfers on the DOM
    this.requestUpdate();
    await this.updateComplete;

    this.initWaveSurfers();
  }

  private initWaveSurfers() {
    const wsOptions = {
      height: 80,
      waveColor: '#a8c7fa',
      progressColor: '#1a73e8',
      cursorColor: '#3c4043',
      cursorWidth: 2,
      dragToSeek: true,
      normalize: true,
    };

    // Initialize each active track
    Object.values(this.tracks).forEach(track => {
      if (!track.url) return;

      const container = this.shadowRoot?.getElementById(`waveform-${track.id}`);
      if (!container) return;

      const ws = WaveSurfer.create({
        ...wsOptions,
        container: container,
        url: track.url,
      });

      track.ws = ws;

      // Sync Mute/Volume state
      ws.setMuted(track.muted);
      ws.setVolume(track.volume);

      // Bind events
      if (track.id === 'mic') {
        // Use mic as master track for duration/currentTime state updates
        ws.on('ready', (duration) => {
          this.duration = duration;
        });
        ws.on('timeupdate', (time) => {
          this.currentTime = time;
        });
        ws.on('finish', () => {
          this.isPlaying = false;
        });
      }

      // Synchronized Seeking
      ws.on('interaction', () => {
        if (this.syncSeeking) return;
        this.syncSeeking = true;
        
        const time = ws.getCurrentTime();
        Object.values(this.tracks).forEach(t => {
          if (t.id !== track.id && t.ws) {
            t.ws.setTime(time);
          }
        });
        
        this.syncSeeking = false;
      });
    });
  }

  private destroyWaveSurfers() {
    Object.values(this.tracks).forEach(track => {
      if (track.ws) {
        track.ws.destroy();
        track.ws = null;
      }
      if (track.url) {
        URL.revokeObjectURL(track.url);
        track.url = null;
      }
    });
    this.isPlaying = false;
    this.duration = 0;
    this.currentTime = 0;
  }

  // Master controls
  private togglePlay() {
    const activeWs = Object.values(this.tracks).map(t => t.ws).filter(Boolean) as WaveSurfer[];
    if (activeWs.length === 0) return;

    if (this.isPlaying) {
      activeWs.forEach(ws => ws.pause());
      this.isPlaying = false;
    } else {
      // Play all
      activeWs.forEach(ws => ws.play());
      this.isPlaying = true;
    }
  }

  private stopAll() {
    Object.values(this.tracks).forEach(t => {
      if (t.ws) {
        t.ws.stop();
      }
    });
    this.isPlaying = false;
    this.currentTime = 0;
  }

  // Track controls
  private onVolumeChange(id: 'ref' | 'mic' | 'out', e: Event) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    const track = this.tracks[id];
    track.volume = value;
    if (track.ws) {
      track.ws.setVolume(value);
    }
    this.requestUpdate();
  }

  private toggleMute(id: 'ref' | 'mic' | 'out') {
    const track = this.tracks[id];
    track.muted = !track.muted;
    if (track.ws) {
      track.ws.setMuted(track.muted);
    }
    this.requestUpdate();
  }

  private toggleSolo(id: 'ref' | 'mic' | 'out') {
    const track = this.tracks[id];
    track.soloed = !track.soloed;

    const hasSoloedTracks = Object.values(this.tracks).some(t => t.soloed);

    Object.values(this.tracks).forEach(t => {
      if (!t.ws) return;
      
      if (hasSoloedTracks) {
        // If there are soloed tracks, mute this track unless it is soloed
        t.ws.setMuted(!t.soloed);
      } else {
        // Otherwise restore the track's own mute state
        t.ws.setMuted(t.muted);
      }
    });

    this.requestUpdate();
  }

  private formatTime(seconds: number): string {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.destroyWaveSurfers();
  }
}

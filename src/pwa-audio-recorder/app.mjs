'use strict';

import {IndexedDBStorage} from './indexeddb-storage.mjs';
import * as visualize from './visualize.mjs';
import { audioBufferToWav } from './wav-utils.mjs';

const DELETE_BUTTON_SELECTOR = '.delete-button';
const DOWNLOAD_BUTTON_SELECTOR = '.download-button';
const RECORDING_DESCRIPTION_SELECTOR = '.recording-description';

const recordButton = document.querySelector('#record');
const recordOutlineEl = document.querySelector('#record-outline');
const soundClips = document.querySelector('.sound-clips');
const clipTemplate = document.querySelector('#clip-template');

document.addEventListener('DOMContentLoaded', init);

// Enable offline support through a ServiceWorker. We register the message
// listener during import time (before DOMContentLoaded), in order to not
// miss messages that are sent during resource loading.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data.type === 'reload') {
      // The ServiceWorker refreshes cached resources in the background. In
      // case of a cache invalidation, the worker sends a message that
      // instructs the website to reload.
      window.location.reload();
    }
  });
  navigator.serviceWorker.register('./service-worker.js');
}

const CONFIG_RADIOS_SELECTOR = '#config-radios';
const CONFIG_RADIO_TEMPLATE_SELECTOR = '#config-radio-template';

const RECORDING_CONFIGS = [
  { name: "default", param: true },
  {
    name: "no-effects",
    param: {
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
    }
  },
  {
    name: "agc-only",
    param: {
      autoGainControl: true,
      echoCancellation: false,
      noiseSuppression: false,
    }
  },
];

function populateRecordingConfigurations() {
  const configRadioTemplate = document.querySelector(CONFIG_RADIO_TEMPLATE_SELECTOR);
  const configRadios = document.querySelector(CONFIG_RADIOS_SELECTOR);

  for (const [i, {name, param}] of RECORDING_CONFIGS.entries()) {
    const radio = configRadioTemplate.content.firstElementChild.cloneNode(true);
    const input = radio.querySelector('input');
    const label = radio.querySelector('label');
    input.id = `radio-${name}`;
    label.textContent = `${name} (${JSON.stringify(param)})`;
    label.setAttribute('for', input.id);
    label.recordingParam = param;
    if (i === 0) input.checked = true;
    configRadios.appendChild(radio);
  }
}

function getSelectedRecordingConfig() {
  const configRadios = document.querySelector(CONFIG_RADIOS_SELECTOR);
  const selectedRadio = configRadios.querySelector('input:checked');
  const label = configRadios.querySelector(`label[for="${selectedRadio.id}"]`);

  return {text: label.textContent, param: label.recordingParam};
}

/** Initializes the web application. */
async function init() {
  /* global mdc */ // Material Components Web scripts are loaded in index.html.
  new mdc.iconButton.MDCIconButtonToggle(recordButton);
  recordButton.onclick = () => startRecording({storage});
  populateRecordingConfigurations();

  const storage = new IndexedDBStorage();
  await storage.open();

  for await (const [id, {recordingDescription, blob}] of storage.readAll()) {
    const clipContainer = insertClip();
    finalizeClip({clipContainer, id, recordingDescription, blob, storage});
  }

  if (new URLSearchParams(window.location.search).get('test') === '1') {
    runTest();
  }
}

/**
 * Inserts a new audio clip at the top of the list.
 *
 * @return {HTMLElement} Container element of the audio clip.
*/
function insertClip() {
  const clipContainer = clipTemplate.content.firstElementChild.cloneNode(true);
  soundClips.prepend(clipContainer);
  return clipContainer;
}

/** Finalizes a clip by replacing the visualization with the audio element. */
function finalizeClip({clipContainer, blob, id, recordingDescription, storage}) {
  clipContainer.querySelector(RECORDING_DESCRIPTION_SELECTOR).textContent = recordingDescription;
  clipContainer.querySelector(DELETE_BUTTON_SELECTOR).onclick = () => {
    clipContainer.parentNode.removeChild(clipContainer);
    storage.delete(parseInt(id));
  };
  clipContainer.querySelector(DOWNLOAD_BUTTON_SELECTOR).onclick = async () => {
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new AudioContext();
    try {
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const wavView = audioBufferToWav(audioBuffer);
      const wavBlob = new Blob([wavView], { type: 'audio/wav' });
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `${recordingDescription.replace(/[:\/\s]/g, '_')}.wav`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Error converting to WAV:', e);
      alert('Failed to convert audio to WAV');
    } finally {
      await audioCtx.close();
    }
  };
  clipContainer.querySelector('audio').src = URL.createObjectURL(blob);
  clipContainer.classList.remove('clip-recording');
}

/** Accesses the device's microphone and returns an audio stream.
 *
 * @return {Promise<MediaStream>|null} Promise with MediaStream or
 *   null on error.
 */
async function getAudioStream(param) {
  try {
    return await navigator.mediaDevices.getUserMedia({audio: param});
  } catch (e) {
    console.error(e);
    return null;
  }
}

/**
 * Starts recording an audio snippet in-memory and visualizes the recording
 * waveform.
 */
async function startRecording({storage}) {
  const config = getSelectedRecordingConfig();

  const chunks = [];
  const stream = await getAudioStream(config.param);
  if (!stream) {
    return; // Permissions have not been granted or an error occurred.
  }

  const clipContainer = insertClip();
  const canvas = clipContainer.querySelector('canvas');
  canvas.width = clipContainer.offsetWidth;

  const recordingDescription = `${(new Date()).toLocaleString()}\u2003${config.text}`;
  clipContainer.querySelector(RECORDING_DESCRIPTION_SELECTOR).textContent = recordingDescription;

  const outlineIndicator = new visualize.OutlineLoudnessIndicator(
      recordOutlineEl);
  const waveformIndicator = new visualize.WaveformIndicator(canvas);

  // Start recording the microphone's audio stream in-memory.
  const mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = ({data}) => {
    chunks.push(data);
  };
  mediaRecorder.onstop = async () => {
    outlineIndicator.hide();
    recordButton.onclick = () => startRecording({storage});
    const blob = new Blob(chunks, {type: mediaRecorder.mimeType});
    console.log({recordingDescription, blob});
    const id = await storage.save({recordingDescription, blob});
    finalizeClip({clipContainer, id, blob, recordingDescription, storage});
  };
  mediaRecorder.start();

  recordButton.onclick = () => {
    // Stop the audio track to remove the browser's recording indicator and
    // stop the MediaRecorder.
    stream.getTracks().forEach((track) => {
      track.stop();
    });
  };

  visualizeRecording({stream, outlineIndicator, waveformIndicator});
}

/** Visualizes the audio with a waveform and a loudness indicator. */
function visualizeRecording({stream, outlineIndicator, waveformIndicator}) {
  // Use AnalyserNode to compute the recorded audio's power to visualize
  // loudness.
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 32; // Smallest possible FFT size for cheaper computation.
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  source.connect(analyser);

  waveformIndicator.drawCenterLine();

  /** Repeatedly draws the waveform and loudness indicator. */
  function draw() {
    if (!stream.active) {
      return; // Stop drawing loop once the recording stopped.
    }

    analyser.getByteFrequencyData(dataArray);
    const loudness = visualize.calculateLoudness(dataArray);
    outlineIndicator.show(loudness);
    waveformIndicator.show(loudness);

    requestAnimationFrame(draw);
  }

  draw();
}

async function runTest() {
  // 1. Start recording
  recordButton.click();

  // 2. After 10 seconds, start playback
  await new Promise((resolve) => setTimeout(resolve, 10000));
  const playbackSource = document.querySelector('#playback-source');
  playbackSource.play();

  // 3. After 10 seconds, stop recording and stop playback
  await new Promise((resolve) => setTimeout(resolve, 10000));
  recordButton.click();
  playbackSource.pause();
  playbackSource.currentTime = 0;

  // 4. Download the recorded audio
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const clip = soundClips.firstElementChild;
  const audio = clip.querySelector('audio');
  const a = document.createElement('a');
  a.href = audio.src;
  a.download = 'recorded_audio.webm';
  a.click();
}

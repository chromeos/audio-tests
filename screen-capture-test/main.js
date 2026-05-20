'use strict';

const startCaptureBtn = document.getElementById('startCaptureBtn');
const previewVideo = document.getElementById('previewVideo');
const volumeLevel = document.getElementById('volumeLevel');
const errorMsgElement = document.getElementById('errorMsg');
const recordingStatus = document.getElementById('recordingStatus');
const recordingsList = document.getElementById('recordingsList');

let mediaStream = null;
let mediaRecorder = null;
let audioContext = null;
let analyser = null;
let dataArray = null;
let source = null;
let animationId = null;
let recordedChunks = [];
let isCapturing = false;

function showError(msg, error) {
    errorMsgElement.textContent = `Error: ${msg}`;
    if (error) {
        console.error(msg, error);
    }
}

function updateVolumeMeter() {
    if (!analyser) return;

    analyser.getByteFrequencyData(dataArray);

    // Calculate average volume
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
    }
    const average = sum / dataArray.length;

    // Map to percentage (0-100)
    const percentage = Math.min(100, (average / 128) * 100);

    volumeLevel.style.width = `${percentage}%`;

    // Change color based on level
    if (percentage > 80) {
        volumeLevel.style.backgroundColor = 'var(--error-color)';
    } else if (percentage > 5) {
        volumeLevel.style.backgroundColor = 'var(--secondary-color)';
    } else {
        volumeLevel.style.backgroundColor = 'transparent';
    }

    animationId = requestAnimationFrame(updateVolumeMeter);
}

async function handleCaptureToggle() {
    if (isCapturing) {
        stopCapture();
    } else {
        await startCaptureAndRecord();
    }
}

async function startCaptureAndRecord() {
    try {
        errorMsgElement.textContent = '';
        startCaptureBtn.disabled = true; // Prevent double clicks during setup

        mediaStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true
        });

        previewVideo.srcObject = mediaStream;

        // Check for audio
        const audioTracks = mediaStream.getAudioTracks();
        if (audioTracks.length > 0) {
            setupAudioAnalysis(mediaStream);
        } else {
            showError('No audio track detected. Please ensure "Share system audio" is checked.');
        }

        // Auto-stop handler (when user clicks "Stop sharing" in browser UI)
        mediaStream.getVideoTracks()[0].addEventListener('ended', () => {
            stopCapture();
        });

        // Update state and UI
        isCapturing = true;
        startCaptureBtn.textContent = 'Stop Capture & Record';
        startCaptureBtn.classList.add('danger');
        startCaptureBtn.disabled = false;

        // Auto-start recording
        startRecording();

    } catch (err) {
        // User canceled selection or other error
        if (err.name !== 'NotAllowedError') {
            showError(`Error starting capture: ${err.message}`, err);
        }
        startCaptureBtn.disabled = false;
    }
}

function setupAudioAnalysis(stream) {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);

        source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        updateVolumeMeter();
    } catch (err) {
        console.warn('Audio analysis setup failed:', err);
    }
}

function stopCapture() {
    // Prevent multiple calls
    if (!isCapturing && !mediaStream) return;

    // Stop recording first if active
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        recordingStatus.textContent = 'Processing recording...';
    }

    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }

    if (source) {
        source.disconnect();
        source = null;
    }

    if (audioContext && audioContext.state !== 'closed') {
        audioContext.close();
        audioContext = null;
    }

    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }

    previewVideo.srcObject = null;
    volumeLevel.style.width = '0%';

    // Update state and UI
    isCapturing = false;
    startCaptureBtn.textContent = 'Start Capture & Record';
    startCaptureBtn.classList.remove('danger');
    startCaptureBtn.disabled = false;
}

function startRecording() {
    recordedChunks = [];
    const options = { mimeType: 'video/webm;codecs=vp9,opus' };

    try {
        if (!MediaRecorder.isTypeSupported(options.mimeType)) {
            console.warn(`${options.mimeType} is not supported, trying default.`);
            delete options.mimeType;
        }

        mediaRecorder = new MediaRecorder(mediaStream, options);

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = () => {
            addRecordingResult();
            recordingStatus.textContent = '';
        };

        mediaRecorder.start();
        recordingStatus.textContent = 'Recording in progress... (Stop sharing to finish)';

    } catch (err) {
        showError(`Error starting recording: ${err.message}`, err);
    }
}

function addRecordingResult() {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const timestamp = now.toLocaleTimeString();
    const filename = `screen-recording-${now.toISOString().replace(/:/g, '-')}.webm`;

    const container = document.createElement('div');
    container.className = 'video-container';

    const header = document.createElement('div');
    header.className = 'video-header';
    const title = document.createElement('h2');
    title.textContent = `Recording ${timestamp}`;
    header.appendChild(title);

    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.src = url;

    const link = document.createElement('a');
    link.className = 'download-link';
    link.href = url;
    link.download = filename;
    link.textContent = 'Download Recording';

    container.appendChild(header);
    container.appendChild(video);
    container.appendChild(link);

    // Insert at the top
    recordingsList.insertBefore(container, recordingsList.firstChild);
}

startCaptureBtn.addEventListener('click', handleCaptureToggle);

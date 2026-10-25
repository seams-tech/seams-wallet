import { recordVoice, type VoiceCaptureEvent } from './plugins/voiceid/browser/microphone';

let audio: AudioContext | null = null;
let stream: MediaStream | null = null;
let controller = new AbortController();
let frames = { total: 0, speech: 0 };

async function microphone(): Promise<MediaStream> {
  audio = new AudioContext();
  const destination = audio.createMediaStreamDestination();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = 180;
  oscillator.connect(gain).connect(destination);
  gain.gain.value = 0;
  const now = audio.currentTime;
  // A click, initial silence, speech, an internal pause, then more speech.
  gain.gain.setValueAtTime(0.1, now + 0.1);
  gain.gain.setValueAtTime(0, now + 0.12);
  gain.gain.setValueAtTime(0.1, now + 2.2);
  gain.gain.setValueAtTime(0, now + 2.5);
  gain.gain.setValueAtTime(0.1, now + 3.25);
  gain.gain.setValueAtTime(0, now + 3.95);
  oscillator.start();
  await audio.resume();
  stream = destination.stream;
  return stream;
}

async function record(): Promise<void> {
  controller = new AbortController();
  frames = { total: 0, speech: 0 };
  document.body.dataset.result = 'pending';
  try {
    const result = await recordVoice(controller.signal, observe);
    if (result.kind === 'captured') result.samples.fill(0);
    document.body.dataset.result = JSON.stringify({
      kind: result.kind,
      quality: result.quality,
      frames,
      tracks: stream?.getTracks().map(trackState),
    });
  } catch (error) {
    document.body.dataset.result = JSON.stringify({
      kind: 'rejected',
      message: error instanceof Error ? error.message : String(error),
      tracks: stream?.getTracks().map(trackState),
    });
  } finally {
    await audio?.close();
  }
}

function trackState(track: MediaStreamTrack): MediaStreamTrackState {
  return track.readyState;
}
function observe(event: VoiceCaptureEvent): void {
  if (event.kind !== 'activity') {
    document.body.dataset.capture = event.kind;
    return;
  }
  frames.total += 1;
  if (event.speech) frames.speech += 1;
}
function cancel(): void {
  controller.abort();
}

navigator.mediaDevices.getUserMedia = microphone;
const recordButton = document.createElement('button');
recordButton.textContent = 'Record';
recordButton.addEventListener('click', record);
const cancelButton = document.createElement('button');
cancelButton.textContent = 'Cancel';
cancelButton.addEventListener('click', cancel);
document.body.append(recordButton, cancelButton);

import { prepareVoiceModelWithProgress } from '@voiceid/browser/progress';
import { recordVoice, type VoiceCaptureEvent } from '@voiceid/browser/microphone';
import { VoicePrompt } from '@voiceid/capture/prompt';
import { SPOKEN_PHRASES } from '@voiceid/browser/phraseVocabulary';
import { WorkerDeferred } from '@seams/wallet/voiceid-host';

type Device = 'desk' | 'headset';
type Request = { exact: string | null; processing: MediaTrackConstraints };
const requests: Request[] = [];
const streams: MediaStream[] = [];
const unavailable = new Set<string>();
let defaultDevice: Device = 'desk';
let denied = false;
let context: AudioContext | null = null;
let controller = new AbortController();
let playback: AudioBufferSourceNode | null = null;
let enumerationGate: WorkerDeferred<void> | null = null;
let recorder: MediaRecorder | null = null;
const originalStart = MediaRecorder.prototype.start;
MediaRecorder.prototype.start = observeRecorder;

function observeRecorder(this: MediaRecorder, timeslice?: number): void {
  recorder = this;
  originalStart.call(this, timeslice);
}

function stopUnexpectedly(): void {
  if (!recorder || recorder.state !== 'recording') throw new Error('No recording to interrupt');
  recorder.stop();
}
const prompt = new VoicePrompt(document, 'Microphone check', SPOKEN_PHRASES[0]);
const parent = document.createElement('section');
parent.className = 'seams-wallet-ui seams-voiceid-activation-surface';
parent.append(prompt.element);
document.body.append(parent);
prompt.record.textContent = 'Record';
prompt.record.disabled = true;
prompt.record.addEventListener('click', capture);
prompt.cancel.addEventListener('click', cancel);
navigator.mediaDevices.getUserMedia = openMicrophone;
navigator.mediaDevices.enumerateDevices = enumerateMicrophones;
void prepare();

async function prepare(): Promise<void> {
  await prepareVoiceModelWithProgress(prompt.progress, controller.signal);
  prompt.progress.replaceChildren();
  prompt.record.disabled = false;
  document.body.dataset.ready = 'true';
}

async function capture(): Promise<void> {
  controller = new AbortController();
  prompt.record.disabled = true;
  document.body.dataset.result = 'recording';
  try {
    const result = await recordVoice(controller.signal, observe);
    document.body.dataset.quality = JSON.stringify(result.quality);
    if (result.kind === 'captured') result.samples.fill(0);
    document.body.dataset.result = result.kind;
  } catch (error) {
    document.body.dataset.result = 'failed';
    document.body.dataset.error = error instanceof Error ? error.message : String(error);
  } finally {
    prompt.ready('Record to check your microphone.');
    prompt.record.hidden = false;
    prompt.record.disabled = false;
  }
}

function observe(event: VoiceCaptureEvent): void {
  prompt.capture(event);
  if (event.kind === 'listening') {
    document.body.dataset.listening = 'true';
    playback?.start();
  }
}

function cancel(): void {
  controller.abort();
}

async function openMicrophone(constraints: MediaStreamConstraints): Promise<MediaStream> {
  const audio = constraints.audio;
  if (typeof audio !== 'object') throw new Error('Microphone constraints missing');
  const requested = audio.deviceId;
  const exact = typeof requested === 'object' && typeof requested.exact === 'string'
    ? requested.exact
    : null;
  requests.push({ exact, processing: audio });
  if (denied) {
    denied = false;
    throw new DOMException('Microphone permission denied', 'NotAllowedError');
  }
  if (exact !== null && unavailable.has(exact)) {
    throw new DOMException('Requested microphone is disconnected', 'OverconstrainedError');
  }
  const device = exact ?? defaultDevice;
  if (context) await context.close();
  context = new AudioContext({ sampleRate: 16_000 });
  const response = await fetch('/microphone-speech.wav');
  const buffer = await context.decodeAudioData(await response.arrayBuffer());
  const destination = context.createMediaStreamDestination();
  playback = context.createBufferSource();
  playback.buffer = buffer;
  playback.connect(destination);
  await context.resume();
  const stream = destination.stream;
  const track = stream.getAudioTracks()[0];
  Object.defineProperty(track, 'label', { value: device });
  // Model a browser that clears settings when its physical input stops.
  track.getSettings = readSettings.bind(null, track, device, exact === null);
  streams.push(stream);
  return stream;
}

function readSettings(track: MediaStreamTrack, device: string, alias: boolean): MediaTrackSettings {
  if (track.readyState !== 'live') return {};
  return {
    deviceId: alias ? 'default' : device,
    groupId: device,
    channelCount: 1,
    sampleRate: 16_000,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
}

async function enumerateMicrophones(): Promise<MediaDeviceInfo[]> {
  if (enumerationGate) {
    document.body.dataset.enumeration = 'waiting';
    await enumerationGate.promise;
  }
  return [
    deviceInfo('default', defaultDevice),
    deviceInfo('desk', 'desk'),
    deviceInfo('headset', 'headset'),
  ];
}

function holdEnumeration(): void {
  enumerationGate = new WorkerDeferred<void>();
}

function releaseEnumeration(): void {
  enumerationGate?.resolve();
  enumerationGate = null;
}

function deviceInfo(deviceId: string, groupId: string): MediaDeviceInfo {
  return { deviceId, groupId, label: groupId, kind: 'audioinput', toJSON: deviceInfoJson };
}

function deviceInfoJson(): object {
  return {};
}

function setDefault(device: Device): void {
  defaultDevice = device;
}

function disconnectDesk(): void {
  unavailable.add('desk');
}

function reconnectDesk(): void {
  unavailable.delete('desk');
}

function denyNext(): void {
  denied = true;
}

function interrupt(): void {
  const track = streams.at(-1)?.getAudioTracks()[0];
  if (!track) throw new Error('No microphone to disconnect');
  track.dispatchEvent(new Event('ended'));
}

function snapshot() {
  return { requests, tracks: streams.flatMap(trackStates) };
}

function trackStates(stream: MediaStream): MediaStreamTrackState[] {
  return stream.getTracks().map(trackState);
}

function trackState(track: MediaStreamTrack): MediaStreamTrackState {
  return track.readyState;
}

declare global {
  interface Window {
    microphoneProbe: {
      setDefault: typeof setDefault;
      disconnectDesk: typeof disconnectDesk;
      reconnectDesk: typeof reconnectDesk;
      denyNext: typeof denyNext;
      interrupt: typeof interrupt;
      snapshot: typeof snapshot;
      holdEnumeration: typeof holdEnumeration;
      releaseEnumeration: typeof releaseEnumeration;
      stopUnexpectedly: typeof stopUnexpectedly;
    };
  }
}
window.microphoneProbe = {
  setDefault,
  disconnectDesk,
  reconnectDesk,
  denyNext,
  interrupt,
  snapshot,
  holdEnumeration,
  releaseEnumeration,
  stopUnexpectedly,
};

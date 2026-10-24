const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
const streams: MediaStream[] = [];
const originalPut = IDBObjectStore.prototype.put;
let cancelEnrollmentSave = false;
let nextAudio: string | null = null;
let injectedAudio: AudioContext | null = null;

function observedPut(
  this: IDBObjectStore,
  value: unknown,
  key?: IDBValidKey,
): IDBRequest<IDBValidKey> {
  const request =
    key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
  if (
    cancelEnrollmentSave &&
    this.name === 'app_state' &&
    typeof value === 'object' &&
    value !== null &&
    'key' in value &&
    value.key === 'voiceid-browser-enrollment-v1'
  ) {
    cancelEnrollmentSave = false;
    queueMicrotask(cancelEnrollment);
  }
  return request;
}
function cancelEnrollment(): void {
  const button = Array.from(document.querySelectorAll('button')).find(isEnrollmentCancel);
  if (!button) throw new Error('Enrollment cancellation control is unavailable');
  button.click();
}
function isEnrollmentCancel(button: HTMLButtonElement): boolean {
  return button.textContent === 'Cancel enrollment';
}
function cancelNextEnrollmentSave(): void {
  cancelEnrollmentSave = true;
}

async function observedGetUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  const audio = nextAudio;
  nextAudio = null;
  const stream = audio === null ? await originalGetUserMedia(constraints) : await audioStream(audio);
  streams.push(stream);
  return stream;
}

function useNextAudio(base64: string): void {
  nextAudio = base64;
}
async function audioStream(base64: string): Promise<MediaStream> {
  if (injectedAudio) await injectedAudio.close();
  injectedAudio = new AudioContext();
  const bytes = Uint8Array.from(atob(base64), characterCode);
  const buffer = await injectedAudio.decodeAudioData(bytes.buffer);
  const source = injectedAudio.createBufferSource();
  const destination = injectedAudio.createMediaStreamDestination();
  source.buffer = buffer;
  source.loop = true;
  source.connect(destination);
  await injectedAudio.resume();
  source.start();
  return destination.stream;
}
function characterCode(character: string): number {
  return character.charCodeAt(0);
}

function microphoneStates(): MediaStreamTrackState[] {
  return streams.flatMap(streamStates);
}
function streamStates(stream: MediaStream): MediaStreamTrackState[] {
  return stream.getTracks().map(trackState);
}
function trackState(track: MediaStreamTrack): MediaStreamTrackState {
  return track.readyState;
}

declare global {
  interface Window {
    voiceIdNextAudio: typeof useNextAudio;
    voiceIdMicrophoneStates: typeof microphoneStates;
    voiceIdCancelNextEnrollmentSave: typeof cancelNextEnrollmentSave;
  }
}
navigator.mediaDevices.getUserMedia = observedGetUserMedia;
window.voiceIdNextAudio = useNextAudio;
window.voiceIdMicrophoneStates = microphoneStates;
window.voiceIdCancelNextEnrollmentSave = cancelNextEnrollmentSave;
IDBObjectStore.prototype.put = observedPut;
export {};

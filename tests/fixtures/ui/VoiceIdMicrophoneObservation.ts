import phrases from '../../../tests/fixtures/audio/aurora/phrases.json';
const streams: MediaStream[] = [];
const originalPut = IDBObjectStore.prototype.put;
let cancelEnrollmentSave = false;
let retireEnrollmentModel = false;
let nextAudio: string | null = null;
let injectedAudio: AudioContext | null = null;

function observedPut(
  this: IDBObjectStore,
  value: unknown,
  key?: IDBValidKey,
): IDBRequest<IDBValidKey> {
  if (retireEnrollmentModel && this.name === 'app_state' &&
      typeof value === 'object' && value !== null && 'key' in value &&
      value.key === 'voiceid-browser-enrollment-v1' && 'value' in value &&
      typeof value.value === 'object' && value.value !== null && 'model' in value.value) {
    value.value.model = 'previous-test-model';
    retireEnrollmentModel = false;
  }
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
function retireNextEnrollmentModel(): void {
  retireEnrollmentModel = true;
}

function cancelNextEnrollmentSave(): void {
  cancelEnrollmentSave = true;
}

async function observedGetUserMedia(): Promise<MediaStream> {
  const audio = nextAudio;
  nextAudio = null;
  let stream: MediaStream;
  if (audio !== null) {
    stream = await audioStream(audio);
  } else {
    const phrase = currentPhrase(document);
    document.body.dataset.voiceTestPhrase = phrase ?? 'unresolved';
    const index = phrase === null ? -1 : phrases.indexOf(phrase);
    if (index < 0) {
      throw new Error('Visible VoiceID phrase is unavailable to the audio fixture');
    } else {
      const response = await fetch(`/voiceid-test-audio/${index}.wav`);
      if (!response.ok) throw new Error('Synthetic phrase audio is unavailable');
      stream = await decodedAudioStream(await response.arrayBuffer());
    }
  }
  streams.push(stream);
  return stream;
}

function useNextAudio(base64: string): void {
  nextAudio = base64;
}
async function audioStream(base64: string): Promise<MediaStream> {
  return await decodedAudioStream(Uint8Array.from(atob(base64), characterCode).buffer);
}
async function decodedAudioStream(bytes: ArrayBuffer): Promise<MediaStream> {
  if (injectedAudio) await injectedAudio.close();
  injectedAudio = new AudioContext();
  const buffer = await injectedAudio.decodeAudioData(bytes);
  const source = injectedAudio.createBufferSource();
  const destination = injectedAudio.createMediaStreamDestination();
  source.buffer = buffer;
  source.loop = false;
  source.connect(destination);
  await injectedAudio.resume();
  source.start(injectedAudio.currentTime + 0.2);
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
    voiceIdRetireNextEnrollmentModel: typeof retireNextEnrollmentModel;
    voiceIdNextAudio: typeof useNextAudio;
    voiceIdMicrophoneStates: typeof microphoneStates;
    voiceIdCancelNextEnrollmentSave: typeof cancelNextEnrollmentSave;
  }
}
navigator.mediaDevices.getUserMedia = observedGetUserMedia;
window.voiceIdRetireNextEnrollmentModel = retireNextEnrollmentModel;
window.voiceIdNextAudio = useNextAudio;
window.voiceIdMicrophoneStates = microphoneStates;
window.voiceIdCancelNextEnrollmentSave = cancelNextEnrollmentSave;
IDBObjectStore.prototype.put = observedPut;
export {};

function currentPhrase(root: Document | ShadowRoot): string | null {
  const enrollment = root.querySelector('[data-voiceid-phrase]');
  if (enrollment) return enrollment.textContent?.trim() ?? null;
  const surface = root.querySelector('.seams-voiceid-activation-surface') ?? root.querySelector('.seams-voiceid-instructions');
  const phrase = surface?.textContent?.match(/“([^”]+)”/)?.[1];
  if (phrase) return phrase;
  for (const element of root.querySelectorAll('*')) {
    if (element.shadowRoot) {
      const nested = currentPhrase(element.shadowRoot);
      if (nested) return nested;
    }
  }
  return null;
}

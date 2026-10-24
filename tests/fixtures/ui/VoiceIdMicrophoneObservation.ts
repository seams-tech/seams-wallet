import phrases from '../../../tests/fixtures/audio/aurora/phrases.json';
const streams: MediaStream[] = [];
const originalPut = IDBObjectStore.prototype.put;
let cancelEnrollmentSave = false;
let retireEnrollmentModel = false;
let nextAudio: { base64: string; leadInSeconds: number } | null = null;
let naturalPhrases = false;
let injectedAudio: AudioContext | null = null;

function observedPut(
  this: IDBObjectStore,
  value: unknown,
  key?: IDBValidKey,
): IDBRequest<IDBValidKey> {
  if (
    retireEnrollmentModel &&
    this.name === 'app_state' &&
    typeof value === 'object' &&
    value !== null &&
    'key' in value &&
    value.key === 'voiceid-browser-enrollment-v1' &&
    'value' in value &&
    typeof value.value === 'object' &&
    value.value !== null &&
    'model' in value.value
  ) {
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
  return button.getAttribute('aria-label') === 'Cancel enrollment';
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
    stream = await audioStream(audio.base64, audio.leadInSeconds);
  } else {
    const phrase = currentPhrase(document);
    document.body.dataset.voiceTestPhrase = phrase ?? 'unresolved';
    const index = phrase === null ? -1 : phrases.indexOf(phrase);
    if (index < 0) {
      throw new Error('Visible VoiceID phrase is unavailable to the audio fixture');
    } else {
      const response = await fetch(
        `/voiceid-test-audio/${naturalPhrases ? 'natural/' : ''}${index}.wav`,
      );
      if (!response.ok) throw new Error('Synthetic phrase audio is unavailable');
      stream = await decodedAudioStream(await response.arrayBuffer());
    }
  }
  streams.push(stream);
  return stream;
}

function useNaturalPhrases(): void {
  naturalPhrases = true;
}

function useNextAudio(base64: string): void {
  nextAudio = { base64, leadInSeconds: 0 };
}
function useNextDelayedAudio(base64: string): void {
  nextAudio = { base64, leadInSeconds: 1.8 };
}
async function audioStream(base64: string, leadInSeconds: number): Promise<MediaStream> {
  return await decodedAudioStream(
    Uint8Array.from(atob(base64), characterCode).buffer,
    leadInSeconds,
  );
}
async function decodedAudioStream(bytes: ArrayBuffer, leadInSeconds = 0): Promise<MediaStream> {
  if (injectedAudio) await injectedAudio.close();
  injectedAudio = new AudioContext();
  const buffer = await injectedAudio.decodeAudioData(bytes);
  const source = injectedAudio.createBufferSource();
  const destination = injectedAudio.createMediaStreamDestination();
  source.buffer = buffer;
  source.loop = false;
  source.connect(destination);
  await injectedAudio.resume();
  source.start(injectedAudio.currentTime + 0.2 + leadInSeconds);
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
    voiceIdUseNaturalPhrases: typeof useNaturalPhrases;
    voiceIdNextAudio: typeof useNextAudio;
    voiceIdNextDelayedAudio: typeof useNextDelayedAudio;
    voiceIdMicrophoneStates: typeof microphoneStates;
    voiceIdCancelNextEnrollmentSave: typeof cancelNextEnrollmentSave;
  }
}
navigator.mediaDevices.getUserMedia = observedGetUserMedia;
window.voiceIdRetireNextEnrollmentModel = retireNextEnrollmentModel;
window.voiceIdUseNaturalPhrases = useNaturalPhrases;
window.voiceIdNextAudio = useNextAudio;
window.voiceIdNextDelayedAudio = useNextDelayedAudio;
window.voiceIdMicrophoneStates = microphoneStates;
window.voiceIdCancelNextEnrollmentSave = cancelNextEnrollmentSave;
IDBObjectStore.prototype.put = observedPut;
export {};

function currentPhrase(root: Document | ShadowRoot): string | null {
  const prompt = root.querySelector('[data-voiceid-phrase]');
  if (prompt) return prompt.getAttribute('data-voiceid-phrase');
  for (const element of root.querySelectorAll('*')) {
    if (element.shadowRoot) {
      const nested = currentPhrase(element.shadowRoot);
      if (nested) return nested;
    }
  }
  return null;
}

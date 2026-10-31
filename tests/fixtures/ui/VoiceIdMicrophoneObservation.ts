import phrases from '../../../tests/fixtures/audio/aurora/phrases.json';
import { openDB } from 'idb';
import { requireRecord } from '@shared/utils/validation';
const streams: MediaStream[] = [];
const originalPut = IDBObjectStore.prototype.put;
let cancelEnrollmentSave = false;
let retireEnrollmentModel = false;
let nextAudio: { base64: string; leadInSeconds: number } | null = null;
let naturalPhrases = false;
let nextWrongPhrase = false;
let injectedAudio: AudioContext | null = null;
const originalCredentialGet = navigator.credentials.get.bind(navigator.credentials);
const originalCredentialCreate = navigator.credentials.create.bind(navigator.credentials);
let registrationAlgorithm: -7 | -257 = -7;
let lastAssertion: PublicKeyCredential | null = null;
let passkeyRequests = 0;
let replayAssertion = false;
let corruptAssertion = false;
let savedAdaptation: { walletId: string; generation: string; value: unknown } | null = null;

async function observedCredentialGet(
  options?: CredentialRequestOptions,
): Promise<Credential | null> {
  if (replayAssertion) {
    replayAssertion = false;
    if (!lastAssertion) throw new Error('No passkey assertion is available to replay');
    return lastAssertion;
  }
  passkeyRequests += 1;
  const credential = await originalCredentialGet(options);
  if (
    corruptAssertion &&
    credential instanceof PublicKeyCredential &&
    credential.response instanceof AuthenticatorAssertionResponse
  ) {
    corruptAssertion = false;
    const signature = new Uint8Array(credential.response.signature.slice(0));
    signature[signature.length - 1] ^= 1;
    Object.defineProperty(credential.response, 'signature', { value: signature.buffer });
  }
  if (
    credential instanceof PublicKeyCredential &&
    credential.response instanceof AuthenticatorAssertionResponse
  )
    lastAssertion = credential;
  return credential;
}
function replayNextPasskey(): void {
  replayAssertion = true;
}
function corruptNextPasskey(): void {
  corruptAssertion = true;
}
function requireRsaPasskey(): void {
  registrationAlgorithm = -257;
}
function isSelectedAlgorithm(parameter: PublicKeyCredentialParameters): boolean {
  return parameter.alg === registrationAlgorithm;
}
async function observedCredentialCreate(
  options?: CredentialCreationOptions,
): Promise<Credential | null> {
  if (options?.publicKey) {
    const parameters = options.publicKey.pubKeyCredParams.filter(isSelectedAlgorithm);
    if (parameters.length === 0)
      throw new Error('The server did not offer the requested passkey algorithm');
    options.publicKey.pubKeyCredParams = parameters;
  }
  const credential = await originalCredentialCreate(options);
  if (
    credential instanceof PublicKeyCredential &&
    credential.response instanceof AuthenticatorAttestationResponse &&
    credential.response.getPublicKeyAlgorithm() !== registrationAlgorithm
  ) {
    throw new Error('The authenticator returned a different passkey algorithm');
  }
  return credential;
}

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
    typeof value.key === 'string' &&
    value.key.startsWith('voiceid-browser-enrollment-v2:') &&
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
    typeof value.key === 'string' &&
    value.key.startsWith('voiceid-browser-enrollment-v2:')
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
    let index = phrase === null ? -1 : phrases.indexOf(phrase);
    if (index < 0) {
      throw new Error('Visible VoiceID phrase is unavailable to the audio fixture');
    } else {
      if (nextWrongPhrase) {
        nextWrongPhrase = false;
        index = (index + 1) % phrases.length;
      }
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

function useNextWrongPhrase(): void {
  nextWrongPhrase = true;
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
    voiceIdUseNextWrongPhrase: typeof useNextWrongPhrase;
    voiceIdNextAudio: typeof useNextAudio;
    voiceIdNextDelayedAudio: typeof useNextDelayedAudio;
    voiceIdMicrophoneStates: typeof microphoneStates;
    voiceIdCancelNextEnrollmentSave: typeof cancelNextEnrollmentSave;
    voiceIdEnrollmentSummary: typeof enrollmentSummary;
    voiceIdPasskeyRequests: typeof readPasskeyRequests;
    voiceIdReplayNextPasskey: typeof replayNextPasskey;
    voiceIdCorruptNextPasskey: typeof corruptNextPasskey;
    voiceIdRequireRsaPasskey: typeof requireRsaPasskey;
    voiceIdAdaptationBoundary: typeof adaptationBoundary;
  }
}
navigator.mediaDevices.getUserMedia = observedGetUserMedia;
window.voiceIdRetireNextEnrollmentModel = retireNextEnrollmentModel;
window.voiceIdUseNaturalPhrases = useNaturalPhrases;
window.voiceIdUseNextWrongPhrase = useNextWrongPhrase;
window.voiceIdNextAudio = useNextAudio;
window.voiceIdNextDelayedAudio = useNextDelayedAudio;
window.voiceIdMicrophoneStates = microphoneStates;
window.voiceIdCancelNextEnrollmentSave = cancelNextEnrollmentSave;
window.voiceIdEnrollmentSummary = enrollmentSummary;
window.voiceIdPasskeyRequests = readPasskeyRequests;
window.voiceIdReplayNextPasskey = replayNextPasskey;
window.voiceIdCorruptNextPasskey = corruptNextPasskey;
window.voiceIdRequireRsaPasskey = requireRsaPasskey;
window.voiceIdAdaptationBoundary = adaptationBoundary;
navigator.credentials.get = observedCredentialGet;
navigator.credentials.create = observedCredentialCreate;
IDBObjectStore.prototype.put = observedPut;
export {};

async function enrollmentSummary(walletId: string) {
  const database = await openDB('seams_wallet');
  try {
    const rows: unknown[] = await database.getAll('app_state');
    for (const raw of rows) {
      const row = requireRecord(raw, 'stored row');
      if (typeof row.key !== 'string' || !row.key.startsWith('voiceid-browser-enrollment-v2:'))
        continue;
      const enrollment = requireRecord(row.value, 'enrollment');
      const scope = requireRecord(enrollment.scope, 'scope');
      if (scope.walletId !== walletId) continue;
      const adaptation = requireRecord(enrollment.adaptation, 'adaptation');
      const hash = new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(JSON.stringify(enrollment.baseline)),
        ),
      );
      return {
        scope,
        generation: String(enrollment.generation),
        revision: Number(enrollment.revision),
        baselineHash: Array.from(hash, hexByte).join(''),
        adaptation: String(adaptation.kind),
        samples: Array.isArray(adaptation.samples) ? adaptation.samples.length : 0,
        samplesHash: Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              'SHA-256',
              new TextEncoder().encode(JSON.stringify(adaptation.samples ?? [])),
            ),
          ),
          hexByte,
        ).join(''),
        hasLifetimeLimits: 'remainingUses' in adaptation || 'expiresAtMs' in adaptation,
        serializedBytes: new TextEncoder().encode(JSON.stringify(enrollment)).length,
        legacyPresent:
          (await database.get('app_state', 'voiceid-browser-enrollment-v1')) !== undefined,
      };
    }
    throw new Error('Scoped voice enrollment is unavailable');
  } finally {
    database.close();
  }
}
function hexByte(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

async function adaptationBoundary(input: {
  walletId: string;
  action: 'save' | 'last_use' | 'expired' | 'legacy';
}): Promise<void> {
  const database = await openDB('seams_wallet');
  try {
    const transaction = database.transaction('app_state', 'readwrite');
    const rows: unknown[] = await transaction.store.getAll();
    for (const raw of rows) {
      const row = requireRecord(raw, 'stored row');
      if (typeof row.key !== 'string' || !row.key.startsWith('voiceid-browser-enrollment-v2:'))
        continue;
      const enrollment = requireRecord(row.value, 'enrollment');
      const scope = requireRecord(enrollment.scope, 'scope');
      if (scope.walletId !== input.walletId) continue;
      const generation = String(enrollment.generation);
      if (input.action === 'save') {
        savedAdaptation = {
          walletId: input.walletId,
          generation,
          value: structuredClone(enrollment.adaptation),
        };
      } else if (input.action === 'legacy') {
        await transaction.store.put({
          key: 'voiceid-browser-enrollment-v1',
          value: {
            kind: 'browser_voiceid_enrollment_v1',
            model: enrollment.model,
            template: structuredClone(enrollment.baseline),
          },
        });
        await transaction.store.delete(row.key);
      } else {
        if (
          !savedAdaptation ||
          savedAdaptation.walletId !== input.walletId ||
          savedAdaptation.generation !== generation
        )
          throw new Error('No matching synthetic adaptation snapshot');
        const adaptation = requireRecord(
          structuredClone(savedAdaptation.value),
          'saved adaptation',
        );
        if (adaptation.kind !== 'adapted')
          throw new Error('Save an actual adapted enrollment before boundary tests');
        // Recreate earlier persisted records at their former lifetime boundaries.
        adaptation.remainingUses = input.action === 'last_use' ? 1 : 32;
        adaptation.expiresAtMs =
          input.action === 'expired' ? Date.now() - 1 : Date.now() + 86_400_000;
        enrollment.adaptation = adaptation;
        enrollment.revision = Number(enrollment.revision) + 1;
        await transaction.store.put(row);
      }
      await transaction.done;
      return;
    }
    throw new Error('Scoped voice enrollment is unavailable');
  } finally {
    database.close();
  }
}

function currentPhrase(root: Document | ShadowRoot): string | null {
  for (const prompt of root.querySelectorAll('[data-voiceid-phrase]')) {
    if (!prompt.closest('[inert], [aria-hidden="true"]'))
      return prompt.getAttribute('data-voiceid-phrase');
  }
  for (const element of root.querySelectorAll('*')) {
    if (element.shadowRoot) {
      const nested = currentPhrase(element.shadowRoot);
      if (nested) return nested;
    }
  }
  return null;
}

const originalWorkletAddModule = Worklet.prototype.addModule;
let holdWorklet = false;
let releaseWorklet: (() => void) | null = null;

async function observedWorkletAddModule(
  this: Worklet,
  moduleURL: string | URL,
  options?: WorkletOptions,
): Promise<void> {
  if (holdWorklet) {
    holdWorklet = false;
    document.body.dataset.voiceTestWorklet = 'waiting';
    await new Promise<void>(storeWorkletRelease);
  }
  await originalWorkletAddModule.call(this, moduleURL, options);
}
function storeWorkletRelease(resolve: () => void): void {
  releaseWorklet = resolve;
}
function holdNextWorklet(): void {
  holdWorklet = true;
  delete document.body.dataset.voiceTestWorklet;
}
function releaseHeldWorklet(): void {
  releaseWorklet?.();
  releaseWorklet = null;
}
declare global {
  interface Window {
    voiceIdHoldNextWorklet: typeof holdNextWorklet;
    voiceIdReleaseWorklet: typeof releaseHeldWorklet;
  }
}
Worklet.prototype.addModule = observedWorkletAddModule;
window.voiceIdHoldNextWorklet = holdNextWorklet;
window.voiceIdReleaseWorklet = releaseHeldWorklet;

function readPasskeyRequests(): number {
  return passkeyRequests;
}

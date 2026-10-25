import { newSpokenPhrase, checkSpokenPhrase, VoicePhraseMismatchError, type SpokenPhrase } from './phrase';
import { IndexedDBManager } from '@/core/indexedDB';
import { SEAMS_WALLET_STORES } from '@/core/indexedDB/schemaNames';
import { WorkerDeferred } from '@/core/signingEngine/workerManager/workerDeferred';
import { requireRecord } from '@shared/utils/validation';
import { prepareVoiceModelWithProgress } from './progress';
import {
  recordVoice,
  requireVoiceUserAction,
  voiceQualityMessage,
  type VoiceCaptureQuality,
  type VoiceCaptureObserver,
} from './microphone';
import { VoicePrompt } from '../capture/prompt';
import {
  normalizeVoiceVector,
  voiceEmbedding,
  voiceSimilarity,
  VOICE_MATCH_THRESHOLD,
  VOICE_MODEL_ID,
} from './model';

const ENROLLMENT_KEY = 'voiceid-browser-enrollment-v1';
type VoiceEnrollment = Readonly<{
  kind: 'browser_voiceid_enrollment_v1';
  model: string;
  template: readonly number[];
}>;

export async function readVoiceEnrollment(): Promise<VoiceEnrollment | null> {
  const raw = await IndexedDBManager.getAppState(ENROLLMENT_KEY);
  if (raw === undefined) return null;
  const record = requireRecord(raw, 'VoiceID enrollment');
  if (
    record.kind !== 'browser_voiceid_enrollment_v1' ||
    typeof record.model !== 'string' ||
    !Array.isArray(record.template) ||
    !record.template.every(isFiniteNumber)
  ) {
    throw new Error('VoiceID browser enrollment is incompatible with this model.');
  }
  if (record.model !== VOICE_MODEL_ID) return null;
  return {
    kind: 'browser_voiceid_enrollment_v1',
    model: VOICE_MODEL_ID,
    template: normalizeVoiceVector(record.template),
  };
}

async function commitEnrollment(enrollment: VoiceEnrollment, signal: AbortSignal): Promise<void> {
  const database = await IndexedDBManager.seamsWalletDB.getDB();
  signal.throwIfAborted();
  const transaction = database.transaction([SEAMS_WALLET_STORES.appState], 'readwrite');
  const abort = abortEnrollmentCommit.bind(null, transaction);
  signal.addEventListener('abort', abort, { once: true });
  try {
    await Promise.all([
      transaction
        .objectStore(SEAMS_WALLET_STORES.appState)
        .put({ key: ENROLLMENT_KEY, value: enrollment }),
      transaction.done,
    ]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

function abortEnrollmentCommit(transaction: { abort(): void }): void {
  try {
    transaction.abort();
  } catch {
    /* A completed commit already ended enrollment. */
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export async function enrollBrowserVoice(signal: AbortSignal): Promise<void> {
  const parent = document.querySelector('.seams-voiceid-activation-surface');
  if (!(parent instanceof HTMLElement)) throw new Error('Open VoiceID activation in the Wallet.');
  await prepareVoiceModelWithProgress(parent);
  signal.throwIfAborted();
  const surface = new VoiceEnrollmentSurface(parent, signal);
  try {
    await surface.result;
  } finally {
    surface.dispose();
  }
}

class VoiceEnrollmentSurface {
  private readonly completion = new WorkerDeferred<void>();
  readonly result = this.completion.promise;
  private readonly status: HTMLParagraphElement;
  private readonly prompt: VoicePrompt;
  private phrase = newSpokenPhrase(null);
  private readonly record: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private readonly samples: number[][] = [];
  private phase: 'ready' | 'recording' | 'committing' | 'closed' = 'ready';
  private get closed(): boolean {
    return this.phase === 'closed';
  }
  private readonly controller = new AbortController();

  constructor(
    parent: HTMLElement,
    private readonly signal: AbortSignal,
  ) {
    this.prompt = new VoicePrompt(document, 'Enroll your voice in this browser', this.phrase);
    this.prompt.title.textContent = 'Read aloud · sample 1 of 3';
    this.status = this.prompt.status;
    this.record = this.prompt.record;
    this.cancel = this.prompt.cancel;
    this.record.textContent = 'Record sample 1';
    this.record.addEventListener('click', this.capture);
    this.cancel.setAttribute('aria-label', 'Cancel enrollment');
    this.cancel.addEventListener('click', this.cancelled);
    this.prompt.ready('Read the full phrase at your normal pace.');
    parent.replaceChildren(this.prompt.element);
    signal.addEventListener('abort', this.cancelled, { once: true });
    if (signal.aborted) this.cancelled();
    else this.record.focus();
  }

  private readonly capture = (): void => {
    void this.collect();
  };
  private async collect(): Promise<void> {
    if (this.phase !== 'ready') return;
    try {
      requireVoiceUserAction();
      this.phase = 'recording';
      this.record.disabled = true;
      this.status.textContent = 'Opening microphone…';
      const pcm = await recordVoice(this.controller.signal, this.prompt.capture);
      if (this.signal.aborted || this.closed) {
        if (pcm.kind === 'captured') pcm.samples.fill(0);
        return;
      }
      if (pcm.kind === 'insufficient_audio') {
        this.status.textContent = voiceQualityMessage(pcm.quality);
        return;
      }
      let embedding: number[];
      try {
        this.status.textContent = 'Checking your voice…';
        const phraseCheck = await checkSpokenPhrase(pcm.samples, this.phrase);
        if (phraseCheck.kind === 'mismatch') throw new VoicePhraseMismatchError(phraseCheck.message);
        embedding = await voiceEmbedding(pcm.samples);
      } finally {
        pcm.samples.fill(0);
      }
      if (this.signal.aborted || this.closed) return;
      let minimumSimilarity = 1;
      for (const previous of this.samples)
        minimumSimilarity = Math.min(minimumSimilarity, voiceSimilarity(previous, embedding));
      this.status.dataset.voiceCapture = JSON.stringify({
        attemptId: pcm.quality.attemptId,
        capturedAtMs: pcm.quality.capturedAtMs,
        sample: this.samples.length + 1,
        durationMs: pcm.quality.durationMs,
        recordingMs: pcm.quality.recordingMs,
        endedBy: pcm.quality.endedBy,
        voicedMs: pcm.quality.voicedMs,
        microphone: pcm.quality.microphone,
        processing: pcm.quality.processing,
        backgroundRms: pcm.quality.backgroundRms,
        speechToBackgroundDb: pcm.quality.speechToBackgroundDb,
        noise: pcm.quality.noise,
        minimumSimilarity,
      });
      for (const previous of this.samples) {
        if (voiceSimilarity(previous, embedding) < VOICE_MATCH_THRESHOLD) {
          throw new Error(
            'This sample differs from the earlier samples. Use the same microphone and try again.',
          );
        }
      }
      this.samples.push(embedding);
      if (this.samples.length < 3) {
        this.status.textContent = `Sample ${this.samples.length} saved. Record the next sample.`;
        this.record.textContent = `Record sample ${this.samples.length + 1}`;
        return;
      }
      const mean = new Array<number>(192).fill(0);
      for (const sample of this.samples) {
        for (let index = 0; index < mean.length; index += 1) mean[index] += sample[index] / 3;
      }
      const enrollment: VoiceEnrollment = {
        kind: 'browser_voiceid_enrollment_v1',
        model: VOICE_MODEL_ID,
        template: normalizeVoiceVector(mean),
      };
      this.phase = 'committing';
      await commitEnrollment(enrollment, this.controller.signal);
      if (this.signal.aborted || this.closed) return;
      this.phase = 'closed';
      this.status.textContent = 'Voice enrolled. Activating this wallet…';
      this.completion.resolve();
    } catch (error) {
      if (!this.closed && error instanceof VoicePhraseMismatchError)
        this.prompt.showDetails(error.details);
      if (!this.closed && this.samples.length === 3) this.samples.pop()?.fill(0);
      if (!this.closed)
        this.status.textContent =
          error instanceof Error ? error.message : 'VoiceID enrollment failed.';
    } finally {
      if (!this.closed) {
        this.phrase = newSpokenPhrase(this.phrase);
        this.prompt.setPhrase(this.phrase);
        this.prompt.title.textContent = `Read aloud · sample ${this.samples.length + 1} of 3`;
        this.prompt.ready(this.status.textContent ?? '');
        this.phase = 'ready';
        this.record.disabled = false;
      }
    }
  }
  private readonly cancelled = (): void => {
    if (this.closed) return;
    this.phase = 'closed';
    this.controller.abort();
    this.completion.reject(new Error('VoiceID enrollment was cancelled.'));
  };
  dispose(): void {
    this.phase = 'closed';
    this.controller.abort();
    this.signal.removeEventListener('abort', this.cancelled);
    this.prompt.dispose();
    this.record.removeEventListener('click', this.capture);
    this.cancel.removeEventListener('click', this.cancelled);
    for (const sample of this.samples) sample.fill(0);
  }
}

export async function verifyBrowserVoice(
  signal: AbortSignal,
  onCapture: VoiceCaptureObserver,
  phrase: SpokenPhrase,
): Promise<
  | { kind: 'matched' }
  | { kind: 'mismatch' }
  | { kind: 'phrase_mismatch'; message: string }
  | { kind: 'insufficient_audio'; quality: VoiceCaptureQuality }
> {
  delete document.body.dataset.voiceVerification;
  const enrollment = await readVoiceEnrollment();
  if (!enrollment)
    throw new Error(
      'Unlock with a passkey or Email OTP, then select Enroll voice again to use the current VoiceID model.',
    );
  const pcm = await recordVoice(signal, onCapture);
  if (pcm.kind === 'insufficient_audio') {
    signal.throwIfAborted();
    return pcm;
  }
  try {
    signal.throwIfAborted();
    const phraseCheck = await checkSpokenPhrase(pcm.samples, phrase);
    const phraseMatched = phraseCheck.kind === 'matched';
    const embedding = await voiceEmbedding(pcm.samples);
    if (signal.aborted) throw new Error('VoiceID verification was cancelled.');
    const similarity = voiceSimilarity(embedding, enrollment.template);
    document.body.dataset.voiceVerification = JSON.stringify({
      attemptId: pcm.quality.attemptId,
      capturedAtMs: pcm.quality.capturedAtMs,
      durationMs: pcm.quality.durationMs,
      recordingMs: pcm.quality.recordingMs,
      endedBy: pcm.quality.endedBy,
      voicedMs: pcm.quality.voicedMs,
      microphone: pcm.quality.microphone,
      processing: pcm.quality.processing,
      backgroundRms: pcm.quality.backgroundRms,
      speechToBackgroundDb: pcm.quality.speechToBackgroundDb,
      noise: pcm.quality.noise,
      similarity,
      threshold: VOICE_MATCH_THRESHOLD,
      phraseMatched,
      phraseRecognition: phraseCheck.recognition,
      expectedPhrase: phrase,
    });
    embedding.fill(0);
    if (similarity < VOICE_MATCH_THRESHOLD) return { kind: 'mismatch' };
    return phraseCheck.kind === 'matched'
      ? { kind: 'matched' }
      : { kind: 'phrase_mismatch', message: phraseCheck.message };
  } finally {
    pcm.samples.fill(0);
  }
}

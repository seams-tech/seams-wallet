import { IndexedDBManager } from '@/core/indexedDB';
import { SEAMS_WALLET_STORES } from '@/core/indexedDB/schemaNames';
import { WorkerDeferred } from '@/core/signingEngine/workerManager/workerDeferred';
import { requireRecord } from '@shared/utils/validation';
import { recordVoice, requireVoiceUserAction } from './microphone';
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
    record.model !== VOICE_MODEL_ID ||
    !Array.isArray(record.template) ||
    !record.template.every(isFiniteNumber)
  ) {
    throw new Error('VoiceID browser enrollment is incompatible with this model.');
  }
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
  private readonly status = document.createElement('p');
  private readonly record = document.createElement('button');
  private readonly cancel = document.createElement('button');
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
    const title = document.createElement('h2');
    title.textContent = 'Enroll your voice in this browser';
    const description = document.createElement('p');
    description.textContent =
      'Record three samples in your normal voice. After Listening appears, read: “My voice helps me open this wallet on my device.” Each sample allows eight seconds. Audio stays local and is discarded.';
    this.status.setAttribute('role', 'status');
    this.record.textContent = 'Record sample 1';
    this.record.className = 'seams-voiceid-primary';
    this.record.addEventListener('click', this.capture);
    this.cancel.textContent = 'Cancel enrollment';
    this.cancel.addEventListener('click', this.cancelled);
    parent.replaceChildren(title, description, this.status, this.record, this.cancel);
    signal.addEventListener('abort', this.cancelled, { once: true });
    if (signal.aborted) this.cancelled();
    else this.record.focus();
  }

  private readonly capture = (): void => {
    void this.collect();
  };
  private readonly listening = (microphone: string): void => {
    this.status.textContent = `Listening for eight seconds using ${microphone}. Read the sentence above.`;
  };
  private async collect(): Promise<void> {
    if (this.phase !== 'ready') return;
    try {
      requireVoiceUserAction();
      this.phase = 'recording';
      this.record.disabled = true;
      this.status.textContent = 'Opening microphone…';
      const pcm = await recordVoice(this.controller.signal, this.listening);
      let embedding: number[];
      try {
        this.status.textContent = 'Checking your voice. The first model download is about 80 MB…';
        embedding = await voiceEmbedding(pcm.samples);
      } finally {
        pcm.samples.fill(0);
      }
      if (this.signal.aborted || this.closed) return;
      let minimumSimilarity = 1;
      for (const previous of this.samples)
        minimumSimilarity = Math.min(minimumSimilarity, voiceSimilarity(previous, embedding));
      this.status.dataset.voiceCapture = JSON.stringify({
        sample: this.samples.length + 1,
        durationMs: pcm.durationMs,
        voicedMs: pcm.voicedMs,
        microphone: pcm.microphone,
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
      if (!this.closed && this.samples.length === 3) this.samples.pop()?.fill(0);
      if (!this.closed)
        this.status.textContent =
          error instanceof Error ? error.message : 'VoiceID enrollment failed.';
    } finally {
      if (!this.closed) {
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
    this.record.removeEventListener('click', this.capture);
    this.cancel.removeEventListener('click', this.cancelled);
    for (const sample of this.samples) sample.fill(0);
  }
}

export async function verifyBrowserVoice(
  signal: AbortSignal,
  onListening: () => void,
): Promise<{ kind: 'matched' } | { kind: 'mismatch' }> {
  const enrollment = await readVoiceEnrollment();
  if (!enrollment)
    throw new Error('Activate VoiceID with an owner unlock to enroll this browser first.');
  const pcm = await recordVoice(signal, onListening);
  try {
    const embedding = await voiceEmbedding(pcm.samples);
    if (signal.aborted) throw new Error('VoiceID verification was cancelled.');
    const similarity = voiceSimilarity(embedding, enrollment.template);
    document.body.dataset.voiceVerification = JSON.stringify({
      durationMs: pcm.durationMs,
      voicedMs: pcm.voicedMs,
      microphone: pcm.microphone,
      similarity,
      threshold: VOICE_MATCH_THRESHOLD,
    });
    embedding.fill(0);
    return similarity < VOICE_MATCH_THRESHOLD ? { kind: 'mismatch' } : { kind: 'matched' };
  } finally {
    pcm.samples.fill(0);
  }
}

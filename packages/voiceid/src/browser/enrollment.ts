import { newSpokenPhrase, checkSpokenPhrase, VoicePhraseMismatchError } from './phrase';
import { WorkerDeferred } from '@seams/wallet/voiceid-host';
import { prepareVoiceModelWithProgress } from './progress';
import { recordVoice, requireVoiceUserAction, voiceQualityMessage } from './microphone';
import { VoicePrompt } from '../capture/prompt';
import {
  normalizeVoiceVector,
  voiceEmbedding,
  voiceSimilarity,
  VOICE_MATCH_THRESHOLD,
} from './model';

import { commitVoiceEnrollment } from './enrollmentStore';
import {
  assertVoiceOwner,
  type VoiceEnrollmentScope,
  type VoiceEnrollmentAuthorization,
} from '@seams/wallet/voiceid-host';
import { toError } from '@seams/wallet/voiceid-host';
import type { Variant } from '@seams/wallet/voiceid-host';
import type { VoiceIdTranscriptionModel } from '@seams/wallet/voiceid-host';

type EnrollmentCapturePlan = Readonly<{ scope: VoiceEnrollmentScope }> &
  Variant<VoiceEnrollmentAuthorization, 'kind', 'activate' | 'replace' | 'improve'>;

export async function enrollBrowserVoice(
  parent: HTMLElement,
  plan: EnrollmentCapturePlan,
  signal: AbortSignal,
  model: VoiceIdTranscriptionModel,
): Promise<void> {
  await prepareVoiceModelWithProgress(parent, signal, model);
  signal.throwIfAborted();
  const surface = new VoiceEnrollmentSurface(parent, plan, signal, model);
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
  private readonly guardTimer: ReturnType<typeof setInterval>;
  private checkingGuard = false;

  constructor(
    parent: HTMLElement,
    private readonly plan: EnrollmentCapturePlan,
    private readonly signal: AbortSignal,
    private readonly model: VoiceIdTranscriptionModel,
  ) {
    this.prompt = new VoicePrompt(
      parent.ownerDocument,
      'Enroll your voice in this browser',
      this.phrase,
    );
    this.prompt.title.textContent = 'Read aloud · 0 of 3 accepted';
    this.status = this.prompt.status;
    this.record = this.prompt.record;
    this.cancel = this.prompt.cancel;
    this.record.textContent = 'Record sample 1';
    this.record.addEventListener('click', this.capture);
    this.cancel.setAttribute('aria-label', 'Cancel enrollment');
    this.cancel.addEventListener('click', this.cancelled);
    this.prompt.ready(
      plan.kind === 'improve'
        ? 'Read naturally. Your original enrollment stays unchanged.'
        : 'Read the full phrase at your normal pace.',
    );
    parent.replaceChildren(this.prompt.element);
    signal.addEventListener('abort', this.cancelled, { once: true });
    this.guardTimer = setInterval(this.checkGuard, 250);
    if (signal.aborted) this.cancelled();
    else this.record.focus();
  }

  private readonly capture = (): void => {
    void this.collect();
  };
  private async collect(): Promise<void> {
    if (this.phase !== 'ready') return;
    const sampleNumber = this.samples.length + 1;
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
      if (this.plan.kind === 'improve' && pcm.quality.noise !== 'normal') {
        pcm.samples.fill(0);
        this.status.textContent = 'Use a quiet place to improve your voice enrollment.';
        return;
      }
      let embedding: number[];
      try {
        await assertVoiceOwner(this.plan.scope, this.plan.guard);
        this.status.textContent = 'Checking your voice…';
        const phraseCheck = await checkSpokenPhrase(pcm.samples, this.phrase, this.model);
        if (phraseCheck.kind === 'mismatch') throw new VoicePhraseMismatchError();
        embedding = await voiceEmbedding(pcm.samples);
      } finally {
        pcm.samples.fill(0);
      }
      if (this.signal.aborted || this.closed) {
        embedding.fill(0);
        return;
      }
      if (this.plan.kind === 'improve') {
        const similarity = voiceSimilarity(this.plan.snapshot.enrollment.baseline, embedding);
        if (similarity < VOICE_MATCH_THRESHOLD) {
          embedding.fill(0);
          throw new Error(
            'Your voice did not match the original enrollment. To replace it, return to Manage voice and choose Record voice again.',
          );
        }
      }
      for (const previous of this.samples) {
        if (voiceSimilarity(previous, embedding) < VOICE_MATCH_THRESHOLD) {
          embedding.fill(0);
          throw new Error(
            'This sample differs from the earlier samples. Use the same microphone and try again.',
          );
        }
      }
      this.samples.push(embedding);
      if (this.samples.length < 3) {
        this.prompt.accepted();
        this.status.textContent = `Sample ${this.samples.length} accepted. Record the next sample.`;
        this.record.textContent = `Record sample ${this.samples.length + 1}`;
        return;
      }
      const mean = new Array<number>(192).fill(0);
      for (const sample of this.samples) {
        for (let index = 0; index < mean.length; index += 1) mean[index] += sample[index] / 3;
      }
      this.phase = 'committing';
      this.prompt.title.textContent = '3 of 3 accepted';
      this.status.textContent = 'Saving voice enrollment…';
      const plan = this.plan;
      switch (plan.kind) {
        case 'activate':
          await commitVoiceEnrollment({
            kind: 'activate',
            scope: plan.scope,
            guard: plan.guard,
            snapshot: plan.snapshot,
            baseline: normalizeVoiceVector(mean),
            signal: this.controller.signal,
          });
          break;
        case 'replace':
          await commitVoiceEnrollment({
            kind: 'replace',
            scope: plan.scope,
            guard: plan.guard,
            snapshot: plan.snapshot,
            baseline: normalizeVoiceVector(mean),
            confirmation: plan.confirmation,
            signal: this.controller.signal,
          });
          break;
        case 'improve':
          await commitVoiceEnrollment({
            kind: 'improve',
            scope: plan.scope,
            guard: plan.guard,
            snapshot: plan.snapshot,
            samples: this.samples,
            confirmation: plan.confirmation,
            signal: this.controller.signal,
          });
          break;
        default:
          return assertNever(plan);
      }
      if (this.signal.aborted || this.closed) return;
      this.phase = 'closed';
      this.prompt.accepted();
      this.status.textContent = 'Voice enrollment saved.';
      this.completion.resolve();
    } catch (error) {
      if (!this.closed && this.phase === 'committing') {
        this.phase = 'closed';
        this.controller.abort();
        this.completion.reject(toError(error));
        return;
      }
      if (!this.closed && this.samples.length === 3) this.samples.pop()?.fill(0);
      if (!this.closed)
        this.status.textContent =
          error instanceof Error ? error.message : 'VoiceID enrollment failed.';
    } finally {
      if (!this.closed) {
        if (this.samples.length < sampleNumber) {
          this.record.textContent = `Retry sample ${sampleNumber}`;
          this.status.textContent = `Sample ${sampleNumber} was not accepted. ${this.status.textContent ?? ''}`;
        }
        this.phrase = newSpokenPhrase(this.phrase);
        this.prompt.setPhrase(this.phrase);
        this.prompt.title.textContent = `Read aloud · ${this.samples.length} of 3 accepted`;
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
  private readonly checkGuard = (): void => {
    if (this.closed || this.checkingGuard) return;
    this.checkingGuard = true;
    void this.validateGuard();
  };
  private async validateGuard(): Promise<void> {
    try {
      await assertVoiceOwner(this.plan.scope, this.plan.guard);
    } catch (error) {
      if (!this.closed) {
        this.phase = 'closed';
        this.controller.abort();
        this.completion.reject(toError(error));
      }
    } finally {
      this.checkingGuard = false;
    }
  }
  dispose(): void {
    this.phase = 'closed';
    this.controller.abort();
    clearInterval(this.guardTimer);
    this.signal.removeEventListener('abort', this.cancelled);
    this.prompt.dispose();
    this.record.removeEventListener('click', this.capture);
    this.cancel.removeEventListener('click', this.cancelled);
    for (const sample of this.samples) sample.fill(0);
  }
}

function assertNever(_plan: never): never {
  throw new Error('Unsupported VoiceID enrollment capture.');
}

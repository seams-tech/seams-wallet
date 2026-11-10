import {
  newSpokenPhrase,
  checkSpokenPhrase,
  VoicePhraseMismatchError,
  type SpokenPhrase,
} from './phrase';
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
import type { AuthMethodEnrollmentRecording } from '@seams/wallet/voiceid-host';

type EnrollmentCapturePlan = Readonly<{ scope: VoiceEnrollmentScope }> &
  Variant<VoiceEnrollmentAuthorization, 'kind', 'activate' | 'replace' | 'improve'>;
type KeepRecordings = (recordings: readonly AuthMethodEnrollmentRecording[]) => void;
type EnrollmentOptions = Readonly<{
  /** Receives the accepted samples after the save, for Speak-to-Sign. */
  keepRecordings?: KeepRecordings;
  /** The phrase that the card already shows, so the first sample keeps it. */
  phrase?: SpokenPhrase;
}>;

/**
 * Records three accepted samples and saves the enrollment. With `keepRecordings`, the accepted
 * samples go to it after the save, for Speak-to-Sign; every other sample is cleared here.
 */
export async function enrollBrowserVoice(
  parent: HTMLElement,
  plan: EnrollmentCapturePlan,
  signal: AbortSignal,
  model: VoiceIdTranscriptionModel,
  options: EnrollmentOptions = {},
): Promise<void> {
  signal.throwIfAborted();
  // The prompt shows at once; VoiceID loads inside it, and recording waits until it is ready.
  const surface = new VoiceEnrollmentSurface(parent, plan, signal, model, options);
  try {
    await Promise.race([surface.prepare(), surface.result]);
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
  private phrase: SpokenPhrase;
  private readonly record: HTMLButtonElement;
  private readonly keepRecordings: KeepRecordings | null;
  private readonly cancel: HTMLButtonElement;
  private readonly samples: number[][] = [];
  /** The accepted samples' audio, kept only for `keepRecordings`. */
  private readonly recordings: AuthMethodEnrollmentRecording[] = [];
  private phase: 'loading' | 'ready' | 'recording' | 'committing' | 'closed' = 'loading';
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
    options: EnrollmentOptions,
  ) {
    this.keepRecordings = options.keepRecordings ?? null;
    this.phrase = options.phrase ?? newSpokenPhrase(null);
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
        : this.keepRecordings
          ? 'Read the full phrase at your normal pace. Speak-to-Sign uses the same samples.'
          : 'Read the full phrase at your normal pace.',
    );
    // Recording waits for VoiceID to load; prepare() enables it.
    this.record.disabled = true;
    // A card that replaces the activation card continues it in place, with no second entrance.
    const continued =
      parent.querySelector('.seams-voiceid-prompt:not(.seams-voiceid-management)') !== null;
    parent.replaceChildren(this.prompt.element);
    if (continued) this.prompt.continueCard();
    signal.addEventListener('abort', this.cancelled, { once: true });
    this.guardTimer = setInterval(this.checkGuard, 250);
    if (signal.aborted) this.cancelled();
    // Focus stays in the card without a ring on Close until Record is ready.
    else if (continued) this.prompt.element.focus({ preventScroll: true });
    else this.cancel.focus();
  }

  /** Loads VoiceID into the prompt's progress slot, then enables recording. */
  async prepare(): Promise<void> {
    await prepareVoiceModelWithProgress(this.prompt.progress, this.controller.signal, this.model);
    if (this.phase !== 'loading') return;
    this.prompt.progress.replaceChildren();
    this.phase = 'ready';
    this.record.disabled = false;
    this.record.focus();
  }

  private readonly capture = (): void => {
    void this.collect();
  };
  private async collect(): Promise<void> {
    if (this.phase !== 'ready') return;
    const sampleNumber = this.samples.length + 1;
    // A copy of this sample's audio for `keepRecordings`, until the sample is accepted.
    let kept: AuthMethodEnrollmentRecording | null = null;
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
      if (this.keepRecordings) {
        kept = {
          samples: pcm.samples.slice(),
          sentence: this.prompt.phrase.textContent ?? '',
        };
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
      if (kept) this.recordings.push(kept);
      kept = null;
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
      this.keepRecordings?.(this.recordings.splice(0));
      this.completion.resolve();
    } catch (error) {
      if (!this.closed && this.phase === 'committing') {
        this.phase = 'closed';
        this.controller.abort();
        this.completion.reject(toError(error));
        return;
      }
      if (!this.closed && this.samples.length === 3) {
        this.samples.pop()?.fill(0);
        this.recordings.pop()?.samples.fill(0);
      }
      if (!this.closed)
        this.status.textContent =
          error instanceof Error ? error.message : 'VoiceID enrollment failed.';
    } finally {
      kept?.samples.fill(0);
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
    // Reject first, so a cancel during loading reports the cancel and not the aborted load.
    this.completion.reject(new Error('VoiceID enrollment was cancelled.'));
    this.controller.abort();
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
    for (const recording of this.recordings.splice(0)) recording.samples.fill(0);
  }
}

function assertNever(_plan: never): never {
  throw new Error('Unsupported VoiceID enrollment capture.');
}

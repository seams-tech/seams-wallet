import { TransactionReviewError } from '@seams/wallet/voiceid-host';
import { VoicePrompt } from './prompt';
import { newConfirmationPhrase, type SpokenPhrase } from '../browser/phrase';
import { prepareVoiceModelWithProgress } from '../browser/progress';
import { listenForVoiceApproval, sameVoiceBinding, type VoiceBinding } from './bridge';
import {
  resolveSelectedVoiceEnrollmentScope,
  type VoiceIdReviewRequest,
  type VoiceConfirmation,
  type VoiceIdTranscriptionModel,
  type AuthMethodApprovalResult,
  type WalletId,
} from '@seams/wallet/voiceid-host';
type ApprovalState =
  | { readonly kind: 'pending' }
  | { readonly kind: 'preparing' }
  | { readonly kind: 'prepared' }
  | { readonly kind: 'authorizing' }
  | {
      readonly kind: 'listening';
      readonly binding: VoiceBinding;
      readonly deadline: number;
      readonly signal: AbortSignal;
    }
  | {
      readonly kind: 'approved';
      readonly binding: VoiceBinding;
      readonly deadline: number;
      readonly signal: AbortSignal;
    }
  | { readonly kind: 'consumed' }
  | { readonly kind: 'closed' };

function assertNever(value: never): never {
  throw new Error(`Unexpected voice outcome: ${String(value)}`);
}

export class VoiceIdApproval {
  private phrase: SpokenPhrase;
  private readonly prompt: VoicePrompt;
  readonly surface: HTMLElement;
  get messages() {
    return {
      confirm: 'Confirm with VoiceID',
      approved: 'Voice approved this operation.',
    };
  }
  private state: ApprovalState = { kind: 'pending' };

  private constructor(
    private readonly reviewExpiresAtMs: number,
    private readonly operationHash: string,
    private readonly walletId: WalletId,
    private readonly confirmation: VoiceConfirmation,
    private readonly model: VoiceIdTranscriptionModel,
  ) {
    this.phrase = newConfirmationPhrase(confirmation, null);
    // The receipt that follows a signature takes the checking segments over as its tracks.
    this.prompt = new VoicePrompt(
      document,
      'Approve transfer with VoiceID',
      this.phrase,
      'segments',
    );
    this.prompt.record.hidden = true;
    // The confirmation card's toolbar closes the review, so the card has no close of its own.
    this.prompt.cancel.hidden = true;
    this.surface = this.prompt.element;
  }

  static forReview(
    request: VoiceIdReviewRequest,
    model: VoiceIdTranscriptionModel,
  ): VoiceIdApproval {
    return new VoiceIdApproval(
      request.expiresAtMs,
      request.operationHash,
      request.walletId,
      request.confirmation,
      model,
    );
  }

  async prepare(signal: AbortSignal): Promise<void> {
    if (this.state.kind !== 'pending') throw new Error('VoiceID preparation already started.');
    this.state = { kind: 'preparing' };
    this.prompt.title.textContent = 'VoiceID';
    this.prompt.status.textContent = 'Loading VoiceID…';
    try {
      await prepareVoiceModelWithProgress(this.prompt.progress, signal, this.model);
      signal.throwIfAborted();
      if (this.state.kind !== 'preparing') throw new Error('VoiceID preparation was interrupted.');
      if (Date.now() >= this.reviewExpiresAtMs) {
        throw new TransactionReviewError('review_expired', 'This review has expired.');
      }
      this.prompt.progress.replaceChildren();
      this.prompt.title.textContent = 'Read aloud';
      this.state = { kind: 'prepared' };
    } catch (error) {
      this.state = { kind: 'closed' };
      throw error;
    }
  }

  async approve(signal: AbortSignal): Promise<AuthMethodApprovalResult> {
    if (this.state.kind === 'approved') {
      if (
        signal.aborted ||
        performance.now() >= this.state.deadline ||
        Date.now() >= this.state.binding.expiresAtMs
      ) {
        throw new Error('Voice approval expired or closed.');
      }
      return { kind: 'approved' };
    }
    if (this.state.kind !== 'prepared') throw new Error('Prepare VoiceID before voice approval.');
    if (
      !navigator.userActivation.isActive ||
      document.visibilityState !== 'visible' ||
      !document.hasFocus()
    ) {
      throw new Error('Open the Wallet review and select Confirm to start voice capture.');
    }
    this.state = { kind: 'authorizing' };
    try {
      const scope = await resolveSelectedVoiceEnrollmentScope(this.walletId);
      let attempt = this.beginAttempt(signal);
      for (;;) {
        const { binding, deadline, remaining } = attempt;
        const outcome = await listenForVoiceApproval(
          scope,
          binding,
          remaining,
          signal,
          this.prompt.capture,
          this.phrase,
          this.model,
        );
        this.assertListening(binding);
        if (signal.aborted || performance.now() >= deadline || Date.now() >= binding.expiresAtMs) {
          throw new Error('Voice approval expired or closed.');
        }
        switch (outcome.kind) {
          case 'approved':
            this.state = { kind: 'approved', binding, deadline, signal };
            return outcome;
          case 'retry':
            // A miss keeps the card open with a new phrase. Try again is the
            // gesture that lets the browser open the microphone once more.
            this.phrase = newConfirmationPhrase(this.confirmation, this.phrase);
            this.prompt.setPhrase(this.phrase);
            this.prompt.record.textContent = 'Try again';
            this.prompt.ready(outcome.message);
            await this.waitForRetry(signal);
            attempt = this.beginAttempt(signal);
            break;
          default:
            return assertNever(outcome);
        }
      }
    } catch (error) {
      this.state = { kind: 'closed' };
      throw error;
    }
  }

  /** Binds one listening attempt to the operation and to what remains of the review. */
  private beginAttempt(signal: AbortSignal): Readonly<{
    binding: VoiceBinding;
    deadline: number;
    remaining: number;
  }> {
    const remaining = Math.min(25_000, this.reviewExpiresAtMs - Date.now());
    if (remaining < 250 || signal.aborted)
      throw new Error('This voice review has expired or closed.');
    const binding = Object.freeze({
      attemptId: crypto.randomUUID(),
      operationHash: this.operationHash,
      expiresAtMs: Date.now() + remaining,
    });
    const deadline = performance.now() + remaining;
    this.prompt.record.hidden = true;
    this.prompt.status.textContent = 'Opening microphone…';
    this.state = { kind: 'listening', binding, deadline, signal };
    return { binding, deadline, remaining };
  }

  /** Resolves when the person selects Try again; rejects when the review closes or expires. */
  private waitForRetry(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const record = this.prompt.record;
      const settle = (retry: boolean): void => {
        clearTimeout(expiry);
        record.removeEventListener('click', tryAgain);
        signal.removeEventListener('abort', close);
        if (retry) resolve();
        else reject(new Error('This voice review has expired or closed.'));
      };
      const tryAgain = settle.bind(null, true);
      const close = settle.bind(null, false);
      const expiry = setTimeout(close, Math.max(0, this.reviewExpiresAtMs - Date.now()));
      record.addEventListener('click', tryAgain);
      signal.addEventListener('abort', close);
      if (signal.aborted) close();
      record.focus();
    });
  }

  consume(): void {
    const state = this.state;
    this.state = { kind: 'consumed' };
    if (
      state.kind !== 'approved' ||
      state.signal.aborted ||
      performance.now() >= state.deadline ||
      Date.now() >= state.binding.expiresAtMs
    ) {
      throw new Error('A current voice approval is required before signing.');
    }
  }

  private assertListening(binding: VoiceBinding): void {
    if (this.state.kind !== 'listening' || !sameVoiceBinding(binding, this.state.binding)) {
      throw new Error('This voice attempt has closed.');
    }
  }
}

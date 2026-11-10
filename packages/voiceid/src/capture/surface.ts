import { VoiceSpeakerMismatchError } from '../browser/verificationError';
import type {
  AuthMethodCaptureMount,
  AuthMethodCaptureSettlement,
} from '@seams/wallet/voiceid-host';
import { authMenuSuccessCopy } from '@seams/wallet/voiceid-host';
import type { UiConfirmSurfaceMeasurementBinding } from '@seams/wallet/voiceid-host';
import {
  createWalletIframeSurfaceMeasurementReporter,
  type WalletIframeSurfaceMeasurementReporter,
} from '@seams/wallet/voiceid-host';
import { WorkerDeferred } from '@seams/wallet/voiceid-host';
import {
  displayPhrase,
  newSpokenPhrase,
  VoicePhraseMismatchError,
  type SpokenPhrase,
} from '../browser/phrase';
import { InsufficientVoiceAudioError, type VoiceCaptureObserver } from '@seams/voice-capture';
import { leaveSurface, VoicePrompt } from '@seams/voice-capture/card';
import { VoiceUnlockFrame } from './unlockFrame';
import { toError } from '@seams/wallet/voiceid-host';
import { VoiceMicrophoneInterruptedError } from '@seams/voice-capture';

type CaptureAction<T> = (
  signal: AbortSignal,
  onCapture: VoiceCaptureObserver,
  phrase: SpokenPhrase,
) => Promise<T>;
type PreparedRecording<T> = Readonly<{
  kind: 'recording';
  action: CaptureAction<T>;
  expiresAtMs: number | null;
}>;
export type PreparedVoiceCapture<T> =
  | PreparedRecording<T>
  | Readonly<{
      kind: 'management';
      action: (signal: AbortSignal) => Promise<T>;
      expiresAtMs?: never;
    }>;
export type VoiceCaptureElements = Readonly<{
  parent: HTMLElement;
  progress: HTMLElement;
}>;
type CapturePreparation<T> = (
  signal: AbortSignal,
  elements: VoiceCaptureElements,
) => Promise<PreparedVoiceCapture<T>>;
type CaptureState<T> =
  | { kind: 'preparing' }
  | { kind: 'ready'; capture: PreparedRecording<T> }
  | { kind: 'capturing' }
  | { kind: 'succeeding' }
  | { kind: 'closed' };
type VoiceCapturePurpose = 'activation' | 'unlock' | 'export';
type VoiceUnlockSuccess = 'show' | 'skip';
const VOICE_CAPTURE_ACTION_LABELS: Readonly<Record<VoiceCapturePurpose, string>> = {
  activation: 'Activate VoiceID',
  unlock: 'Unlock with VoiceID',
  export: 'Export keys with VoiceID',
};
// The unlock success holds and fades on the auth menu's clock.
const SUCCESS_HOLD_MS = 1300;
const SUCCESS_FADE_MS = 240;
/** A handed-over card that no other card takes within this time leaves (see `handOver`). */
const HANDOFF_WAIT_MS = 4000;
class VoiceIdCaptureSurface<T> {
  readonly result: Promise<T>;
  private readonly completion = new WorkerDeferred<T>();
  private readonly controller = new AbortController();
  private readonly element: HTMLElement;
  private readonly activateButton: HTMLButtonElement;
  private readonly cancelButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly prompt: VoicePrompt;
  private readonly unlockFrame: VoiceUnlockFrame | null;
  private readonly autoStartUnlock: boolean;
  private readonly unlockSuccess: VoiceUnlockSuccess;
  private readonly unmountCapture: ((settlement: AuthMethodCaptureSettlement) => void) | null;
  private readonly measurement: WalletIframeSurfaceMeasurementReporter | null;
  private phrase = newSpokenPhrase(null);
  private state: CaptureState<T> = { kind: 'preparing' };
  private readonly purpose: VoiceCapturePurpose;
  /** A card of the same request follows a successful activation (Speak-to-Sign enrollment). */
  private readonly handoff: boolean;
  private settlement: AuthMethodCaptureSettlement = 'closed';
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    prepare: CapturePreparation<T>,
    purpose: VoiceCapturePurpose,
    binding: UiConfirmSurfaceMeasurementBinding,
    unlockSuccess: VoiceUnlockSuccess,
    mountCapture: AuthMethodCaptureMount | undefined,
    handoff: boolean,
  ) {
    this.unlockSuccess = unlockSuccess;
    this.purpose = purpose;
    this.handoff = handoff;
    const actionLabel = VOICE_CAPTURE_ACTION_LABELS[purpose];
    const parent = document.getElementById('root') ?? document.body;
    if (!parent) throw new Error('Wallet activation surface has no mount root.');
    // A card handed over by an earlier request that never opened its next card goes now.
    for (const stale of document.querySelectorAll<HTMLElement>('[data-seams-voiceid-handoff]'))
      leaveSurface(stale);
    this.element = document.createElement('section');
    this.element.className =
      'seams-wallet-ui seams-auth-method-activation-surface seams-voiceid-activation-surface';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', actionLabel);
    // A step-up inside an operation's card keeps that card's toolbar and footer, and its
    // checking segments become the receipt's tracks.
    const inCard = purpose === 'unlock' && unlockSuccess === 'skip' && mountCapture !== undefined;
    this.prompt = new VoicePrompt(
      document,
      actionLabel,
      this.phrase,
      inCard ? 'segments' : 'ring',
      displayPhrase,
    );
    this.element.append(this.prompt.element);
    this.unlockFrame =
      purpose === 'unlock' && !inCard ? new VoiceUnlockFrame(this.element, this.prompt) : null;
    this.autoStartUnlock = purpose === 'unlock' && mountCapture !== undefined;
    if (inCard) {
      this.element.classList.add('seams-voiceid-in-card');
      // The card's toolbar closes the operation, so the capture has no close of its own.
      this.prompt.cancel.hidden = true;
    }
    this.status = this.prompt.status;
    this.status.textContent = 'Loading VoiceID…';
    this.prompt.title.textContent = 'VoiceID';
    this.element.dataset.preparation = 'loading';
    this.activateButton = this.prompt.record;
    this.activateButton.textContent = actionLabel;
    this.activateButton.disabled = true;
    this.activateButton.hidden = this.autoStartUnlock;
    this.activateButton.addEventListener('click', this.begin);
    this.cancelButton = this.prompt.cancel;
    this.cancelButton.addEventListener('click', this.cancel);
    this.element.addEventListener('cancel', this.cancel);
    this.unmountCapture = mountCapture ? mountCapture(this.element) : null;
    if (!mountCapture) parent.appendChild(this.element);
    this.measurement =
      !mountCapture && binding.kind === 'wallet_iframe'
        ? createWalletIframeSurfaceMeasurementReporter({
            kind: 'request_surface',
            element: this.element,
            requestId: binding.requestId,
            postMeasurement: binding.postMeasurement,
          })
        : null;
    // The parent sizes the frame to this surface, so the card can follow the frame (fillFrame).
    if (this.measurement) this.element.classList.add('seams-voiceid-hugged');
    // The card holds focus until its action is ready; Close shows no ring while it loads.
    this.prompt.element.tabIndex = -1;
    this.prompt.element.focus({ preventScroll: true });
    this.result = this.completion.promise;
    void this.initialize(prepare);
  }

  dispose(): void {
    this.measurement?.disconnect();
    if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
    this.element.removeEventListener('cancel', this.cancel);
    this.activateButton.removeEventListener('click', this.begin);
    this.cancelButton.removeEventListener('click', this.cancel);
    this.unlockFrame?.dispose();
    this.prompt.dispose();
    // A host that mounted the card also removes it, so it can fade it out in place.
    if (this.unmountCapture) this.unmountCapture(this.settlement);
    else if (this.handoff && this.settlement === 'succeeded') this.handOver();
    else leaveSurface(this.element);
  }

  /**
   * The finished card stays where it is until the next card of this request takes its place
   * (capture/phrase.ts), so no empty frame shows while the Wallet prepares that card.
   */
  private handOver(): void {
    const element = this.element;
    element.dataset.seamsVoiceidHandoff = '';
    // A cancelled request opens no next card.
    element.addEventListener('cancel', leaveSurface.bind(null, element), { once: true });
    window.setTimeout(() => {
      if (element.isConnected && element.dataset.seamsVoiceidHandoff !== undefined)
        leaveSurface(element);
    }, HANDOFF_WAIT_MS);
  }

  private async initialize(prepare: CapturePreparation<T>): Promise<void> {
    try {
      await new Promise<void>(afterPromptPaint);
      this.controller.signal.throwIfAborted();
      const capture = await prepare(this.controller.signal, {
        parent: this.element,
        progress: this.prompt.progress,
      });
      if (this.state.kind === 'closed') return;
      if (capture.kind === 'management') {
        this.element.setAttribute('aria-label', 'Manage voice');
        this.element.dataset.preparation = 'ready';
        this.state = { kind: 'capturing' };
        const result = await capture.action(this.controller.signal);
        this.controller.signal.throwIfAborted();
        this.state = { kind: 'closed' };
        this.completion.resolve(result);
        return;
      }
      const remaining = capture.expiresAtMs === null ? null : capture.expiresAtMs - Date.now();
      if (remaining !== null && remaining <= 0) {
        throw new Error('VoiceID challenge expired. Start unlock again.');
      }
      this.state = { kind: 'ready', capture };
      this.expiryTimer = remaining === null ? null : setTimeout(this.expire, remaining);
      for (const progress of this.element.querySelectorAll('.seams-voiceid-model-download'))
        progress.remove();
      this.activateButton.disabled = false;
      if (this.autoStartUnlock) {
        this.element.dataset.preparation = 'ready';
        this.begin();
        return;
      }
      // The title and the status change in place; the action row follows them (prompt.ts CSS).
      await this.prompt.change({
        title: 'Read aloud',
        status: 'Read naturally, then pause.',
        apply: () => {
          this.element.dataset.preparation = 'ready';
        },
      });
      if (this.state.kind === 'ready') this.activateButton.focus();
    } catch (error) {
      if (this.state.kind === 'closed') return;
      this.state = { kind: 'closed' };
      this.completion.reject(toError(error));
    }
  }

  private readonly begin = (): void => {
    if (this.state.kind !== 'ready') return;
    const capture = this.state.capture;
    this.state = { kind: 'capturing' };
    void this.perform(capture);
  };

  private async perform(capture: PreparedRecording<T>): Promise<void> {
    this.activateButton.disabled = true;
    // Activation opens the enrollment card next, which opens the microphone itself.
    if (this.purpose !== 'activation') void this.prompt.change({ status: 'Opening microphone…' });
    try {
      // Unlock begins after preparation. Enrollment and retries start from their controls.
      const result = await capture.action(this.controller.signal, this.prompt.capture, this.phrase);
      if (this.state.kind === 'closed') return;
      if (this.unlockFrame && this.unlockSuccess === 'show') await this.showUnlocked(this.unlockFrame);
      // A host that mounted the capture keeps a passed check on screen.
      this.settlement = 'succeeded';
      this.state = { kind: 'closed' };
      this.completion.resolve(result);
    } catch (error: unknown) {
      if (this.state.kind === 'closed') return;
      if (
        error instanceof InsufficientVoiceAudioError ||
        error instanceof VoicePhraseMismatchError ||
        error instanceof VoiceMicrophoneInterruptedError ||
        error instanceof VoiceSpeakerMismatchError
      ) {
        if (capture.expiresAtMs !== null && Date.now() >= capture.expiresAtMs) {
          this.expire();
          return;
        }
        this.phrase = newSpokenPhrase(this.phrase);
        this.state = { kind: 'ready', capture };
        await this.prompt.readyChange(error.message, {
          phrase: this.phrase,
          action: { label: 'Try again' },
        });
        if (this.state.kind === 'ready') this.activateButton.focus();
        return;
      }
      this.state = { kind: 'closed' };
      this.completion.reject(toError(error));
    }
  }

  /**
   * The wallet is already unlocked: the card plays the success in place, keeps
   * its height, then fades out. The menu behind it is not shown again.
   */
  private async showUnlocked(frame: VoiceUnlockFrame): Promise<void> {
    this.state = { kind: 'succeeding' };
    this.settlement = 'succeeded';
    if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.cancelButton.disabled = true;
    const startedAt = performance.now();
    const copy = authMenuSuccessCopy('authenticated');
    await this.prompt.succeed(copy.headline, copy.message, frame.succeed());
    const hold = Math.max(0, SUCCESS_HOLD_MS - (performance.now() - startedAt));
    await this.element.animate(
      [
        { opacity: 1 },
        { opacity: 1, offset: hold / (hold + SUCCESS_FADE_MS), easing: 'ease-in' },
        { opacity: 0 },
      ],
      { duration: hold + SUCCESS_FADE_MS, fill: 'forwards' },
    ).finished;
  }

  private readonly cancel = (): void => {
    if (this.state.kind === 'closed' || this.state.kind === 'succeeding') return;
    this.state = { kind: 'closed' };
    this.controller.abort();
    this.completion.reject(new VoiceIdCaptureCancelledError());
  };

  private readonly expire = (): void => {
    if (this.state.kind === 'closed' || this.state.kind === 'succeeding') return;
    this.state = { kind: 'closed' };
    this.controller.abort();
    this.completion.reject(new Error('VoiceID challenge expired. Start unlock again.'));
  };
}

export class VoiceIdCaptureCancelledError extends Error {
  constructor() {
    super('VoiceID capture was cancelled.');
    this.name = 'VoiceIdCaptureCancelledError';
  }
}

export async function showVoiceIdCaptureSurface<T>(input: {
  readonly prepare: CapturePreparation<T>;
  readonly purpose: VoiceCapturePurpose;
  readonly measurement: UiConfirmSurfaceMeasurementBinding;
  readonly unlockSuccess?: VoiceUnlockSuccess;
  readonly mountCapture?: AuthMethodCaptureMount;
  /** Another card of this request follows a success, so the card stays until it takes over. */
  readonly handoff?: boolean;
}): Promise<T> {
  const surface = new VoiceIdCaptureSurface(
    input.prepare,
    input.purpose,
    input.measurement,
    input.unlockSuccess ?? 'show',
    input.mountCapture,
    input.handoff ?? false,
  );
  try {
    return await surface.result;
  } finally {
    surface.dispose();
  }
}

function afterPromptPaint(resolve: () => void): void {
  requestAnimationFrame(queueAfterPaint.bind(null, resolve));
}
function queueAfterPaint(resolve: () => void): void {
  setTimeout(resolve, 0);
}

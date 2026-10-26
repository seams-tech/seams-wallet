import { VoiceSpeakerMismatchError } from '../browser/verificationError';
import type {
  AuthMethodCaptureMount,
  AuthMethodCaptureSettlement,
} from '@/core/authMethods/hostPlugin';
import { authMenuSuccessCopy } from '@/SeamsWeb/walletIframe/host/auth-menu/domain';
import type { UiConfirmSurfaceMeasurementBinding } from '@/core/signingEngine/uiConfirm/uiConfirm.types';
import {
  createWalletIframeSurfaceMeasurementReporter,
  type WalletIframeSurfaceMeasurementReporter,
} from '@/SeamsWeb/walletIframe/host/surface-measurement-reporter';
import { WorkerDeferred } from '@/core/signingEngine/workerManager/workerDeferred';
import { newSpokenPhrase, VoicePhraseMismatchError, type SpokenPhrase } from '../browser/phrase';
import { InsufficientVoiceAudioError, type VoiceCaptureObserver } from '../browser/microphone';
import { VoicePrompt } from './prompt';
import { VoiceUnlockFrame } from './unlockFrame';
import { toError } from '@shared/utils/errors';

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
type CapturePreparation<T> = (
  signal: AbortSignal,
  parent: HTMLElement,
) => Promise<PreparedVoiceCapture<T>>;
type CaptureState<T> =
  | { kind: 'preparing' }
  | { kind: 'ready'; capture: PreparedRecording<T> }
  | { kind: 'capturing' }
  | { kind: 'succeeding' }
  | { kind: 'closed' };
// The unlock success holds and fades on the auth menu's clock.
const SUCCESS_HOLD_MS = 1300;
const SUCCESS_FADE_MS = 240;
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
  private readonly unmountCapture: ((settlement: AuthMethodCaptureSettlement) => void) | null;
  private readonly measurement: WalletIframeSurfaceMeasurementReporter | null;
  private phrase = newSpokenPhrase(null);
  private state: CaptureState<T> = { kind: 'preparing' };
  private settlement: AuthMethodCaptureSettlement = 'closed';
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    prepare: CapturePreparation<T>,
    purpose: 'activation' | 'unlock',
    binding: UiConfirmSurfaceMeasurementBinding,
    mountCapture?: AuthMethodCaptureMount,
  ) {
    const actionLabel = purpose === 'activation' ? 'Activate VoiceID' : 'Unlock with VoiceID';
    const parent = document.getElementById('root') ?? document.body;
    if (!parent) throw new Error('Wallet activation surface has no mount root.');
    this.element = document.createElement('section');
    this.element.className =
      'seams-wallet-ui seams-auth-method-activation-surface seams-voiceid-activation-surface';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', actionLabel);
    this.prompt = new VoicePrompt(document, actionLabel, this.phrase);
    this.element.append(this.prompt.element);
    this.unlockFrame =
      purpose === 'unlock' ? new VoiceUnlockFrame(this.element, this.prompt) : null;
    this.status = this.prompt.status;
    this.status.textContent = 'Preparing VoiceID…';
    this.prompt.title.textContent = 'VoiceID';
    this.element.dataset.preparation = 'loading';
    this.activateButton = this.prompt.record;
    this.activateButton.textContent = actionLabel;
    this.activateButton.disabled = true;
    this.activateButton.hidden = this.unlockFrame !== null;
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
    this.cancelButton.focus();
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
    else this.element.remove();
  }

  private async initialize(prepare: CapturePreparation<T>): Promise<void> {
    try {
      await new Promise<void>(afterPromptPaint);
      this.controller.signal.throwIfAborted();
      const capture = await prepare(this.controller.signal, this.prompt.progress);
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
      this.element.dataset.preparation = 'ready';
      this.prompt.title.textContent = 'Read aloud';
      this.status.textContent = 'Read naturally, then pause.';
      this.activateButton.disabled = false;
      if (this.unlockFrame) this.begin();
      else this.activateButton.focus();
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
    this.status.textContent = 'Opening microphone…';
    try {
      // Unlock begins after preparation. Enrollment and retries start from their controls.
      const result = await capture.action(this.controller.signal, this.prompt.capture, this.phrase);
      if (this.state.kind === 'closed') return;
      if (this.unlockFrame) await this.showUnlocked(this.unlockFrame);
      this.state = { kind: 'closed' };
      this.completion.resolve(result);
    } catch (error: unknown) {
      if (this.state.kind === 'closed') return;
      if (
        error instanceof InsufficientVoiceAudioError ||
        error instanceof VoicePhraseMismatchError ||
        error instanceof VoiceSpeakerMismatchError
      ) {
        if (capture.expiresAtMs !== null && Date.now() >= capture.expiresAtMs) {
          this.expire();
          return;
        }
        const attemptedPhrase = this.phrase;
        this.phrase = newSpokenPhrase(attemptedPhrase);
        this.prompt.setPhrase(this.phrase);
        this.state = { kind: 'ready', capture };
        this.activateButton.hidden = false;
        this.activateButton.textContent = 'Try again';
        this.prompt.ready(error.message);
        if (error instanceof VoicePhraseMismatchError || error instanceof VoiceSpeakerMismatchError)
          this.prompt.showDetails(error.details, attemptedPhrase);
        this.activateButton.focus();
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
  readonly purpose: 'activation' | 'unlock';
  readonly measurement: UiConfirmSurfaceMeasurementBinding;
  readonly mountCapture?: AuthMethodCaptureMount;
}): Promise<T> {
  const surface = new VoiceIdCaptureSurface(
    input.prepare,
    input.purpose,
    input.measurement,
    input.mountCapture,
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

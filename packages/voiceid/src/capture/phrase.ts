import {
  createWalletIframeSurfaceMeasurementReporter,
  toError,
  WorkerDeferred,
  type AuthMethodPhraseRecording,
  type AuthMethodPhraseSurface,
  type PhraseChoice,
  type PhraseView,
  type UiConfirmSurfaceMeasurementBinding,
  type WalletAuthMethodHostPlugin,
  type WalletIframeSurfaceMeasurementReporter,
} from '@seams/wallet/voiceid-host';
import { recordVoice, voiceQualityMessage, type VoiceCaptureEvent } from '../browser/microphone';
import { VoiceMicrophoneInterruptedError } from '../browser/microphoneInput';
import { SPOKEN_PHRASES } from '../browser/phraseVocabulary';
import { expectedSpeechMs } from '../browser/speechPause';
import { voiceActivityModel } from '../browser/voiceActivity';
import { PhraseCard, type HandedOverRows } from './phraseCard';
import { leaveSurface, VoicePrompt } from './prompt';

type PhraseInput = Parameters<WalletAuthMethodHostPlugin['openPhrase']>[0];

const LABEL = 'Say this with your voice';
const PROMPT_LABEL = 'Say this sentence';
const PROMPT_MESSAGE = 'Read it naturally, then pause.';

/**
 * Shows the given sentence in the VoiceID prompt. The surface records clips with the quality
 * gate, and stays open so the caller can show its check and the result in the same card. A too
 * quiet or interrupted recording stays on the surface for another try.
 */
export function openPhrase(input: PhraseInput): AuthMethodPhraseSurface {
  return new PhraseSurface(input.sentence, input.surfaceMeasurementBinding, input.signal);
}

class PhraseSurface implements AuthMethodPhraseSurface {
  private readonly element: HTMLElement;
  private readonly prompt: VoicePrompt;
  private readonly card: PhraseCard;
  private readonly measurement: WalletIframeSurfaceMeasurementReporter | null;
  private recorder: AbortController | null = null;
  private recording: WorkerDeferred<AuthMethodPhraseRecording> | null = null;
  private choice: ((choice: PhraseChoice) => void) | null = null;
  private view: PhraseView | null = null;
  private started = false;
  private closed = false;
  /** The voiced time of the whole sentence, after which a shorter pause ends a recording. */
  private readonly expectedSpeechMs: number;
  /** The speech detector has started; before that, a recording waits for it to load. */
  private speechDetectorReady = false;

  constructor(
    sentence: string,
    binding: UiConfirmSurfaceMeasurementBinding,
    private readonly outer: AbortSignal,
  ) {
    this.expectedSpeechMs = expectedSpeechMs(sentence);
    // A VoiceID card that this request just finished stays on screen for this card (surface.ts).
    const handedOver = document.querySelector<HTMLElement>(
      '.seams-voiceid-activation-surface[data-seams-voiceid-handoff]',
    );
    // The first recording on a page waits for the speech detector (about 16 MB with its engine),
    // so it starts loading while the owner reads the sentence. A failure shows on Record.
    voiceActivityModel.prepare().then(this.detectorStarted, ignoreEarlyLoad);
    const parent = document.getElementById('root') ?? document.body;
    this.element = document.createElement('section');
    this.element.className =
      'seams-wallet-ui seams-auth-method-activation-surface seams-voiceid-activation-surface';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', LABEL);
    this.prompt = new VoicePrompt(document, LABEL, SPOKEN_PHRASES[0]);
    this.prompt.title.textContent = PROMPT_LABEL;
    // A sentence that already ends with punctuation, such as an enrollment phrase, keeps it.
    const shown = /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
    this.prompt.phrase.textContent = shown;
    delete this.prompt.phrase.dataset.voiceidPhrase;
    this.prompt.status.textContent = PROMPT_MESSAGE;
    this.prompt.record.textContent = 'Record';
    const handedOverPrompt = handedOver?.querySelector(':scope > .seams-voiceid-prompt') ?? null;
    const rows = handedOverPrompt ? handedOverRows(handedOverPrompt) : null;
    if (handedOverPrompt) {
      // The card starts as the card it replaces, so the swap does not show; then its rows change.
      this.prompt.continueFrom(handedOverPrompt);
      this.prompt.record.hidden = true;
    }
    this.card = new PhraseCard(
      this.prompt,
      { label: PROMPT_LABEL, sentence: shown, message: PROMPT_MESSAGE, action: 'Record' },
      rows,
    );
    this.element.append(this.prompt.element);
    this.prompt.record.addEventListener('click', this.press);
    this.prompt.cancel.addEventListener('click', this.cancel);
    this.element.addEventListener('cancel', this.cancel);
    outer.addEventListener('abort', this.cancel);
    if (handedOver) handedOver.replaceWith(this.element);
    else parent.appendChild(this.element);
    // The parent sizes the frame to this surface, so the card can follow the frame (fillFrame).
    if (binding.kind === 'wallet_iframe') this.element.classList.add('seams-voiceid-hugged');
    this.measurement =
      binding.kind === 'wallet_iframe'
        ? createWalletIframeSurfaceMeasurementReporter({
            kind: 'request_surface',
            element: this.element,
            requestId: binding.requestId,
            postMeasurement: binding.postMeasurement,
          })
        : null;
    if (rows) this.prompt.element.focus({ preventScroll: true });
    else this.prompt.record.focus();
    if (outer.aborted) this.cancel();
  }

  record(): Promise<AuthMethodPhraseRecording> {
    if (this.closed) return Promise.resolve({ kind: 'cancelled' });
    this.settleChoice('replaced');
    this.recording?.resolve({ kind: 'cancelled' });
    const recording = new WorkerDeferred<AuthMethodPhraseRecording>();
    this.recording = recording;
    if (this.view) {
      this.view = null;
      void this.card.showPrompt();
    }
    return recording.promise;
  }

  show(view: PhraseView): Promise<PhraseChoice> {
    if (this.closed) return Promise.resolve('closed');
    this.settleChoice('replaced');
    this.view = view;
    void this.card.show(view);
    return new Promise((resolve) => {
      this.choice = resolve;
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.recorder?.abort();
    this.recording?.resolve({ kind: 'cancelled' });
    this.settleChoice('closed');
    this.measurement?.disconnect();
    this.outer.removeEventListener('abort', this.cancel);
    this.element.removeEventListener('cancel', this.cancel);
    this.prompt.record.removeEventListener('click', this.press);
    this.prompt.cancel.removeEventListener('click', this.cancel);
    this.card.dispose();
    this.prompt.dispose();
    leaveSurface(this.element);
  }

  /** The one button records on the prompt and answers a result. */
  private readonly press = (): void => {
    if (this.view) {
      if (this.view.kind === 'result' && !this.view.action.busy) this.settleChoice('action');
      return;
    }
    if (!this.recording || this.started) return;
    this.started = true;
    this.prompt.record.disabled = true;
    this.prompt.status.textContent = this.speechDetectorReady
      ? 'Opening microphone…'
      : 'Loading VoiceID…';
    void this.attempt(this.recording);
  };

  private async attempt(recording: WorkerDeferred<AuthMethodPhraseRecording>): Promise<void> {
    const recorder = new AbortController();
    this.recorder = recorder;
    try {
      const recorded = await recordVoice(recorder.signal, this.capture, this.expectedSpeechMs);
      if (this.recording !== recording || this.closed) {
        recorded.samples?.fill(0);
        return;
      }
      if (recorded.kind === 'insufficient_audio') {
        this.retry(voiceQualityMessage(recorded.quality));
        return;
      }
      // The owner stopped speaking at the last voiced frame, before the end pause.
      const endOfSpeechAt = recorded.lastSoundAtMs ?? performance.now();
      this.started = false;
      this.recording = null;
      recording.resolve({ kind: 'recorded', samples: recorded.samples, endOfSpeechAt });
    } catch (error) {
      if (this.recording !== recording || this.closed) return;
      if (error instanceof VoiceMicrophoneInterruptedError) {
        this.retry(error.message);
        return;
      }
      this.started = false;
      this.recording = null;
      recording.reject(toError(error));
    }
  }

  private readonly detectorStarted = (): void => {
    this.speechDetectorReady = true;
  };

  /** The end of speech starts the check in place; every other capture event is the prompt's. */
  private readonly capture = (event: VoiceCaptureEvent): void => {
    if (event.kind === 'processing') this.card.beginCheck();
    else this.prompt.capture(event);
  };

  private retry(message: string): void {
    this.started = false;
    this.prompt.record.textContent = 'Try again';
    this.prompt.ready(message);
    this.prompt.record.focus();
  }

  private settleChoice(choice: PhraseChoice): void {
    const settle = this.choice;
    this.choice = null;
    settle?.(choice);
  }

  /** A close during a check is not possible: the button is hidden while the caller works. */
  private readonly cancel = (): void => {
    if (this.view?.kind === 'check' && !this.outer.aborted) return;
    if (this.recording) {
      this.recorder?.abort();
      this.recording.resolve({ kind: 'cancelled' });
      this.recording = null;
      this.started = false;
    }
    this.settleChoice('closed');
    if (this.outer.aborted) this.close();
  };
}

/** A failed early load runs again when Record needs the detector, and shows its error there. */
function ignoreEarlyLoad(): void {}

/** The rows that the handed-over card shows now. */
function handedOverRows(prompt: Element): HandedOverRows {
  const read = (selector: string): string =>
    prompt.querySelector(`:scope > ${selector}`)?.textContent ?? '';
  return { label: read('h2'), message: read('.seams-voiceid-status') };
}

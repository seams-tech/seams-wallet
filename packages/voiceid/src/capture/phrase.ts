import {
  createWalletIframeSurfaceMeasurementReporter,
  toError,
  WorkerDeferred,
  type AuthMethodPhraseRecording,
  type UiConfirmSurfaceMeasurementBinding,
  type WalletAuthMethodHostPlugin,
  type WalletIframeSurfaceMeasurementReporter,
} from '@seams/wallet/voiceid-host';
import { recordVoice, voiceQualityMessage } from '../browser/microphone';
import { VoiceMicrophoneInterruptedError } from '../browser/microphoneInput';
import { SPOKEN_PHRASES } from '../browser/phraseVocabulary';
import { VoicePrompt } from './prompt';

type PhraseInput = Parameters<WalletAuthMethodHostPlugin['recordPhrase']>[0];

const LABEL = 'Say this with your voice';

/**
 * Shows the given sentence in the VoiceID prompt and records one clip with the quality
 * gate. A too quiet or interrupted recording stays on the surface for another try.
 */
export async function recordPhrase(input: PhraseInput): Promise<AuthMethodPhraseRecording> {
  const surface = new PhraseSurface(input.sentence, input.surfaceMeasurementBinding, input.signal);
  try {
    return await surface.result;
  } finally {
    surface.dispose();
  }
}

class PhraseSurface {
  private readonly completion = new WorkerDeferred<AuthMethodPhraseRecording>();
  readonly result = this.completion.promise;
  private readonly controller = new AbortController();
  private readonly element: HTMLElement;
  private readonly prompt: VoicePrompt;
  private readonly measurement: WalletIframeSurfaceMeasurementReporter | null;
  private recording = false;
  private settled = false;

  constructor(
    sentence: string,
    binding: UiConfirmSurfaceMeasurementBinding,
    private readonly outer: AbortSignal,
  ) {
    const parent = document.getElementById('root') ?? document.body;
    this.element = document.createElement('section');
    this.element.className =
      'seams-wallet-ui seams-auth-method-activation-surface seams-voiceid-activation-surface';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', LABEL);
    this.prompt = new VoicePrompt(document, LABEL, SPOKEN_PHRASES[0]);
    this.prompt.title.textContent = 'Say this sentence';
    // A sentence that already ends with punctuation, such as an enrollment phrase, keeps it.
    this.prompt.phrase.textContent = /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
    delete this.prompt.phrase.dataset.voiceidPhrase;
    this.prompt.status.textContent = 'Read it naturally, then pause.';
    this.prompt.record.textContent = 'Record';
    this.element.append(this.prompt.element);
    this.prompt.record.addEventListener('click', this.record);
    this.prompt.cancel.addEventListener('click', this.cancel);
    this.element.addEventListener('cancel', this.cancel);
    outer.addEventListener('abort', this.cancel);
    parent.appendChild(this.element);
    this.measurement =
      binding.kind === 'wallet_iframe'
        ? createWalletIframeSurfaceMeasurementReporter({
            kind: 'request_surface',
            element: this.element,
            requestId: binding.requestId,
            postMeasurement: binding.postMeasurement,
          })
        : null;
    this.prompt.record.focus();
    if (outer.aborted) this.cancel();
  }

  dispose(): void {
    this.controller.abort();
    this.measurement?.disconnect();
    this.outer.removeEventListener('abort', this.cancel);
    this.element.removeEventListener('cancel', this.cancel);
    this.prompt.record.removeEventListener('click', this.record);
    this.prompt.cancel.removeEventListener('click', this.cancel);
    this.prompt.dispose();
    this.element.remove();
  }

  private readonly record = (): void => {
    if (this.recording || this.settled) return;
    this.recording = true;
    this.prompt.record.disabled = true;
    this.prompt.status.textContent = 'Opening microphone…';
    void this.attempt();
  };

  private async attempt(): Promise<void> {
    try {
      const recorded = await recordVoice(this.controller.signal, this.prompt.capture);
      const endOfSpeechAt = performance.now();
      if (this.settled) {
        recorded.samples?.fill(0);
        return;
      }
      if (recorded.kind === 'insufficient_audio') {
        this.retry(voiceQualityMessage(recorded.quality));
        return;
      }
      this.settle({ kind: 'recorded', samples: recorded.samples, endOfSpeechAt });
    } catch (error) {
      if (this.settled) return;
      if (error instanceof VoiceMicrophoneInterruptedError) {
        this.retry(error.message);
        return;
      }
      this.settled = true;
      this.completion.reject(toError(error));
    }
  }

  private retry(message: string): void {
    this.recording = false;
    this.prompt.record.textContent = 'Try again';
    this.prompt.ready(message);
    this.prompt.record.focus();
  }

  private settle(result: AuthMethodPhraseRecording): void {
    if (this.settled) return;
    this.settled = true;
    this.completion.resolve(result);
  }

  private readonly cancel = (): void => {
    this.controller.abort();
    this.settle({ kind: 'cancelled' });
  };
}

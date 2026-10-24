import {
  createCspStylesheetManager,
  getDefaultCspNonce,
} from '@/core/browser/walletIframe/csp-stylesheet';
import type { SpokenPhrase } from '../browser/phrase';
import type { VoiceCaptureEvent } from '../browser/microphone';
import { VoiceWaveform } from '../browser/waveform';

const CSS = `
.seams-voiceid-prompt {
  box-sizing: border-box;
  position: relative;
  width: min(100%, 28rem);
  margin: 0 auto;
  padding: 3.25rem 1.5rem 2rem;
  border-radius: 1.75rem;
  background: var(--seams-colors-colorBackground, #192024);
  color: var(--seams-colors-textPrimary, #eff2f3);
  text-align: center;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.seams-voiceid-prompt h2 {
  font-size: 0.85rem;
  line-height: 1.4;
  font-weight: 400;
  opacity: 0.7;
  margin: 0 0 1.5rem;
}
.seams-voiceid-prompt .seams-voiceid-phrase {
  font-size: clamp(1.8rem, 6vw, 2.5rem);
  font-weight: 450;
  line-height: 1.17;
  letter-spacing: -0.04em;
  text-wrap: balance;
  max-width: 21rem;
  min-height: 5.85rem;
  margin: 0 auto;
}
.seams-voiceid-waveform {
  display: block;
  width: 227px;
  max-width: 100%;
  height: 64px;
  margin: 1.5rem auto 0.5rem;
  fill: currentColor;
}
.seams-voiceid-prompt .seams-voiceid-status {
  font-size: 0.75rem;
  line-height: 1.5;
  min-height: 1.2rem;
  opacity: 0.75;
  margin: 0;
}
.seams-voiceid-prompt button {
  font: inherit;
  cursor: pointer;
  touch-action: manipulation;
}
.seams-voiceid-prompt button:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 4px;
}
.seams-voiceid-prompt .seams-voiceid-close {
  position: absolute;
  right: 0.75rem;
  top: 0.5rem;
  width: 2.5rem;
  height: 2.5rem;
  background: transparent;
  border: 0;
  border-radius: 50%;
  color: inherit;
  font-size: 1.5rem;
  opacity: 0.7;
}
.seams-voiceid-prompt .seams-voiceid-record-slot {
  height: 4rem;
  padding-top: 1.25rem;
  box-sizing: border-box;
}
.seams-voiceid-prompt .seams-voiceid-primary {
  padding: 0.7rem 1.25rem;
  font-size: 0.8rem;
  border: 0;
  border-radius: 2rem;
  background: var(--seams-colors-textPrimary, #eff2f3);
  color: var(--seams-colors-colorBackground, #192024);
}
.seams-voiceid-prompt .seams-voiceid-primary:disabled {
  opacity: 0.5;
  cursor: wait;
}
.seams-voiceid-prompt button[hidden],
.seams-voiceid-prompt [hidden] {
  display: none !important;
}
.seams-voiceid-prompt .seams-voiceid-model-download {
  font-size: 0.75rem;
  line-height: 1.5;
}
.seams-voiceid-prompt .seams-voiceid-model-download progress {
  width: 100%;
}
`;
const styles = new WeakMap<Document, ReturnType<typeof createCspStylesheetManager>>();

export class VoicePrompt {
  readonly element: HTMLElement;
  readonly title: HTMLHeadingElement;
  readonly phrase: HTMLParagraphElement;
  readonly status: HTMLParagraphElement;
  readonly record: HTMLButtonElement;
  readonly cancel: HTMLButtonElement;
  private readonly waveform: VoiceWaveform;
  private disposed = false;

  constructor(document: Document, label: string, phrase: SpokenPhrase) {
    let stylesheet = styles.get(document);
    if (!stylesheet) {
      stylesheet = createCspStylesheetManager({
        doc: document,
        baseCss: CSS,
        nonce: getDefaultCspNonce,
      });
      styles.set(document, stylesheet);
    }
    stylesheet.ensureBase();
    this.element = document.createElement('section');
    this.element.className = 'seams-wallet-ui seams-voiceid-prompt';
    this.element.setAttribute('aria-label', label);
    this.title = document.createElement('h2');
    this.title.textContent = 'Read aloud';
    this.phrase = document.createElement('p');
    this.phrase.className = 'seams-voiceid-phrase';
    this.phrase.dataset.voiceidPhrase = '';
    this.phrase.setAttribute('aria-live', 'polite');
    this.setPhrase(phrase);
    this.waveform = new VoiceWaveform(document);
    this.status = document.createElement('p');
    this.status.className = 'seams-voiceid-status';
    this.status.setAttribute('role', 'status');
    this.record = document.createElement('button');
    this.record.type = 'button';
    this.record.className = 'seams-voiceid-primary';
    this.record.textContent = 'Record';
    this.cancel = document.createElement('button');
    this.cancel.type = 'button';
    this.cancel.className = 'seams-voiceid-close';
    this.cancel.textContent = '×';
    this.cancel.setAttribute('aria-label', 'Cancel');
    const slot = document.createElement('div');
    slot.className = 'seams-voiceid-record-slot';
    slot.append(this.record);
    this.element.append(
      this.cancel,
      this.title,
      this.phrase,
      this.waveform.element,
      this.status,
      slot,
    );
  }

  setPhrase(phrase: SpokenPhrase): void {
    this.phrase.textContent = phrase.charAt(0).toUpperCase() + phrase.slice(1) + '.';
    this.phrase.dataset.voiceidPhrase = phrase;
  }

  readonly capture = (event: VoiceCaptureEvent): void => {
    if (this.disposed) return;
    switch (event.kind) {
      case 'listening':
        this.element.dataset.capture = 'listening';
        this.record.hidden = true;
        this.status.textContent = 'Listening';
        this.waveform.start(event.stream);
        return;
      case 'processing':
        this.element.dataset.capture = 'processing';
        this.waveform.stop();
        this.status.textContent = 'Checking your voice…';
        return;
      default:
        return assertNever(event);
    }
  };

  ready(message: string): void {
    this.waveform.stop();
    this.element.dataset.capture = 'ready';
    this.status.textContent = message;
    this.record.hidden = false;
    this.record.disabled = false;
  }

  dispose(): void {
    this.disposed = true;
    this.waveform.stop();
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected capture event: ${String(value)}`);
}

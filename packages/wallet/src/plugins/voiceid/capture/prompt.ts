import {
  createCspStylesheetManager,
  getDefaultCspNonce,
} from '@/core/browser/walletIframe/csp-stylesheet';
import type { SpokenPhrase } from '../browser/phrase';
import type { VoiceCaptureEvent } from '../browser/microphone';
import { VoiceVisual } from './visual';

const CSS = `
.seams-voiceid-activation-surface { width: min(100%, 26.25rem); margin: 0 auto; }
.seams-voiceid-recording-details { font-size:.7rem; line-height:1.5; margin: .75rem 0; opacity:.8; overflow-wrap:anywhere; }
.seams-voiceid-recording-details summary { cursor:pointer; }

.seams-voiceid-prompt {
  box-sizing: border-box;
  position: relative;
  width: min(100%, 26.25rem);
  margin: 0 auto;
  padding: 3.5rem 1.5rem 1.5rem;
  display: grid;
  grid-template-rows: auto minmax(6rem, auto) 5rem minmax(3.375rem, auto) 5rem auto;
  border: 1px solid var(--seams-colors-borderPrimary, #303b41);
  border-radius: var(--seams-shape-card, 16px);
  background: var(--seams-colors-colorBackground, #192024);
  color: var(--seams-colors-textPrimary, #eff2f3);
  text-align: center;
  font-family: var(--seams-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
  -webkit-font-smoothing: antialiased;
}
.seams-voiceid-prompt {
  transition: opacity 180ms var(--seams-ease-out, cubic-bezier(0.23, 1, 0.32, 1)), transform 180ms var(--seams-ease-out, cubic-bezier(0.23, 1, 0.32, 1));
}
@starting-style {
  .seams-voiceid-prompt { opacity: 0; transform: translateY(4px); }
}
.seams-voiceid-progress-slot { grid-row: 5; grid-column: 1; min-width: 0; align-self: center; }
.seams-voiceid-progress-slot:empty { visibility: hidden; }
.seams-voiceid-activation-surface[data-preparation="loading"] .seams-voiceid-record-slot { visibility: hidden; }
.seams-voiceid-recording-details { grid-row: 6; grid-column: 1; color: var(--seams-colors-textSecondary, #9cabb3); }
@media (prefers-reduced-motion: reduce) {
  .seams-voiceid-prompt { transform: none; transition: opacity 150ms ease; }
  @starting-style { .seams-voiceid-prompt { transform: none; } }
  .seams-voiceid-ribbon { transition: none !important; }
}
.seams-voiceid-prompt h2 {
  font-size: 0.85rem;
  line-height: 1.4;
  font-weight: 500;
  color: var(--seams-colors-textSecondary, #9cabb3);
  margin: 0 0 1.5rem;
}
.seams-voiceid-prompt .seams-voiceid-phrase {
  font-size: clamp(1.75rem, 6vw, 2.25rem);
  font-weight: 600;
  line-height: 1.17;
  letter-spacing: -0.035em;
  text-wrap: balance;
  max-width: 21rem;
  align-self: center;
  margin: 0 auto;
}
.seams-voiceid-ribbon {
  display: block;
  width: 308px;
  max-width: 100%;
  height: 64px;
  margin: auto;
}
/* The glow is decorative and cannot intercept record, retry or cancel controls. */
.seams-voiceid-glow { position: absolute; inset: 0; pointer-events: none; border-radius: inherit; z-index: 0; }
.seams-voiceid-beam { width: 100%; height: 100%; border-radius: inherit; }
.seams-voiceid-prompt > :not(.seams-voiceid-glow) { position: relative; z-index: 1; }
.seams-voiceid-prompt > .seams-voiceid-close { position: absolute; }
.seams-voiceid-prompt .seams-voiceid-status {
  font-size: 0.75rem;
  line-height: 1.5;
  min-height: 3.375rem;
  color: var(--seams-colors-textSecondary, #9cabb3);
  margin: 0;
}
.seams-voiceid-prompt button {
  font: inherit;
  cursor: pointer;
  touch-action: manipulation;
}
.seams-voiceid-prompt button:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
.seams-voiceid-prompt .seams-voiceid-close {
  position: absolute;
  right: 0.75rem;
  top: 0.75rem;
  width: 2.5rem;
  height: 2.5rem;
  background: transparent;
  border: 0;
  border-radius: var(--seams-shape-control, 10px);
  color: inherit;
  display: grid;
  place-items: center;
  color: var(--seams-colors-textSecondary, #9cabb3);
}
.seams-voiceid-prompt .seams-voiceid-record-slot {
  grid-row: 5;
  grid-column: 1;
  align-self: center;
  width: 100%;
  box-sizing: border-box;
}
.seams-voiceid-prompt .seams-voiceid-primary {
  width: 100%;
  min-height: var(--seams-shape-controlHeight, 44px);
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  border: 0;
  border-radius: var(--seams-shape-control, 10px);
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
  appearance: none;
  display: block;
  width: 100%;
  height: 4px;
  border: 0;
  border-radius: 2px;
  overflow: hidden;
  background: var(--seams-colors-surface, #202b31);
  accent-color: var(--seams-colors-textPrimary, #eff2f3);
}
.seams-voiceid-model-download p { margin: 0 0 0.75rem; color: var(--seams-colors-textSecondary, #9cabb3); font-variant-numeric: tabular-nums; }
.seams-voiceid-model-download progress::-webkit-progress-bar { background: var(--seams-colors-surface, #202b31); }
.seams-voiceid-model-download progress::-webkit-progress-value { background: var(--seams-colors-textPrimary, #eff2f3); border-radius: 2px; }
.seams-voiceid-model-download progress::-moz-progress-bar { background: var(--seams-colors-textPrimary, #eff2f3); }
@media (hover: hover) and (pointer: fine) {
  .seams-voiceid-close:hover { background: var(--seams-colors-surface, #202b31); }
  .seams-voiceid-primary:hover:not(:disabled) { opacity: 0.9; }
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
  readonly progress: HTMLElement;
  private readonly visual: VoiceVisual;
  private readonly details: HTMLDetailsElement;
  private readonly detailText: HTMLParagraphElement;
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
    this.visual = new VoiceVisual(document, this.element);
    this.status = document.createElement('p');
    this.status.className = 'seams-voiceid-status';
    this.status.setAttribute('role', 'status');
    this.details = document.createElement('details');
    this.details.hidden = true;
    this.details.className = 'seams-voiceid-recording-details';
    const summary = document.createElement('summary');
    summary.textContent = 'Recording details';
    this.detailText = document.createElement('p');
    this.details.append(summary, this.detailText);
    this.record = document.createElement('button');
    this.record.type = 'button';
    this.record.className = 'seams-voiceid-primary';
    this.record.textContent = 'Record';
    this.cancel = document.createElement('button');
    this.cancel.type = 'button';
    this.cancel.className = 'seams-voiceid-close';
    const closeIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    closeIcon.setAttribute('viewBox', '0 0 24 24');
    closeIcon.setAttribute('width', '20');
    closeIcon.setAttribute('height', '20');
    closeIcon.setAttribute('aria-hidden', 'true');
    const closePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    closePath.setAttribute('d', 'M6 6l12 12M18 6L6 18');
    closePath.setAttribute('fill', 'none');
    closePath.setAttribute('stroke', 'currentColor');
    closePath.setAttribute('stroke-width', '1.75');
    closePath.setAttribute('stroke-linecap', 'round');
    closeIcon.append(closePath);
    this.cancel.append(closeIcon);
    this.cancel.setAttribute('aria-label', 'Cancel');
    this.progress = document.createElement('div');
    this.progress.className = 'seams-voiceid-progress-slot';
    const slot = document.createElement('div');
    slot.className = 'seams-voiceid-record-slot';
    slot.append(this.record);
    this.element.append(
      this.visual.glow,
      this.cancel,
      this.title,
      this.phrase,
      this.visual.element,
      this.status,
      slot,
      this.progress,
      this.details,
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
        this.details.hidden = true;
        this.details.open = false;
        delete this.status.dataset.voiceCaptureQuality;
        this.element.dataset.capture = 'listening';
        this.record.hidden = true;
        this.status.textContent = 'Listening';
        this.visual.listen();
        return;
      case 'activity':
        this.visual.add(event);
        return;
      case 'measured': {
        const quality = event.quality;
        this.status.dataset.voiceCaptureQuality = JSON.stringify(quality);
        this.details.hidden = quality.voicedMs >= quality.requiredVoicedMs && quality.noise !== 'high';
        if (quality.noise === 'high') this.status.textContent = 'Background noise is high. Move closer to the microphone.';
        this.detailText.textContent = `Input: ${quality.microphone}. Audio length ${(quality.durationMs / 1_000).toFixed(1)} s; capture ${(quality.recordingMs / 1_000).toFixed(1)} s, ended by ${quality.endedBy}; ${(quality.voicedMs / 1_000).toFixed(2)} s of detected speech. Peak frame level ${quality.peakFrameRms.toFixed(4)}; minimum ${quality.levelThreshold}. Background RMS ${quality.backgroundRms.toFixed(4)}. Speech/background ${quality.speechToBackgroundDb === null ? "unknown" : quality.speechToBackgroundDb.toFixed(1) + " dB"}. Browser processing: ${JSON.stringify(quality.processing)}.`;
        return;
      }
      case 'processing':
        this.element.dataset.capture = 'processing';
        this.visual.checking();
        this.status.textContent = 'Checking your voice…';
        return;
      default:
        return assertNever(event);
    }
  };

  showDetails(message: string): void {
    this.details.hidden = false;
    this.details.open = false;
    this.detailText.textContent = message;
  }

  /** Settle the visual when an enrollment sample is accepted. */
  accepted(): void {
    this.visual.accept();
  }

  ready(message: string): void {
    this.visual.ready();
    this.element.dataset.capture = 'ready';
    this.status.textContent = message;
    this.record.hidden = false;
    this.record.disabled = false;
  }

  dispose(): void {
    this.disposed = true;
    this.visual.stop();
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected capture event: ${String(value)}`);
}

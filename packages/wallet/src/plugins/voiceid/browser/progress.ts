import { prepareVoiceActivity } from './voiceActivity';
import { prepareVoiceModel } from './model';
import { preparePhraseModel } from './phrase';
import type { VoiceModelProgress } from './inference';

// Models saved in this browser load within a frame or two. The progress appears only
// for a load that takes longer, so a cached load never adds a row and resizes the card.
const REVEAL_DELAY_MS = 300;

class VoiceModelDownload {
  readonly element = document.createElement('section');
  private readonly status = document.createElement('p');
  private readonly meter = document.createElement('progress');
  private readonly reveal: ReturnType<typeof setTimeout>;

  constructor(parent: HTMLElement) {
    this.element.className = 'seams-voiceid-model-download';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.meter.setAttribute('aria-label', 'VoiceID model download');
    this.meter.style.width = '100%';
    this.element.append(this.status, this.meter);
    this.reveal = setTimeout(parent.append.bind(parent, this.element), REVEAL_DELAY_MS);
  }

  /** A load that finished first never shows; a shown one stays until its surface removes it. */
  readonly settle = (): void => {
    clearTimeout(this.reveal);
  };

  readonly update = (state: VoiceModelProgress): void => {
    this.element.dataset.state = state.kind;
    this.meter.hidden = state.kind === 'ready';
    this.meter.removeAttribute('value');
    switch (state.kind) {
      case 'checking_cache':
        this.status.textContent = `Loading saved ${state.label.toLowerCase()}…`;
        return;
      case 'downloading':
        this.meter.max = state.total;
        this.meter.value = state.received;
        this.status.textContent = `Downloading ${state.label.toLowerCase()}: ${(state.received / 1_000_000).toFixed(1)} of ${(state.total / 1_000_000).toFixed(1)} MB · ${Math.floor(state.received / state.total * 100)}%`;
        return;
      case 'preparing':
        this.status.textContent = `Preparing ${state.label.toLowerCase()} on this device…`;
        return;
      case 'ready':
        this.status.textContent = state.storage === 'browser'
          ? `${state.label} is ready. The model is saved in this browser.`
          : `${state.label} is ready for this session. This browser could not save the model.`;
        return;
    }
    state satisfies never;
  };
}

export async function prepareVoiceModelWithProgress(parent: HTMLElement): Promise<void> {
  const component = new VoiceModelDownload(parent);
  try {
    await prepareVoiceModel(component.update);
    await preparePhraseModel(component.update);
    await prepareVoiceActivity(component.update);
  } finally {
    component.settle();
  }
}

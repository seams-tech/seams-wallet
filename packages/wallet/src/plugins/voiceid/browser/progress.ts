import { prepareVoiceActivity } from './voiceActivity';
import { prepareVoiceModel } from './model';
import { preparePhraseModel } from './phrase';
import type { VoiceModelProgress } from './inference';

class VoiceModelDownload {
  readonly element = document.createElement('section');
  private readonly status = document.createElement('p');
  private readonly meter = document.createElement('progress');

  constructor(parent: HTMLElement) {
    this.element.className = 'seams-voiceid-model-download';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.meter.setAttribute('aria-label', 'VoiceID model download');
    this.meter.style.width = '100%';
    this.element.append(this.status, this.meter);
    parent.append(this.element);
  }

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
  await prepareVoiceModel(component.update);
  await preparePhraseModel(component.update);
  await prepareVoiceActivity(component.update);
}

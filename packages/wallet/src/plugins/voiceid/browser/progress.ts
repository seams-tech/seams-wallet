import { ensureVoiceIdStyles } from '../capture/surface';
import { prepareVoiceModel, type VoiceModelProgress } from './model';

class VoiceModelDownload {
  readonly element = document.createElement('section');
  private readonly status = document.createElement('p');
  private readonly meter = document.createElement('progress');

  constructor(parent: HTMLElement, standalone: boolean) {
    ensureVoiceIdStyles(document);
    this.element.className = standalone
      ? 'seams-wallet-ui seams-auth-method-activation-surface seams-voiceid-activation-surface seams-voiceid-model-download'
      : 'seams-voiceid-model-download';
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
        this.status.textContent = 'Checking this browser for VoiceID…';
        return;
      case 'downloading':
        this.meter.max = state.total;
        this.meter.value = state.received;
        this.status.textContent = `Downloading VoiceID: ${(state.received / 1_000_000).toFixed(1)} of ${(state.total / 1_000_000).toFixed(1)} MB (${Math.floor(state.received / state.total * 100)}%). This browser will save the model for next time.`;
        return;
      case 'preparing':
        this.status.textContent = 'Preparing VoiceID on this device…';
        return;
      case 'ready':
        this.status.textContent = state.storage === 'browser'
          ? 'VoiceID is ready. The model is saved in this browser.'
          : 'VoiceID is ready for this session. This browser could not save the model.';
        return;
    }
    state satisfies never;
  };
}

export async function prepareVoiceModelWithProgress(parent?: HTMLElement): Promise<void> {
  const mount = parent ?? document.getElementById('root') ?? document.body;
  const component = new VoiceModelDownload(mount, parent === undefined);
  try {
    await prepareVoiceModel(component.update);
  } finally {
    if (!parent) component.element.remove();
  }
}

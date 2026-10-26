import { voiceActivityModel } from './voiceActivity';
import { voiceModel } from './model';
import { phraseModel } from './phrase';
import { voiceInferenceEngine, type VoiceAssetProgress } from './inference';

// Avoid flashing an indicator when the prepared sessions are already in memory.
const REVEAL_DELAY_MS = 300;
const MODELS = [voiceModel, phraseModel, voiceActivityModel];
const ASSETS = [voiceInferenceEngine, ...MODELS.map(modelAsset)];

function modelAsset(model: typeof voiceModel) {
  return model.asset;
}

function assetSize(total: number, asset: (typeof ASSETS)[number]): number {
  return total + asset.size;
}

class VoiceModelDownload {
  readonly element = document.createElement('section');
  private readonly status = document.createElement('p');
  private readonly meter = document.createElement('progress');
  private readonly reveal: ReturnType<typeof setTimeout>;
  private readonly received = new Map<(typeof ASSETS)[number], number>();
  private readonly total = ASSETS.reduce(assetSize, 0);

  constructor(parent: HTMLElement) {
    this.element.className = 'seams-voiceid-model-download';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.meter.setAttribute('aria-label', 'VoiceID download');
    this.meter.style.width = '100%';
    this.element.append(this.status, this.meter);
    this.status.textContent = 'Loading saved VoiceID…';
    this.reveal = setTimeout(parent.append.bind(parent, this.element), REVEAL_DELAY_MS);
  }

  /** A load that finished first never shows; a shown one stays until its surface removes it. */
  readonly settle = (): void => {
    clearTimeout(this.reveal);
  };

  readonly update = (asset: (typeof ASSETS)[number], state: VoiceAssetProgress): void => {
    switch (state.kind) {
      case 'checking_cache':
        return;
      case 'downloading':
        this.received.set(asset, state.received);
        this.element.dataset.state = 'downloading';
        break;
      case 'ready':
        this.received.set(asset, asset.size);
        break;
      default:
        state satisfies never;
    }
    if (this.element.dataset.state !== 'downloading') return;
    let received = 0;
    for (const bytes of this.received.values()) received += bytes;
    this.meter.max = this.total;
    this.meter.value = received;
    this.status.textContent = `Downloading VoiceID: ${(received / 1_000_000).toFixed(1)} of ${(this.total / 1_000_000).toFixed(1)} MB · ${Math.floor((received / this.total) * 100)}%`;
  };

  preparing(): void {
    this.element.dataset.state = 'preparing';
    this.meter.removeAttribute('value');
    this.status.textContent = 'Preparing VoiceID…';
  }

  ready(): void {
    this.element.dataset.state = 'ready';
    this.meter.hidden = true;
    this.status.textContent = 'VoiceID is ready.';
  }
}

export async function prepareVoiceModelWithProgress(parent: HTMLElement): Promise<void> {
  const component = new VoiceModelDownload(parent);
  try {
    for (const asset of ASSETS) {
      await asset.download(component.update.bind(component, asset));
    }
    component.preparing();
    for (const model of MODELS) await model.prepare();
    component.ready();
  } finally {
    component.settle();
  }
}

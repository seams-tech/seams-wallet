import { voiceActivityModel } from './voiceActivity';
import { voiceModel } from './model';
import { phraseModel } from './phrase';
import { VoiceIdLoadError, voiceInferenceEngine, type VoiceAssetProgress } from './inference';
import { WorkerDeferred } from '@seams/wallet/voiceid-host';

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
  private readonly retryButton = document.createElement('button');
  private retry: WorkerDeferred<void> | null = null;
  private readonly cancelled = new WorkerDeferred<never>();
  private readonly reveal: ReturnType<typeof setTimeout>;
  private readonly received = new Map<(typeof ASSETS)[number], number>();
  private readonly total = ASSETS.reduce(assetSize, 0);

  constructor(
    private readonly parent: HTMLElement,
    private readonly signal: AbortSignal,
  ) {
    this.element.className = 'seams-voiceid-model-download';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.meter.setAttribute('aria-label', 'VoiceID download');
    this.meter.style.width = '100%';
    this.retryButton.type = 'button';
    this.retryButton.className = 'seams-voiceid-primary';
    this.retryButton.textContent = 'Retry loading';
    this.retryButton.hidden = true;
    this.retryButton.addEventListener('click', this.retryLoading);
    this.element.append(this.status, this.meter, this.retryButton);
    this.status.textContent = 'Loading saved VoiceID…';
    this.reveal = setTimeout(parent.append.bind(parent, this.element), REVEAL_DELAY_MS);
    signal.addEventListener('abort', this.abort, { once: true });
  }

  /** A load that finished first never shows; a shown one stays until its surface removes it. */
  readonly settle = (): void => {
    clearTimeout(this.reveal);
    this.signal.removeEventListener('abort', this.abort);
    this.retryButton.removeEventListener('click', this.retryLoading);
  };

  readonly abort = (): void => {
    const error = new DOMException('VoiceID preparation was cancelled.', 'AbortError');
    this.cancelled.reject(error);
    this.retry?.reject(error);
  };

  private readonly retryLoading = (): void => {
    this.retry?.resolve();
    this.retry = null;
  };

  async prepare(): Promise<void> {
    this.signal.throwIfAborted();
    await Promise.race([this.prepareUntilReady(), this.cancelled.promise]);
  }

  private async prepareUntilReady(): Promise<void> {
    for (;;) {
      this.signal.throwIfAborted();
      this.retryButton.hidden = true;
      this.meter.hidden = false;
      try {
        for (const asset of ASSETS) {
          await asset.download(this.update.bind(this, asset));
          this.signal.throwIfAborted();
        }
        this.preparing();
        for (const model of MODELS) {
          await model.prepare();
          this.signal.throwIfAborted();
        }
        this.ready();
        return;
      } catch (error) {
        this.signal.throwIfAborted();
        if (!(error instanceof VoiceIdLoadError)) throw error;
        clearTimeout(this.reveal);
        this.parent.append(this.element);
        this.element.dataset.state = 'failed';
        this.meter.hidden = true;
        this.status.textContent = error.message;
        this.retry = new WorkerDeferred<void>();
        this.retryButton.hidden = false;
        this.retryButton.focus();
        await this.retry.promise;
      }
    }
  }

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

export async function prepareVoiceModelWithProgress(
  parent: HTMLElement,
  signal: AbortSignal,
): Promise<void> {
  const component = new VoiceModelDownload(parent, signal);
  try {
    await component.prepare();
  } finally {
    component.settle();
  }
}

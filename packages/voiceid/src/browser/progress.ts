import { voiceActivityModel } from './voiceActivity';
import { voiceModel } from './model';
import { getPhraseModel } from './phrase';
import type { VoiceIdTranscriptionModel } from '@seams/wallet/voiceid-host';
import { VoiceIdLoadError, voiceInferenceEngine, type VoiceAssetProgress } from './inference';
import { WorkerDeferred } from '@seams/wallet/voiceid-host';

// A download shows at once. Saved models usually start within this time, so their indicator
// shows only when the start is slow, and then stays long enough to read.
const REVEAL_DELAY_MS = 600;
const MIN_VISIBLE_MS = 400;
// The indicator's rows fade out before the card's own rows fade back in (prompt.ts).
const FADE_MS = 120;
const SWAP_OUT_MS = 120;
const SWAP_IN_MS = 200;
function modelAsset(model: typeof voiceModel) {
  return model.asset;
}

type DownloadAsset = typeof voiceInferenceEngine;
function assetSize(total: number, asset: DownloadAsset): number {
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
  /** `performance.now()` when the indicator showed, or null while it is not shown. */
  private shownAt: number | null = null;
  private readonly received = new Map<DownloadAsset, number>();
  private readonly models: readonly (typeof voiceModel)[];
  private readonly assets: readonly DownloadAsset[];
  private readonly total: number;

  constructor(
    private readonly parent: HTMLElement,
    private readonly signal: AbortSignal,
    model: VoiceIdTranscriptionModel,
  ) {
    this.models = [voiceModel, getPhraseModel(model), voiceActivityModel];
    this.assets = [voiceInferenceEngine, ...this.models.map(modelAsset)];
    this.total = this.assets.reduce(assetSize, 0);
    this.element.className = 'seams-voiceid-model-download';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.meter.setAttribute('aria-label', 'VoiceID download');
    this.retryButton.type = 'button';
    this.retryButton.className = 'seams-voiceid-primary';
    this.retryButton.textContent = 'Retry loading';
    this.retryButton.hidden = true;
    this.retryButton.addEventListener('click', this.retryLoading);
    this.element.append(this.status, this.meter, this.retryButton);
    this.status.textContent = 'Loading saved VoiceID…';
    this.reveal = setTimeout(this.show, REVEAL_DELAY_MS);
    signal.addEventListener('abort', this.abort, { once: true });
  }

  private readonly show = (): void => {
    clearTimeout(this.reveal);
    if (this.shownAt !== null) return;
    this.shownAt = performance.now();
    this.parent.append(this.element);
  };

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
        for (const asset of this.assets) {
          await asset.download(this.update.bind(this, asset));
          this.signal.throwIfAborted();
        }
        this.preparing();
        for (const model of this.models) {
          await model.prepare();
          this.signal.throwIfAborted();
        }
        await this.ready();
        return;
      } catch (error) {
        this.signal.throwIfAborted();
        if (!(error instanceof VoiceIdLoadError)) throw error;
        this.show();
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

  readonly update = (asset: DownloadAsset, state: VoiceAssetProgress): void => {
    switch (state.kind) {
      case 'checking_cache':
        return;
      case 'downloading':
        this.received.set(asset, state.received);
        this.element.dataset.state = 'downloading';
        // A download takes seconds, so it shows at once.
        this.show();
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

  /** The bar stays full: an indeterminate bar paints as an empty track. */
  preparing(): void {
    this.element.dataset.state = 'preparing';
    this.meter.max = this.total;
    this.meter.value = this.total;
    void this.swapStatus('Preparing VoiceID…');
  }

  /** The message fades out, changes and fades in, so two texts never cross in one place. */
  private async swapStatus(text: string): Promise<void> {
    const status = this.status;
    if (this.shownAt === null || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      status.textContent = text;
      return;
    }
    const out = status.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: SWAP_OUT_MS,
      easing: 'ease-in',
      fill: 'forwards',
    });
    await out.finished.catch(ignoreCancel);
    status.textContent = text;
    status.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: SWAP_IN_MS,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
    });
    out.cancel();
  }

  /** A shown indicator stays for MIN_VISIBLE_MS, then fades out before the card goes on. */
  async ready(): Promise<void> {
    clearTimeout(this.reveal);
    if (this.shownAt === null) return;
    const shownFor = performance.now() - this.shownAt;
    if (shownFor < MIN_VISIBLE_MS) await delay(MIN_VISIBLE_MS - shownFor, this.signal);
    // The rows fade out as they are; the card's own rows and Record say that VoiceID is ready.
    this.element.dataset.state = 'ready';
    await delay(FADE_MS, this.signal);
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const waited = new WorkerDeferred<void>();
  const stop = (): void => {
    clearTimeout(timer);
    waited.reject(new DOMException('VoiceID preparation was cancelled.', 'AbortError'));
  };
  const timer = setTimeout(() => {
    signal.removeEventListener('abort', stop);
    waited.resolve();
  }, ms);
  signal.addEventListener('abort', stop, { once: true });
  return waited.promise;
}

function ignoreCancel(): void {}

export async function prepareVoiceModelWithProgress(
  parent: HTMLElement,
  signal: AbortSignal,
  model: VoiceIdTranscriptionModel,
): Promise<void> {
  const component = new VoiceModelDownload(parent, signal, model);
  try {
    await component.prepare();
  } finally {
    component.settle();
  }
}

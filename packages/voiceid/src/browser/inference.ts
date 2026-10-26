import type { InferenceSession } from 'onnxruntime-web';

type ModelAsset = Readonly<{ path: string; sha256: string; bytes: number; label: string }>;
export type VoiceAssetProgress =
  { kind: 'checking_cache' } | { kind: 'downloading'; received: number } | { kind: 'ready' };
const CACHE_NAME = 'seams-voiceid-models-v1';

async function openModelCache(): Promise<Cache | null> {
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

class BrowserInferenceAsset {
  private pending: Promise<ArrayBuffer> | null = null;
  private progress: VoiceAssetProgress = { kind: 'checking_cache' };
  private readonly listeners = new Set<(progress: VoiceAssetProgress) => void>();

  constructor(private readonly asset: ModelAsset) {}

  get size(): number {
    return this.asset.bytes;
  }

  async download(onProgress?: (progress: VoiceAssetProgress) => void): Promise<ArrayBuffer> {
    if (onProgress) {
      this.listeners.add(onProgress);
      onProgress(this.progress);
    }
    try {
      if (!this.pending) this.pending = this.bytes().catch(this.failed);
      const bytes = await this.pending;
      this.publish({ kind: 'ready' });
      return bytes;
    } finally {
      if (onProgress) this.listeners.delete(onProgress);
    }
  }

  private readonly failed = (error: unknown): never => {
    this.pending = null;
    this.progress = { kind: 'checking_cache' };
    throw error;
  };

  private publish(progress: VoiceAssetProgress): void {
    this.progress = progress;
    for (const listener of this.listeners) listener(progress);
  }

  private async valid(bytes: ArrayBuffer): Promise<boolean> {
    if (bytes.byteLength !== this.asset.bytes) return false;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    let hex = '';
    for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
    return hex === this.asset.sha256;
  }

  private async bytes(): Promise<ArrayBuffer> {
    const { label, path, sha256 } = this.asset;
    this.publish({ kind: 'checking_cache' });
    const cache = await openModelCache();
    const cacheKey = new URL(`${path}?sha256=${sha256}`, location.origin).href;
    try {
      const response = await cache?.match(cacheKey);
      if (response) {
        const bytes = await response.arrayBuffer();
        if (await this.valid(bytes)) return bytes;
        await cache?.delete(cacheKey);
      }
    } catch {
      // Cache access can fail in restricted browser storage.
    }
    this.publish({ kind: 'downloading', received: 0 });
    const response = await fetch(path, { credentials: 'omit', cache: 'force-cache' });
    if (!response.ok || !response.body)
      throw new Error(`${label} is unavailable from this Wallet.`);
    const reader = response.body.getReader();
    const bytes = new Uint8Array(this.asset.bytes);
    let received = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (received + chunk.value.length > bytes.length)
          throw new Error(`${label} size is invalid.`);
        bytes.set(chunk.value, received);
        received += chunk.value.length;
        this.publish({ kind: 'downloading', received });
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (!(await this.valid(bytes.buffer))) throw new Error(`${label} integrity check failed.`);
    if (cache) {
      try {
        await cache.put(
          cacheKey,
          new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }),
        );
      } catch {
        // Inference remains available for this session if storage is full.
      }
    }
    return bytes.buffer;
  }
}

// These bytes match the pinned onnxruntime-web dependency shipped by the Wallet host.
export const voiceInferenceEngine = new BrowserInferenceAsset({
  path: '/sdk/voiceid/ort-wasm-simd-threaded.wasm',
  sha256: '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2',
  bytes: 14_239_897,
  label: 'VoiceID engine',
});

export class BrowserInferenceModel {
  readonly asset: BrowserInferenceAsset;
  private session: Promise<InferenceSession> | null = null;

  constructor(asset: ModelAsset) {
    this.asset = new BrowserInferenceAsset(asset);
  }

  prepare(): Promise<InferenceSession> {
    if (!this.session) this.session = this.load().catch(this.failed);
    return this.session;
  }

  private readonly failed = (error: unknown): never => {
    this.session = null;
    throw error;
  };

  private async load(): Promise<InferenceSession> {
    const ort = await import('onnxruntime-web/wasm');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = new URL('/sdk/voiceid/', location.origin).href;
    ort.env.wasm.wasmBinary = await voiceInferenceEngine.download();
    const bytes = await this.asset.download();
    return await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  }
}

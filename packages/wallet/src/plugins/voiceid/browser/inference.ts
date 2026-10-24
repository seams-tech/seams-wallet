import type { InferenceSession } from 'onnxruntime-web';

type ModelAsset = Readonly<{ path: string; sha256: string; bytes: number; label: string }>;
export type VoiceModelProgress =
  | { kind: 'checking_cache'; label: string }
  | { kind: 'downloading'; label: string; received: number; total: number }
  | { kind: 'preparing'; label: string; storage: 'browser' | 'session' }
  | { kind: 'ready'; label: string; storage: 'browser' | 'session' };
const CACHE_NAME = 'seams-voiceid-models-v1';

async function openModelCache(): Promise<Cache | null> {
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

export class BrowserInferenceModel {
  private session: Promise<InferenceSession> | null = null;
  private progress: VoiceModelProgress;
  private readonly listeners = new Set<(progress: VoiceModelProgress) => void>();

  constructor(private readonly asset: ModelAsset) {
    this.progress = { kind: 'checking_cache', label: asset.label };
  }

  async prepare(onProgress?: (progress: VoiceModelProgress) => void): Promise<InferenceSession> {
    if (onProgress) {
      this.listeners.add(onProgress);
      onProgress(this.progress);
    }
    try {
      if (!this.session) this.session = this.load().catch(this.failed);
      return await this.session;
    } finally {
      if (onProgress) this.listeners.delete(onProgress);
    }
  }

  private readonly failed = (error: unknown): never => {
    this.session = null;
    throw error;
  };

  private publish(progress: VoiceModelProgress): void {
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

  private async bytes(): Promise<{ bytes: ArrayBuffer; storage: 'browser' | 'session' }> {
    const { label, path, sha256 } = this.asset;
    this.publish({ kind: 'checking_cache', label });
    const cache = await openModelCache();
    const cacheKey = new URL(`${path}?sha256=${sha256}`, location.origin).href;
    try {
      const response = await cache?.match(cacheKey);
      if (response) {
        const bytes = await response.arrayBuffer();
        if (await this.valid(bytes)) return { bytes, storage: 'browser' };
        await cache?.delete(cacheKey);
      }
    } catch {
      // Cache access can fail in restricted browser storage.
    }
    this.publish({ kind: 'downloading', label, received: 0, total: this.asset.bytes });
    const response = await fetch(path, { credentials: 'omit', cache: 'force-cache' });
    if (!response.ok || !response.body) throw new Error(`${label} is unavailable from this Wallet.`);
    const reader = response.body.getReader();
    const bytes = new Uint8Array(this.asset.bytes);
    let received = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (received + chunk.value.length > bytes.length) throw new Error(`${label} size is invalid.`);
        bytes.set(chunk.value, received);
        received += chunk.value.length;
        this.publish({ kind: 'downloading', label, received, total: bytes.length });
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (!(await this.valid(bytes.buffer))) throw new Error(`${label} integrity check failed.`);
    if (cache) {
      try {
        await cache.put(cacheKey, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }));
        return { bytes: bytes.buffer, storage: 'browser' };
      } catch {
        // Inference remains available for this session if storage is full.
      }
    }
    return { bytes: bytes.buffer, storage: 'session' };
  }

  private async load(): Promise<InferenceSession> {
    const ort = await import('onnxruntime-web/wasm');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = new URL('/sdk/', location.origin).href;
    const model = await this.bytes();
    this.publish({ kind: 'preparing', label: this.asset.label, storage: model.storage });
    const session = await ort.InferenceSession.create(model.bytes, { executionProviders: ['wasm'] });
    this.publish({ kind: 'ready', label: this.asset.label, storage: model.storage });
    return session;
  }
}

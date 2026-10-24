import type { InferenceSession } from 'onnxruntime-web';

const MODEL_PATH = '/sdk/voiceid/redimnet-b1.onnx';
const MODEL_HASH = 'e04dd7a6a1e23fc7b89e47682ea9d0a3946cf7bc59d07922c3db3efc52ae4269';
const MODEL_BYTES = 8_859_593;
const CACHE_NAME = 'seams-voiceid-models-v1';
export const VOICE_MODEL_ID = `redimnet-b1:${MODEL_HASH}`;
// Prototype threshold: next tenth above the 4s calibration maximum impostor score (0.4417).
export const VOICE_MATCH_THRESHOLD = 0.5;
export type VoiceModelProgress =
  | { kind: 'checking_cache' }
  | { kind: 'downloading'; received: number; total: number }
  | { kind: 'preparing'; storage: 'browser' | 'session' }
  | { kind: 'ready'; storage: 'browser' | 'session' };
let session: Promise<InferenceSession> | null = null;
let progress: VoiceModelProgress = { kind: 'checking_cache' };
const listeners = new Set<(progress: VoiceModelProgress) => void>();

function publish(next: VoiceModelProgress): void {
  progress = next;
  for (const listener of listeners) listener(next);
}

async function validModel(bytes: ArrayBuffer): Promise<boolean> {
  if (bytes.byteLength !== MODEL_BYTES) return false;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex === MODEL_HASH;
}

async function openModelCache(): Promise<Cache | null> {
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

async function modelBytes(): Promise<{ bytes: ArrayBuffer; storage: 'browser' | 'session' }> {
  publish({ kind: 'checking_cache' });
  const cache = await openModelCache();
  const cacheKey = new URL(`${MODEL_PATH}?sha256=${MODEL_HASH}`, location.origin).href;
  try {
    const cached = await cache?.match(cacheKey);
    if (cached) {
      const bytes = await cached.arrayBuffer();
      if (await validModel(bytes)) return { bytes, storage: 'browser' };
      await cache?.delete(cacheKey);
    }
  } catch {
    // Cache access can be unavailable in restricted browser storage.
  }
  publish({ kind: 'downloading', received: 0, total: MODEL_BYTES });
  const response = await fetch(MODEL_PATH, { credentials: 'omit', cache: 'force-cache' });
  if (!response.ok || !response.body) throw new Error('VoiceID model is unavailable from this Wallet.');
  const reader = response.body.getReader();
  const bytes = new Uint8Array(MODEL_BYTES);
  let received = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (received + chunk.value.length > MODEL_BYTES) throw new Error('VoiceID model size is invalid.');
      bytes.set(chunk.value, received);
      received += chunk.value.length;
      publish({ kind: 'downloading', received, total: MODEL_BYTES });
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  if (!(await validModel(bytes.buffer))) throw new Error('VoiceID model integrity check failed.');
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

async function loadModel(): Promise<InferenceSession> {
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = new URL('/sdk/', location.origin).href;
  const model = await modelBytes();
  publish({ kind: 'preparing', storage: model.storage });
  const loaded = await ort.InferenceSession.create(model.bytes, { executionProviders: ['wasm'] });
  publish({ kind: 'ready', storage: model.storage });
  return loaded;
}

export async function prepareVoiceModel(onProgress?: (progress: VoiceModelProgress) => void): Promise<InferenceSession> {
  if (onProgress) {
    listeners.add(onProgress);
    onProgress(progress);
  }
  try {
    if (!session) session = loadModel().catch(modelLoadFailed);
    return await session;
  } finally {
    if (onProgress) listeners.delete(onProgress);
  }
}

function modelLoadFailed(error: unknown): never {
  session = null;
  throw error;
}

export async function voiceEmbedding(samples: Float32Array): Promise<number[]> {
  const model = await prepareVoiceModel();
  const ort = await import('onnxruntime-web/wasm');
  const tensor = new ort.Tensor('float32', samples, [1, samples.length]);
  try {
    const output = await model.run({ samples: tensor });
    try {
      const embedding = output.embedding;
      if (!embedding || !(embedding.data instanceof Float32Array)) {
        throw new Error('VoiceID model returned an invalid embedding.');
      }
      return normalizeVoiceVector(Array.from(embedding.data));
    } finally {
      for (const outputTensor of Object.values(output)) outputTensor.dispose();
    }
  } finally {
    tensor.dispose();
  }
}

export function normalizeVoiceVector(values: readonly number[]): number[] {
  if (values.length !== 192) throw new Error('VoiceID template dimensions are invalid.');
  let squared = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) throw new Error('VoiceID template is invalid.');
    squared += value * value;
  }
  if (squared < 1e-12) throw new Error('VoiceID template contains no signal.');
  const norm = Math.sqrt(squared);
  const normalized: number[] = [];
  for (const value of values) normalized.push(value / norm);
  return normalized;
}

export function voiceSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== 192 || right.length !== 192)
    throw new Error('VoiceID templates are incompatible.');
  let score = 0;
  for (let index = 0; index < left.length; index += 1) score += left[index] * right[index];
  return score;
}

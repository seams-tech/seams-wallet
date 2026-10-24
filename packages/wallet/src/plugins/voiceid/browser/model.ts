import type { InferenceSession } from 'onnxruntime-web';

const MODEL_PATH = '/sdk/voiceid/ecapa.onnx';
const MODEL_HASH = '0d56d37287767d3c43a4f2ffc7ed12452bdd73d67c40428acd78279ecff8d5c3';
export const VOICE_MODEL_ID = `ecapa:${MODEL_HASH}`;
export const VOICE_MATCH_THRESHOLD = 0.6;
let session: Promise<InferenceSession> | null = null;

async function loadModel(): Promise<InferenceSession> {
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = new URL('/sdk/', location.origin).href;
  const response = await fetch(MODEL_PATH, { credentials: 'omit', cache: 'force-cache' });
  if (!response.ok) throw new Error('VoiceID model is unavailable from this Wallet.');
  const bytes = await response.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  if (hex !== MODEL_HASH) throw new Error('VoiceID model integrity check failed.');
  return await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
}

export async function prepareVoiceModel(): Promise<InferenceSession> {
  if (!session) session = loadModel().catch(modelLoadFailed);
  return await session;
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

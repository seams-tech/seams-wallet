import { BrowserInferenceModel } from './inference';

const MODEL_HASH = 'e04dd7a6a1e23fc7b89e47682ea9d0a3946cf7bc59d07922c3db3efc52ae4269';
export const VOICE_MODEL_ID = `redimnet-b1:${MODEL_HASH}`;
// Prototype threshold: next tenth above the 4s calibration maximum impostor score (0.4417).
export const VOICE_MATCH_THRESHOLD = 0.5;
export const voiceModel = new BrowserInferenceModel({
  path: '/sdk/voiceid/redimnet-b1.onnx', sha256: MODEL_HASH,
  bytes: 8_859_593, label: 'Speaker verification',
});

export async function voiceEmbedding(samples: Float32Array): Promise<number[]> {
  const model = await voiceModel.prepare();
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

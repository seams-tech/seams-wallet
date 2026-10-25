import { BrowserInferenceModel, type VoiceModelProgress } from './inference';
import { SPOKEN_PHRASES, PHRASE_TOKENS } from './phraseVocabulary';

export type SpokenPhrase = (typeof SPOKEN_PHRASES)[number];
const model = new BrowserInferenceModel({
  path: '/sdk/voiceid/aurora-int8.onnx',
  sha256: '83ed6f3856458cd96d49a70d8c5175aeec18ba8c184e5367e089cd424eebefd6',
  bytes: 1_342_384,
  label: 'Phrase recognition',
});
// Prototype development cutoff; see the synthetic phrase screening evidence.
const MAX_GREEDY_LOG_GAP = 5;
const TOKEN_COUNT = 257;
let lastIssuedPhrase: SpokenPhrase | null = null;

export function newSpokenPhrase(previous: SpokenPhrase | null): SpokenPhrase {
  const random = new Uint32Array(1);
  let phrase: SpokenPhrase;
  do {
    crypto.getRandomValues(random);
    phrase = SPOKEN_PHRASES[random[0] % SPOKEN_PHRASES.length];
  } while (phrase === previous || phrase === lastIssuedPhrase);
  lastIssuedPhrase = phrase;
  return phrase;
}

export async function preparePhraseModel(onProgress?: (progress: VoiceModelProgress) => void) {
  return await model.prepare(onProgress);
}

function logAdd(left: number, right: number): number {
  if (left === -Infinity) {
    return right;
  }
  if (right === -Infinity) {
    return left;
  }
  const maximum = Math.max(left, right);
  return maximum + Math.log(Math.exp(left - maximum) + Math.exp(right - maximum));
}

function ctcScore(probabilities: Float64Array, frames: number, tokens: readonly number[]): number {
  const states = new Int32Array(tokens.length * 2 + 1);
  for (let index = 0; index < tokens.length; index += 1) {
    states[index * 2 + 1] = tokens[index];
  }
  let previous = new Float64Array(states.length).fill(-Infinity);
  previous[0] = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const next = new Float64Array(states.length).fill(-Infinity);
    for (let state = 0; state < states.length; state += 1) {
      let total = previous[state];
      if (state > 0) {
        total = logAdd(total, previous[state - 1]);
      }
      if (state > 1 && states[state] !== 0 && states[state] !== states[state - 2]) {
        total = logAdd(total, previous[state - 2]);
      }
      next[state] = total + probabilities[frame * TOKEN_COUNT + states[state]];
    }
    previous = next;
  }
  return states.length === 1 ? previous[0] : logAdd(previous[states.length - 1], previous[states.length - 2]);
}

type PhraseRecognition =
  | { kind: 'recognized'; phrase: SpokenPhrase; gap: number }
  | { kind: 'uncertain'; candidate: SpokenPhrase; gap: number }
  | { kind: 'empty' };

export type PhraseCheck =
  | { kind: 'matched'; recognition: PhraseRecognition }
  | { kind: 'mismatch'; recognition: PhraseRecognition; message: string };

function recognize(logits: Float32Array, frames: number): PhraseRecognition {
  const probabilities = new Float64Array(logits.length);
  const greedy: number[] = [];
  let previousToken = -1;
  for (let frame = 0; frame < frames; frame += 1) {
    const offset = frame * TOKEN_COUNT;
    let maximum = -Infinity;
    let bestToken = 0;
    for (let token = 0; token < TOKEN_COUNT; token += 1) {
      const value = logits[offset + token];
      if (!Number.isFinite(value)) {
        throw new Error('Phrase model returned invalid scores.');
      }
      if (value > maximum) {
        maximum = value;
        bestToken = token;
      }
    }
    let sum = 0;
    for (let token = 0; token < TOKEN_COUNT; token += 1) {
      sum += Math.exp(logits[offset + token] - maximum);
    }
    const normalizer = maximum + Math.log(sum);
    for (let token = 0; token < TOKEN_COUNT; token += 1) {
      probabilities[offset + token] = logits[offset + token] - normalizer;
    }
    if (bestToken !== 0 && bestToken !== previousToken) {
      greedy.push(bestToken);
    }
    previousToken = bestToken;
  }
  if (greedy.length === 0) {
    return { kind: 'empty' };
  }
  let bestScore = -Infinity;
  let bestIndex = 0;
  for (let index = 0; index < PHRASE_TOKENS.length; index += 1) {
    const score = ctcScore(probabilities, frames, PHRASE_TOKENS[index]);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  const greedyScore = ctcScore(probabilities, frames, greedy);
  const gap = greedyScore - bestScore;
  return gap <= MAX_GREEDY_LOG_GAP
    ? { kind: 'recognized', phrase: SPOKEN_PHRASES[bestIndex], gap }
    : { kind: 'uncertain', candidate: SPOKEN_PHRASES[bestIndex], gap };
}

export async function checkSpokenPhrase(
  samples: Float32Array,
  expected: SpokenPhrase,
): Promise<PhraseCheck> {
  const session = await preparePhraseModel();
  const ort = await import('onnxruntime-web/wasm');
  const input = new ort.Tensor('float32', samples, [1, samples.length]);
  try {
    const outputs = await session.run({ samples: input });
    try {
      const logits = outputs.logits;
      if (
        !logits ||
        !(logits.data instanceof Float32Array) ||
        logits.dims.length !== 3 ||
        logits.dims[0] !== 1 ||
        logits.dims[2] !== TOKEN_COUNT ||
        logits.data.length !== logits.dims[1] * TOKEN_COUNT
      ) {
        throw new Error('Phrase model returned an invalid result.');
      }
      const recognition = recognize(logits.data, logits.dims[1]);
      if (recognition.kind === 'recognized' && recognition.phrase === expected)
        return { kind: 'matched', recognition };
      return { kind: 'mismatch', recognition, message: phraseFailureMessage(recognition) };
    } finally {
      for (const output of Object.values(outputs)) {
        output.dispose();
      }
    }
  } finally {
    input.dispose();
  }
}

function phraseFailureMessage(result: PhraseRecognition): string {
  switch (result.kind) {
    case 'recognized':
      return `Phrase recognition chose “${result.phrase}”. Please read the displayed phrase naturally.`;
    case 'uncertain':
      return `Phrase recognition was uncertain. Closest phrase: “${result.candidate}”. Score gap ${result.gap.toFixed(1)}; limit ${MAX_GREEDY_LOG_GAP}.`;
    case 'empty':
      return 'Phrase recognition detected no words. Please try again in your normal voice.';
    default:
      return assertNever(result);
  }
}
function assertNever(value: never): never {
  throw new Error(`Unexpected phrase result: ${String(value)}`);
}

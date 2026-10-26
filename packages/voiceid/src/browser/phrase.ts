import { BrowserInferenceModel } from './inference';
import { SPOKEN_PHRASES, PHRASE_TOKEN_PIECES } from './phraseVocabulary';

export type SpokenPhrase = (typeof SPOKEN_PHRASES)[number];
export const phraseModel = new BrowserInferenceModel({
  path: '/sdk/voiceid/aurora-int8.onnx',
  sha256: '83ed6f3856458cd96d49a70d8c5175aeec18ba8c184e5367e089cd424eebefd6',
  bytes: 1_342_384,
  label: 'Phrase recognition',
});
// A development bound for an approximate spoken challenge, not transcription confidence.
const MAX_TEXT_DIFFERENCE = 0.3;
const MIN_CANDIDATE_MARGIN = 0.1;
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

type PhraseRecognition =
  | {
      kind: 'recognized';
      phrase: SpokenPhrase;
      difference: number;
      margin: number;
      decodedText: string;
    }
  | {
      kind: 'uncertain';
      candidate: SpokenPhrase;
      difference: number;
      margin: number;
      decodedText: string;
      reason: 'different' | 'ambiguous' | 'negated';
    }
  | { kind: 'empty' };

const HOMOPHONES = new Map([
  ['sea', 'see'],
  ['here', 'hear'],
  ['meat', 'meet'],
  ['whether', 'weather'],
  ['son', 'sun'],
  ['wood', 'would'],
  ['two', 'to'],
  ['too', 'to'],
  ['eye', 'i'],
]);

const NEGATIONS = new Set([
  'no',
  'not',
  'never',
  'cannot',
  "can't",
  "don't",
  "doesn't",
  "isn't",
  "aren't",
  "wasn't",
  "weren't",
  "won't",
  "wouldn't",
  "shouldn't",
  'without',
]);

function words(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/’/g, "'")
      .match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? []
  );
}
function keepWord(word: string): boolean {
  return word !== 'a' && word !== 'an' && word !== 'the';
}
function canonicalWord(word: string): string {
  return HOMOPHONES.get(word) ?? word;
}
function canonicalText(tokens: readonly string[]): string {
  return tokens.filter(keepWord).map(canonicalWord).join(' ');
}
function isNegation(word: string): boolean {
  return NEGATIONS.has(word);
}
function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, initialDistance);
  for (let row = 0; row < left.length; row += 1) {
    const next = [row + 1];
    for (let column = 0; column < right.length; column += 1) {
      next.push(
        Math.min(
          next[column] + 1,
          previous[column + 1] + 1,
          previous[column] + (left[row] === right[column] ? 0 : 1),
        ),
      );
    }
    previous = next;
  }
  return previous[right.length];
}
function initialDistance(_value: unknown, index: number): number {
  return index;
}
function matchDecodedPhrase(decodedText: string): PhraseRecognition {
  const tokens = words(decodedText);
  const text = canonicalText(tokens);
  if (!text) return { kind: 'empty' };
  let best: SpokenPhrase = SPOKEN_PHRASES[0];
  let difference = Infinity;
  let runnerUp = Infinity;
  for (const phrase of SPOKEN_PHRASES) {
    const target = canonicalText(words(phrase));
    const score = editDistance(text, target) / Math.max(text.length, target.length);
    if (score < difference) {
      runnerUp = difference;
      difference = score;
      best = phrase;
    } else {
      runnerUp = Math.min(runnerUp, score);
    }
  }
  const margin = runnerUp - difference;
  const spokenNegation = tokens.filter(isNegation).join(' ');
  const challengeNegation = words(best).filter(isNegation).join(' ');
  if (spokenNegation !== challengeNegation) {
    return {
      kind: 'uncertain',
      candidate: best,
      difference,
      margin,
      decodedText,
      reason: 'negated',
    };
  }
  const expectedWords = words(best).length;
  if (difference > MAX_TEXT_DIFFERENCE || Math.abs(tokens.length - expectedWords) > 2) {
    return {
      kind: 'uncertain',
      candidate: best,
      difference,
      margin,
      decodedText,
      reason: 'different',
    };
  }
  if (margin < MIN_CANDIDATE_MARGIN) {
    return {
      kind: 'uncertain',
      candidate: best,
      difference,
      margin,
      decodedText,
      reason: 'ambiguous',
    };
  }
  return { kind: 'recognized', phrase: best, difference, margin, decodedText };
}

/** A local phrase rejection can retry while the original server challenge is valid. */
export class VoicePhraseMismatchError extends Error {
  constructor() {
    super('The phrase was not clear. Try the new phrase at your normal pace.');
    this.name = 'VoicePhraseMismatchError';
  }
}

export type PhraseCheck =
  | { kind: 'matched'; recognition: PhraseRecognition }
  | { kind: 'mismatch'; recognition: PhraseRecognition };

function recognize(logits: Float32Array, frames: number): PhraseRecognition {
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
    if (bestToken !== 0 && bestToken !== previousToken) {
      greedy.push(bestToken);
    }
    previousToken = bestToken;
  }
  if (greedy.length === 0) {
    return { kind: 'empty' };
  }
  const decodedText = greedy
    .map(tokenPiece)
    .join('')
    .replace(/▁/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return matchDecodedPhrase(decodedText);
}

function tokenPiece(token: number): string {
  return PHRASE_TOKEN_PIECES[token];
}

export async function checkSpokenPhrase(
  samples: Float32Array,
  expected: SpokenPhrase,
): Promise<PhraseCheck> {
  const session = await phraseModel.prepare();
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
      return { kind: 'mismatch', recognition };
    } finally {
      for (const output of Object.values(outputs)) {
        output.dispose();
      }
    }
  } finally {
    input.dispose();
  }
}

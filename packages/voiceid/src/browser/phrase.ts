import { BrowserInferenceModel } from './inference';
import {
  CHALLENGE_PHRASES,
  CONFIRMATION_PHRASES,
  SPOKEN_PHRASES,
  PHRASE_TOKEN_PIECES,
} from './phraseVocabulary';
import type { VoiceConfirmation } from './confirmationCommand';
import type { VoiceIdTranscriptionModel } from '@seams/wallet/voiceid-host';
import { PHRASE_TOKEN_PIECES as CITRINET_TOKEN_PIECES } from './phraseTokens';

export type SpokenPhrase = (typeof SPOKEN_PHRASES)[number];
const auroraModel = new BrowserInferenceModel({
  path: '/sdk/voiceid/aurora-int8.onnx',
  sha256: '83ed6f3856458cd96d49a70d8c5175aeec18ba8c184e5367e089cd424eebefd6',
  bytes: 1_342_384,
  label: 'Phrase recognition',
});
const citrinetModel = new BrowserInferenceModel({
  path: '/sdk/voiceid/citrinet-int8.onnx',
  sha256: '875f58df0e2a593017ac9550c8fab68c4343cd1fbb2a042290450aa125441ed5',
  bytes: 10_483_704,
  label: 'Phrase recognition',
});

export function getPhraseModel(model: VoiceIdTranscriptionModel): BrowserInferenceModel {
  switch (model) {
    case 'aurora':
      return auroraModel;
    case 'citrinet':
      return citrinetModel;
    default:
      return assertNever(model);
  }
}
// A development bound for an approximate spoken challenge, not transcription confidence.
const MAX_TEXT_DIFFERENCE = 0.3;
const MIN_CANDIDATE_MARGIN = 0.1;
const TOKEN_COUNT = 257;
let lastIssuedPhrase: SpokenPhrase | null = null;

export function newSpokenPhrase(previous: SpokenPhrase | null): SpokenPhrase {
  return choosePhrase(CHALLENGE_PHRASES, previous);
}

export function newConfirmationPhrase(
  confirmation: VoiceConfirmation,
  previous: SpokenPhrase | null,
): SpokenPhrase {
  switch (confirmation.kind) {
    case 'random':
      return newSpokenPhrase(previous);
    case 'action':
      return choosePhrase(CONFIRMATION_PHRASES[confirmation.action], previous);
    default:
      return assertNever(confirmation);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected VoiceID state: ${String(value)}`);
}

function choosePhrase(
  phrases: readonly [SpokenPhrase, SpokenPhrase, ...SpokenPhrase[]],
  previous: SpokenPhrase | null,
): SpokenPhrase {
  const available = phrases.filter(isNewPhrase.bind(null, previous));
  const preferred = available.filter(isNewPhrase.bind(null, lastIssuedPhrase));
  const candidates = preferred.length > 0 ? preferred : available;
  if (candidates.length === 0) throw new Error('No fresh VoiceID challenge is available.');
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  const phrase = candidates[random[0] % candidates.length];
  lastIssuedPhrase = phrase;
  return phrase;
}

function isNewPhrase(previous: SpokenPhrase | null, phrase: SpokenPhrase): boolean {
  return phrase !== previous;
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
  ['sail', 'sale'],
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
  return tokens
    .filter(keepWord)
    .map(canonicalWord)
    .join(' ')
    .replace(/\bto day\b/g, 'today');
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

function recognize(logits: Float32Array, frames: number, model: VoiceIdTranscriptionModel): string {
  const blank = model === 'aurora' ? 0 : TOKEN_COUNT - 1;
  const greedy: number[] = [];
  let previousToken = -1;
  for (let frame = 0; frame < frames; frame += 1) {
    const offset = frame * TOKEN_COUNT;
    let maximum = -Infinity;
    let bestToken = blank;
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
    if (bestToken !== blank && bestToken !== previousToken) {
      greedy.push(bestToken);
    }
    previousToken = bestToken;
  }
  if (greedy.length === 0) {
    return '';
  }
  switch (model) {
    case 'aurora':
      return greedy.map(tokenPiece).join('').replace(/▁/g, ' ').trim().replace(/\s+/g, ' ');
    case 'citrinet':
      return decodeWordPieces(greedy);
    default:
      return assertNever(model);
  }
}

function decodeWordPieces(tokens: readonly number[]): string {
  let text = '';
  let joinNext = false;
  for (const token of tokens) {
    const piece = CITRINET_TOKEN_PIECES[token];
    if (piece.startsWith('[')) continue;
    if (piece.startsWith('##')) text += piece.slice(2);
    else if (piece === "'") {
      text += piece;
      joinNext = true;
      continue;
    } else text += (joinNext || text.length === 0 ? '' : ' ') + piece;
    joinNext = false;
  }
  return text.trim();
}

/** Apply the same phrase checks to an independently decoded transcript. */
export function checkTranscribedPhrase(decodedText: string, expected: SpokenPhrase): PhraseCheck {
  const recognition = matchDecodedPhrase(decodedText);
  if (recognition.kind === 'recognized' && recognition.phrase === expected)
    return { kind: 'matched', recognition };
  return { kind: 'mismatch', recognition };
}

function tokenPiece(token: number): string {
  return PHRASE_TOKEN_PIECES[token];
}

export async function checkSpokenPhrase(
  samples: Float32Array,
  expected: SpokenPhrase,
  model: VoiceIdTranscriptionModel,
): Promise<PhraseCheck> {
  const session = await getPhraseModel(model).prepare();
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
      return checkTranscribedPhrase(recognize(logits.data, logits.dims[1], model), expected);
    } finally {
      for (const output of Object.values(outputs)) {
        output.dispose();
      }
    }
  } finally {
    input.dispose();
  }
}

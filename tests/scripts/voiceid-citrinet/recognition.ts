import { BrowserInferenceModel } from '../../../packages/voiceid/src/browser/inference';
import {
  checkSpokenPhrase,
  checkTranscribedPhrase,
  phraseModel,
  type PhraseCheck,
  type SpokenPhrase,
} from '../../../packages/voiceid/src/browser/phrase';
import { SPOKEN_PHRASES } from '../../../packages/voiceid/src/browser/phraseVocabulary';

const citrinetModel = new BrowserInferenceModel({
  path: '/citrinet/citrinet-int8.onnx',
  sha256: '875f58df0e2a593017ac9550c8fab68c4343cd1fbb2a042290450aa125441ed5',
  bytes: 10_483_704,
  label: 'Citrinet INT8',
});

export type ModelResult =
  | Readonly<{
      kind: 'processed';
      milliseconds: number;
      check: PhraseCheck;
      acceptedChallenges: readonly SpokenPhrase[];
    }>
  | Readonly<{
      kind: 'failed';
      milliseconds: number;
      check?: never;
      acceptedChallenges?: never;
    }>;
export type Comparison = Readonly<{
  durationMs: number;
  first: 'aurora' | 'citrinet';
  aurora: ModelResult;
  citrinet: ModelResult;
}>;

export async function prepareComparison(): Promise<readonly string[]> {
  await phraseModel.prepare();
  await citrinetModel.prepare();
  const response = await fetch('/citrinet/vocabulary.json');
  const raw: unknown = await response.json();
  if (!Array.isArray(raw) || raw.length !== 256) throw new Error('Invalid Citrinet vocabulary');
  const vocabulary: string[] = [];
  for (const piece of raw) {
    if (typeof piece !== 'string' || piece.length === 0) throw new Error('Invalid Citrinet token');
    vocabulary.push(piece);
  }
  return vocabulary;
}

function decode(logits: Float32Array, frames: number, vocabulary: readonly string[]): string {
  const tokens: string[] = [];
  let previous = -1;
  for (let frame = 0; frame < frames; frame += 1) {
    let maximum = -Infinity;
    let selected = 256;
    for (let token = 0; token < 257; token += 1) {
      const score = logits[frame * 257 + token];
      if (!Number.isFinite(score)) throw new Error('Citrinet returned an invalid score');
      if (score > maximum) {
        maximum = score;
        selected = token;
      }
    }
    if (selected !== previous && selected !== 256 && !vocabulary[selected].startsWith('[')) {
      tokens.push(vocabulary[selected]);
    }
    previous = selected;
  }
  let text = '';
  let joinNext = false;
  for (const token of tokens) {
    if (token.startsWith('##')) text += token.slice(2);
    else if (token === "'") {
      text += token;
      joinNext = true;
      continue;
    } else text += (joinNext || text.length === 0 ? '' : ' ') + token;
    joinNext = false;
  }
  return text.trim();
}

async function checkCitrinet(
  samples: Float32Array,
  expected: SpokenPhrase,
  vocabulary: readonly string[],
): Promise<PhraseCheck> {
  const session = await citrinetModel.prepare();
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
        logits.dims[2] !== 257 ||
        logits.data.length !== logits.dims[1] * 257
      ) {
        throw new Error('Citrinet returned an invalid result');
      }
      return checkTranscribedPhrase(decode(logits.data, logits.dims[1], vocabulary), expected);
    } finally {
      for (const output of Object.values(outputs)) output.dispose();
    }
  } finally {
    input.dispose();
  }
}

function result(check: PhraseCheck, milliseconds: number): ModelResult {
  const acceptedChallenges: SpokenPhrase[] = [];
  if (check.recognition.kind !== 'empty') {
    for (const challenge of SPOKEN_PHRASES) {
      if (checkTranscribedPhrase(check.recognition.decodedText, challenge).kind === 'matched') {
        acceptedChallenges.push(challenge);
      }
    }
  }
  return { kind: 'processed', check, milliseconds, acceptedChallenges };
}

async function measureRecognition(recognize: () => Promise<PhraseCheck>): Promise<ModelResult> {
  const started = performance.now();
  try {
    const check = await recognize();
    return result(check, performance.now() - started);
  } catch {
    return { kind: 'failed', milliseconds: performance.now() - started };
  }
}

/** Both recognizers receive this exact buffer. The caller must erase it afterward. */
export async function compareRecording(
  samples: Float32Array,
  expected: SpokenPhrase,
  vocabulary: readonly string[],
  first: Comparison['first'],
): Promise<Comparison> {
  let aurora: ModelResult;
  let citrinet: ModelResult;
  if (first === 'aurora') {
    aurora = await measureRecognition(checkSpokenPhrase.bind(null, samples, expected));
    citrinet = await measureRecognition(checkCitrinet.bind(null, samples, expected, vocabulary));
  } else {
    citrinet = await measureRecognition(checkCitrinet.bind(null, samples, expected, vocabulary));
    aurora = await measureRecognition(checkSpokenPhrase.bind(null, samples, expected));
  }
  return { durationMs: samples.length / 16, first, aurora, citrinet };
}

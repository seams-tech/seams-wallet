import {
  checkSpokenPhrase,
  checkTranscribedPhrase,
  getPhraseModel,
  type PhraseCheck,
  type SpokenPhrase,
} from '../../../packages/voiceid/src/browser/phrase';
import { SPOKEN_PHRASES } from '../../../packages/voiceid/src/browser/phraseVocabulary';

export type ModelResult =
  | Readonly<{
      kind: 'processed';
      milliseconds: number;
      check: PhraseCheck;
      acceptedChallenges: readonly SpokenPhrase[];
    }>
  | Readonly<{ kind: 'failed'; milliseconds: number; check?: never; acceptedChallenges?: never }>;
export type Comparison = Readonly<{
  durationMs: number;
  first: 'aurora' | 'citrinet';
  aurora: ModelResult;
  citrinet: ModelResult;
}>;

export async function prepareComparison(): Promise<void> {
  await getPhraseModel('aurora').prepare();
  await getPhraseModel('citrinet').prepare();
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

/** Both recognizers receive this exact buffer. The caller erases it afterward. */
export async function compareRecording(
  samples: Float32Array,
  expected: SpokenPhrase,
  first: Comparison['first'],
): Promise<Comparison> {
  let aurora: ModelResult;
  let citrinet: ModelResult;
  if (first === 'aurora') {
    aurora = await measureRecognition(checkSpokenPhrase.bind(null, samples, expected, 'aurora'));
    citrinet = await measureRecognition(
      checkSpokenPhrase.bind(null, samples, expected, 'citrinet'),
    );
  } else {
    citrinet = await measureRecognition(
      checkSpokenPhrase.bind(null, samples, expected, 'citrinet'),
    );
    aurora = await measureRecognition(checkSpokenPhrase.bind(null, samples, expected, 'aurora'));
  }
  return { durationMs: samples.length / 16, first, aurora, citrinet };
}

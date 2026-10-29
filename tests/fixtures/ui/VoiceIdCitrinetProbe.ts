import {
  compareRecording,
  prepareComparison,
  type Comparison,
} from '../../../tests/scripts/voiceid-citrinet/recognition';
import { SPOKEN_PHRASES } from '@voiceid/browser/phraseVocabulary';

let vocabulary: readonly string[] | null = null;

async function prepare(): Promise<number> {
  const started = performance.now();
  vocabulary = await prepareComparison();
  return performance.now() - started;
}

async function compare(
  base64: string,
  expectedIndex: number,
  first: Comparison['first'],
): Promise<Comparison> {
  const phrase = SPOKEN_PHRASES[expectedIndex];
  if (!phrase || !vocabulary) throw new Error('Prepare comparison and choose a known phrase');
  const bytes = Uint8Array.from(atob(base64), characterCode);
  const context = new OfflineAudioContext(1, 1, 16000);
  const audio = await context.decodeAudioData(bytes.buffer);
  const samples = audio.getChannelData(0);
  try {
    return await compareRecording(samples, phrase, vocabulary, first);
  } finally {
    samples.fill(0);
  }
}

function characterCode(character: string): number {
  return character.charCodeAt(0);
}

declare global {
  interface Window {
    prepareCitrinetComparison: typeof prepare;
    compareCitrinetRecording: typeof compare;
  }
}
window.prepareCitrinetComparison = prepare;
window.compareCitrinetRecording = compare;

import { checkSpokenPhrase } from '@voiceid/browser/phrase';
import { SPOKEN_PHRASES } from '@voiceid/browser/phraseVocabulary';

async function checkAudio(base64: string, expectedIndex: number) {
  const phrase = SPOKEN_PHRASES[expectedIndex];
  if (!phrase) throw new Error('Unknown test phrase');
  const bytes = Uint8Array.from(atob(base64), characterCode);
  const context = new OfflineAudioContext(1, 1, 16000);
  const audio = await context.decodeAudioData(bytes.buffer);
  if (audio.sampleRate !== 16000) throw new Error('Expected 16 kHz test audio');
  const samples = audio.getChannelData(0);
  try {
    return await checkSpokenPhrase(samples, phrase);
  } finally {
    samples.fill(0);
  }
}
function characterCode(character: string): number {
  return character.charCodeAt(0);
}
declare global {
  interface Window {
    voicePhraseCheck: typeof checkAudio;
  }
}
window.voicePhraseCheck = checkAudio;

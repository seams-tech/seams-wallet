import { checkSpokenPhrase, newConfirmationPhrase } from '@voiceid/browser/phrase';
import { parseVoiceConfirmation } from '@voiceid/browser/confirmationCommand';
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
    return await checkSpokenPhrase(samples, phrase, 'aurora');
  } finally {
    samples.fill(0);
  }
}
function characterCode(character: string): number {
  return character.charCodeAt(0);
}

function confirmationChallenge(value: unknown, previousIndex: number | null) {
  const previous = previousIndex === null ? null : SPOKEN_PHRASES[previousIndex];
  if (previous === undefined) throw new Error('Unknown previous challenge');
  try {
    const purpose = parseVoiceConfirmation(value);
    const phrase = newConfirmationPhrase(purpose, previous);
    return { kind: 'challenge' as const, purpose, phrase, index: SPOKEN_PHRASES.indexOf(phrase) };
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error)) throw error;
    return { kind: 'invalid' as const, code: error.code };
  }
}
declare global {
  interface Window {
    voicePhraseCheck: typeof checkAudio;
    voiceConfirmationChallenge: typeof confirmationChallenge;
  }
}
window.voicePhraseCheck = checkAudio;
window.voiceConfirmationChallenge = confirmationChallenge;

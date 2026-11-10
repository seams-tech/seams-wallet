import { VoicePrompt } from '@seams/voice-capture/card';
import { configureVoiceIdCapture } from '@voiceid/capture/configure';
import { SPOKEN_PHRASES } from '@voiceid/browser/phraseVocabulary';

// The capture package reads the Wallet's settings, as in the Wallet host.
configureVoiceIdCapture();

type CornerControl = { label: string | null; path: string | null; left: number; right: number };
declare global {
  interface Window {
    voiceBackProbe: { corner: () => CornerControl; showBack: () => void };
  }
}

const prompt = new VoicePrompt(document, 'VoiceID', SPOKEN_PHRASES[0]);
document.body.append(prompt.element);

function corner(): CornerControl {
  const card = prompt.element.getBoundingClientRect();
  const control = prompt.cancel.getBoundingClientRect();
  return {
    label: prompt.cancel.getAttribute('aria-label'),
    path: prompt.cancel.querySelector('path')?.getAttribute('d') ?? null,
    left: control.left - card.left,
    right: card.right - control.right,
  };
}

window.voiceBackProbe = { corner, showBack: prompt.showBack.bind(prompt) };

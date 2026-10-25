import { VoicePrompt } from '@/plugins/voiceid/capture/prompt';
import { SPOKEN_PHRASES } from '@/plugins/voiceid/browser/phraseVocabulary';

const [initialPhrase, retryPhrase] = SPOKEN_PHRASES;

let prompt: VoicePrompt | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let tick = 0;
const violations: string[] = [];
document.addEventListener('securitypolicyviolation', recordViolation);
function recordViolation(event: SecurityPolicyViolationEvent): void {
  violations.push(event.violatedDirective);
}
function securityViolations(): readonly string[] { return violations; }

function mount(): void {
  dispose();
  document.documentElement.dataset.theme = 'dark';
  document.body.style.margin = '0';
  prompt = new VoicePrompt(document, 'VoiceID visual probe', initialPhrase);
  document.body.append(prompt.element);
  prompt.cancel.addEventListener('click', dispose);
  prompt.ready('Read naturally, then pause.');
}
function activity(): void {
  tick += 1;
  prompt?.capture({ kind: 'activity', rms: 0.08 + Math.sin(tick * 0.4) ** 2 * 0.1, speech: true });
}
function listen(): void {
  stopTimer();
  prompt?.capture({ kind: 'listening' });
  activity();
  timer = setInterval(activity, 32);
}
function stopTimer(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
}
function checking(): void {
  stopTimer();
  prompt?.capture({ kind: 'processing' });
}
function retry(): void {
  stopTimer();
  prompt?.setPhrase(retryPhrase);
  prompt?.ready('Try the new phrase at your normal pace.');
}
function dispose(): void {
  stopTimer();
  prompt?.dispose();
  prompt?.element.remove();
  prompt = null;
}
function light(): void {
  document.documentElement.dataset.theme = 'light';
}
window.voicePromptProbe = { mount, listen, checking, retry, light, securityViolations };
declare global {
  interface Window {
    voicePromptProbe: {
      mount(): void;
      listen(): void;
      checking(): void;
      retry(): void;
      light(): void;
      securityViolations(): readonly string[];
    };
  }
}

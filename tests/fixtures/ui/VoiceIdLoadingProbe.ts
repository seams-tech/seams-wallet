import { prepareVoiceModelWithProgress } from '@/plugins/voiceid/browser/progress';
import { VoicePrompt } from '@/plugins/voiceid/capture/prompt';
import { checkSpokenPhrase } from '@/plugins/voiceid/browser/phrase';
import { SPOKEN_PHRASES } from '@/plugins/voiceid/browser/phraseVocabulary';

type LoadingObservation = { state: string; value: number; total: number; text: string };
declare global {
  interface Window {
    voiceLoadingObservations: LoadingObservation[];
  }
}

window.voiceLoadingObservations = [];
const start = document.createElement('button');
start.textContent = 'Load VoiceID';
start.addEventListener('click', begin);
const parent = document.createElement('section');
parent.className = 'seams-wallet-ui seams-voiceid-activation-surface';
parent.dataset.theme = 'dark';
document.body.append(start, parent);
new MutationObserver(observe).observe(parent, { subtree: true, childList: true, attributes: true });

function observe(): void {
  const section = parent.querySelector<HTMLElement>('.seams-voiceid-model-download');
  const meter = section?.querySelector('progress');
  if (!section || !meter) return;
  window.voiceLoadingObservations.push({
    state: section.dataset.state ?? 'checking_cache',
    value: meter.hasAttribute('value') ? meter.value : -1,
    total: meter.max,
    text: section.textContent ?? '',
  });
}

async function begin(): Promise<void> {
  start.disabled = true;
  window.voiceLoadingObservations = [];
  const prompt = new VoicePrompt(document, 'VoiceID', SPOKEN_PHRASES[0]);
  prompt.title.textContent = 'VoiceID';
  prompt.status.textContent = '';
  prompt.record.hidden = true;
  parent.replaceChildren(prompt.element);
  document.body.dataset.result = 'loading';
  try {
    await prepareVoiceModelWithProgress(prompt.progress);
    const response = await fetch('/speech.wav');
    const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(
      await response.arrayBuffer(),
    );
    const result = await checkSpokenPhrase(audio.getChannelData(0), SPOKEN_PHRASES[0]);
    if (result.kind !== 'matched')
      throw new Error('Prepared phrase model did not match the recording');
    document.body.dataset.result = 'ready';
  } catch (error) {
    prompt.status.textContent = error instanceof Error ? error.message : String(error);
    document.body.dataset.result = 'failed';
  } finally {
    start.disabled = false;
  }
}

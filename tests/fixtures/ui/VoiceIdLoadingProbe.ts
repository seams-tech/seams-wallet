import { prepareVoiceModelWithProgress } from '@voiceid/browser/progress';
import { VoicePrompt } from '@voiceid/capture/prompt';
import { checkSpokenPhrase } from '@voiceid/browser/phrase';
import { SPOKEN_PHRASES } from '@voiceid/browser/phraseVocabulary';
import { voiceIdAuthMethod } from '../../../packages/voiceid/src/descriptor';
import { parseWalletAuthMethodPlugins } from '@/core/authMethods/plugins';

function configuredModel() {
  const requested = new URL(location.href).searchParams.get('transcriptionModel');
  if (requested !== null && requested !== 'aurora' && requested !== 'citrinet')
    throw new Error('Unknown transcription model');
  const plugin = voiceIdAuthMethod({ transcriptionModel: requested ?? 'citrinet' });
  return parseWalletAuthMethodPlugins([plugin])[0].transcriptionModel ?? 'citrinet';
}
const model = configuredModel();
document.body.dataset.transcriptionModel = model;

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
const cancel = document.createElement('button');
cancel.textContent = 'Cancel loading';
cancel.hidden = true;
cancel.addEventListener('click', cancelLoading);
let controller = new AbortController();
const parent = document.createElement('section');
parent.className = 'seams-wallet-ui seams-voiceid-activation-surface';
parent.dataset.theme = 'dark';
document.body.append(start, cancel, parent);
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
  controller = new AbortController();
  start.disabled = true;
  cancel.hidden = false;
  window.voiceLoadingObservations = [];
  const prompt = new VoicePrompt(document, 'VoiceID', SPOKEN_PHRASES[0]);
  prompt.title.textContent = 'VoiceID';
  prompt.status.textContent = '';
  prompt.record.hidden = true;
  parent.replaceChildren(prompt.element);
  document.body.dataset.result = 'loading';
  try {
    await prepareVoiceModelWithProgress(prompt.progress, controller.signal, model);
    const response = await fetch('/speech.wav');
    const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(
      await response.arrayBuffer(),
    );
    const result = await checkSpokenPhrase(audio.getChannelData(0), SPOKEN_PHRASES[0], model);
    if (result.kind !== 'matched')
      throw new Error('Prepared phrase model did not match the recording');
    document.body.dataset.result = 'ready';
  } catch (error) {
    prompt.status.textContent = error instanceof Error ? error.message : String(error);
    document.body.dataset.result = controller.signal.aborted ? 'cancelled' : 'failed';
  } finally {
    start.disabled = false;
    cancel.hidden = true;
  }
}

function cancelLoading(): void {
  controller.abort();
}

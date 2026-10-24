import {
  createCspStylesheetManager,
  getDefaultCspNonce,
} from '@/core/browser/walletIframe/csp-stylesheet';
import { WorkerDeferred } from '@/core/signingEngine/workerManager/workerDeferred';
import { VOICE_SAMPLE_PHRASE } from '../browser/microphone';
import { toError } from '@shared/utils/errors';

const SURFACE_CSS = `
.seams-voiceid-activation-surface {
  box-sizing: border-box;
  width: min(100%, 28rem);
  margin: 0 auto;
  padding: 1.5rem;
  border-radius: 1.25rem;
  background: var(--seams-colors-colorBackground, #18191f);
  color: var(--seams-colors-textPrimary, #fff);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.seams-voiceid-activation-surface h2 { margin: 0 0 .75rem; font-size: 1.35rem; }
.seams-voiceid-activation-surface p { margin: 0 0 1.25rem; line-height: 1.5; }
.seams-voiceid-activation-surface .seams-voiceid-actions { display: flex; gap: .75rem; flex-wrap: wrap; }
.seams-voiceid-activation-surface button {
  padding: .7rem 1rem;
  border-radius: .65rem;
  border: 1px solid currentColor;
  font: inherit;
  cursor: pointer;
}
.seams-voiceid-activation-surface button:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.seams-voiceid-activation-surface button:disabled { cursor: wait; opacity: .6; }
.seams-voiceid-activation-surface .seams-voiceid-primary {
  background: var(--seams-colors-textPrimary, #fff);
  color: var(--seams-colors-colorBackground, #18191f);
}
`;

type CaptureAction<T> = (signal: AbortSignal, onListening: () => void) => Promise<T>;
export type PreparedVoiceCapture<T> = Readonly<{
  action: CaptureAction<T>;
  expiresAtMs: number | null;
}>;
type CapturePreparation<T> = (
  signal: AbortSignal,
  parent: HTMLElement,
) => Promise<PreparedVoiceCapture<T>>;
type CaptureState<T> =
  | { kind: 'preparing' }
  | { kind: 'ready'; capture: PreparedVoiceCapture<T> }
  | { kind: 'capturing' }
  | { kind: 'closed' };
const documentStyles = new WeakMap<Document, ReturnType<typeof createCspStylesheetManager>>();

function ensureVoiceIdStyles(document: Document): void {
  let styles = documentStyles.get(document);
  if (!styles) {
    styles = createCspStylesheetManager({
      doc: document,
      baseCss: SURFACE_CSS,
      nonce: getDefaultCspNonce,
    });
    documentStyles.set(document, styles);
  }
  styles.ensureBase();
}

class VoiceIdCaptureSurface<T> {
  readonly result: Promise<T>;
  private readonly completion = new WorkerDeferred<T>();
  private readonly controller = new AbortController();
  private readonly element: HTMLElement;
  private readonly activateButton: HTMLButtonElement;
  private readonly cancelButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  private state: CaptureState<T> = { kind: 'preparing' };
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    prepare: CapturePreparation<T>,
    purpose: 'activation' | 'unlock',
  ) {
    const actionLabel = purpose === 'activation' ? 'Activate VoiceID' : 'Unlock with VoiceID';
    const parent = document.getElementById('root') ?? document.body;
    if (!parent) throw new Error('Wallet activation surface has no mount root.');
    ensureVoiceIdStyles(document);
    this.element = document.createElement('section');
    this.element.className = 'seams-wallet-ui seams-auth-method-activation-surface seams-voiceid-activation-surface';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-modal', 'true');
    this.element.setAttribute('aria-label', actionLabel);
    const title = document.createElement('h2');
    title.textContent = actionLabel;
    this.element.appendChild(title);
    const description = document.createElement('p');
    description.textContent = purpose === 'unlock'
      ? `Select Unlock with VoiceID. When Listening appears, slowly say: “${VOICE_SAMPLE_PHRASE}” Audio stays on this device.`
      : 'Select Activate VoiceID to enroll or verify your voice. Audio stays on this device.';
    this.element.appendChild(description);
    this.status = document.createElement('p');
    this.status.textContent = 'Preparing VoiceID…';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.element.appendChild(this.status);
    const actions = document.createElement('div');
    actions.className = 'seams-voiceid-actions';
    this.activateButton = document.createElement('button');
    this.activateButton.type = 'button';
    this.activateButton.disabled = true;
    this.activateButton.className = 'seams-voiceid-primary';
    this.activateButton.textContent = actionLabel;
    this.activateButton.addEventListener('click', this.begin);
    actions.appendChild(this.activateButton);
    this.cancelButton = document.createElement('button');
    this.cancelButton.type = 'button';
    this.cancelButton.textContent = 'Cancel';
    this.cancelButton.addEventListener('click', this.cancel);
    actions.appendChild(this.cancelButton);
    this.element.appendChild(actions);
    this.element.addEventListener('cancel', this.cancel);
    parent.appendChild(this.element);
    this.cancelButton.focus();
    this.result = this.completion.promise;
    void this.initialize(prepare);
  }

  dispose(): void {
    if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
    this.element.removeEventListener('cancel', this.cancel);
    this.activateButton.removeEventListener('click', this.begin);
    this.cancelButton.removeEventListener('click', this.cancel);
    this.element.remove();
  }

  private async initialize(prepare: CapturePreparation<T>): Promise<void> {
    try {
      const capture = await prepare(this.controller.signal, this.element);
      if (this.state.kind === 'closed') return;
      const remaining = capture.expiresAtMs === null ? null : capture.expiresAtMs - Date.now();
      if (remaining !== null && remaining <= 0) {
        throw new Error('VoiceID challenge expired. Start unlock again.');
      }
      this.state = { kind: 'ready', capture };
      this.expiryTimer = remaining === null ? null : setTimeout(this.expire, remaining);
      this.status.textContent = '';
      this.activateButton.disabled = false;
      this.activateButton.focus();
    } catch (error) {
      if (this.state.kind === 'closed') return;
      this.state = { kind: 'closed' };
      this.completion.reject(toError(error));
    }
  }

  private readonly begin = (): void => {
    if (this.state.kind !== 'ready') return;
    const capture = this.state.capture;
    this.state = { kind: 'capturing' };
    void this.perform(capture.action);
  };

  private async perform(activate: CaptureAction<T>): Promise<void> {
    this.activateButton.disabled = true;
    this.status.textContent = 'Opening microphone…';
    try {
      // Start in the button event so capture retains browser user activation.
      const result = await activate(this.controller.signal, this.listening);
      if (this.state.kind === 'closed') return;
      this.state = { kind: 'closed' };
      this.completion.resolve(result);
    } catch (error: unknown) {
      if (this.state.kind === 'closed') return;
      this.state = { kind: 'closed' };
      this.completion.reject(toError(error));
    }
  }

  private readonly listening = (): void => {
    this.status.textContent = `Listening for eight seconds. Slowly say: “${VOICE_SAMPLE_PHRASE}” Speak for about three seconds.`;
  };

  private readonly cancel = (): void => {
    if (this.state.kind === 'closed') return;
    this.state = { kind: 'closed' };
    this.controller.abort();
    this.completion.reject(new Error('VoiceID capture was cancelled.'));
  };

  private readonly expire = (): void => {
    if (this.state.kind === 'closed') return;
    this.state = { kind: 'closed' };
    this.controller.abort();
    this.completion.reject(new Error('VoiceID challenge expired. Start unlock again.'));
  };
}

export async function showVoiceIdCaptureSurface<T>(input: {
  readonly prepare: CapturePreparation<T>;
  readonly purpose: 'activation' | 'unlock';
}): Promise<T> {
  const surface = new VoiceIdCaptureSurface(input.prepare, input.purpose);
  try {
    return await surface.result;
  } finally {
    surface.dispose();
  }
}

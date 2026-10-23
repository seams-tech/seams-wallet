import { nativeEnrollmentStatus } from '@/core/signingEngine/uiConfirm/voiceId/bridge';
import {
  VOICE_ID_POLICY_KEY,
  voiceIdIsRequired,
} from '@/core/signingEngine/uiConfirm/voiceId/approval';

class VoiceIdSettings {
  private readonly status = document.createElement('p');
  private readonly enable = document.createElement('button');
  private readonly disable = document.createElement('button');
  private readonly lifetime = new AbortController();

  constructor() {
    if (window.top !== window.self)
      throw new Error('Open VoiceID settings in a separate browser tab.');
    document.title = 'Wallet VoiceID';
    const main = document.createElement('main');
    main.className = 'seams-voiceid-settings';
    const title = document.createElement('h1');
    title.textContent = 'VoiceID on this device';
    const detail = document.createElement('p');
    detail.textContent =
      'Start the local VoiceID service on this device. Use its enrollment page to record three voice samples. The local Keychain stores your voice template.';
    const scope = document.createElement('p');
    scope.textContent =
      'VoiceID approves one reviewed NEAR transfer. Your existing wallet session and signing limits still apply. Other signing routes will be unavailable while VoiceID is enabled.';
    this.status.setAttribute('role', 'status');
    this.enable.textContent = 'Enable VoiceID';
    this.disable.textContent = 'Disable VoiceID';
    this.enable.addEventListener('click', this.enableVoiceId);
    this.disable.addEventListener('click', this.disableVoiceId);
    window.addEventListener('pagehide', this.close, { once: true });
    main.append(title, detail, scope, this.status, this.enable, this.disable);
    document.body.replaceChildren(main);
    this.refresh();
  }

  private refresh(): void {
    const required = voiceIdIsRequired();
    this.status.textContent = required
      ? 'VoiceID is required on this wallet origin.'
      : 'VoiceID is disabled.';
    this.enable.disabled = required;
    this.disable.disabled = !required;
  }

  private readonly enableVoiceId = async (): Promise<void> => {
    this.enable.disabled = true;
    this.status.textContent = 'Checking the local VoiceID host…';
    try {
      const status = await nativeEnrollmentStatus(this.lifetime.signal);
      if (status !== 'ready')
        throw new Error('Enroll your voice with the local VoiceID page, then try again.');
      if (this.lifetime.signal.aborted) return;
      localStorage.setItem(VOICE_ID_POLICY_KEY, 'required');
      this.refresh();
    } catch (error) {
      this.status.textContent = error instanceof Error ? error.message : 'VoiceID is unavailable.';
      this.enable.disabled = false;
    }
  };

  private readonly disableVoiceId = (): void => {
    localStorage.removeItem(VOICE_ID_POLICY_KEY);
    this.refresh();
  };

  private readonly close = (): void => {
    this.lifetime.abort();
  };
}

new VoiceIdSettings();

import type { VoiceIdAuthMethodPlugin } from '@seams/wallet/voiceid-host';

/** A small opt-in descriptor with no capture, model, or host implementation. */
export function voiceIdAuthMethod(): VoiceIdAuthMethodPlugin {
  return { kind: 'voiceid' };
}

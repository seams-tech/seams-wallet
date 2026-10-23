import type { VoiceIdAuthMethodPlugin } from '@/core/authMethods/plugins';

/** A small opt-in descriptor with no capture, model, or host implementation. */
export function voiceIdAuthMethod(): VoiceIdAuthMethodPlugin {
  return { kind: 'voiceid' };
}

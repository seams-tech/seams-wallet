import {
  getDefaultCspNonce,
  readVoiceMicrophonePreference,
  saveVoiceMicrophonePreference,
} from '@seams/wallet/voiceid-host';
import { configureVoiceCapture } from '@seams/voice-capture';

/**
 * Gives `@seams/voice-capture` the Wallet's settings: the folder that serves VoiceID's files, the
 * Wallet's store for the chosen microphone, its style nonce, and the words of its messages.
 */
export function configureVoiceIdCapture(): void {
  configureVoiceCapture({
    assetBase: '/sdk/voiceid/',
    microphonePreference: {
      read: readVoiceMicrophonePreference,
      save: saveVoiceMicrophonePreference,
    },
    label: 'VoiceID',
    place: 'the Wallet',
    site: 'this Wallet',
    recoveryHint: 'Reload the page or use a passkey.',
    cacheName: 'seams-voiceid-models-v1',
    styleNonce: getDefaultCspNonce,
  });
}

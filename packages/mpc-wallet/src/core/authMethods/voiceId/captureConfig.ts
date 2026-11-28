import { getDefaultCspNonce } from '@/core/browser/walletIframe/csp-stylesheet';
import {
  readVoiceMicrophonePreference,
  saveVoiceMicrophonePreference,
} from './microphonePreference';

/**
 * The Wallet's settings for `configureVoiceCapture` of `@seams/voice-capture`: the folder that
 * serves the speech files, the Wallet's store for the chosen microphone, its style nonce, and
 * the words of its messages.
 *
 * The settings are the state of one copy of the package. The Wallet's chunk of the phrase card
 * and the VoiceID plugin each bundle a copy, and each copy gets these settings.
 */
export function walletVoiceCaptureConfig() {
  return {
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
  };
}

import { walletVoiceCaptureConfig } from '@seams/mpc-wallet/voiceid';
import { configureVoiceCapture } from '@seams/voice-capture';

/**
 * Gives this plugin's copy of `@seams/voice-capture` the Wallet's settings. The Wallet core
 * holds them, and gives the same settings to its own copy for the phrase card.
 */
export function configureVoiceIdCapture(): void {
  configureVoiceCapture(walletVoiceCaptureConfig());
}

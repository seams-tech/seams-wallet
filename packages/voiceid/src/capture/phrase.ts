import {
  anchoredCardChrome,
  createWalletIframeSurfaceMeasurementReporter,
  type AuthMethodPhraseSurface,
  type WalletAuthMethodHostPlugin,
} from '@seams/wallet/voiceid-host';
import { openPhraseCard } from '@seams/voice-capture/card';

type PhraseInput = Parameters<WalletAuthMethodHostPlugin['openPhrase']>[0];

/**
 * Shows the given sentence on the phrase card of `@seams/voice-capture`, in the Wallet's frame:
 * the Wallet's theme classes, its Back control, and the size reports that the Wallet iframe
 * needs. The card records clips with the quality gate and stays open, so the caller can show its
 * check and the result on the same card.
 */
export function openPhrase(input: PhraseInput): AuthMethodPhraseSurface {
  const binding = input.surfaceMeasurementBinding;
  return openPhraseCard({
    sentence: input.sentence,
    signal: input.signal,
    frame: {
      parent: document.getElementById('root') ?? document.body,
      className: 'seams-wallet-ui seams-auth-method-activation-surface',
      back: anchoredCardChrome() === 'back',
      // The parent sizes the frame to this surface, so the card can follow the frame.
      hugged: binding.kind === 'wallet_iframe',
      mounted(element) {
        if (binding.kind !== 'wallet_iframe') return;
        const measurement = createWalletIframeSurfaceMeasurementReporter({
          kind: 'request_surface',
          element,
          requestId: binding.requestId,
          postMeasurement: binding.postMeasurement,
        });
        return () => measurement.disconnect();
      },
    },
  });
}

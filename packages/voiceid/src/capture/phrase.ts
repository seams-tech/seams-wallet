import {
  anchoredCardChrome,
  createWalletIframeSurfaceMeasurementReporter,
  pressCardControl,
  type AuthMethodPhraseSurface,
  type WalletAuthMethodHostPlugin,
} from '@seams/wallet/voiceid-host';
import { openPhraseCard, type PhraseCardControls } from '@seams/voice-capture/card';

type PhraseInput = Parameters<WalletAuthMethodHostPlugin['openPhrase']>[0];

/**
 * Shows the given sentence on the phrase card of `@seams/voice-capture`, in the Wallet's frame:
 * the Wallet's theme classes, the Back and Close that the app asked for, and the size reports that the Wallet iframe
 * needs. The card records clips with the quality gate and stays open, so the caller can show its
 * check and the result on the same card.
 */
export function openPhrase(input: PhraseInput): AuthMethodPhraseSurface {
  const binding = input.surfaceMeasurementBinding;
  return openPhraseCard({
    sentence: input.sentence,
    signal: input.signal,
    autoStart: input.autoStart === true,
    frame: {
      parent: document.getElementById('root') ?? document.body,
      className: 'seams-wallet-ui seams-auth-method-activation-surface',
      controls: cardControls(),
      // The app hears which control the person pressed, before the card ends.
      pressed: pressCardControl,
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

/** The card's corner controls for the chrome that the app asked for. Close is the default. */
function cardControls(): PhraseCardControls {
  const chrome = anchoredCardChrome();
  return chrome === 'back' || chrome === 'back_and_close' ? chrome : 'close';
}

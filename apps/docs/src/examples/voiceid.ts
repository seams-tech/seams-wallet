// #region configuration
import { defineSeamsConfig } from '@seams/wallet';
import { voiceIdAuthMethod } from '@seams/voiceid';

export const voiceIdConfig = defineSeamsConfig({
  walletOrigin: import.meta.env.VITE_WALLET_ORIGIN,
  relayerUrl: import.meta.env.VITE_RELAYER_URL,
  publishableKey: import.meta.env.VITE_SEAMS_PUBLISHABLE_KEY,
  authMethods: [voiceIdAuthMethod()],
  chains: [{ network: 'near-testnet' }, { network: 'arc-testnet', chainId: 5_042_002 }],
});
// #endregion configuration

// #region activation
import type { SeamsContextType } from '@seams/wallet/react';

export async function enableVoiceId(seams: SeamsContextType['seams'], walletId: string) {
  const result = await seams.registration.activateAuthMethod({
    walletId,
    method: 'voiceid',
  });
  if (result.kind === 'cancelled') return result;

  console.log('VoiceID enabled', result.walletAuthMethodId);
  return result;
}
// #endregion activation

// #region unlock
export async function unlockWithVoiceId(
  seams: SeamsContextType['seams'],
  walletId: string,
  walletAuthMethodId: string,
) {
  const result = await seams.auth.unlockWithAuthMethod({
    walletId,
    walletAuthMethodId,
    method: 'voiceid',
  });
  if (!result.success) throw new Error(result.error);
  return result;
}
// #endregion unlock

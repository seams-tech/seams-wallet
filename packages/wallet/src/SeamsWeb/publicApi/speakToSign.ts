import type {
  SpeakToSignTransferRequest,
  SpeakToSignTransferResult,
} from '@/core/transactionFeatures/hostPlugin';
import {
  findWalletTransactionFeature,
  type SpeakToSignNetwork,
  type WalletTransactionFeaturePlugin,
} from '@/core/transactionFeatures/plugins';
import { walletIdFromString } from '@shared/utils/registrationIds';

export type SpeakToSignCapability = Readonly<{
  vault: string;
  network: SpeakToSignNetwork;
  requestTransfer(request: SpeakToSignTransferRequest): Promise<SpeakToSignTransferResult>;
}>;

/**
 * The app API that a list of transaction features adds. Only a list with a known length
 * counts, so a widened `SeamsConfigsInput` adds nothing.
 */
export type TransactionFeatureApi<F extends readonly WalletTransactionFeaturePlugin[]> =
  number extends F['length']
    ? unknown
    : 'speak_to_sign' extends F[number]['kind']
      ? { readonly speakToSign: SpeakToSignCapability }
      : unknown;

export function createSpeakToSignCapability(
  features: readonly WalletTransactionFeaturePlugin[],
): SpeakToSignCapability | null {
  const feature = findWalletTransactionFeature(features, 'speak_to_sign');
  if (!feature) return null;
  return { vault: feature.vault, network: feature.network, requestTransfer };
}

// The Wallet iframe route for the spoken payment flow comes later.
async function requestTransfer(
  request: SpeakToSignTransferRequest,
): Promise<SpeakToSignTransferResult> {
  walletIdFromString(request.walletId);
  return { kind: 'unavailable', reason: 'flow_not_available' };
}

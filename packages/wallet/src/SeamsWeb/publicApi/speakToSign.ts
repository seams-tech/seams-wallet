import type {
  SpeakToSignTransferRequest,
  SpeakToSignTransferResult,
} from '@/core/transactionFeatures/hostPlugin';
import {
  findWalletTransactionFeature,
  type SpeakToSignNetwork,
  type WalletTransactionFeaturePlugin,
} from '@/core/transactionFeatures/plugins';

export type SpeakToSignCapability = Readonly<{
  vault: string;
  network: SpeakToSignNetwork;
  /**
   * Runs one spoken payment in the Wallet iframe: the owner reads the sentence aloud,
   * the Seams server verifies the voice, and the vault receives `transfer_with_verdict`.
   */
  requestTransfer(request: SpeakToSignTransferRequest): Promise<SpeakToSignTransferResult>;
}>;

export function createSpeakToSignCapability(
  features: readonly WalletTransactionFeaturePlugin[],
  requestTransfer: SpeakToSignCapability['requestTransfer'],
): SpeakToSignCapability | null {
  const feature = findWalletTransactionFeature(features, 'speak_to_sign');
  if (!feature) return null;
  return { vault: feature.vault, network: feature.network, requestTransfer };
}

import type {
  SpeakToSignEnrollmentRequest,
  SpeakToSignEnrollmentResult,
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
  /**
   * Enrolls the owner's voice with the verifier: the owner reads three phrases aloud, approves
   * `authorize_enrollment` for exactly these recordings, and the verifier stores the template.
   * The vault must exist. A new enrollment replaces the template.
   */
  enroll(request: SpeakToSignEnrollmentRequest): Promise<SpeakToSignEnrollmentResult>;
}>;

export function createSpeakToSignCapability(
  features: readonly WalletTransactionFeaturePlugin[],
  commands: Pick<SpeakToSignCapability, 'requestTransfer' | 'enroll'>,
): SpeakToSignCapability | null {
  const feature = findWalletTransactionFeature(features, 'speak_to_sign');
  if (!feature) return null;
  return {
    vault: feature.vault,
    network: feature.network,
    requestTransfer: commands.requestTransfer,
    enroll: commands.enroll,
  };
}

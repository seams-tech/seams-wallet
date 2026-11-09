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
  network: SpeakToSignNetwork;
  /**
   * Runs one spoken payment in the Wallet iframe: the owner reads the sentence aloud, the Seams
   * server has the verifier check the voice and the words, and the Wallet sends the transfer
   * from the owner's account. An accepted verdict needs no confirm; a policy rule can ask for a
   * passkey.
   */
  requestTransfer(request: SpeakToSignTransferRequest): Promise<SpeakToSignTransferResult>;
  /**
   * Enrolls the owner's voice with the verifier: the owner reads three phrases aloud, signs one
   * message that authorizes exactly these recordings, and the verifier stores the template. A
   * new enrollment replaces the template.
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
    network: feature.network,
    requestTransfer: commands.requestTransfer,
    enroll: commands.enroll,
  };
}

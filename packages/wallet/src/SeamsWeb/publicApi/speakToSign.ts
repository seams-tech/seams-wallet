import type {
  SpeakToSignEnrollmentRequest,
  SpeakToSignEnrollmentResult,
  SpeakToSignNoteRequest,
  SpeakToSignNoteResult,
  SpeakToSignMergeApprovalRequest,
  SpeakToSignRatingRequest,
  SpeakToSignTransferRequest,
  SpeakToSignTransferResult,
} from '@/core/transactionFeatures/hostPlugin';
import type { WithPresentation } from '@/SeamsWeb/walletIframe/client/speakToSignCommands';
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
  requestTransfer(request: WithPresentation<SpeakToSignTransferRequest>): Promise<SpeakToSignTransferResult>;
  /**
   * Posts one community note by voice: the author reads the note's short summary aloud, the
   * verifier checks the voice and the words, and the Wallet calls `add_note` on the notes
   * contract from the owner's account, with no deposit and no confirm.
   */
  requestNote(request: WithPresentation<SpeakToSignNoteRequest>): Promise<SpeakToSignNoteResult>;
  /**
   * Rates one community note by voice: the owner says "this note is helpful", "this note is
   * somewhat helpful" or "this note is not helpful", and the Wallet calls `rate_note`.
   */
  requestRating(request: WithPresentation<SpeakToSignRatingRequest>): Promise<SpeakToSignNoteResult>;
  /**
   * Approves one pull request merge by voice: the owner says "merge pull request 42 into main",
   * and the Wallet calls `approve_merge` on the contract, with no deposit and no confirm. The
   * verdict binds the repository and the head commit, which the owner does not say.
   */
  requestMergeApproval(request: WithPresentation<SpeakToSignMergeApprovalRequest>): Promise<SpeakToSignNoteResult>;
  /**
   * Enrolls the owner's voice with the verifier: the owner reads three phrases aloud, signs one
   * message that authorizes exactly these recordings, and the verifier stores the template. A
   * new enrollment replaces the template.
   */
  enroll(request: WithPresentation<SpeakToSignEnrollmentRequest>): Promise<SpeakToSignEnrollmentResult>;
}>;

export function createSpeakToSignCapability(
  features: readonly WalletTransactionFeaturePlugin[],
  commands: Pick<
    SpeakToSignCapability,
    'requestTransfer' | 'requestNote' | 'requestRating' | 'requestMergeApproval' | 'enroll'
  >,
): SpeakToSignCapability | null {
  const feature = findWalletTransactionFeature(features, 'speak_to_sign');
  if (!feature) return null;
  return {
    network: feature.network,
    requestTransfer: commands.requestTransfer,
    requestNote: commands.requestNote,
    requestRating: commands.requestRating,
    requestMergeApproval: commands.requestMergeApproval,
    enroll: commands.enroll,
  };
}

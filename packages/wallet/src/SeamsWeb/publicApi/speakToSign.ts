import type {
  SpeakToSignBetRequest,
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
import {
  runWalletModalSteps,
  type WalletModalSteps,
  type WalletModalStepsOwner,
} from './walletModalSteps';

/**
 * A Speak-to-Sign request. `presentation` shows the VoiceID card in the app's own dialog;
 * `steps` shows it in the SDK's modal between the app's own steps.
 */
export type SpeakToSignCall<Request, Result> =
  | (WithPresentation<Request> & Readonly<{ steps?: never }>)
  | (Request & Readonly<{ presentation?: never; steps: WalletModalSteps<Result> }>);

export type SpeakToSignCapability = Readonly<{
  network: SpeakToSignNetwork;
  /**
   * Runs one spoken payment in the Wallet iframe: the owner reads the sentence aloud, the Seams
   * server has the verifier check the voice and the words, and the Wallet sends the transfer
   * from the owner's account. An accepted verdict needs no confirm; a policy rule can ask for a
   * passkey.
   */
  requestTransfer(
    request: SpeakToSignCall<SpeakToSignTransferRequest, SpeakToSignTransferResult>,
  ): Promise<SpeakToSignTransferResult>;
  /**
   * Posts one community note by voice: the author reads the note's short summary aloud, the
   * verifier checks the voice and the words, and the Wallet calls `add_note` on the notes
   * contract from the owner's account, with no deposit and no confirm.
   */
  requestNote(
    request: SpeakToSignCall<SpeakToSignNoteRequest, SpeakToSignNoteResult>,
  ): Promise<SpeakToSignNoteResult>;
  /**
   * Rates one community note by voice: the owner says "this note is helpful", "this note is
   * somewhat helpful" or "this note is not helpful", and the Wallet calls `rate_note`.
   */
  requestRating(
    request: SpeakToSignCall<SpeakToSignRatingRequest, SpeakToSignNoteResult>,
  ): Promise<SpeakToSignNoteResult>;
  /**
   * Approves one pull request merge by voice: the owner says "merge pull request 42 into main",
   * and the Wallet calls `approve_merge` on the contract, with no deposit and no confirm. The
   * verdict binds the repository and the head commit, which the owner does not say.
   */
  requestMergeApproval(
    request: SpeakToSignCall<SpeakToSignMergeApprovalRequest, SpeakToSignNoteResult>,
  ): Promise<SpeakToSignNoteResult>;
  /**
   * Bets on one outcome of a prediction market by voice: the owner says "bet zero point five
   * usdc yes on market nine", and the Wallet sends the stake with the token's `ft_transfer_call`
   * to the market contract, with the signed verdict in `msg` and no confirm. The verdict binds
   * the market and the token, which the owner does not say. The token must be the USDC contract
   * of the network. The Wallet sets no amount limit: the amount that the owner says is the bet.
   */
  requestBet(
    request: SpeakToSignCall<SpeakToSignBetRequest, SpeakToSignNoteResult>,
  ): Promise<SpeakToSignNoteResult>;
  /**
   * Enrolls the owner's voice with the verifier: the owner reads three phrases aloud, signs one
   * message that authorizes exactly these recordings, and the verifier stores the template. A
   * new enrollment replaces the template.
   */
  enroll(
    request: SpeakToSignCall<SpeakToSignEnrollmentRequest, SpeakToSignEnrollmentResult>,
  ): Promise<SpeakToSignEnrollmentResult>;
}>;

type SpeakToSignCommand<Request, Result> = (request: WithPresentation<Request>) => Promise<Result>;

/** Every Speak-to-Sign result has this kind for a request that the owner left. */
const CANCELLED = Object.freeze({ kind: 'cancelled' as const });

function withModalSteps<Request extends object, Result>(
  command: SpeakToSignCommand<Request, Result>,
  owner: WalletModalStepsOwner,
  cancelled: Result,
  request: SpeakToSignCall<Request, Result>,
): Promise<Result> {
  if (request.steps === undefined) return command(request);
  const { steps, ...rest } = request;
  return runWalletModalSteps(owner, {
    kind: 'speak_to_sign',
    steps,
    cancelled,
    send: (presentation) => command({ ...(rest as Request), presentation }),
  });
}

export function createSpeakToSignCapability(
  features: readonly WalletTransactionFeaturePlugin[],
  commands: Readonly<{
    requestTransfer: SpeakToSignCommand<SpeakToSignTransferRequest, SpeakToSignTransferResult>;
    requestNote: SpeakToSignCommand<SpeakToSignNoteRequest, SpeakToSignNoteResult>;
    requestRating: SpeakToSignCommand<SpeakToSignRatingRequest, SpeakToSignNoteResult>;
    requestMergeApproval: SpeakToSignCommand<
      SpeakToSignMergeApprovalRequest,
      SpeakToSignNoteResult
    >;
    requestBet: SpeakToSignCommand<SpeakToSignBetRequest, SpeakToSignNoteResult>;
    enroll: SpeakToSignCommand<SpeakToSignEnrollmentRequest, SpeakToSignEnrollmentResult>;
  }>,
  owner: WalletModalStepsOwner,
): SpeakToSignCapability | null {
  const feature = findWalletTransactionFeature(features, 'speak_to_sign');
  if (!feature) return null;
  return {
    network: feature.network,
    requestTransfer: (request) =>
      withModalSteps(commands.requestTransfer, owner, CANCELLED, request),
    requestNote: (request) => withModalSteps(commands.requestNote, owner, CANCELLED, request),
    requestRating: (request) => withModalSteps(commands.requestRating, owner, CANCELLED, request),
    requestMergeApproval: (request) =>
      withModalSteps(commands.requestMergeApproval, owner, CANCELLED, request),
    requestBet: (request) => withModalSteps(commands.requestBet, owner, CANCELLED, request),
    enroll: (request) => withModalSteps(commands.enroll, owner, CANCELLED, request),
  };
}

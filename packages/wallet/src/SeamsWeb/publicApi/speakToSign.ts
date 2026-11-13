import type {
  SpeakToSignBetRequest,
  SpeakToSignDelegateRequest,
  SpeakToSignEnrollmentRequest,
  SpeakToSignEnrollmentResult,
  SpeakToSignPrepareRequest,
  SpeakToSignPrepareResult,
  SpeakToSignProof,
  SpeakToSignMessageRefusalReason,
  SpeakToSignMessageRequest,
  SpeakToSignMessageResult,
  SpeakToSignNoteRefusalReason,
  SpeakToSignNoteRequest,
  SpeakToSignMergeApprovalRequest,
  SpeakToSignRatingRequest,
  SpeakToSignRefusalReason,
  SpeakToSignSignedDelegateResult,
  SpeakToSignSignedMessage,
  SpeakToSignSignedTransactionResult,
  SpeakToSignTransactionRequest,
  SpeakToSignTransferRequest,
  SpeakToSignTransferResult,
  SpeakToSignUnavailableReason,
} from '@/core/transactionFeatures/hostPlugin';
import type { SignDelegateActionResult, SignTransactionResult } from '@/core/types/seams';
import type {
  SpeakToSignCommands,
  WithPresentation,
} from '@/SeamsWeb/walletIframe/client/speakToSignCommands';
import {
  findWalletApproval,
  type SpeakToSignNetwork,
  type WalletApprovalPlugin,
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

/**
 * The result of one spoken signing call. `approved` holds what the normal call of the same name
 * returns. The other kinds signed nothing, or the sent transaction failed (`transaction_failed`).
 */
export type SpeakToSignResult<T, Reason extends string = SpeakToSignNoteRefusalReason> =
  | (Readonly<{ kind: 'approved'; result: T }> & SpeakToSignProof)
  | Readonly<{ kind: 'refused'; reason: Reason; detail?: string }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'unavailable'; reason: SpeakToSignUnavailableReason; detail?: string }>;

/** A transaction that the Wallet signed and sent, with its final outcome on chain. */
export type SpeakToSignSentTransaction = Readonly<{ transactionHash: string }>;

type Sent<Reason extends string = SpeakToSignNoteRefusalReason> = SpeakToSignResult<
  SpeakToSignSentTransaction,
  Reason
>;
type SignedMessage = SpeakToSignResult<SpeakToSignSignedMessage, SpeakToSignMessageRefusalReason>;

/**
 * Requests whose sentence comes from the request fields, so the owner says what the Wallet
 * signs. Each one is one fixed call shape.
 */
export type SpeakToSignTypedCalls = Readonly<{
  /** A NEAR transfer: "send two near to alice dot testnet". A policy rule can ask for a passkey. */
  transfer(
    request: SpeakToSignCall<SpeakToSignTransferRequest, Sent<SpeakToSignRefusalReason>>,
  ): Promise<Sent<SpeakToSignRefusalReason>>;
  /**
   * `add_note` on a notes contract. The Seams server writes a short summary of the note, the card
   * shows the note above it, and the author says the summary. The verifier checks that the
   * summary gives the main point of the note.
   */
  note(request: SpeakToSignCall<SpeakToSignNoteRequest, Sent>): Promise<Sent>;
  /** `rate_note` on a notes contract: "this note is helpful". */
  rating(request: SpeakToSignCall<SpeakToSignRatingRequest, Sent>): Promise<Sent>;
  /** `approve_merge` on a merge-approval contract: "merge pull request 42 into main". */
  mergeApproval(request: SpeakToSignCall<SpeakToSignMergeApprovalRequest, Sent>): Promise<Sent>;
  /**
   * A bet on a prediction market: "bet zero point five usdc yes on market nine". The Wallet
   * sends the stake with the token's `ft_transfer_call`, with the signed verdict in `msg`.
   */
  bet(request: SpeakToSignCall<SpeakToSignBetRequest, Sent>): Promise<Sent>;
}>;

/**
 * The NEAR signer by voice: each call has the name of the `seams.near` call that it replaces.
 * The owner reads the request's `summary` aloud, the Seams server has the verifier check the
 * voice and the words, and the Wallet signs with no confirm. The verdict binds exactly what the
 * Wallet signs. The application writes the summary: the voice proves who approves and what was
 * said, not that the summary describes the request.
 */
export type SpeakToSignCapability = Readonly<{
  network: SpeakToSignNetwork;
  /** Signs and sends any NEAR transaction, as `near.signAndSendTransaction`. */
  signAndSendTransaction(
    request: SpeakToSignCall<SpeakToSignTransactionRequest, Sent>,
  ): Promise<Sent>;
  /** Signs any NEAR transaction and does not send it, as `near.signTransaction`. */
  signTransaction(
    request: SpeakToSignCall<
      SpeakToSignTransactionRequest,
      SpeakToSignResult<SignTransactionResult>
    >,
  ): Promise<SpeakToSignResult<SignTransactionResult>>;
  /** Signs a NEP-366 delegate action for a relayer, as `near.signDelegateAction`. */
  signDelegateAction(
    request: SpeakToSignCall<
      SpeakToSignDelegateRequest,
      SpeakToSignResult<SignDelegateActionResult>
    >,
  ): Promise<SpeakToSignResult<SignDelegateActionResult>>;
  /** Signs any NEP-413 message, as `near.signMessage`. The Wallet draws the nonce. */
  signMessage(
    request: SpeakToSignCall<SpeakToSignMessageRequest, SignedMessage>,
  ): Promise<SignedMessage>;
  typed: SpeakToSignTypedCalls;
  /**
   * Enrolls the owner's voice with the verifier: the owner reads three phrases aloud, signs one
   * message that authorizes exactly these recordings, and the verifier stores the template. A
   * new enrollment replaces the template.
   */
  enroll(
    request: SpeakToSignCall<SpeakToSignEnrollmentRequest, SpeakToSignEnrollmentResult>,
  ): Promise<SpeakToSignEnrollmentResult>;
  /** The warm-up before a spoken request. It shows no card. */
  prepare(request: SpeakToSignPrepareRequest): Promise<SpeakToSignPrepareResult>;
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

/** What the Wallet iframe answers for a call that sends a transaction. */
type SendAnswer<Reason extends string> =
  | Extract<SpeakToSignTransferResult, { kind: 'sent' }>
  | Exclude<Sent<Reason>, { kind: 'approved' }>;

/** The public result of a sent transaction. */
function sent<Reason extends string>(answer: SendAnswer<Reason>): Sent<Reason> {
  if (answer.kind !== 'sent') return answer;
  const { transactionHash, approval, times, attestationUrl } = answer;
  return { kind: 'approved', result: { transactionHash }, approval, times, attestationUrl };
}

/** The public result of a transaction that the Wallet signed and did not send. */
function signedTransaction(
  answer: SpeakToSignSignedTransactionResult,
): SpeakToSignResult<SignTransactionResult> {
  if (answer.kind !== 'signed_transaction') return answer;
  const { signed, approval, times, attestationUrl } = answer;
  return { kind: 'approved', result: signed, approval, times, attestationUrl };
}

function signedDelegate(
  answer: SpeakToSignSignedDelegateResult,
): SpeakToSignResult<SignDelegateActionResult> {
  if (answer.kind !== 'signed_delegate') return answer;
  const { signed, approval, times, attestationUrl } = answer;
  return { kind: 'approved', result: signed, approval, times, attestationUrl };
}

function signedMessage(result: SpeakToSignMessageResult): SignedMessage {
  if (result.kind !== 'signed') return result;
  const { kind: _kind, approval, times, attestationUrl, ...message } = result;
  return { kind: 'approved', result: message, approval, times, attestationUrl };
}

export function createSpeakToSignCapability(
  features: readonly WalletApprovalPlugin[],
  commands: SpeakToSignCommands,
  owner: WalletModalStepsOwner,
): SpeakToSignCapability | null {
  const feature = findWalletApproval(features, 'spoken');
  if (!feature) return null;
  /** A call that sends: the iframe's `sent` answer becomes the public `approved` result. */
  const sending =
    <Request extends object, Reason extends string>(
      command: SpeakToSignCommand<Request, SendAnswer<Reason>>,
    ) =>
    (request: SpeakToSignCall<Request, Sent<Reason>>): Promise<Sent<Reason>> =>
      withModalSteps(async (inner) => sent(await command(inner)), owner, CANCELLED, request);
  return {
    network: feature.network,
    signAndSendTransaction: sending(commands.requestTransaction),
    signTransaction: (request) =>
      withModalSteps(
        async (inner) => signedTransaction(await commands.requestSignedTransaction(inner)),
        owner,
        CANCELLED,
        request,
      ),
    signDelegateAction: (request) =>
      withModalSteps(
        async (inner) => signedDelegate(await commands.requestDelegateAction(inner)),
        owner,
        CANCELLED,
        request,
      ),
    signMessage: (request) =>
      withModalSteps(
        async (inner) => signedMessage(await commands.requestMessage(inner)),
        owner,
        CANCELLED,
        request,
      ),
    typed: {
      transfer: sending(commands.requestTransfer),
      note: sending(commands.requestNote),
      rating: sending(commands.requestRating),
      mergeApproval: sending(commands.requestMergeApproval),
      bet: sending(commands.requestBet),
    },
    enroll: (request) => withModalSteps(commands.enroll, owner, CANCELLED, request),
    prepare: commands.prepare,
  };
}

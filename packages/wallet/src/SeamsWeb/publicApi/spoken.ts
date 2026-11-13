// Approval by voice in the app API. The owner says a sentence, and the Wallet signs with no
// confirm (Speak-to-Sign). It has two forms:
//   - the normal NEAR sign calls take `approval: { kind: 'spoken', summary }`: the application
//     writes the sentence, and the verdict binds exactly what the Wallet signs;
//   - `seams.near.spoken` has the typed requests, whose sentence comes from their fields, and
//     the enrollment of the owner's voice.
// Both need `approvals: [spoken({ network })]` in the configuration.

import type {
  SpeakToSignBetRequest,
  SpeakToSignEnrollmentResult,
  SpeakToSignMergeApprovalRequest,
  SpeakToSignMessageRefusalReason,
  SpeakToSignNoteRefusalReason,
  SpeakToSignNoteRequest,
  SpeakToSignPrepareResult,
  SpeakToSignProgress,
  SpeakToSignRatingRequest,
  SpeakToSignRefusalReason,
  SpeakToSignSignedMessage,
  SpeakToSignTransferRequest,
} from '@/core/transactionFeatures/hostPlugin';
import type { SpeakToSignNetwork } from '@/core/transactionFeatures/plugins';
import type { ActionArgs, TransactionInput } from '@/core/types/actions';
import type { DelegateActionInput } from '@/core/types/delegate';
import type { SignNEP413MessageParams } from '@/core/types/sdkPublicResults';
import type { SignDelegateActionResult, SignTransactionResult } from '@/core/types/seams';
import type { CurrentWalletResolver, WalletSessionInput } from './currentWallet';
import type {
  SpeakToSignCall,
  SpeakToSignCapability,
  SpeakToSignResult,
  SpeakToSignSentTransaction,
} from './speakToSign';
import type { NearSignerCapability } from './types';

/**
 * Asks for the owner's voice in place of the Wallet's confirm. The owner reads `summary` aloud:
 * 1 to 12 plain words. The application writes it, so the voice proves who approves and what was
 * said, not that the summary describes the request.
 */
export type SpokenApproval = Readonly<{
  kind: 'spoken';
  summary: string;
  /** How the spoken request goes: the recording, the verifier, the signature. */
  onProgress?: (progress: SpeakToSignProgress) => void;
  /**
   * The card records when it opens, with no press on Record. Default: true. If the browser does
   * not start audio without a press, the card keeps its Record button.
   */
  autoStart?: boolean;
}>;

/** The wallet that a spoken call is for. Omitted: the authenticated wallet. */
type SpokenSubject = Readonly<{ walletSession?: WalletSessionInput }>;

type Sent<Reason extends string = SpeakToSignNoteRefusalReason> = SpeakToSignResult<
  SpeakToSignSentTransaction,
  Reason
>;
type SignedMessage = SpeakToSignResult<SpeakToSignSignedMessage, SpeakToSignMessageRefusalReason>;

/** A normal sign call with `approval`. Its card shows in the app's dialog or in modal steps. */
type Approved<Fields, Result> = SpeakToSignCall<
  SpokenSubject & Fields & Readonly<{ approval: SpokenApproval }>,
  Result
>;

/** A typed request: the fields of the kind, with no wallet id. */
type Typed<Request extends { walletId: string }, Result> = SpeakToSignCall<
  SpokenSubject & Omit<Request, 'walletId'>,
  Result
>;

/**
 * The normal NEAR sign calls with `approval`. Each returns a result with a `kind`: `approved`
 * holds what the call without `approval` returns, and the other kinds signed nothing (or the
 * sent transaction failed: `transaction_failed`). They do not throw for a refusal.
 */
export interface SpokenNearSigner {
  /** Signs and sends any NEAR transaction. */
  signAndSendTransaction(
    args: Approved<Readonly<{ receiverId: string; actions: ActionArgs[] }>, Sent>,
  ): Promise<Sent>;
  /** Signs any NEAR transaction and does not send it. */
  signTransaction(
    args: Approved<
      Readonly<{ transaction: TransactionInput }>,
      SpeakToSignResult<SignTransactionResult>
    >,
  ): Promise<SpeakToSignResult<SignTransactionResult>>;
  /** Signs a NEP-366 delegate action for a relayer. The Wallet reads the sender itself. */
  signDelegateAction(
    args: Approved<
      Readonly<{ delegate: Omit<DelegateActionInput, 'senderId'> & { senderId?: string } }>,
      SpeakToSignResult<SignDelegateActionResult>
    >,
  ): Promise<SpeakToSignResult<SignDelegateActionResult>>;
  /** Signs any NEP-413 message. The Wallet draws the nonce. */
  signMessage(
    args: Approved<Readonly<{ params: SignNEP413MessageParams }>, SignedMessage>,
  ): Promise<SignedMessage>;
}

/**
 * `seams.near.spoken`: the requests whose sentence comes from the request fields, so the owner
 * says what the Wallet signs, and the enrollment. Present only with `spoken({ network })` in
 * `approvals`.
 */
export type SpokenCalls = Readonly<{
  network: SpeakToSignNetwork;
  /** A NEAR transfer: "send two near to alice dot testnet". A policy rule can ask for a passkey. */
  transfer(
    request: Typed<SpeakToSignTransferRequest, Sent<SpeakToSignRefusalReason>>,
  ): Promise<Sent<SpeakToSignRefusalReason>>;
  /**
   * `add_note` on a notes contract. The Seams server writes a short summary of the note, the card
   * shows the note above it, and the author says the summary. The verifier checks that the
   * summary gives the main point of the note.
   */
  note(request: Typed<SpeakToSignNoteRequest, Sent>): Promise<Sent>;
  /** `rate_note` on a notes contract: "this note is helpful". */
  rating(request: Typed<SpeakToSignRatingRequest, Sent>): Promise<Sent>;
  /** `approve_merge` on a merge-approval contract: "merge pull request 42 into main". */
  mergeApproval(request: Typed<SpeakToSignMergeApprovalRequest, Sent>): Promise<Sent>;
  /**
   * A bet on a prediction market: "bet zero point five usdc yes on market nine". The Wallet
   * sends the stake with the token's `ft_transfer_call`, with the signed verdict in `msg`.
   */
  bet(request: Typed<SpeakToSignBetRequest, Sent>): Promise<Sent>;
  /**
   * Enrolls the owner's voice with the verifier: the owner reads three phrases aloud, signs one
   * message that authorizes exactly these recordings, and the verifier stores the template. A
   * new enrollment replaces the template. `autoStart: true` records each phrase when its card
   * opens (default: false).
   */
  enroll(
    request?: Typed<{ walletId: string }, SpeakToSignEnrollmentResult>,
  ): Promise<SpeakToSignEnrollmentResult>;
  /**
   * Prepares the next spoken request, before the owner asks for it: call it when your form with
   * the request is on the screen. The Wallet loads its Speak-to-Sign code, and for `note` it
   * asks the Seams server for the note's summary and keeps it for some minutes. The request
   * that follows then shows its card about 1 to 3 s sooner. The call shows no card, records
   * nothing and signs nothing. Call it again when the note's text changes. A failure is not an
   * error of your flow: the request that follows does the same steps itself.
   */
  prepare(request?: SpokenPrepareRequest): Promise<SpeakToSignPrepareResult>;
}>;

/** What `seams.near.spoken.prepare` takes: the wallet session, and the note to summarize. */
export type SpokenPrepareRequest = Readonly<{
  walletSession?: WalletSessionInput;
  /** The note of the `spoken.note` call that follows. */
  note?: Readonly<{ text: string }>;
}>;

/** `seams.near`: the NEAR signer, its calls with `approval`, and `spoken` when it is enabled. */
// The spoken overloads come first: a call with `approval` then gets its own types for its
// callbacks, and `Parameters<...>` of a call still names the normal arguments.
export type NearCapability = SpokenNearSigner &
  NearSignerCapability &
  Readonly<{ spoken?: SpokenCalls }>;

const NOT_ENABLED =
  'Approval by voice is not enabled: add spoken({ network }) to `approvals` in the SDK configuration.';

type AnyArgs = Readonly<Record<string, unknown>>;

/**
 * Adds approval by voice to the NEAR signer. A call with `approval` goes to the spoken flow of
 * the Wallet; a call without it goes to the signer unchanged. `voice` is null when the
 * configuration does not hold the descriptor: a call with `approval` then throws.
 */
export function withSpokenApprovals(
  near: NearSignerCapability,
  voice: SpeakToSignCapability | null,
  currentWallet: Pick<CurrentWalletResolver, 'walletSession'>,
): NearCapability {
  /** The internal request: the wallet id, the surface of the call and the given fields. */
  const request = async (args: AnyArgs, fields: AnyArgs) => {
    const session = await currentWallet.walletSession(args.walletSession as WalletSessionInput);
    return {
      ...fields,
      walletId: String(session.walletId),
      ...(args.steps === undefined
        ? args.presentation === undefined
          ? {}
          : { presentation: args.presentation }
        : { steps: args.steps }),
    };
  };
  /** A general call: the summary, the progress listener and `autoStart` come from `approval`. */
  const general = async (args: AnyArgs, fields: AnyArgs) => {
    const approval = args.approval as SpokenApproval;
    return await request(args, {
      ...fields,
      summary: approval.summary,
      ...(approval.onProgress ? { onProgress: approval.onProgress } : {}),
      ...(approval.autoStart === undefined ? {} : { autoStart: approval.autoStart }),
    });
  };
  /** A typed call: every field of the request but the subject and the surface. */
  const typed = async (args: AnyArgs) => {
    const { walletSession: _subject, presentation: _presentation, steps: _steps, ...fields } = args;
    return await request(args, fields);
  };
  const enabled = (): SpeakToSignCapability => {
    if (!voice) throw new Error(NOT_ENABLED);
    return voice;
  };
  const asked = (args: unknown): args is AnyArgs =>
    typeof args === 'object' && args !== null && 'approval' in args && args.approval !== undefined;

  const signer = {
    ...near,
    async signAndSendTransaction(args: unknown) {
      if (!asked(args)) return await near.signAndSendTransaction(args as never);
      const transaction = { receiverId: args.receiverId, actions: args.actions };
      return await enabled().signAndSendTransaction(
        (await general(args, { transaction })) as never,
      );
    },
    async signTransaction(args: unknown) {
      if (!asked(args)) return await near.signTransaction(args as never);
      return await enabled().signTransaction(
        (await general(args, { transaction: args.transaction })) as never,
      );
    },
    async signDelegateAction(args: unknown) {
      if (!asked(args)) return await near.signDelegateAction(args as never);
      const { senderId: _sender, ...delegate } = args.delegate as DelegateActionInput;
      return await enabled().signDelegateAction((await general(args, { delegate })) as never);
    },
    async signMessage(args: unknown) {
      if (!asked(args)) return await near.signMessage(args as never);
      const { message, recipient, callbackUrl, state } = args.params as SignNEP413MessageParams;
      return await enabled().signMessage(
        (await general(args, {
          message,
          recipient,
          ...(callbackUrl === undefined ? {} : { callbackUrl }),
          ...(state === undefined ? {} : { state }),
        })) as never,
      );
    },
  };
  if (!voice) return signer as NearCapability;
  const spoken: SpokenCalls = {
    network: voice.network,
    transfer: async (args) => await voice.typed.transfer((await typed(args)) as never),
    note: async (args) => await voice.typed.note((await typed(args)) as never),
    rating: async (args) => await voice.typed.rating((await typed(args)) as never),
    mergeApproval: async (args) => await voice.typed.mergeApproval((await typed(args)) as never),
    bet: async (args) => await voice.typed.bet((await typed(args)) as never),
    enroll: async (args = {}) => await voice.enroll((await typed(args)) as never),
    prepare: async (args = {}) => {
      const session = await currentWallet.walletSession(args.walletSession);
      return await voice.prepare({
        walletId: String(session.walletId),
        ...(args.note === undefined ? {} : { note: { text: args.note.text } }),
      });
    },
  };
  return { ...signer, spoken } as NearCapability;
}

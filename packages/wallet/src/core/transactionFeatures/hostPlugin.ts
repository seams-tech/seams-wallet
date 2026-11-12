import type {
  AuthMethodPhraseRequest,
  PhraseChoice,
  PhraseView,
} from '@/core/authMethods/hostPlugin';
import type { ActionArgs, TransactionInput } from '@/core/types/actions';
import type { SignDelegateActionResult, SignTransactionResult } from '@/core/types/seams';
import type { UiConfirmSurfaceMeasurementBinding } from '@/core/signingEngine/uiConfirm/uiConfirm.types';
import type { WalletId } from '@shared/utils/domainIds';
import type { Variant } from '@shared/utils/variant';
import type { SpokenMessageAction } from './spokenMessage';
import type { SpeakToSignNetwork } from './plugins';
import type { BetOutcome } from './spokenBet';
import type { NoteRating, SpokenNoteAction } from './spokenNote';
import type { VerifierRefusal, VoiceApproval } from './voiceVerdict';

export type SpeakToSignUnavailableReason =
  /** The Wallet route supplied no transfer, so the host plugin cannot start one. */
  | 'flow_not_available'
  /** The wallet has no enabled VoiceID enrollment, so the verifier has no voice to compare. */
  | 'voiceid_unavailable'
  /** The network has no pinned verifier, or the Seams verify route did not answer usefully. */
  | 'verifier_unavailable'
  /** The Seams server did not write the summary of a community note. Nothing was recorded. */
  | 'summary_unavailable'
  /** The Wallet did not send the transaction. Nothing was paid. */
  | 'not_submitted'
  /** The transaction may have been sent. Check it before another payment. */
  | 'submission_unknown';

/**
 * Refusals of the Seams co-signer, which checks the verdict again before it adds its part of
 * the signature. `detail` names its reason (`CosignerVoiceRefusal`). Nothing was signed.
 */
type SpeakToSignCosignerRefusalReason =
  /** For example a verdict that the co-signer already accepted for another request. */
  'cosigner_refused';

/** Refusals from the verifier, the verdict check in Wallet core, the co-signer and the chain. */
export type SpeakToSignRefusalReason =
  | SpeakToSignCosignerRefusalReason
  | VerifierRefusal
  /** The amount is not a whole number of hundredths of NEAR from 0.01 to 1,000,000. */
  | 'amount_not_speakable'
  /** The receiver is not a named NEAR account that the sentence can say (an implicit one). */
  | 'receiver_not_speakable'
  /** The receiver account does not exist on the feature's network. */
  | 'receiver_missing'
  /** The verdict signature, key, digests, expiry or kind did not match this request. */
  | 'verdict_mismatch'
  /** The transfer was sent and failed on chain, for example for too small a balance. */
  | 'transaction_failed';

/** Milliseconds of each stage. `endOfSpeechToReceiptMs` is the latency budget of the flow. */
export type SpeakToSignTransferTimes = Readonly<{
  speechMs: number;
  /** The Seams verify route, which runs the verifier. */
  verifyMs: number;
  /** The verdict check, the signature and the transfer up to its receipt. */
  transactionMs: number;
  endOfSpeechToReceiptMs: number;
}>;

/** The result of one spoken request whose refusals are `Reason`. */
type SpokenResult<Reason extends string> =
  | Readonly<{
      kind: 'sent';
      transactionHash: string;
      /** `voice_and_passkey` when a policy rule asked for a passkey after the voice. */
      approval: VoiceApproval;
      times: SpeakToSignTransferTimes;
    }>
  | SpokenFailure<Reason>;

/** A spoken request that signed nothing, or whose transaction failed. */
type SpokenFailure<Reason extends string> =
  | Readonly<{ kind: 'refused'; reason: Reason; detail?: string }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'unavailable'; reason: SpeakToSignUnavailableReason; detail?: string }>;

export type SpeakToSignTransferResult = SpokenResult<SpeakToSignRefusalReason>;

/** Refusals of a spoken note, rating, merge approval, market bet or general transaction. */
export type SpeakToSignNoteRefusalReason =
  | VerifierRefusal
  | SpeakToSignCosignerRefusalReason
  /** The summary is not 1 to 12 plain words of ASCII letters (see `summaryRefusal`). */
  | 'summary_not_speakable'
  /** The contract, the id, the note text (1 to 280 characters) or the rating is not valid. */
  | 'note_not_valid'
  /** The contract, pull request, repository, base branch or head commit is not valid. */
  | 'merge_not_valid'
  /**
   * The market contract, the market id, the outcome or the amount is not valid, or the token is
   * not the USDC contract of the network.
   */
  | 'bet_not_valid'
  /** The receiver is not a NEAR account, the transaction has no action, or a delegate field is not valid. */
  | 'transaction_not_valid'
  | 'verdict_mismatch'
  /** The call was sent and failed on chain, for example for an unknown note or a closed market. */
  | 'transaction_failed';

export type SpeakToSignNoteResult = SpokenResult<SpeakToSignNoteRefusalReason>;

/** A transaction that the Wallet signed and did not send, as `near.signTransaction` returns it. */
export type SpeakToSignSignedTransactionResult =
  | Readonly<{
      kind: 'signed_transaction';
      signed: SignTransactionResult;
      approval: VoiceApproval;
      times: SpeakToSignTransferTimes;
    }>
  | SpokenFailure<SpeakToSignNoteRefusalReason>;

/** A NEP-366 delegate action that the Wallet signed, as `near.signDelegateAction` returns it. */
export type SpeakToSignSignedDelegateResult =
  | Readonly<{
      kind: 'signed_delegate';
      signed: SignDelegateActionResult;
      approval: VoiceApproval;
      times: SpeakToSignTransferTimes;
    }>
  | SpokenFailure<SpeakToSignNoteRefusalReason>;

/** What the host plugin returns for one note action, by the kind and delivery of the action. */
export type SpeakToSignNoteActionResult =
  | SpeakToSignNoteResult
  | SpeakToSignSignedTransactionResult
  | SpeakToSignSignedDelegateResult;

/** One spoken payment from the app. The Wallet iframe reads the owner itself. */
/**
 * The progress of one spoken request, in order. The verifier sends its result only at the end,
 * so there is no event between `verifier_running` and `verdict`.
 */
export type SpeakToSignProgress =
  /** The Wallet sent the recording and the request to the Seams verify route. */
  | Readonly<{ stage: 'recording_sent' }>
  /** The Seams server called the verifier. */
  | Readonly<{ stage: 'verifier_running' }>
  /** The verifier answered. `ms` holds its stage times, such as `speaker` and `transcribe`. */
  | Readonly<{ stage: 'verdict'; ms: Readonly<Record<string, number>> }>
  /** A policy rule asks the owner for a fresh approval. `policyText` is the rule's sentence. */
  | Readonly<{ stage: 'step_up'; policyText: string | null }>
  /** The signed transaction left for the network. */
  | Readonly<{ stage: 'transaction_sent' }>
  /** NEAR returned the final outcome of the transaction. */
  | Readonly<{ stage: 'settled'; transactionHash: string }>;

/**
 * Whether the VoiceID card starts its recording when it opens, with no press on Record. If the
 * browser does not start audio without a press, the card keeps its Record button.
 */
type WithAutoStart = Readonly<{
  /** Default: true for a spoken request, false for an enrollment. */
  autoStart?: boolean;
}>;

/** Spoken requests take an optional progress listener, which runs in the app, and `autoStart`. */
type SpokenRequestOptions = Readonly<{
  onProgress?: (progress: SpeakToSignProgress) => void;
}> &
  WithAutoStart;

export type SpeakToSignTransferRequest = Readonly<{
  walletId: string;
  /** A named NEAR account that the owner says, such as `"bob.testnet"`. Not only a contact. */
  receiver: string;
  /** Decimal NEAR, such as `"2.5"`. */
  amount: string;
}> &
  SpokenRequestOptions;

/**
 * One spoken community note from the app. The Seams server writes a summary of 1 to 12 plain
 * words from the note, and the author says only the summary. The app gives no summary, so it
 * cannot choose the words; the verifier checks that the summary fits the note.
 */
export type SpeakToSignNoteRequest = Readonly<{
  walletId: string;
  /** The notes contract, a named NEAR account. */
  contract: string;
  /** A whole number from 0 to `Number.MAX_SAFE_INTEGER`. */
  postId: number;
  /** The note, 1 to 280 characters. */
  text: string;
}> &
  SpokenRequestOptions;

/** One spoken rating of a community note from the app. */
export type SpeakToSignRatingRequest = Readonly<{
  walletId: string;
  contract: string;
  /** A whole number from 0 to `Number.MAX_SAFE_INTEGER`. */
  noteId: number;
  rating: NoteRating;
}> &
  SpokenRequestOptions;

/** One spoken approval to merge a pull request. The owner says its number and its base only. */
export type SpeakToSignMergeApprovalRequest = Readonly<{
  walletId: string;
  /** The merge-approval contract, a named NEAR account. */
  contract: string;
  /** `owner/name`, such as `seams-tech/seams-wallet`. */
  repo: string;
  /** A whole number from 1 to `Number.MAX_SAFE_INTEGER`. */
  pullRequest: number;
  /** The base branch, 1 to 32 lowercase letters, such as `main`. */
  base: string;
  /** The head commit, 40 lowercase hex characters. */
  headCommit: string;
}> &
  SpokenRequestOptions;

/**
 * One spoken bet on a prediction market. The owner says the amount, the outcome and the market
 * id: "bet zero point five usdc yes on market nine".
 */
export type SpeakToSignBetRequest = Readonly<{
  walletId: string;
  /** The market contract, a named NEAR account. */
  contract: string;
  /** The token of the stake. Only the USDC contract of the network is accepted. */
  token: string;
  /** A whole number from 1 to `Number.MAX_SAFE_INTEGER`. */
  marketId: number;
  outcome: BetOutcome;
  /** Decimal USDC with at most two decimals, such as `"0.5"`, from 0.01 to 1,000,000. */
  amount: string;
}> &
  SpokenRequestOptions;

/**
 * One spoken transaction of any kind: any receiver and any actions, as `signAndSendTransaction`
 * takes them. The owner says the summary only, and the verdict binds the receiver and the
 * actions. The application writes the summary, so the voice proves who approves, not that the
 * summary describes the transaction.
 */
export type SpeakToSignTransactionRequest = Readonly<{
  walletId: string;
  transaction: TransactionInput;
  /** 1 to 12 plain words that the owner reads aloud. See `summaryRefusal`. */
  summary: string;
}> &
  SpokenRequestOptions;

/**
 * One spoken NEP-366 delegate action, as `near.signDelegateAction` takes it: a relayer sends
 * the actions for the owner. The owner says the summary only. The Wallet reads the sender
 * itself.
 */
export type SpeakToSignDelegateRequest = Readonly<{
  walletId: string;
  delegate: Readonly<{
    receiverId: string;
    actions: ActionArgs[];
    nonce: bigint | string | number;
    maxBlockHeight: bigint | string | number;
    /** `ed25519:<base58>`: the access key of the owner that signs. */
    publicKey: string;
  }>;
  /** 1 to 12 plain words that the owner reads aloud. See `summaryRefusal`. */
  summary: string;
}> &
  SpokenRequestOptions;

/**
 * One spoken NEP-413 message, as `near.signMessage` takes it. The owner says the summary only,
 * and the verdict binds the exact message, nonce, recipient and callback URL. The Wallet draws
 * the nonce.
 */
export type SpeakToSignMessageRequest = Readonly<{
  walletId: string;
  message: string;
  recipient: string;
  callbackUrl?: string;
  /** The application's own value, which the result returns. It is not signed. */
  state?: string;
  /** 1 to 12 plain words that the owner reads aloud. See `summaryRefusal`. */
  summary: string;
}> &
  SpokenRequestOptions;

/** A NEP-413 signature by the key of the owner's account. */
export type SpeakToSignSignedMessage = Readonly<{
  accountId: string;
  /** `ed25519:<base58>`. */
  publicKey: string;
  /** base64 of the 64-byte signature. */
  signature: string;
  /** base64 of the 32-byte nonce that the Wallet drew. */
  nonce: string;
  state?: string;
}>;

/** Refusals of a spoken message. */
export type SpeakToSignMessageRefusalReason =
  | VerifierRefusal
  | SpeakToSignCosignerRefusalReason
  | 'summary_not_speakable'
  /** The message or the recipient is empty. */
  | 'message_not_valid'
  | 'verdict_mismatch';

export type SpeakToSignMessageResult =
  | (Readonly<{ kind: 'signed'; approval: VoiceApproval; times: SpeakToSignTransferTimes }> &
      SpeakToSignSignedMessage)
  | Readonly<{ kind: 'refused'; reason: SpeakToSignMessageRefusalReason; detail?: string }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'unavailable'; reason: SpeakToSignUnavailableReason; detail?: string }>;

/**
 * One verifier enrollment from the app. The Wallet iframe reads the owner itself. With
 * `autoStart`, each phrase card records when it opens. A wallet without VoiceID first sets up
 * VoiceID, and its cards still wait for a press on each sample.
 */
export type SpeakToSignEnrollmentRequest = Readonly<{ walletId: string }> & WithAutoStart;

/** Refusals of an enrollment by the verifier. The verifier stored no template. */
export type SpeakToSignEnrollmentRefusalReason =
  | 'quality'
  /** The three recordings do not sound like one speaker. */
  | 'speaker'
  | 'audio_reused'
  | 'audio_invalid'
  | 'unsupported'
  | 'speaker_unavailable'
  | 'storage'
  /** Another enrollment of this owner changed the template at the same time. */
  | 'template_exists'
  /** The signed message is not from a full-access key of the owner, or is for other audio. */
  | 'not_authorized'
  /** The verifier could not read the owner's access key over NEAR RPC. */
  | 'authorization_unavailable';

export type SpeakToSignEnrollmentResult =
  | Readonly<{
      kind: 'enrolled';
      /** 1 for the first enrollment, then 1 more for each new enrollment. */
      templateEpoch: number;
      /** The lowest pairwise speaker score of the three recordings, in thousandths. */
      agreementMilli: number;
    }>
  | Readonly<{ kind: 'refused'; reason: SpeakToSignEnrollmentRefusalReason; detail?: string }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'unavailable'; reason: SpeakToSignUnavailableReason; detail?: string }>;

/**
 * The verifier's answer through the Seams server. `attestationUrl` is the public OutLayer record
 * of the call, with its TDX quote, or null when OutLayer gave none.
 */
export type SpeakToSignVerifyReply =
  | Readonly<{ kind: 'output'; output: unknown; attestationUrl: string | null }>
  | SpeakToSignServerFailure;

/** A Seams server route that did not answer: its fixed code, or the HTTP status. */
type SpeakToSignServerFailure = Readonly<{ kind: 'failed'; code: string }>;

/** The summary of a community note that the Seams server wrote, or why there is none. */
export type SpeakToSignNoteSummary =
  | Readonly<{ kind: 'summary'; summary: string }>
  | SpeakToSignServerFailure;

/** A transfer that Wallet core paid, or why it paid nothing. */
export type SpeakToSignPayment =
  | Readonly<{ kind: 'executed'; transactionHash: string; approval: VoiceApproval }>
  | Readonly<{ kind: 'reverted'; transactionHash: string; error: string }>
  | Readonly<{ kind: 'not_submitted'; error: string }>
  | Readonly<{ kind: 'submission_unknown'; error: string }>
  | Readonly<{
      kind: 'refused';
      reason: VerifierRefusal | 'verdict_mismatch' | SpeakToSignCosignerRefusalReason;
      detail?: string;
    }>
  /** The owner closed the step-up question. Nothing was signed. */
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'unavailable'; detail: string }>;

/** What core did for one note action: a payment, or a signature that core did not send. */
export type SpeakToSignNoteSigning =
  | SpeakToSignPayment
  /** Core signed the transaction and did not send it. */
  | Readonly<{ kind: 'signed_transaction'; signed: SignTransactionResult; approval: VoiceApproval }>
  /** Core signed the delegate action. A relayer sends it. */
  | Readonly<{ kind: 'signed_delegate'; signed: SignDelegateActionResult; approval: VoiceApproval }>;

/** A message that Wallet core signed, or why it signed nothing. */
export type SpeakToSignMessageSigning =
  | (Readonly<{ kind: 'signed'; approval: VoiceApproval }> & SpeakToSignSignedMessage)
  | Readonly<{ kind: 'not_signed'; error: string }>
  | Variant<SpeakToSignPayment, 'kind', 'refused' | 'cancelled' | 'unavailable'>;

/** What the payment tells the open prompt, so the card follows it. */
export type SpeakToSignPaymentHooks = Readonly<{
  /** The verdict passed and asks for nothing more. Core signs next. */
  accepted(): void;
  /**
   * A policy rule asks for a fresh approval. Resolves true when the owner asks to approve; core
   * then asks for the session's own method. `policyText` is the rule's sentence, if any.
   */
  approveStepUp(policyText: string | null): Promise<boolean>;
  /** The signed transaction is on its way to the network. */
  broadcasting(): void;
  /**
   * A block holds the plain transfer, before its receipt runs: NEAR has checked its signature,
   * nonce and balance, so the card can show it as sent. The payment result still waits for the
   * outcome. Never called for a contract call.
   */
  included(transactionHash: string): void;
}>;

/** The verifier's `enroll` authorization: a NEP-413 signature by a full-access key of the owner. */
export type SpeakToSignEnrollmentAuthorization =
  | Readonly<{
      kind: 'signed';
      authorization: Readonly<{ public_key: string; signature_b64: string; nonce_b64: string }>;
    }>
  | Readonly<{ kind: 'not_signed'; error: string }>;

/** A recorded sentence: a 16 kHz mono PCM16 WAV of at most 8 s, as the verifier hashes it. */
export type SpeakToSignClip =
  | Readonly<{
      kind: 'captured';
      wav: Uint8Array<ArrayBuffer>;
      speechMs: number;
      /**
       * `performance.now()` of the last voiced frame: the owner stopped speaking then, before the
       * pause that ends the recording.
       */
      endOfSpeechAt: number;
    }>
  | Readonly<{ kind: 'cancelled' }>
  /** VoiceID could not load or record on this Wallet host. */
  | Readonly<{ kind: 'unavailable'; detail: string }>;

export type SpeakToSignClipRequest = Readonly<{
  /** The sentence that the VoiceID surface shows. */
  sentence: string;
  /** The text that the sentence speaks for, such as a note, shown above it. */
  context?: AuthMethodPhraseRequest['context'];
  /** The first recording starts with no press on Record, where the browser allows it. */
  autoStart: boolean;
  signal: AbortSignal;
  surfaceMeasurementBinding: UiConfirmSurfaceMeasurementBinding;
}>;

/** The VoiceID surface of one sentence. It stays open for the check and the result. */
export type SpeakToSignPrompt = Readonly<{
  /** Records one clip. A later call shows the sentence again and records a new clip. */
  record(): Promise<SpeakToSignClip>;
  show(view: PhraseView): Promise<PhraseChoice>;
  close(): void;
}>;

export type SpeakToSignPromptResult =
  | Readonly<{ kind: 'opened'; prompt: SpeakToSignPrompt }>
  /** VoiceID could not load on this Wallet host. */
  | Readonly<{ kind: 'unavailable'; detail: string }>;

/**
 * Core's own operations for one spoken request or one enrollment. They are internal to the
 * Wallet: the host plugin never gets them. It gets `SpeakToSignApprovalOperations` or
 * `SpeakToSignEnrollmentOperations`, which core binds to the request (`./hostApproval`).
 */
export type SpeakToSignHostOperations = Readonly<{
  openPrompt(request: SpeakToSignClipRequest): Promise<SpeakToSignPromptResult>;
  /** True if the account exists on the feature's network. */
  receiverExists(accountId: string, signal: AbortSignal): Promise<boolean>;
  verify(
    input: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<SpeakToSignVerifyReply>;
  /** Asks the Seams server for the spoken summary of a community note. */
  summarizeNote(text: string, signal: AbortSignal): Promise<SpeakToSignNoteSummary>;
  /**
   * Checks the verifier output against this transfer and, on an approved verdict, signs and
   * sends it from the owner's account. An `accept` verdict shows no confirm; a `step_up`
   * verdict asks for a fresh approval with the session's own method. Each verdict pays once.
   */
  payWithVerdict(
    transfer: Readonly<{ receiver: string; amountYocto: bigint }>,
    verifierOutput: unknown,
    signal: AbortSignal,
    hooks: SpeakToSignPaymentHooks,
  ): Promise<SpeakToSignPayment>;
  /**
   * Checks the verifier output against this note, rating, merge approval or bet and, on an
   * approved verdict, signs and sends its one call from the owner's account, as `payWithVerdict`
   * does for a transfer. A note, rating or merge call has no deposit. A bet is the token's
   * `ft_transfer_call` with the verdict. The Wallet sets no amount limit for a bet. A general
   * transaction is signed as the application gave it.
   */
  signNoteWithVerdict(
    action: SpokenNoteAction,
    verifierOutput: unknown,
    signal: AbortSignal,
    hooks: SpeakToSignPaymentHooks,
  ): Promise<SpeakToSignNoteSigning>;
  /**
   * Checks the verifier output against this message and, on an accepted verdict, signs it with
   * the key of the owner's account, with no confirm. Each verdict signs once.
   */
  signMessageWithVerdict(
    action: SpokenMessageAction,
    verifierOutput: unknown,
    signal: AbortSignal,
    hooks: SpeakToSignPaymentHooks,
  ): Promise<SpeakToSignMessageSigning>;
  /** Signs the enrollment message for three clips that core recorded in this flow. */
  authorizeEnrollment(
    clips: readonly Uint8Array<ArrayBuffer>[],
    signal: AbortSignal,
  ): Promise<SpeakToSignEnrollmentAuthorization>;
}>;

/** What core signed for one spoken request, or why it signed nothing. */
export type SpeakToSignSigning = SpeakToSignNoteSigning | SpeakToSignMessageSigning;

/** What the host plugin returns for one spoken request, by its kind and delivery. */
export type SpeakToSignApprovalResult =
  | SpeakToSignTransferResult
  | SpeakToSignNoteActionResult
  | SpeakToSignMessageResult;

/**
 * A recording that core holds for the plugin. It has no bytes and no digest: core keeps the
 * audio of each handle of this flow. A handle that the plugin makes, or a handle of another
 * flow, names no recording.
 */
export type SpeakToSignClipHandle = Readonly<{
  kind: 'captured';
  speechMs: number;
  /**
   * `performance.now()` of the last voiced frame: the owner stopped speaking then, before the
   * pause that ends the recording.
   */
  endOfSpeechAt: number;
}>;

export type SpeakToSignRecording =
  | SpeakToSignClipHandle
  | Readonly<{ kind: 'cancelled' }>
  /** VoiceID could not record on this Wallet host. */
  | Readonly<{ kind: 'unavailable'; detail: string }>;

/**
 * The request as the plugin sees it: texts for the card. It cannot change what core signs. The
 * plugin passes no intent, no sentence and no verifier input back to core.
 */
export type SpeakToSignRequestView = Readonly<{
  kind:
    | 'account_transfer'
    | 'community_note'
    | 'note_rating'
    | 'merge_approval'
    | 'market_bet'
    | 'transaction'
    | 'signed_message';
  /** What core does with the signature: it sends a transaction, or it returns a signature. */
  form: 'send' | 'sign' | 'delegate' | 'message';
  /** The sentence on the card, which core shows. */
  displayText: string;
  /** The words that the owner says. */
  spokenText: string;
  /** The receiver of a transfer or a transaction, or the recipient of a message. */
  counterparty: string | null;
  /** The decimal NEAR of a transfer, such as `"2.5"`. */
  amount: string | null;
  /** The summary of a community note. */
  summary: string | null;
}>;

/**
 * The operations of one spoken request. Core bound the owner, the sentence and the thing to
 * sign before it made them, so no operation takes one. They stop when `approve` settles.
 */
export type SpeakToSignApprovalOperations = Readonly<{
  /** Records one clip of the sentence on the card. Core keeps the audio. */
  record(): Promise<SpeakToSignRecording>;
  /**
   * Sends the clip, sealed, with the request of this flow to the Seams verify route. A handle
   * verifies once: core clears its audio.
   */
  verify(clip: SpeakToSignClipHandle): Promise<SpeakToSignVerifyReply>;
  /**
   * Checks the verifier output against the request of this flow and, on an approved verdict,
   * signs it. An `accept` verdict shows no confirm; a `step_up` verdict asks for a fresh
   * approval with the session's own method. One flow signs once.
   */
  sign(verifierOutput: unknown, hooks: SpeakToSignPaymentHooks): Promise<SpeakToSignSigning>;
}>;

/** The card of the request, which core opened with its sentence. Core closes it. */
export type SpeakToSignSurface = Readonly<{
  show(view: PhraseView): Promise<PhraseChoice>;
}>;

/** One spoken request that the Wallet route asks the host plugin to run. */
export type SpeakToSignHostApproval = Readonly<{
  walletId: WalletId;
  network: SpeakToSignNetwork;
  /** Aborted when the application cancels the request. Core checks its own copy. */
  signal: AbortSignal;
  ownerAccountId: string;
  request: SpeakToSignRequestView;
  surface: SpeakToSignSurface;
  operations: SpeakToSignApprovalOperations;
}>;

/** What `enrollClips` returns: the verifier's reply, or why the owner signed no authorization. */
export type SpeakToSignEnrollmentReply =
  | SpeakToSignVerifyReply
  | Readonly<{ kind: 'not_signed'; error: string }>;

/** The operations of one enrollment. They stop when `enroll` settles. */
export type SpeakToSignEnrollmentOperations = Readonly<{
  /**
   * Opens the card of enrollment phrase `index` (0 to `phraseCount` - 1) and records it. The
   * card stays open until the next `record` or the end of the enrollment.
   */
  record(index: number): Promise<SpeakToSignRecording>;
  /** Shows a view on the open card. */
  show(view: PhraseView): Promise<PhraseChoice>;
  /**
   * Has the owner sign one authorization for exactly these clips of this flow, then sends them,
   * sealed, to the verifier. `onAuthorized` runs when the owner signed.
   */
  enrollClips(
    clips: readonly SpeakToSignClipHandle[],
    onAuthorized: () => void,
  ): Promise<SpeakToSignEnrollmentReply>;
}>;

/** One enrollment that the Wallet route asks the host plugin to run. */
export type SpeakToSignHostEnrollment = Readonly<{
  walletId: WalletId;
  network: SpeakToSignNetwork;
  signal: AbortSignal;
  ownerAccountId: string;
  /** The verifier needs exactly this many recordings. */
  phraseCount: number;
  /**
   * The samples of the VoiceID enrollment that this flow made just before, or null. With them,
   * the plugin enrolls these clips and records nothing. Their card is open.
   */
  clips: readonly SpeakToSignClipHandle[] | null;
  operations: SpeakToSignEnrollmentOperations;
}>;

/** A clip that this flow already recorded: the verifier's WAV and the sentence the owner read. */
export type SpeakToSignEnrollmentRecording = Readonly<{
  wav: Uint8Array<ArrayBuffer>;
  sentence: string;
}>;

/**
 * The approver of Speak-to-Sign: the flow on the card. It is a part of the Wallet
 * (`./approver`) that loads on first use, so one build has both sides of this contract and no
 * version check is necessary. It runs in the trusted Wallet host, never in the embedding app.
 */
export interface SpeakToSignHostPlugin {
  /**
   * Runs one spoken request on its card: records, verifies and hands the verifier output to
   * core, which checks it and signs. The plugin draws the check and the result.
   */
  approve(input: SpeakToSignHostApproval): Promise<SpeakToSignApprovalResult>;
  /**
   * Records the enrollment phrases (or takes the given clips) and asks core to authorize and
   * send them, so that the verifier stores the owner's voice template.
   */
  enroll(input: SpeakToSignHostEnrollment): Promise<SpeakToSignEnrollmentResult>;
}

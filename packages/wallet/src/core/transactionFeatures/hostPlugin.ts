import type { PhraseChoice, PhraseView } from '@/core/authMethods/hostPlugin';
import type { UiConfirmSurfaceMeasurementBinding } from '@/core/signingEngine/uiConfirm/uiConfirm.types';
import type { WalletId } from '@shared/utils/domainIds';
import type { SpeakToSignNetwork } from './plugins';
import type { BetOutcome } from './spokenBet';
import type { NoteRating, SpokenNoteAction } from './spokenNote';
import type { VerifierRefusal, VoiceApproval } from './voiceVerdict';

/** Wallet and `@seams/speak-to-sign` must use the same value. It is separate from VoiceID's. */
export const SPEAK_TO_SIGN_HOST_API_VERSION = 10;

export type SpeakToSignUnavailableReason =
  /** The Wallet route supplied no transfer, so the host plugin cannot start one. */
  | 'flow_not_available'
  /** The wallet has no enabled VoiceID enrollment, so the verifier has no voice to compare. */
  | 'voiceid_unavailable'
  /** The network has no pinned verifier, or the Seams verify route did not answer usefully. */
  | 'verifier_unavailable'
  /** The Wallet did not send the transaction. Nothing was paid. */
  | 'not_submitted'
  /** The transaction may have been sent. Check it before another payment. */
  | 'submission_unknown';

/**
 * Refusals of the Seams co-signer, which checks the verdict again before it adds its part of
 * the signature. `detail` names its reason (`CosignerVoiceRefusal`). Nothing was signed.
 */
type SpeakToSignCosignerRefusalReason =
  /** The payment is over the voice limit for one payment or for 24 hours. */
  | 'voice_limit'
  /** Another refusal of the co-signer, for example a verdict that it already accepted. */
  | 'cosigner_refused';

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
  | Readonly<{ kind: 'refused'; reason: Reason; detail?: string }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'unavailable'; reason: SpeakToSignUnavailableReason; detail?: string }>;

export type SpeakToSignTransferResult = SpokenResult<SpeakToSignRefusalReason>;

/** Refusals of a spoken community note, note rating, merge approval or market bet. */
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
  | 'verdict_mismatch'
  /** The call was sent and failed on chain, for example for an unknown note or a closed market. */
  | 'transaction_failed';

export type SpeakToSignNoteResult = SpokenResult<SpeakToSignNoteRefusalReason>;

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

/** Spoken requests take an optional progress listener. It runs in the app. */
type WithProgress = Readonly<{ onProgress?: (progress: SpeakToSignProgress) => void }>;

export type SpeakToSignTransferRequest = Readonly<{
  walletId: string;
  /** A named NEAR account that the owner says, such as `"bob.testnet"`. Not only a contact. */
  receiver: string;
  /** Decimal NEAR, such as `"2.5"`. */
  amount: string;
}> &
  WithProgress;

/** One spoken community note from the app. The author says only the summary. */
export type SpeakToSignNoteRequest = Readonly<{
  walletId: string;
  /** The notes contract, a named NEAR account. */
  contract: string;
  /** A whole number from 0 to `Number.MAX_SAFE_INTEGER`. */
  postId: number;
  /** The note, 1 to 280 characters. */
  text: string;
  /** 1 to 12 plain words that the author reads aloud. */
  summary: string;
}> &
  WithProgress;

/** One spoken rating of a community note from the app. */
export type SpeakToSignRatingRequest = Readonly<{
  walletId: string;
  contract: string;
  /** A whole number from 0 to `Number.MAX_SAFE_INTEGER`. */
  noteId: number;
  rating: NoteRating;
}> &
  WithProgress;

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
  WithProgress;

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
  WithProgress;

/** One verifier enrollment from the app. The Wallet iframe reads the owner itself. */
export type SpeakToSignEnrollmentRequest = Readonly<{ walletId: string }>;

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

export type SpeakToSignVerifyReply =
  Readonly<{ kind: 'output'; output: unknown }> | Readonly<{ kind: 'failed'; code: string }>;

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
 * Scoped core operations for one spoken payment or one enrollment. The plugin can record clips
 * on the VoiceID surface, check that a receiver exists and call the Seams verify route. Core
 * itself checks each verdict and builds what it signs: one transfer from the owner, or one
 * enrollment message for clips that core recorded. The plugin gets no signing context, key or
 * session.
 */
export type SpeakToSignHostOperations = Readonly<{
  openPrompt(request: SpeakToSignClipRequest): Promise<SpeakToSignPromptResult>;
  /** True if the account exists on the feature's network. */
  receiverExists(accountId: string, signal: AbortSignal): Promise<boolean>;
  verify(
    input: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<SpeakToSignVerifyReply>;
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
   * `ft_transfer_call` with the verdict; above 10 USDC it asks for a fresh approval first.
   */
  signNoteWithVerdict(
    action: SpokenNoteAction,
    verifierOutput: unknown,
    signal: AbortSignal,
    hooks: SpeakToSignPaymentHooks,
  ): Promise<SpeakToSignPayment>;
  /** Signs the enrollment message for three clips that core recorded in this flow. */
  authorizeEnrollment(
    clips: readonly Uint8Array<ArrayBuffer>[],
    signal: AbortSignal,
  ): Promise<SpeakToSignEnrollmentAuthorization>;
}>;

/** One spoken payment that the Wallet route asks the host plugin to run. */
export type SpeakToSignHostTransfer = Readonly<{
  ownerAccountId: string;
  receiver: string;
  /** Decimal NEAR, such as `"2.5"`. */
  amount: string;
  surfaceMeasurementBinding: UiConfirmSurfaceMeasurementBinding;
  operations: SpeakToSignHostOperations;
}>;

/** One spoken note or rating that the Wallet route asks the host plugin to run. */
export type SpeakToSignHostNote = Readonly<{
  ownerAccountId: string;
  action: SpokenNoteAction;
  surfaceMeasurementBinding: UiConfirmSurfaceMeasurementBinding;
  operations: SpeakToSignHostOperations;
}>;

/** One enrollment that the Wallet route asks the host plugin to run. */
/** A clip that this flow already recorded: the verifier's WAV and the sentence the owner read. */
export type SpeakToSignEnrollmentRecording = Readonly<{
  wav: Uint8Array<ArrayBuffer>;
  sentence: string;
}>;

export type SpeakToSignHostEnrollment = Readonly<{
  walletId: WalletId;
  network: SpeakToSignNetwork;
  signal: AbortSignal;
  ownerAccountId: string;
  surfaceMeasurementBinding: UiConfirmSurfaceMeasurementBinding;
  operations: SpeakToSignHostOperations;
  /**
   * The three samples of the VoiceID enrollment that this flow made just before, or null. With
   * them, the plugin enrolls these clips and records nothing.
   */
  recordings: readonly SpeakToSignEnrollmentRecording[] | null;
}>;

/** Implementations run in the trusted Wallet host, never in the embedding app. */
export interface SpeakToSignHostPlugin {
  /**
   * Records the three enrollment phrases (or takes the given recordings), has the owner sign an
   * authorization for exactly these recordings and asks the verifier to store the owner's voice
   * template.
   */
  enroll(input: SpeakToSignHostEnrollment): Promise<SpeakToSignEnrollmentResult>;
  requestTransfer(input: {
    readonly walletId: WalletId;
    readonly network: SpeakToSignNetwork;
    readonly signal: AbortSignal;
    /** The Wallet route adds the transfer when the app API carries a receiver and an amount. */
    readonly transfer?: SpeakToSignHostTransfer;
  }): Promise<SpeakToSignTransferResult>;
  requestNoteAction(input: {
    readonly walletId: WalletId;
    readonly network: SpeakToSignNetwork;
    readonly signal: AbortSignal;
    readonly note: SpeakToSignHostNote;
  }): Promise<SpeakToSignNoteResult>;
}

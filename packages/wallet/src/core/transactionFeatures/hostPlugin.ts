import type { PhraseChoice, PhraseView } from '@/core/authMethods/hostPlugin';
import type { UiConfirmSurfaceMeasurementBinding } from '@/core/signingEngine/uiConfirm/uiConfirm.types';
import type { WalletId } from '@shared/utils/domainIds';
import type { SpeakToSignNetwork } from './plugins';
import type { VerifierRefusal, VoiceApproval } from './voiceVerdict';

/** Wallet and `@seams/speak-to-sign` must use the same value. It is separate from VoiceID's. */
export const SPEAK_TO_SIGN_HOST_API_VERSION = 5;

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

/** Refusals from the verifier, the verdict check in Wallet core and the chain. */
export type SpeakToSignRefusalReason =
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

export type SpeakToSignTransferResult =
  | Readonly<{
      kind: 'sent';
      transactionHash: string;
      /** `voice_and_passkey` when a policy rule asked for a passkey after the voice. */
      approval: VoiceApproval;
      times: SpeakToSignTransferTimes;
    }>
  | Readonly<{ kind: 'refused'; reason: SpeakToSignRefusalReason; detail?: string }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'unavailable'; reason: SpeakToSignUnavailableReason; detail?: string }>;

/** One spoken payment from the app. The Wallet iframe reads the owner itself. */
export type SpeakToSignTransferRequest = Readonly<{
  walletId: string;
  /** A named NEAR account that the owner says, such as `"bob.testnet"`. Not only a contact. */
  receiver: string;
  /** Decimal NEAR, such as `"2.5"`. */
  amount: string;
}>;

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
  | Readonly<{ kind: 'refused'; reason: VerifierRefusal | 'verdict_mismatch'; detail?: string }>
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
      /** `performance.now()` when the recorder handed over the trimmed clip. */
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

/** One enrollment that the Wallet route asks the host plugin to run. */
export type SpeakToSignHostEnrollment = Readonly<{
  walletId: WalletId;
  network: SpeakToSignNetwork;
  signal: AbortSignal;
  ownerAccountId: string;
  surfaceMeasurementBinding: UiConfirmSurfaceMeasurementBinding;
  operations: SpeakToSignHostOperations;
}>;

/** Implementations run in the trusted Wallet host, never in the embedding app. */
export interface SpeakToSignHostPlugin {
  /**
   * Records the three enrollment phrases, has the owner sign an authorization for exactly these
   * recordings and asks the verifier to store the owner's voice template.
   */
  enroll(input: SpeakToSignHostEnrollment): Promise<SpeakToSignEnrollmentResult>;
  requestTransfer(input: {
    readonly walletId: WalletId;
    readonly network: SpeakToSignNetwork;
    readonly signal: AbortSignal;
    /** The Wallet route adds the transfer when the app API carries a receiver and an amount. */
    readonly transfer?: SpeakToSignHostTransfer;
  }): Promise<SpeakToSignTransferResult>;
}

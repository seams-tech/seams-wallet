import type { UiConfirmSurfaceMeasurementBinding } from '@/core/signingEngine/uiConfirm/uiConfirm.types';
import type { WalletId } from '@shared/utils/domainIds';
import type { SpeakToSignNetwork } from './plugins';

/** Wallet and `@seams/speak-to-sign` must use the same value. It is separate from VoiceID's. */
export const SPEAK_TO_SIGN_HOST_API_VERSION = 2;

export type SpeakToSignUnavailableReason =
  /** The Wallet route supplied no transfer, so the host plugin cannot start one. */
  | 'flow_not_available'
  /** The wallet has no enabled VoiceID enrollment, so the verifier has no voice to compare. */
  | 'voiceid_unavailable'
  /** The vault has no state for this owner. */
  | 'vault_missing'
  /** The vault views or the Seams verify route did not answer usefully. */
  | 'verifier_unavailable'
  /** The Wallet did not submit the vault transaction. Nothing was paid. */
  | 'not_submitted'
  /** The vault transaction may have been sent. Check it before another payment. */
  | 'submission_unknown';

/** Refusals from the verifier, the local verdict check and the vault. Nothing was paid. */
export type SpeakToSignRefusalReason =
  | 'quality'
  | 'speaker'
  | 'words'
  | 'audio_reused'
  | 'audio_invalid'
  | 'template_missing'
  | 'unsupported'
  | 'speaker_unavailable'
  | 'storage'
  | 'transcriber_unavailable'
  /** The amount is not a whole number of hundredths of NEAR from 0.01 to 1,000,000. */
  | 'amount_not_speakable'
  /** The receiver is not an active contact of the vault, or it cannot be spoken. */
  | 'receiver_not_contact'
  /** The verdict signature, key, digests or kind did not match this request. */
  | 'verdict_mismatch'
  /** The vault refused the transaction. */
  | 'vault_rejected';

/** Milliseconds of each stage. `endOfSpeechToReceiptMs` is the latency budget of the flow. */
export type SpeakToSignTransferTimes = Readonly<{
  speechMs: number;
  verifyMs: number;
  checkMs: number;
  transactionMs: number;
  endOfSpeechToReceiptMs: number;
}>;

export type SpeakToSignTransferResult =
  | Readonly<{ kind: 'sent'; transactionHash: string; times: SpeakToSignTransferTimes }>
  | Readonly<{ kind: 'refused'; reason: SpeakToSignRefusalReason; detail?: string }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'unavailable'; reason: SpeakToSignUnavailableReason; detail?: string }>;

/** One spoken payment from the app. The Wallet iframe reads the owner and the vault itself. */
export type SpeakToSignTransferRequest = Readonly<{
  walletId: string;
  /** An active contact of the vault, such as `"bob.testnet"`. */
  receiver: string;
  /** Decimal NEAR, such as `"2.5"`. */
  amount: string;
}>;

/** One verifier enrollment from the app. The Wallet iframe reads the owner and the vault itself. */
export type SpeakToSignEnrollmentRequest = Readonly<{ walletId: string }>;

/** Refusals of an enrollment by the verifier or the vault. The verifier stored no template. */
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
  /** The vault holds no live authorization for these recordings. */
  | 'not_authorized'
  /** The verifier could not read the vault's authorization. */
  | 'authorization_unavailable'
  /** The vault refused `authorize_enrollment`. */
  | 'vault_rejected';

export type SpeakToSignEnrollmentResult =
  | Readonly<{
      kind: 'enrolled';
      /** 1 for the first enrollment, then 1 more for each new enrollment. */
      templateEpoch: number;
      /** The lowest pairwise speaker score of the three recordings, in thousandths. */
      agreementMilli: number;
      /** The `authorize_enrollment` transaction. */
      transactionHash: string;
    }>
  | Readonly<{ kind: 'refused'; reason: SpeakToSignEnrollmentRefusalReason; detail?: string }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'unavailable'; reason: SpeakToSignUnavailableReason; detail?: string }>;

/** The read-only vault methods that the host plugin may call. */
export type SpeakToSignVaultView =
  | 'get_vault'
  | 'get_contacts'
  | 'get_verifier'
  | 'get_pending_enrollment';

/** The arguments of the vault's `transfer_with_verdict`. Amount and nonce are decimal strings. */
export type SpeakToSignVaultTransferArgs = Readonly<{
  receiver_id: string;
  amount: string;
  nonce: string;
  verdict_json: string;
  signature_b64: string;
}>;

export type SpeakToSignVerifyReply =
  Readonly<{ kind: 'output'; output: unknown }> | Readonly<{ kind: 'failed'; code: string }>;

export type SpeakToSignSubmission =
  | Readonly<{ kind: 'executed'; transactionHash: string }>
  | Readonly<{ kind: 'reverted'; transactionHash: string; error: string }>
  | Readonly<{ kind: 'not_submitted'; error: string }>
  | Readonly<{ kind: 'submission_unknown'; error: string }>;

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

/**
 * Scoped core operations for one spoken payment or one enrollment. The plugin can record
 * clips on the VoiceID surface, read four vault views, call the Seams verify route and send
 * `transfer_with_verdict` or `authorize_enrollment` to the configured vault as the owner. It
 * gets no signing context, key or session.
 */
export type SpeakToSignHostOperations = Readonly<{
  captureClip(request: SpeakToSignClipRequest): Promise<SpeakToSignClip>;
  viewVault(view: SpeakToSignVaultView, signal: AbortSignal): Promise<unknown>;
  verify(
    input: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<SpeakToSignVerifyReply>;
  submitTransfer(
    args: SpeakToSignVaultTransferArgs,
    signal: AbortSignal,
  ): Promise<SpeakToSignSubmission>;
  /** Sends `authorize_enrollment({ enrollment_digest })` with no deposit. */
  authorizeEnrollment(enrollmentDigest: string, signal: AbortSignal): Promise<SpeakToSignSubmission>;
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
  vault: string;
  network: SpeakToSignNetwork;
  signal: AbortSignal;
  ownerAccountId: string;
  surfaceMeasurementBinding: UiConfirmSurfaceMeasurementBinding;
  operations: SpeakToSignHostOperations;
}>;

/** Implementations run in the trusted Wallet host, never in the embedding app. */
export interface SpeakToSignHostPlugin {
  /**
   * Records the three enrollment phrases, authorizes exactly these recordings on the vault and
   * asks the verifier to store the owner's voice template.
   */
  enroll(input: SpeakToSignHostEnrollment): Promise<SpeakToSignEnrollmentResult>;
  requestTransfer(input: {
    readonly walletId: WalletId;
    readonly vault: string;
    readonly network: SpeakToSignNetwork;
    readonly signal: AbortSignal;
    /** The Wallet route adds the transfer when the app API carries a receiver and an amount. */
    readonly transfer?: SpeakToSignHostTransfer;
  }): Promise<SpeakToSignTransferResult>;
}

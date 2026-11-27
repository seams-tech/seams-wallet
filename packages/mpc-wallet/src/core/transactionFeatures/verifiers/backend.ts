// The port between Wallet core and a Speak-to-Sign verifier backend (Refactor 254): what only the
// device does for a backend. It prepares the verifier input that leaves the device, writes the
// owner's enrollment statement, and gives the card its text and receipt. Each backend is one
// module beside this file.

import type { PhraseReceipt } from '@/core/authMethods/hostPlugin';
import type { SpeakToSignBackendId } from '@shared/speakToSign/backend';
import type { SpeakToSignVerifier } from '@shared/speakToSign/evidence/voiceVerdictV2';
import { OUTLAYER_VERIFIER } from './outlayer/outlayerVerifier';

/** What a receipt shows of one verifier call: the version in its verdict, and its attestation. */
export type VerifierProof = Readonly<{
  /**
   * The verifier version in the signed verdict, such as "0.13.0". A build for another
   * speech-to-text service adds its name: "0.14.0+venice".
   */
  verifier: string | null;
  /** A public record of the call, or null. */
  attestationUrl: string | null;
}>;

/** Where each check of the verifier runs. It sends one answer at the end, so its wait names them. */
export type VerifierSteps = Readonly<{
  speaker: string;
  words: string;
  policy: string;
  verdict: string;
}>;

export type VerifierReceiptInput = Readonly<{
  /** The owner's account as the card shows it. */
  owner: string;
  /** A community note also had its summary checked. */
  note: boolean;
}>;

/** The message that the owner signs (NEP-413) to enroll the three recordings. */
export type EnrollmentStatement = Readonly<{ message: string; recipient: string }>;

export interface SpeakToSignVerifierBackend {
  readonly id: SpeakToSignBackendId;
  readonly steps: VerifierSteps;
  /** The card text when the verifier did not answer in time. */
  readonly timeout: Readonly<{ headline: string; caption: string }>;
  proof(output: unknown, attestationUrl: string | null): VerifierProof;
  receipt(input: VerifierReceiptInput, proof: VerifierProof): PhraseReceipt;
  /**
   * The verifier input as it leaves the device. Null when a recording cannot leave it in the
   * form that the backend needs, so that nothing is sent.
   */
  prepareInput(
    verifier: SpeakToSignVerifier | null,
    verifierInput: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>> | null>;
  enrollmentStatement(
    owner: string,
    clipDigests: readonly Uint8Array<ArrayBuffer>[],
    verifier: SpeakToSignVerifier,
  ): Promise<EnrollmentStatement>;
}

/** The verifier backend of Wallet core. OutLayer is the only one before Refactor 254 Slice 4. */
export const SPEAK_TO_SIGN_VERIFIER_BACKEND: SpeakToSignVerifierBackend = OUTLAYER_VERIFIER;

// The port between Wallet core and a Speak-to-Sign verifier backend: what only the device does
// for a backend. It builds the verifier input that leaves the device, reads the output, proves
// the owner's approval of an enrollment, and gives the card its text and receipt. Each backend is
// one module beside this file.

import type { PhraseReceipt } from '@/core/transactionFeatures/phraseSurface';
import type { SpeakToSignBackendId } from '@shared/speakToSign/backend';
import type { SpeakToSignNetwork, SpokenRequest } from '@shared/speakToSign/spokenRequest';
import type { SignNEP413MessageResult } from '@/core/types/sdkPublicResults';
import type { SpeakToSignEnrollmentAuthorization } from '../hostPlugin';
import type { SpokenIntent } from '../spokenIntent';
import type { VerifyOutput } from '../voiceVerdict';
import { OUTLAYER_VERIFIER } from './outlayer/outlayerVerifier';
import { SAYSO_VERIFIER } from './sayso/saysoVerifier';

/** What a receipt shows of one verifier call: the version in its verdict, and its attestation. */
export type VerifierProof = Readonly<{
  /**
   * The verifier version in the signed verdict, such as "0.13.0" or "sayso/0.2.0". A build for
   * another speech-to-text service adds its name: "0.14.0+venice".
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

/** What a spoken request is, for the verify input of a backend. */
export type SpokenVerifyFacts = Readonly<{
  network: SpeakToSignNetwork;
  owner: string;
  intent: SpokenIntent;
  /** The request of the intent, and its digest (`spokenRequestDigest`). */
  request: SpokenRequest;
  requestDigest: Uint8Array;
}>;

export type SpokenVerifyInput =
  /** The verify input without its recording. */
  | Readonly<{ kind: 'ready'; input: Readonly<Record<string, unknown>> }>
  /** The request is above the verifier's limits, so it has no spoken approval. */
  | Readonly<{ kind: 'above_limits'; detail: string }>;

/** What a backend may use to prove that the owner approves an enrollment. */
export type EnrollmentApprovalInput = Readonly<{
  owner: string;
  network: SpeakToSignNetwork;
  /** SHA-256 of each WAV, in order. */
  clipDigests: readonly Uint8Array<ArrayBuffer>[];
  /** The owner's NEP-413 signing path, bound to the Wallet Session and the owner account. */
  signMessage(
    statement: Readonly<{ message: string; recipient: string }>,
  ): Promise<SignNEP413MessageResult>;
  /** A fresh passkey or Email OTP approval, which issues a new Wallet Session. Never a voice. */
  freshApproval(): Promise<FreshApproval>;
}>;

export type FreshApproval =
  | Readonly<{ kind: 'approved' }>
  | Readonly<{ kind: 'not_approved'; error: string }>;

export interface SpeakToSignVerifierBackend {
  readonly id: SpeakToSignBackendId;
  readonly steps: VerifierSteps;
  /** The card text when the verifier did not answer in time. */
  readonly timeout: Readonly<{ headline: string; caption: string }>;
  /** The `kind` of the backend's enrollment output. */
  readonly enrollmentKind: string;
  /** The verify output that the Seams route passes through unchanged, or null. */
  parseOutput(output: unknown): VerifyOutput | null;
  proof(output: unknown, attestationUrl: string | null): VerifierProof;
  receipt(input: VerifierReceiptInput, proof: VerifierProof): PhraseReceipt;
  /** The verify input of a spoken request, before the recording. Core calls it before the card. */
  verifyInput(facts: SpokenVerifyFacts): Promise<SpokenVerifyInput>;
  /**
   * The verifier input as it leaves the device, with its recordings in the form that the
   * backend needs. Null when a recording cannot leave the device in that form.
   */
  prepareInput(
    network: SpeakToSignNetwork,
    verifierInput: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>> | null>;
  /** The owner's approval of an enrollment of exactly these clips. */
  authorizeEnrollment(input: EnrollmentApprovalInput): Promise<SpeakToSignEnrollmentAuthorization>;
  /** The input that deletes the owner's voice template, or null when the backend has no delete. */
  templateDeleteInput(
    network: SpeakToSignNetwork,
    owner: string,
  ): Readonly<Record<string, unknown>> | null;
}

const BACKENDS: Readonly<Record<SpeakToSignBackendId, SpeakToSignVerifierBackend>> = {
  sayso: SAYSO_VERIFIER,
  outlayer: OUTLAYER_VERIFIER,
};

/**
 * The verifier backend of Wallet core: SaySo. OutLayer is a module that is off; a Wallet built
 * with `outlayer` here uses it again, with a lane whose Gateway runs OutLayer. The Gateway refuses
 * an input of another backend (`backend_mismatch`).
 */
export const SPEAK_TO_SIGN_VERIFIER_BACKEND: SpeakToSignVerifierBackend = BACKENDS.sayso;

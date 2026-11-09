import { accountExists } from '@/core/rpcClients/near/accountExists';
import type { NearClient } from '@/core/rpcClients/near/NearClient';
import { transfer } from '@/core/types/actionBuilders';
import type { TransactionInput } from '@/core/types/actions';
import type { ActionResult } from '@/core/types/seams';
import type { SignNEP413MessageResult } from '@/core/types/sdkPublicResults';
import { base64UrlEncode } from '@shared/utils/base64';
import { isPlainObject } from '@shared/utils/validation';
import type {
  AuthMethodPhraseRecording,
  AuthMethodPhraseRequest,
  AuthMethodPhraseSurface,
} from '@/core/authMethods/hostPlugin';
import type {
  SpeakToSignClip,
  SpeakToSignClipRequest,
  SpeakToSignEnrollmentAuthorization,
  SpeakToSignHostOperations,
  SpeakToSignPayment,
  SpeakToSignPaymentHooks,
  SpeakToSignPromptResult,
  SpeakToSignVerifyReply,
} from './hostPlugin';
import type { SpeakToSignFeaturePlugin } from './plugins';
import { concat, sha256, utf8, type SpokenTransferRequest } from './spokenTransfer';
import {
  checkVoiceVerdict,
  parseVerifyOutput,
  SPEAK_TO_SIGN_VERIFIERS,
  type VoiceApproval,
} from './voiceVerdict';

type Verifiers = typeof SPEAK_TO_SIGN_VERIFIERS;
import { pcm16Wav, SAMPLE_RATE } from './wav';

const VERIFY_PATH = '/speak-to-sign/v1/verify';
const ENROLLMENT_DOMAIN = 'seams:voice-enrollment:v2';
const ENROLLMENT_MESSAGE_PREFIX = 'Speak-to-Sign voice enrollment ';
const ENROLLMENT_RECORDINGS = 3;

export type SpeakToSignHostOperationsInput = Readonly<{
  feature: SpeakToSignFeaturePlugin;
  ownerAccountId: string;
  /** The Seams server that serves the verify route. */
  serverUrl: string;
  nearClient: Pick<NearClient, 'viewAccount'>;
  /** The bearer Wallet Session operation credential that the verify route admits. */
  operationCredential: (signal: AbortSignal) => Promise<string>;
  /**
   * The owner's NEAR signing path for one voice-approved transaction: no confirm for `voice`,
   * a fresh approval with the session's own method for `voice_and_passkey`. `onBroadcast` runs
   * when the signed transaction leaves for the network.
   */
  signVoiceApprovedTransaction: (
    transaction: TransactionInput,
    approval: VoiceApproval,
    policyText: string | null,
    signal: AbortSignal,
    onBroadcast: () => void,
  ) => Promise<ActionResult>;
  /** The owner's NEP-413 signing path, bound to the wallet session and the owner account. */
  signMessage: (
    params: Readonly<{ message: string; recipient: string }>,
    signal: AbortSignal,
  ) => Promise<SignNEP413MessageResult>;
  /** The VoiceID host plugin's `openPhrase`, loaded on first use. */
  openPhrase: (request: AuthMethodPhraseRequest) => Promise<AuthMethodPhraseSurface>;
  fetch: typeof fetch;
  now?: () => number;
  /** Tests pass their own key. The Wallet always uses the pinned verifiers. */
  verifiers?: Verifiers;
}>;

/**
 * What one flow recorded and paid. A verdict binds a clip of this flow, and the flow pays at most
 * once, even when "Try again" brings it several accepted verdicts.
 */
type FlowState = {
  readonly recordedAudio: Set<string>;
  paid: boolean;
};

/** Builds the scoped operations for one spoken payment or enrollment. */
export function createSpeakToSignHostOperations(
  input: SpeakToSignHostOperationsInput,
): SpeakToSignHostOperations {
  const state: FlowState = { recordedAudio: new Set(), paid: false };
  return {
    openPrompt: openPrompt.bind(null, input, state),
    receiverExists: receiverExists.bind(null, input),
    verify: verify.bind(null, input),
    payWithVerdict: payWithVerdict.bind(null, input, state),
    authorizeEnrollment: authorizeEnrollment.bind(null, input, state),
  };
}

/** Opens the VoiceID surface of one sentence. It stays open until the plugin closes it. */
async function openPrompt(
  input: SpeakToSignHostOperationsInput,
  state: FlowState,
  request: SpeakToSignClipRequest,
): Promise<SpeakToSignPromptResult> {
  request.signal.throwIfAborted();
  let surface: AuthMethodPhraseSurface;
  try {
    surface = await input.openPhrase({
      sentence: request.sentence,
      signal: request.signal,
      surfaceMeasurementBinding: request.surfaceMeasurementBinding,
    });
  } catch (error) {
    request.signal.throwIfAborted();
    return { kind: 'unavailable', detail: errorDetail(error, 'VoiceID did not load') };
  }
  return {
    kind: 'opened',
    prompt: {
      record: recordClip.bind(null, state, surface, request.signal),
      show: (view) => surface.show(view),
      close: () => surface.close(),
    },
  };
}

/** Records one clip on the open surface and returns it as the verifier's canonical WAV. */
async function recordClip(
  state: FlowState,
  surface: AuthMethodPhraseSurface,
  signal: AbortSignal,
): Promise<SpeakToSignClip> {
  signal.throwIfAborted();
  let recording: AuthMethodPhraseRecording;
  try {
    recording = await surface.record();
  } catch (error) {
    signal.throwIfAborted();
    return { kind: 'unavailable', detail: errorDetail(error, 'recording failed') };
  }
  if (recording.kind === 'cancelled') return recording;
  const wav = pcm16Wav(recording.samples);
  recording.samples.fill(0);
  state.recordedAudio.add(await audioDigest(wav));
  return {
    kind: 'captured',
    wav,
    speechMs: Math.round(((wav.length - 44) / 2 / SAMPLE_RATE) * 1_000),
    endOfSpeechAt: recording.endOfSpeechAt,
  };
}

async function receiverExists(
  input: SpeakToSignHostOperationsInput,
  accountId: string,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  const exists = await accountExists(input.nearClient, accountId);
  signal.throwIfAborted();
  return exists;
}

async function verify(
  input: SpeakToSignHostOperationsInput,
  verifierInput: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
): Promise<SpeakToSignVerifyReply> {
  const credential = await input.operationCredential(signal);
  const url = new URL(VERIFY_PATH, input.serverUrl);
  let response: Response;
  try {
    response = await input.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${credential}` },
      body: JSON.stringify({ input: verifierInput }),
      credentials: 'omit',
      signal,
    });
  } catch (error) {
    signal.throwIfAborted();
    return { kind: 'failed', code: error instanceof Error ? error.name : 'network' };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: 'failed', code: `http_${response.status}` };
  }
  if (response.ok && isPlainObject(body) && body.ok === true && 'output' in body) {
    return { kind: 'output', output: body.output };
  }
  const code = isPlainObject(body) && typeof body.code === 'string' ? body.code : '';
  return { kind: 'failed', code: code || `http_${response.status}` };
}

async function payWithVerdict(
  input: SpeakToSignHostOperationsInput,
  state: FlowState,
  transferRequest: Readonly<{ receiver: string; amountYocto: bigint }>,
  verifierOutput: unknown,
  signal: AbortSignal,
  hooks: SpeakToSignPaymentHooks,
): Promise<SpeakToSignPayment> {
  signal.throwIfAborted();
  const verifier = (input.verifiers ?? SPEAK_TO_SIGN_VERIFIERS)[input.feature.network];
  if (!verifier) return { kind: 'unavailable', detail: 'This network has no verifier.' };
  const output = parseVerifyOutput(verifierOutput);
  if (!output) return { kind: 'unavailable', detail: 'invalid verifier output' };
  const request: SpokenTransferRequest = {
    network: input.feature.network,
    owner: input.ownerAccountId,
    receiver: transferRequest.receiver,
    amountYocto: transferRequest.amountYocto,
  };
  const check = await checkVoiceVerdict({
    output,
    request,
    verifier,
    recordedAudio: state.recordedAudio,
    nowMs: (input.now ?? Date.now)(),
  });
  if (check.kind === 'refused') return check;
  if (check.kind === 'mismatch') {
    return { kind: 'refused', reason: 'verdict_mismatch', detail: check.detail };
  }
  if (state.paid) {
    return { kind: 'refused', reason: 'verdict_mismatch', detail: 'this flow already paid' };
  }
  if (check.approval === 'voice') hooks.accepted();
  else if (!(await hooks.approveStepUp(check.policyText))) return { kind: 'cancelled' };
  signal.throwIfAborted();
  // A verdict that waited for the owner may have expired meanwhile.
  if (!verdictStillValid(output.verdictJson, (input.now ?? Date.now)())) {
    return { kind: 'refused', reason: 'verdict_mismatch', detail: 'verdict expired' };
  }
  if (state.paid) {
    return { kind: 'refused', reason: 'verdict_mismatch', detail: 'this flow already paid' };
  }
  state.paid = true;
  const result = await input.signVoiceApprovedTransaction(
    {
      receiverId: request.receiver,
      actions: [transfer(`${request.amountYocto} yoctoNEAR`)],
    },
    check.approval,
    check.policyText,
    signal,
    hooks.broadcasting,
  );
  if (!result.success) {
    // Nothing left the Wallet, so another recording of this flow may still pay.
    if (result.kind === 'not_submitted') state.paid = false;
    return result.kind === 'not_submitted'
      ? { kind: 'not_submitted', error: result.error }
      : { kind: 'submission_unknown', error: result.error };
  }
  const failure = executionFailure(result.result);
  return failure === null
    ? { kind: 'executed', transactionHash: result.transactionId, approval: check.approval }
    : { kind: 'reverted', transactionHash: result.transactionId, error: failure };
}

async function authorizeEnrollment(
  input: SpeakToSignHostOperationsInput,
  state: FlowState,
  clips: readonly Uint8Array<ArrayBuffer>[],
  signal: AbortSignal,
): Promise<SpeakToSignEnrollmentAuthorization> {
  signal.throwIfAborted();
  const verifier = (input.verifiers ?? SPEAK_TO_SIGN_VERIFIERS)[input.feature.network];
  if (!verifier) return { kind: 'not_signed', error: 'This network has no verifier.' };
  if (clips.length !== ENROLLMENT_RECORDINGS) {
    return { kind: 'not_signed', error: 'An enrollment needs exactly three recordings.' };
  }
  const digests = await Promise.all(clips.map(sha256));
  if (!digests.every((digest) => state.recordedAudio.has(base64UrlEncode(digest)))) {
    return { kind: 'not_signed', error: 'Only recordings of this enrollment can be authorized.' };
  }
  const digest = await enrollmentDigest(input.ownerAccountId, digests);
  let signed: SignNEP413MessageResult;
  try {
    signed = await input.signMessage(
      { message: `${ENROLLMENT_MESSAGE_PREFIX}${digest}`, recipient: verifier.project },
      signal,
    );
  } catch (error) {
    signal.throwIfAborted();
    return { kind: 'not_signed', error: error instanceof Error ? error.message : 'not signed' };
  }
  if (!signed.success) return { kind: 'not_signed', error: signed.error };
  return {
    kind: 'signed',
    authorization: {
      public_key: signed.publicKey,
      signature_b64: signed.signature,
      nonce_b64: signed.nonce,
    },
  };
}

/** base64url SHA-256(domain || owner || 0 || SHA-256 of each WAV, in order). */
export async function enrollmentDigest(
  owner: string,
  clipDigests: readonly Uint8Array<ArrayBuffer>[],
): Promise<string> {
  const preimage = concat([utf8(ENROLLMENT_DOMAIN), utf8(owner), new Uint8Array(1), ...clipDigests]);
  return base64UrlEncode(await sha256(preimage));
}

/** The checked verdict's expiry, read again after the owner answered a step-up. */
function verdictStillValid(verdictJson: string, nowMs: number): boolean {
  const verdict: unknown = JSON.parse(verdictJson);
  return isPlainObject(verdict) && typeof verdict.expires_at_ms === 'number'
    ? verdict.expires_at_ms > nowMs
    : false;
}

function errorDetail(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message.slice(0, 200) : fallback;
}

async function audioDigest(wav: Uint8Array<ArrayBuffer>): Promise<string> {
  return base64UrlEncode(await sha256(wav));
}

/** The first failure in the outcome or its receipts, as JSON text, or null. */
function executionFailure(outcome: unknown): string | null {
  if (!isPlainObject(outcome)) return 'missing outcome';
  const statuses: unknown[] = [outcome.status];
  if (Array.isArray(outcome.receipts_outcome)) {
    for (const receipt of outcome.receipts_outcome) {
      if (isPlainObject(receipt) && isPlainObject(receipt.outcome)) {
        statuses.push(receipt.outcome.status);
      }
    }
  }
  for (const status of statuses) {
    if (isPlainObject(status) && 'Failure' in status) {
      return JSON.stringify(status.Failure).slice(0, 400);
    }
  }
  return null;
}

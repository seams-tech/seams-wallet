import { accountExists } from '@/core/rpcClients/near/accountExists';
import type { NearClient } from '@/core/rpcClients/near/NearClient';
import { transfer } from '@/core/types/actionBuilders';
import type { TransactionInput } from '@/core/types/actions';
import type { DelegateActionInput } from '@/core/types/delegate';
import type {
  ActionResult,
  SignDelegateActionResult,
  SignTransactionResult,
} from '@/core/types/seams';
import type { Variant } from '@shared/utils/variant';
import type { SignNEP413MessageResult } from '@/core/types/sdkPublicResults';
import { base64UrlEncode } from '@shared/utils/base64';
import { isPlainObject } from '@shared/utils/validation';
import { concat, sha256, utf8 } from '@shared/speakToSign/spokenRequest';
import {
  parseCosignerVoiceRefusal,
  SPEAK_TO_SIGN_VERIFIERS,
} from '@shared/speakToSign/voiceVerdict';
import type {
  AuthMethodEnrollmentRecording,
  AuthMethodPhraseRecording,
  AuthMethodPhraseRequest,
  AuthMethodPhraseSurface,
} from '@/core/authMethods/hostPlugin';
import type {
  SpeakToSignClip,
  SpeakToSignClipRequest,
  SpeakToSignEnrollmentAuthorization,
  SpeakToSignEnrollmentRecording,
  SpeakToSignHostOperations,
  SpeakToSignMessageSigning,
  SpeakToSignNoteSigning,
  SpeakToSignPayment,
  SpeakToSignPaymentHooks,
  SpeakToSignProgress,
  SpeakToSignPromptResult,
  SpeakToSignVerifyReply,
} from './hostPlugin';
import type { SpeakToSignFeaturePlugin } from './plugins';
import {
  messageActionRefusal,
  messageDigests,
  type SpokenMessageAction,
} from './spokenMessage';
import {
  noteActionDigests,
  noteActionRefusal,
  noteTransaction,
  type SpokenNoteAction,
} from './spokenNote';
import { transferDigests, type SpokenDigests } from './spokenTransfer';
import {
  checkVoiceVerdict,
  parseVerifyOutput,
  type SignedVoiceVerdict,
  type VoiceApprovedSigning,
} from './voiceVerdict';
import { readVerifyStream } from './verifyStream';
import { pcm16Wav, SAMPLE_RATE } from './wav';

type Verifiers = typeof SPEAK_TO_SIGN_VERIFIERS;

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
   * a fresh approval with the session's own method for `voice_and_passkey`. The signing request
   * carries the verdict, so the Seams co-signer checks it again. `onBroadcast` runs when the
   * signed transaction leaves for the network. `onIncluded`, set only for a plain transfer, runs
   * when a block holds the transaction, before its outcome is read.
   */
  signVoiceApprovedTransaction: (
    transaction: TransactionInput,
    voice: VoiceApprovedSigning,
    signal: AbortSignal,
    onBroadcast: () => void,
    onIncluded: ((transactionHash: string) => void) | null,
  ) => Promise<ActionResult>;
  /** As `signVoiceApprovedTransaction`, but the signed transaction is returned and not sent. */
  signVoiceApprovedTransactionOnly: (
    transaction: TransactionInput,
    voice: VoiceApprovedSigning,
    signal: AbortSignal,
  ) => Promise<SignTransactionResult>;
  /** The owner's NEP-366 signing path for one voice-approved delegate action, with no confirm. */
  signVoiceApprovedDelegate: (
    delegate: DelegateActionInput,
    verdict: SignedVoiceVerdict,
    signal: AbortSignal,
  ) => Promise<SignDelegateActionResult>;
  /**
   * The owner's NEP-413 signing path for one voice-approved message, with no confirm. The
   * signing request carries the verdict and the summary, so the Seams co-signer checks them.
   */
  signVoiceApprovedMessage: (
    action: SpokenMessageAction,
    verdict: SignedVoiceVerdict,
    signal: AbortSignal,
  ) => Promise<SignNEP413MessageResult>;
  /** The owner's NEP-413 signing path, bound to the wallet session and the owner account. */
  signMessage: (
    params: Readonly<{ message: string; recipient: string }>,
    signal: AbortSignal,
  ) => Promise<SignNEP413MessageResult>;
  /** The VoiceID host plugin's `openPhrase`, loaded on first use. */
  openPhrase: (request: AuthMethodPhraseRequest) => Promise<AuthMethodPhraseSurface>;
  /**
   * The signing preparation that needs no verdict, such as the access-key nonce and a recent
   * block hash. It runs while the verifier works and signs nothing. Best effort.
   */
  prepareSigning: () => Promise<void>;
  /** Tells the app how the spoken request goes. */
  progress: (progress: SpeakToSignProgress) => void;
  fetch: typeof fetch;
  now?: () => number;
  /** Tests pass their own key. The Wallet always uses the pinned verifiers. */
  verifiers?: Verifiers;
  /** The VoiceID enrollment samples that this flow made, which its enrollment may authorize. */
  adopted?: AdoptedRecordings;
}>;

/** VoiceID enrollment samples as the verifier's WAV clips, with the digests of those clips. */
export type AdoptedRecordings = Readonly<{
  recordings: readonly SpeakToSignEnrollmentRecording[];
  digests: readonly string[];
}>;

/**
 * Turns the samples of a VoiceID enrollment that this flow just made into the verifier's WAV
 * clips, so the owner records one set for VoiceID and Speak-to-Sign. It clears the samples.
 */
export async function adoptVoiceIdRecordings(
  samples: readonly AuthMethodEnrollmentRecording[],
): Promise<AdoptedRecordings> {
  const recordings = samples.map(toEnrollmentRecording);
  return {
    recordings,
    digests: await Promise.all(recordings.map((recording) => audioDigest(recording.wav))),
  };
}

function toEnrollmentRecording(
  recording: AuthMethodEnrollmentRecording,
): SpeakToSignEnrollmentRecording {
  const wav = pcm16Wav(recording.samples);
  recording.samples.fill(0);
  return { wav, sentence: recording.sentence };
}

/**
 * What one flow recorded and signed. A verdict binds a clip of this flow, and the flow signs at
 * most once, even when "Try again" brings it several accepted verdicts.
 */
type FlowState = {
  readonly recordedAudio: Set<string>;
  paid: boolean;
};

/** Builds the scoped operations for one spoken payment or enrollment. */
export function createSpeakToSignHostOperations(
  input: SpeakToSignHostOperationsInput,
): SpeakToSignHostOperations {
  const state: FlowState = { recordedAudio: new Set(input.adopted?.digests), paid: false };
  return {
    openPrompt: openPrompt.bind(null, input, state),
    receiverExists: receiverExists.bind(null, input),
    verify: verify.bind(null, input),
    payWithVerdict: payWithVerdict.bind(null, input, state),
    signNoteWithVerdict: signNoteWithVerdict.bind(null, input, state),
    signMessageWithVerdict: signMessageWithVerdict.bind(null, input, state),
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
  if (verifierInput.op === 'verify') void input.prepareSigning().catch(() => {});
  input.progress({ stage: 'recording_sent' });
  let response: Response;
  try {
    response = await input.fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        authorization: `Bearer ${credential}`,
      },
      body: JSON.stringify({ input: verifierInput }),
      credentials: 'omit',
      signal,
    });
  } catch (error) {
    signal.throwIfAborted();
    return { kind: 'failed', code: error instanceof Error ? error.name : 'network' };
  }
  // The route refuses with a JSON error before it calls the verifier.
  if (!response.ok || !response.body) return await refusalOf(response);
  let reply: SpeakToSignVerifyReply;
  try {
    reply = await readVerifyStream(response.body, () =>
      input.progress({ stage: 'verifier_running' }),
    );
  } catch (error) {
    signal.throwIfAborted();
    return { kind: 'failed', code: error instanceof Error ? error.name : 'verify_stream' };
  }
  if (reply.kind === 'output') input.progress({ stage: 'verdict', ms: stageTimes(reply.output) });
  return reply;
}

async function refusalOf(response: Response): Promise<SpeakToSignVerifyReply> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: 'failed', code: `http_${response.status}` };
  }
  const code = isPlainObject(body) && typeof body.code === 'string' ? body.code : '';
  return { kind: 'failed', code: code || `http_${response.status}` };
}

/** The verifier's stage times (`ms`), numbers only. */
function stageTimes(output: unknown): Readonly<Record<string, number>> {
  const ms = isPlainObject(output) && isPlainObject(output.ms) ? output.ms : {};
  return Object.fromEntries(
    Object.entries(ms).filter((entry): entry is [string, number] => Number.isFinite(entry[1])),
  );
}

async function payWithVerdict(
  input: SpeakToSignHostOperationsInput,
  state: FlowState,
  transferRequest: Readonly<{ receiver: string; amountYocto: bigint }>,
  verifierOutput: unknown,
  signal: AbortSignal,
  hooks: SpeakToSignPaymentHooks,
): Promise<SpeakToSignPayment> {
  const expected = await transferDigests({
    network: input.feature.network,
    owner: input.ownerAccountId,
    receiver: transferRequest.receiver,
    amountYocto: transferRequest.amountYocto,
  });
  const transaction: TransactionInput = {
    receiverId: transferRequest.receiver,
    actions: [transfer(`${transferRequest.amountYocto} yoctoNEAR`)],
  };
  // Once a block holds a plain transfer, NEAR has checked its signature, nonce and balance.
  // The receiver was checked before verify, so the transfer can show as sent.
  const onIncluded = (transactionHash: string) => hooks.included(transactionHash);
  return await signWithVerdict(
    input,
    state,
    expected,
    () => transaction,
    null,
    verifierOutput,
    signal,
    hooks,
    onIncluded,
  );
}

async function signNoteWithVerdict(
  input: SpeakToSignHostOperationsInput,
  state: FlowState,
  action: SpokenNoteAction,
  verifierOutput: unknown,
  signal: AbortSignal,
  hooks: SpeakToSignPaymentHooks,
): Promise<SpeakToSignNoteSigning> {
  const refusal = noteActionRefusal(input.feature.network, action);
  if (refusal) return { kind: 'unavailable', detail: refusal };
  const expected = await noteActionDigests(input.feature.network, input.ownerAccountId, action);
  if (action.kind === 'transaction' && action.delivery !== 'send') {
    return await signWithoutSend(input, state, expected, action, verifierOutput, signal, hooks);
  }
  // A contract call can still fail in the contract, so it shows only its outcome.
  return await signWithVerdict(
    input,
    state,
    expected,
    noteTransaction.bind(null, action),
    action.kind === 'transaction' ? action.summary : null,
    verifierOutput,
    signal,
    hooks,
    null,
  );
}

/**
 * Signs a general transaction and does not send it: as a signed transaction for the
 * application, or as a NEP-366 delegate action for a relayer.
 */
async function signWithoutSend(
  input: SpeakToSignHostOperationsInput,
  state: FlowState,
  expected: SpokenDigests,
  action: Variant<SpokenNoteAction, 'kind', 'transaction'>,
  verifierOutput: unknown,
  signal: AbortSignal,
  hooks: SpeakToSignPaymentHooks,
): Promise<SpeakToSignNoteSigning> {
  const { delivery, transaction } = action;
  // The delegate path has no fresh-approval mode, so a verdict that asks for one signs nothing.
  const stepUp = delivery === 'sign' ? 'ask' : 'refuse';
  const approved = await approveVerdict(input, state, expected, verifierOutput, signal, hooks, stepUp);
  if (approved.kind !== 'approved') return approved;
  const { approval, policyText } = approved;
  const verdict = { ...approved.verdict, summary: action.summary };
  try {
    if (delivery === 'send' || delivery === 'sign') {
      const signed = await input.signVoiceApprovedTransactionOnly(
        transaction,
        { approval, policyText, verdict },
        signal,
      );
      return { kind: 'signed_transaction', signed, approval };
    }
    const signed = await input.signVoiceApprovedDelegate(
      {
        senderId: input.ownerAccountId,
        receiverId: transaction.receiverId,
        actions: transaction.actions,
        ...delivery,
      },
      verdict,
      signal,
    );
    return { kind: 'signed_delegate', signed, approval };
  } catch (error) {
    signal.throwIfAborted();
    // Nothing was signed, so another recording of this flow may still sign.
    state.paid = false;
    const message = error instanceof Error ? error.message : 'not signed';
    return cosignerRefusal(message) ?? { kind: 'not_submitted', error: message };
  }
}

async function signMessageWithVerdict(
  input: SpeakToSignHostOperationsInput,
  state: FlowState,
  action: SpokenMessageAction,
  verifierOutput: unknown,
  signal: AbortSignal,
  hooks: SpeakToSignPaymentHooks,
): Promise<SpeakToSignMessageSigning> {
  const refusal = messageActionRefusal(action);
  if (refusal) return { kind: 'unavailable', detail: refusal };
  const expected = await messageDigests(input.feature.network, input.ownerAccountId, action);
  // The message path has no fresh-approval mode, so a verdict that asks for one signs nothing.
  const approved = await approveVerdict(input, state, expected, verifierOutput, signal, hooks, 'refuse');
  if (approved.kind !== 'approved') return approved;
  let signed: SignNEP413MessageResult;
  try {
    signed = await input.signVoiceApprovedMessage(
      action,
      { ...approved.verdict, summary: action.summary },
      signal,
    );
  } catch (error) {
    signal.throwIfAborted();
    signed = { success: false, error: errorDetail(error, 'not signed') };
  }
  if (!signed.success) {
    // Nothing was signed, so another recording of this flow may still sign.
    state.paid = false;
    return cosignerRefusal(signed.error) ?? { kind: 'not_signed', error: signed.error };
  }
  return {
    kind: 'signed',
    approval: approved.approval,
    accountId: signed.accountId,
    publicKey: signed.publicKey,
    signature: signed.signature,
    nonce: action.nonce,
    ...(signed.state === undefined ? {} : { state: signed.state }),
  };
}

/** A refusal of the Seams co-signer in a signing error, or null for another error. */
function cosignerRefusal(error: string): Variant<SpeakToSignPayment, 'kind', 'refused'> | null {
  const refusal = parseCosignerVoiceRefusal(error);
  return refusal ? { kind: 'refused', reason: 'cosigner_refused', detail: refusal } : null;
}

/** A verdict that passed every check. The flow is marked as signed. */
type ApprovedVerdict = Readonly<{ kind: 'approved' }> & VoiceApprovedSigning;

/**
 * Checks the verdict against the request digests and takes the one signature of the flow. A
 * `step_up` verdict asks the owner first; with `stepUp` `refuse`, it signs nothing.
 */
async function approveVerdict(
  input: SpeakToSignHostOperationsInput,
  state: FlowState,
  expected: SpokenDigests,
  verifierOutput: unknown,
  signal: AbortSignal,
  hooks: SpeakToSignPaymentHooks,
  stepUp: 'ask' | 'refuse',
): Promise<
  ApprovedVerdict | Variant<SpeakToSignPayment, 'kind', 'refused' | 'cancelled' | 'unavailable'>
> {
  signal.throwIfAborted();
  const verifier = (input.verifiers ?? SPEAK_TO_SIGN_VERIFIERS)[input.feature.network];
  if (!verifier) return { kind: 'unavailable', detail: 'This network has no verifier.' };
  const output = parseVerifyOutput(verifierOutput);
  if (!output) return { kind: 'unavailable', detail: 'invalid verifier output' };
  const check = await checkVoiceVerdict({
    output,
    expected,
    verifier,
    recordedAudio: state.recordedAudio,
    nowMs: (input.now ?? Date.now)(),
  });
  if (check.kind === 'refused') return check;
  if (check.kind === 'mismatch') {
    return { kind: 'refused', reason: 'verdict_mismatch', detail: check.detail };
  }
  if (state.paid) {
    return { kind: 'refused', reason: 'verdict_mismatch', detail: 'this flow already signed' };
  }
  if (check.approval === 'voice') {
    hooks.accepted();
  } else if (stepUp === 'refuse') {
    return { kind: 'refused', reason: 'verdict_mismatch', detail: 'this request has no step-up' };
  } else {
    input.progress({ stage: 'step_up', policyText: check.policyText });
    if (!(await hooks.approveStepUp(check.policyText))) return { kind: 'cancelled' };
  }
  signal.throwIfAborted();
  // A verdict that waited for the owner may have expired meanwhile.
  if (!verdictStillValid(output.verdictJson, (input.now ?? Date.now)())) {
    return { kind: 'refused', reason: 'verdict_mismatch', detail: 'verdict expired' };
  }
  if (state.paid) {
    return { kind: 'refused', reason: 'verdict_mismatch', detail: 'this flow already signed' };
  }
  state.paid = true;
  return check;
}

/**
 * Checks the verdict against the request digests, then signs the transaction once.
 * `transaction` builds it from the checked verdict, because a bet carries the verdict to its
 * contract. `summary` is the spoken summary of a general transaction, which the co-signer
 * needs beside the verdict.
 */
async function signWithVerdict(
  input: SpeakToSignHostOperationsInput,
  state: FlowState,
  expected: SpokenDigests,
  transaction: (verdict: SignedVoiceVerdict) => TransactionInput,
  summary: string | null,
  verifierOutput: unknown,
  signal: AbortSignal,
  hooks: SpeakToSignPaymentHooks,
  onIncluded: ((transactionHash: string) => void) | null,
): Promise<SpeakToSignPayment> {
  const check = await approveVerdict(input, state, expected, verifierOutput, signal, hooks, 'ask');
  if (check.kind !== 'approved') return check;
  const result = await input.signVoiceApprovedTransaction(
    transaction(check.verdict),
    {
      approval: check.approval,
      policyText: check.policyText,
      verdict: summary === null ? check.verdict : { ...check.verdict, summary },
    },
    signal,
    () => {
      input.progress({ stage: 'transaction_sent' });
      hooks.broadcasting();
    },
    onIncluded,
  );
  if (!result.success) {
    // Nothing left the Wallet, so another recording of this flow may still pay.
    if (result.kind === 'not_submitted') state.paid = false;
    if (result.kind !== 'not_submitted') return { kind: 'submission_unknown', error: result.error };
    return cosignerRefusal(result.error) ?? { kind: 'not_submitted', error: result.error };
  }
  input.progress({ stage: 'settled', transactionHash: result.transactionId });
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

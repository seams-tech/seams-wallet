// The co-signer's check of a Speak-to-Sign verdict. Wallet core signs a voice-approved transaction
// or NEP-413 message with no confirm after it checks the verdict, and its signing request carries
// the verdict. Before the co-signer adds its part of the signature, it checks the verdict again
// against the bytes that it signs and records it once. It sets no amount limit: a limit is a
// rule of the Wallet's policy engine, as for a normal signature. A normal signing request carries no
// verdict, and the co-signer does not run this check for it.

import { checkVerdict, parseVerdict, verdictMessage, type VerdictRefusal } from '@seams/voice-verdict';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { hasExactKeys } from '@shared/utils/exactKeys';
import { isPlainObject } from '@shared/utils/validation';
import {
  spokenRequestBorsh,
  spokenRequestDigest,
  USDC_UNITS_PER_HUNDREDTH,
  type SpokenRequest,
  type SpeakToSignNetwork,
} from '@shared/speakToSign/spokenRequest';
import {
  COSIGNER_VOICE_REFUSAL_CODE,
  cosignerVoiceRefusalMessage,
  SPEAK_TO_SIGN_VERIFIERS,
  VOICE_VERDICT_LIFE_MS,
  type CosignerVoiceRefusal,
  type SpeakToSignVerifier,
} from '@shared/speakToSign/voiceVerdict';
import type { RouterApiWalletRegistrationService } from '../../framework/authServicePort';
import type { NormalizedRouterLogger } from '../../framework/logger';
import type { RouterAbEd25519NormalSigningAuthorizationResult } from '../signingOperations/routerAbEd25519NormalSigningRoute';
import { parseRouterAbEd25519NormalSigningScopeV2 } from '../signingOperations/routerAbPrivateSigningWorker';
import {
  betCarriesVerdict,
  decodeVoiceDelegate,
  decodeVoiceTransaction,
  spokenMessageRequest,
  spokenRequestOfTransaction,
  spokenTransactionRequest,
} from './voiceVerdictTransaction';

const YOCTO_PER_HUNDREDTH = 10n ** 22n;

type VoiceVerdictRecord = Readonly<{
  walletId: string;
  /** base64url of the message that the verifier key signed. */
  verdictId: string;
  /** The signing request that the verdict approved. A retry of that request may use it again. */
  requestId: string;
  acceptedAtMs: number;
  expiresAtMs: number;
}>;

export type VoiceVerdictLedgerAdmission = 'admitted' | 'replayed' | 'reused';

/** The co-signer's record of accepted verdicts. */
export type VoiceVerdictLedger = Readonly<{
  /**
   * Records the verdict once: `replayed` when the same request has it already, `reused` when
   * another request has it.
   */
  admit(record: VoiceVerdictRecord): Promise<VoiceVerdictLedgerAdmission>;
}>;

export type SpeakToSignVoiceVerdictCheck = Readonly<{
  ledger: VoiceVerdictLedger;
  /** Tests pass their own key. The co-signer always uses the pinned verifiers. */
  verifiers?: Readonly<Record<SpeakToSignNetwork, SpeakToSignVerifier | null>>;
  now?: () => number;
}>;

/** What the Ed25519 signing route passes: its context, the request and the verdict beside it. */
export type SigningRouteVoiceVerdict = Readonly<{
  ctx: Readonly<{
    opts: Readonly<{ speakToSignVoiceVerdicts?: SpeakToSignVoiceVerdictCheck | null }>;
    logger: Pick<NormalizedRouterLogger, 'warn'>;
    service: Readonly<{
      walletRegistration: Pick<
        RouterApiWalletRegistrationService,
        'resolveEd25519MaterialActivation'
      >;
    }>;
  }>;
  /** The request without `voice_verdict`: its scope, intent and signing payload. */
  body: Readonly<Record<string, unknown>>;
  phase: 'prepare' | 'finalize';
  /** The `voice_verdict` field of the request. Undefined for a normal signing request. */
  voiceVerdict: unknown;
}>;

/** Takes `voice_verdict` out of a signing request, so the MPC Router gets the request without it. */
export function splitVoiceVerdict<T extends { readonly body: Record<string, unknown> }>(
  route: T,
): T & { readonly voiceVerdict: unknown } {
  const { voice_verdict: voiceVerdict, ...body } = route.body;
  return { ...route, body, voiceVerdict };
}

type Admission =
  | Readonly<{ ok: true }>
  /** `detail`: why the co-signer could not check, for its own log only. */
  | Readonly<{ ok: false; reason: CosignerVoiceRefusal; detail?: string }>;

/** How the Ed25519 signing route authorized the request. */
type SigningAuthorization = Extract<RouterAbEd25519NormalSigningAuthorizationResult, { ok: true }>;

/**
 * Checks the verdict of a voice-approved signing request, after the route authorized the
 * session. Null admits the request: a normal request has no verdict and skips the check. A
 * response refuses the request with its reason. Only the first round (prepare) carries a
 * verdict. Without a configured check the co-signer refuses every verdict, because it cannot
 * record one.
 */
export async function checkSigningRequestVoiceVerdict(
  route: SigningRouteVoiceVerdict,
  authorization: SigningAuthorization,
): Promise<Response | null> {
  if (route.voiceVerdict === undefined) return null;
  const check = route.ctx.opts.speakToSignVoiceVerdicts;
  const admission =
    check && route.phase === 'prepare'
      ? await admitVoiceVerdict(check, route, authorization)
      : refuse(check ? 'verdict_invalid' : 'unavailable');
  if (admission.ok) return null;
  // One line for each refusal, so limits, reuse and faults show in the server log.
  route.ctx.logger.warn('[speak-to-sign] co-signer refused a voice verdict', {
    reason: admission.reason,
    phase: route.phase,
    walletId: scopeField(route.body, 'account_id'),
    requestId: scopeField(route.body, 'request_id'),
    ...(admission.detail ? { detail: admission.detail } : {}),
  });
  return voiceVerdictRefusalResponse(admission.reason);
}

/** A text field of the request scope, for the log. */
function scopeField(body: Readonly<Record<string, unknown>>, field: string): string | undefined {
  const value = isPlainObject(body.scope) ? body.scope[field] : undefined;
  return typeof value === 'string' ? value : undefined;
}

async function admitVoiceVerdict(
  check: SpeakToSignVoiceVerdictCheck,
  route: SigningRouteVoiceVerdict,
  authorization: SigningAuthorization,
): Promise<Admission> {
  const nowMs = (check.now ?? Date.now)();
  const signed = route.voiceVerdict;
  // A general transaction sends its spoken summary beside the verdict.
  const summary = isPlainObject(signed) ? signed.summary : undefined;
  const keys =
    summary === undefined
      ? ['verdict_json', 'signature_b64']
      : ['verdict_json', 'signature_b64', 'summary'];
  if (
    !hasExactKeys(signed, keys) ||
    typeof signed.verdict_json !== 'string' ||
    typeof signed.signature_b64 !== 'string' ||
    (summary !== undefined && typeof summary !== 'string')
  ) {
    return refuse('verdict_invalid');
  }
  const parsed = parseVerdict(signed.verdict_json);
  if ('refusal' in parsed || parsed.verdict.outcome === 'refuse') return refuse('verdict_invalid');
  const target = readSigningTarget(route.body);
  if (!target) return refuse('request_mismatch');
  const verifier = (check.verifiers ?? SPEAK_TO_SIGN_VERIFIERS)[target.network];
  if (!verifier) return refuse('network_unsupported');
  // The request digest is compared below, after the co-signer builds the request from the bytes
  // that it signs. A step-up passes here and needs the fresh approval next.
  const checked = await checkVerdict({
    verdictJson: signed.verdict_json,
    signatureB64: signed.signature_b64,
    publicKey: verifier.publicKey,
    nowMs,
    acceptStepUp: true,
  });
  if (!checked.ok) return refuse(cosignerRefusal(checked.refusal));
  const { verdict } = checked;
  if (verdict.outcome === 'step_up' && !freshApproval(authorization, verdict.expires_at_ms)) {
    return refuse('step_up_required');
  }

  const { signed: bytes } = target;
  let transaction = null;
  if (bytes.kind === 'transaction') transaction = decodeVoiceTransaction(bytes.unsignedTransaction);
  if (bytes.kind === 'delegate') transaction = await decodeVoiceDelegate(bytes);
  if (bytes.kind !== 'message' && !transaction) return refuse('request_mismatch');
  const owner = await sessionNearAccount(route, target);
  if (typeof owner !== 'string') return { ok: false, reason: 'unavailable', detail: owner.detail };
  if (transaction && transaction.signerId !== owner) return refuse('owner_mismatch');
  // With a summary, the verdict is for the transaction as a whole (any actions), sent by the
  // owner or as a delegate action, or for the message. Without one, it is for a typed request,
  // which the co-signer builds from the one action of the transaction.
  let spoken: SpokenRequest | null = null;
  if (transaction) {
    spoken =
      summary === undefined
        ? await spokenRequestOfTransaction(target.network, transaction)
        : await spokenTransactionRequest(target.network, transaction, summary);
  } else if (bytes.kind === 'message' && summary !== undefined) {
    spoken = await spokenMessageRequest(target.network, owner, bytes, summary);
  }
  if (!spoken) return refuse('request_mismatch');
  let borsh: Uint8Array;
  try {
    borsh = spokenRequestBorsh(spoken);
  } catch {
    // An amount or id that does not fit its Borsh integer.
    return refuse('request_mismatch');
  }
  const digest = base64UrlEncode(await spokenRequestDigest(borsh));
  if (digest !== verdict.request_digest) return refuse('request_mismatch');
  // A bet carries its verdict to the market contract. It must be the verdict of this request.
  if (
    summary === undefined &&
    transaction &&
    !betCarriesVerdict(target.network, transaction, {
      verdictJson: signed.verdict_json,
      signatureB64: signed.signature_b64,
    })
  ) {
    return refuse('request_mismatch');
  }
  // A verified bet or transfer verdict names a whole number of hundredths of USDC or NEAR.
  if (spoken.kind === 'market_bet' && spoken.amountUnits % USDC_UNITS_PER_HUNDREDTH !== 0n) {
    return refuse('request_mismatch');
  }
  if (spoken.kind === 'account_transfer' && spoken.amountYocto % YOCTO_PER_HUNDREDTH !== 0n) {
    return refuse('request_mismatch');
  }

  let ledger: VoiceVerdictLedgerAdmission;
  try {
    ledger = await check.ledger.admit({
      walletId: target.walletId,
      verdictId: base64UrlEncode(await verdictMessage(signed.verdict_json)),
      requestId: target.requestId,
      acceptedAtMs: nowMs,
      expiresAtMs: verdict.expires_at_ms,
    });
  } catch (error: unknown) {
    return { ok: false, reason: 'unavailable', detail: errorDetail(error, 'ledger') };
  }
  if (ledger === 'reused') return refuse('reused');
  return { ok: true };
}

/** The co-signer's reason for a verdict that `checkVerdict` refused. */
function cosignerRefusal(refusal: VerdictRefusal): CosignerVoiceRefusal {
  switch (refusal.code) {
    case 'bad_public_key':
    case 'bad_signature_encoding':
    case 'bad_signature':
      return 'signature_invalid';
    case 'expired':
    case 'not_yet_valid':
      return 'expired';
    case 'request_mismatch':
    case 'spoken_text_mismatch':
    case 'audio_mismatch':
      return 'request_mismatch';
    case 'malformed':
    case 'wrong_kind':
    case 'wrong_renderer':
    case 'refused':
    case 'step_up':
      return 'verdict_invalid';
  }
}

/**
 * True when the owner approved again after the verdict: an operation step-up approved this exact
 * operation, or a new VoiceID unlock issued the Wallet Session after the verifier signed the
 * verdict. A VoiceID session answers a fresh-approval request with that unlock.
 */
function freshApproval(authorization: SigningAuthorization, verdictExpiresAtMs: number): boolean {
  if (authorization.kind === 'operation_step_up') return true;
  if (authorization.kind !== 'wallet_session_operation_credential_v1') return false;
  const { authorization: issued, authMethod } = authorization.validated.admission.context;
  const verdictSignedAtMs = verdictExpiresAtMs - VOICE_VERDICT_LIFE_MS;
  return authMethod.kind === 'voiceid' && issued.session.createdAtMs >= verdictSignedAtMs;
}

type SigningTarget = Readonly<{
  network: SpeakToSignNetwork;
  walletId: string;
  requestId: string;
  materialActivation: ReturnType<
    typeof parseRouterAbEd25519NormalSigningScopeV2
  >['material_activation'];
  signed: SignedBytes;
}>;

/**
 * The bytes whose SHA-256 the signers sign: one NEAR transaction, one NEP-366 delegate action
 * or one NEP-413 message.
 */
type SignedBytes =
  | Readonly<{ kind: 'transaction'; unsignedTransaction: Uint8Array }>
  | Readonly<{ kind: 'delegate'; canonicalDelegate: Uint8Array; expectedDigestB64u: string }>
  | Readonly<{ kind: 'message'; canonicalMessage: Uint8Array; expectedDigestB64u: string }>;

/** The scope and the signed bytes of the prepare request, or null. */
function readSigningTarget(body: Readonly<Record<string, unknown>>): SigningTarget | null {
  const { intent, signing_payload: payload } = body;
  if (!isPlainObject(intent) || !isPlainObject(payload)) return null;
  const network = intent.near_network_id;
  if (network !== 'testnet' && network !== 'mainnet') return null;
  try {
    const signed = readSignedBytes(intent, payload);
    if (!signed) return null;
    const scope = parseRouterAbEd25519NormalSigningScopeV2(body.scope);
    return {
      network,
      walletId: scope.account_id,
      requestId: scope.request_id,
      materialActivation: scope.material_activation,
      signed,
    };
  } catch {
    return null;
  }
}

/** Throws for text that is not base64url. */
function readSignedBytes(
  intent: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>,
): SignedBytes | null {
  if (intent.kind === 'near_transaction_v1' && payload.kind === 'near_unsigned_transaction_borsh_v1') {
    const borsh = payload.unsigned_transaction_borsh_b64u;
    if (typeof borsh !== 'string' || intent.unsigned_transaction_borsh_b64u !== borsh) return null;
    return { kind: 'transaction', unsignedTransaction: base64UrlDecode(borsh) };
  }
  if (intent.kind === 'near_delegate_action_v1' && payload.kind === 'near_delegate_action_v1') {
    const { canonical_delegate_borsh_b64u: canonical, expected_signing_digest_b64u: digest } =
      payload;
    if (typeof canonical !== 'string' || typeof digest !== 'string') return null;
    return {
      kind: 'delegate',
      canonicalDelegate: base64UrlDecode(canonical),
      expectedDigestB64u: digest,
    };
  }
  if (intent.kind === 'nep413_v1' && payload.kind === 'nep413_message_v1') {
    const { canonical_message_b64u: canonical, expected_signing_digest_b64u: digest } = payload;
    if (typeof canonical !== 'string' || typeof digest !== 'string') return null;
    return {
      kind: 'message',
      canonicalMessage: base64UrlDecode(canonical),
      expectedDigestB64u: digest,
    };
  }
  return null;
}

/** The NEAR account of the session's Ed25519 signer. The route checked that the scope is its. */
async function sessionNearAccount(
  route: SigningRouteVoiceVerdict,
  target: SigningTarget,
): Promise<string | Readonly<{ detail: string }>> {
  try {
    const resolved = await route.ctx.service.walletRegistration.resolveEd25519MaterialActivation({
      walletId: target.walletId,
      materialActivation: target.materialActivation,
    });
    return resolved.ok ? resolved.nearAccountId : { detail: `material ${resolved.code}` };
  } catch (error: unknown) {
    return { detail: errorDetail(error, 'material') };
  }
}

function errorDetail(error: unknown, source: string): string {
  return `${source}: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`;
}

function refuse(reason: CosignerVoiceRefusal): Admission {
  return { ok: false, reason };
}

function voiceVerdictRefusalResponse(reason: CosignerVoiceRefusal): Response {
  const status = reason === 'unavailable' ? 503 : reason === 'reused' ? 409 : 403;
  return Response.json(
    {
      ok: false,
      code: COSIGNER_VOICE_REFUSAL_CODE,
      reason,
      message: cosignerVoiceRefusalMessage(reason),
    },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

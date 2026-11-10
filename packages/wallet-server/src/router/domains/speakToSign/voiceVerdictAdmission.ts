// The co-signer's check of a Speak-to-Sign verdict. Wallet core signs a voice-approved transaction
// with no confirm after it checks the verdict, and its signing request carries the verdict. Before
// the co-signer adds its part of the signature, it checks the verdict again against the
// transaction, records it once and applies the voice limits. A normal signing request carries no
// verdict, and the co-signer does not run this check for it.

import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { hasExactKeys } from '@shared/utils/exactKeys';
import { isPlainObject } from '@shared/utils/validation';
import {
  spokenRequestBorsh,
  spokenRequestDigest,
  USDC_UNITS_PER_HUNDREDTH,
  VOICE_BET_STEP_UP_ABOVE_UNITS,
  type SpeakToSignNetwork,
} from '@shared/speakToSign/spokenRequest';
import {
  COSIGNER_VOICE_REFUSAL_CODE,
  cosignerVoiceRefusalMessage,
  parseVoiceVerdict,
  SPEAK_TO_SIGN_VERIFIERS,
  verifyVoiceVerdictSignature,
  VOICE_VERDICT_LIFE_MS,
  voiceVerdictIsLive,
  voiceVerdictMessage,
  type CosignerVoiceRefusal,
  type SpeakToSignVerifier,
} from '@shared/speakToSign/voiceVerdict';
import type { RouterApiWalletRegistrationService } from '../../framework/authServicePort';
import type { NormalizedRouterLogger } from '../../framework/logger';
import type { RouterAbEd25519NormalSigningAuthorizationResult } from '../signingOperations/routerAbEd25519NormalSigningRoute';
import { parseRouterAbEd25519NormalSigningScopeV2 } from '../signingOperations/routerAbPrivateSigningWorker';
import { decodeVoiceTransaction, spokenRequestOfTransaction } from './voiceVerdictTransaction';

const YOCTO_PER_HUNDREDTH = 10n ** 22n;
const DAY_MS = 86_400_000;

/**
 * What the voice alone may approve. A `step_up` verdict that comes with a fresh approval (an
 * operation step-up or a new VoiceID unlock) is not a voice-only approval, so these limits do
 * not apply to it and it does not count toward the day. The per-payment limit is the
 * verifier's step-up rule (10 NEAR).
 */
const SPEAK_TO_SIGN_VOICE_LIMITS = Object.freeze({
  perPaymentYocto: 10n * 10n ** 24n,
  /** In any 24 hours, for each wallet. */
  perDayYocto: 20n * 10n ** 24n,
});

type VoiceVerdictRecord = Readonly<{
  walletId: string;
  /** base64url of the message that the verifier key signed. */
  verdictId: string;
  /** The signing request that the verdict approved. A retry of that request may use it again. */
  requestId: string;
  /** The voice-only amount in hundredths of NEAR; 0 for a note, a rating, a bet or a `step_up`. */
  voiceHundredths: number;
  acceptedAtMs: number;
  expiresAtMs: number;
}>;

export type VoiceVerdictLedgerAdmission = 'admitted' | 'replayed' | 'reused' | 'over_daily_limit';

/** The co-signer's record of accepted verdicts. */
export type VoiceVerdictLedger = Readonly<{
  /**
   * Records the verdict, in one step with the sum of the wallet's voice-only amounts accepted
   * after `windowStartMs`: `reused` when another request has the verdict, `over_daily_limit`
   * when the sum with this amount would pass `limitHundredths`.
   */
  admit(
    record: VoiceVerdictRecord & {
      readonly windowStartMs: number;
      readonly limitHundredths: number;
    },
  ): Promise<VoiceVerdictLedgerAdmission>;
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
  if (
    !hasExactKeys(signed, ['verdict_json', 'signature_b64']) ||
    typeof signed.verdict_json !== 'string' ||
    typeof signed.signature_b64 !== 'string'
  ) {
    return refuse('verdict_invalid');
  }
  const verdict = parseVoiceVerdict(signed.verdict_json);
  if (verdict.kind !== 'approve') return refuse('verdict_invalid');
  const target = readSigningTarget(route.body);
  if (!target) return refuse('request_mismatch');
  const verifier = (check.verifiers ?? SPEAK_TO_SIGN_VERIFIERS)[target.network];
  if (!verifier) return refuse('network_unsupported');
  const signatureValid = await verifyVoiceVerdictSignature(
    verifier.publicKey,
    signed.verdict_json,
    signed.signature_b64,
  );
  if (!signatureValid) return refuse('signature_invalid');
  if (!voiceVerdictIsLive(verdict.expiresAtMs, nowMs)) return refuse('expired');
  if (verdict.outcome === 'step_up' && !freshApproval(authorization, verdict.expiresAtMs)) {
    return refuse('step_up_required');
  }

  const transaction = decodeVoiceTransaction(target.unsignedTransaction);
  if (!transaction) return refuse('request_mismatch');
  const owner = await sessionNearAccount(route, target);
  if (typeof owner !== 'string') return { ok: false, reason: 'unavailable', detail: owner.detail };
  if (transaction.signerId !== owner) return refuse('owner_mismatch');
  const spoken = await spokenRequestOfTransaction(target.network, transaction);
  if (!spoken) return refuse('request_mismatch');
  let borsh: Uint8Array;
  try {
    borsh = spokenRequestBorsh(spoken);
  } catch {
    // An amount or id that does not fit its Borsh integer.
    return refuse('request_mismatch');
  }
  const digest = base64UrlEncode(await spokenRequestDigest(borsh));
  if (digest !== verdict.requestDigest) return refuse('request_mismatch');
  if (spoken.kind === 'market_bet') {
    // A verified bet verdict names a whole number of hundredths of USDC.
    if (spoken.amountUnits % USDC_UNITS_PER_HUNDREDTH !== 0n) return refuse('request_mismatch');
    // The market contract takes only an `accept` verdict, so the verifier cannot ask for a
    // step-up. The co-signer's own rule: a bet above the limit needs a fresh approval.
    if (
      spoken.amountUnits > VOICE_BET_STEP_UP_ABOVE_UNITS &&
      !freshApproval(authorization, verdict.expiresAtMs)
    ) {
      return refuse('step_up_required');
    }
  }

  const voiceYocto =
    spoken.kind === 'account_transfer' && verdict.outcome === 'accept' ? spoken.amountYocto : 0n;
  // A verified transfer verdict names a whole number of hundredths of NEAR.
  if (voiceYocto % YOCTO_PER_HUNDREDTH !== 0n) return refuse('request_mismatch');
  if (voiceYocto > SPEAK_TO_SIGN_VOICE_LIMITS.perPaymentYocto) return refuse('over_payment_limit');
  let ledger: VoiceVerdictLedgerAdmission;
  try {
    ledger = await check.ledger.admit({
      walletId: target.walletId,
      verdictId: base64UrlEncode(await voiceVerdictMessage(signed.verdict_json)),
      requestId: target.requestId,
      voiceHundredths: Number(voiceYocto / YOCTO_PER_HUNDREDTH),
      acceptedAtMs: nowMs,
      expiresAtMs: verdict.expiresAtMs,
      windowStartMs: nowMs - DAY_MS,
      limitHundredths: Number(SPEAK_TO_SIGN_VOICE_LIMITS.perDayYocto / YOCTO_PER_HUNDREDTH),
    });
  } catch (error: unknown) {
    return { ok: false, reason: 'unavailable', detail: errorDetail(error, 'ledger') };
  }
  if (ledger === 'reused') return refuse('reused');
  if (ledger === 'over_daily_limit') return refuse('over_daily_limit');
  return { ok: true };
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
  unsignedTransaction: Uint8Array;
}>;

/** The scope and the one unsigned NEAR transaction of the prepare request, or null. */
function readSigningTarget(body: Readonly<Record<string, unknown>>): SigningTarget | null {
  const { intent, signing_payload: payload } = body;
  if (!isPlainObject(intent) || !isPlainObject(payload)) return null;
  const network = intent.near_network_id;
  const borsh = payload.unsigned_transaction_borsh_b64u;
  if (
    intent.kind !== 'near_transaction_v1' ||
    payload.kind !== 'near_unsigned_transaction_borsh_v1' ||
    (network !== 'testnet' && network !== 'mainnet') ||
    typeof borsh !== 'string' ||
    intent.unsigned_transaction_borsh_b64u !== borsh
  ) {
    return null;
  }
  try {
    const scope = parseRouterAbEd25519NormalSigningScopeV2(body.scope);
    return {
      network,
      walletId: scope.account_id,
      requestId: scope.request_id,
      materialActivation: scope.material_activation,
      unsignedTransaction: base64UrlDecode(borsh),
    };
  } catch {
    return null;
  }
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

import type {
  MlDsaSigningSessionPolicy,
  MlDsaSigningAuthorization,
} from '@shared/near/mlDsaSigningSession';
import { parseMlDsaSigningSessionPolicy } from '@shared/near/mlDsaSigningSession';
import type { MlDsaEmailOtpProof } from '@shared/near/mlDsaEmailOtp';
import type { MlDsaSigningPreparation, MlDsaSigningActor } from '@shared/near/mlDsaSigning';
import {
  parseDigestB64u,
  sha256Utf8DigestB64u,
  type DigestB64u,
} from '@shared/utils/canonicalPrimitives';
import { secureRandomBase64Url } from '@shared/utils/secureRandomId';
import type { WebAuthnAuthenticationCredential } from '@/core/types/webauthn';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';
import type { WalletId } from '@shared/utils/domainIds';

type CachedSession = {
  readonly walletId: WalletId;
  readonly relayerUrl: string;
  readonly sessionIdB64u: DigestB64u;
  readonly tokenB64u: DigestB64u;
  readonly expiresAtMs: number;
  readonly remainingOperations: number;
  readonly policy: MlDsaSigningSessionPolicy;
};
export type MlDsaTransactionApproval = {
  readonly actor: MlDsaSigningActor;
} & ReadonlyExclusiveUnion<
  | { readonly kind: 'fresh'; readonly challengeB64u: DigestB64u }
  | {
      readonly kind: 'session_start';
      readonly scope: string;
      readonly session: CachedSession;
      readonly challengeB64u: DigestB64u;
    }
  | {
      readonly kind: 'session';
      readonly scope: string;
      readonly session: CachedSession;
      readonly challengeB64u: DigestB64u;
    }
>;
const sessions = new Map<string, CachedSession>();

export function clearMlDsaSigningSessions(): void {
  const wallets = new Set<WalletId>();
  for (const session of sessions.values()) wallets.add(session.walletId);
  for (const walletId of wallets)
    void retireMlDsaSigningSessions(walletId).catch(ignoreRetirementFailure);
}
function ignoreRetirementFailure(): void {}

export async function retireMlDsaSigningSessions(walletId: WalletId): Promise<void> {
  const retiring: CachedSession[] = [];
  for (const [scope, session] of sessions) {
    if (session.walletId !== walletId) continue;
    sessions.delete(scope);
    retiring.push(session);
  }
  if (retiring.length === 0) return;
  for (const session of retiring) {
    await revokeCachedSession(session);
  }
}
async function revokeCachedSession(session: CachedSession): Promise<void> {
  const { revokeMlDsaSigningSession } = await import('@/core/rpcClients/relayer/mlDsaSigning');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const outcome = await revokeMlDsaSigningSession({
      relayerUrl: session.relayerUrl,
      credential: {
        walletId: session.walletId,
        sessionIdB64u: session.sessionIdB64u,
        tokenB64u: session.tokenB64u,
      },
    });
    if (outcome.kind === 'revoked' || outcome.code !== 'conflict') return;
  }
  throw new Error('ML-DSA session revocation did not settle');
}

export function forgetMlDsaTransactionApproval(approval: MlDsaTransactionApproval): void {
  if (approval.kind === 'fresh') return;
  const current = sessions.get(approval.scope);
  if (!current || current.sessionIdB64u !== approval.session.sessionIdB64u) return;
  sessions.delete(approval.scope);
  void revokeCachedSession(current).catch(ignoreRetirementFailure);
}

export async function prepareMlDsaTransactionApproval(input: {
  readonly relayerUrl: string;
  readonly preparation: MlDsaSigningPreparation;
  readonly ownerDigestB64u: DigestB64u;
  readonly materialEpoch: number;
  readonly policy: MlDsaSigningSessionPolicy | null;
}): Promise<MlDsaTransactionApproval> {
  const p = input.preparation;
  const scope = JSON.stringify([
    input.relayerUrl,
    p.request.walletId,
    p.request.signingKeyId,
    input.materialEpoch,
    input.ownerDigestB64u,
    p.request.actor,
  ]);
  const cached = sessions.get(scope);
  const policy = input.policy === null ? null : parseMlDsaSigningSessionPolicy(input.policy);
  const matchingPolicy =
    policy === null ||
    (cached?.policy.maxOperations === policy.maxOperations &&
      cached.policy.durationMs === policy.durationMs);
  if (
    cached &&
    cached.expiresAtMs > Date.now() &&
    cached.remainingOperations > 0 &&
    matchingPolicy
  ) {
    return {
      kind: 'session',
      actor: p.request.actor,
      scope,
      session: cached,
      challengeB64u: p.challengeB64u,
    };
  }
  sessions.delete(scope);
  if (cached && !matchingPolicy) await revokeCachedSession(cached);
  if (policy === null)
    return { kind: 'fresh', actor: p.request.actor, challengeB64u: p.challengeB64u };
  const tokenB64u = parseDigestB64u(secureRandomBase64Url(32, 'ML-DSA signing session credential'));
  const { prepareMlDsaSigningSession } = await import('@/core/rpcClients/relayer/mlDsaSigning');
  const startedAtMs = Date.now();
  const prepared = await prepareMlDsaSigningSession({
    relayerUrl: input.relayerUrl,
    request: {
      walletId: p.request.walletId,
      operationIdB64u: p.request.operationIdB64u,
      tokenDigestB64u: await sha256Utf8DigestB64u(`seams/ml-dsa/session-token/v1|${tokenB64u}`),
      maxOperations: policy.maxOperations,
      durationMs: policy.durationMs,
    },
  });
  if (prepared.kind !== 'prepared') throw new Error(prepared.message);
  if (
    prepared.preparation.maxOperations !== policy.maxOperations ||
    prepared.preparation.expiresAtMs <= Date.now() ||
    prepared.preparation.expiresAtMs > startedAtMs + policy.durationMs + 30_000
  )
    throw new Error('The Gateway changed the ML-DSA signing session budget or expiry');
  return {
    kind: 'session_start',
    actor: p.request.actor,
    scope,
    challengeB64u: prepared.preparation.challengeB64u,
    session: {
      walletId: p.request.walletId,
      relayerUrl: input.relayerUrl,
      sessionIdB64u: prepared.preparation.sessionIdB64u,
      tokenB64u,
      expiresAtMs: prepared.preparation.expiresAtMs,
      remainingOperations: policy.maxOperations,
      policy,
    },
  };
}

export type MlDsaConfirmationProof = ReadonlyExclusiveUnion<
  | { readonly kind: 'passkey'; readonly credential: WebAuthnAuthenticationCredential }
  | { readonly kind: 'email_otp'; readonly proof: MlDsaEmailOtpProof }
  | { readonly kind: 'session' }
>;

export function authorizeMlDsaTransaction(input: {
  readonly approval: MlDsaTransactionApproval;
  readonly proof: MlDsaConfirmationProof;
}): MlDsaSigningAuthorization<WebAuthnAuthenticationCredential> {
  const { approval, proof } = input;
  if (approval.kind === 'session') {
    if (proof.kind !== 'session') throw new Error('A warm session must use its existing approval');
  } else if (proof.kind === 'session' || approval.actor.kind !== proof.kind) {
    throw new Error('The approval method differs from the selected owner');
  }
  if (
    proof.kind === 'passkey' &&
    (approval.actor.kind !== 'passkey' || proof.credential.id !== approval.actor.credentialIdB64u)
  )
    throw new Error('The signing approval used a different owner');
  switch (approval.kind) {
    case 'fresh':
      switch (proof.kind) {
        case 'passkey':
          return { kind: 'passkey', credential: proof.credential };
        case 'email_otp':
          return { kind: 'email_otp', proof: proof.proof };
        case 'session':
          throw new Error('Fresh signing requires owner approval');
        default:
          return assertNever(proof);
      }
    case 'session_start':
    case 'session': {
      const session = approval.session;
      if (session.expiresAtMs <= Date.now() || session.remainingOperations <= 0)
        throw new Error('The signing session is expired or exhausted');
      sessions.set(approval.scope, {
        walletId: session.walletId,
        relayerUrl: session.relayerUrl,
        sessionIdB64u: session.sessionIdB64u,
        tokenB64u: session.tokenB64u,
        expiresAtMs: session.expiresAtMs,
        remainingOperations: session.remainingOperations - 1,
        policy: session.policy,
      });
      switch (proof.kind) {
        case 'session':
          return {
            kind: 'session',
            sessionIdB64u: session.sessionIdB64u,
            tokenB64u: session.tokenB64u,
          };
        case 'passkey':
          return {
            kind: 'session_start',
            credential: proof.credential,
            sessionIdB64u: session.sessionIdB64u,
            tokenB64u: session.tokenB64u,
          };
        case 'email_otp':
          return {
            kind: 'email_otp_session_start',
            proof: proof.proof,
            sessionIdB64u: session.sessionIdB64u,
            tokenB64u: session.tokenB64u,
          };
        default:
          return assertNever(proof);
      }
    }
    default:
      return assertNever(approval);
  }
}
function assertNever(value: never): never {
  throw new Error(`Unknown signing approval: ${String(value)}`);
}

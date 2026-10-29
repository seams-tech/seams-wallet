import {
  externalAuthFailure,
  serializeExternalIdentity,
  type ExternalAuthResult,
  type ExternalOwnerChallenge,
} from '@shared/auth/externalAuth';
import {
  computeWalletOwnerAdminChallengeDigest,
  type WalletOwnerAdminOperation,
} from '@shared/authorization/walletOwnerOperation';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  ExternalAuthStore,
  type ExternalOwnerAttempt,
  type ExternalOwnerAttemptBinding,
} from './externalAuthStore';

export type ExternalOwnerOperation = Readonly<{
  attempt: ExternalOwnerAttempt;
  operation: Extract<
    WalletOwnerAdminOperation,
    'external_identity_associate' | 'external_identity_unlink'
  >;
  payload: Readonly<Record<string, unknown>>;
  challengeB64u: DigestB64u;
}>;

export async function readExternalOwnerOperation(input: {
  readonly store: ExternalAuthStore;
  readonly binding: ExternalOwnerAttemptBinding;
  readonly requestOrigin: string;
  readonly phase: 'prepare' | 'complete';
}): Promise<ExternalAuthResult<ExternalOwnerOperation>> {
  const attempt =
    input.phase === 'prepare'
      ? await input.store.prepareOwnerChallenge(input.binding)
      : await input.store.readOwnerAttempt(input.binding);
  if (!attempt) return externalAuthFailure('access_denied');
  if (attempt.challenge.kind !== 'ready') return externalAuthFailure('access_denied');
  if (attempt.status === 'verified' && attempt.challenge.expiresAtMs <= input.binding.nowMs) {
    return externalAuthFailure('expired');
  }
  const identity = serializeExternalIdentity(attempt.identity);
  let operation: ExternalOwnerOperation['operation'];
  let payload: Readonly<Record<string, unknown>>;
  switch (attempt.purpose) {
    case 'associate':
      operation = 'external_identity_associate';
      payload = {
        attemptId: attempt.attemptId,
        identity,
        originBinding: attempt.originBinding,
        revision: attempt.trustRevision,
        expiresAtMs: attempt.challenge.expiresAtMs,
      };
      break;
    case 'unlink':
      operation = 'external_identity_unlink';
      payload = {
        attemptId: attempt.attemptId,
        associationId: attempt.associationId,
        identity,
        originBinding: attempt.originBinding,
        revision: attempt.trustRevision,
        expiresAtMs: attempt.challenge.expiresAtMs,
      };
      break;
    default:
      return assertNever(attempt);
  }
  const challengeB64u = await computeWalletOwnerAdminChallengeDigest({
    walletId: attempt.walletId,
    operation,
    payload,
    requestOrigin: input.requestOrigin,
  });
  return { ok: true, value: { attempt, operation, payload, challengeB64u } };
}

export function externalOwnerChallenge(operation: ExternalOwnerOperation): ExternalOwnerChallenge {
  const attempt = operation.attempt;
  if (attempt.challenge.kind !== 'ready') throw new Error('Owner challenge is not prepared');
  switch (attempt.purpose) {
    case 'associate':
      return {
        kind: 'associate',
        walletId: attempt.walletId,
        attemptId: attempt.attemptId,
        identity: attempt.identity,
        challengeB64u: operation.challengeB64u,
        expiresAtMs: attempt.challenge.expiresAtMs,
      };
    case 'unlink':
      return {
        kind: 'unlink',
        walletId: attempt.walletId,
        attemptId: attempt.attemptId,
        associationId: attempt.associationId,
        identity: attempt.identity,
        challengeB64u: operation.challengeB64u,
        expiresAtMs: attempt.challenge.expiresAtMs,
      };
    default:
      return assertNever(attempt);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported external owner operation: ${String(value)}`);
}

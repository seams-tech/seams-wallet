import { walletSessionAuthorizations } from '@/core/indexedDB';
import { resolveFullWalletOwner } from '../../walletCustody/walletSigningOwner';
import type { WalletId } from '@shared/utils/domainIds';
import type { WalletSessionRef } from '../../interfaces/ecdsaChainTarget';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import type { EmailOtpWalletSessionCoordinator } from '../../session/emailOtp/EmailOtpWalletSessionCoordinator';
import type { EmailOtpConfirmPrompt, UserConfirmDecision } from '../../stepUpConfirmation/types';
import { parseMlDsaEmailOtpProof } from '@shared/near/mlDsaEmailOtp';
import type {
  MlDsaTransactionApproval,
  MlDsaConfirmationProof,
} from '../../walletCustody/mlDsaSigningSessions';
import { redactCredentialExtensionOutputs } from '../../webauthnAuth/credentials/credentialExtensions';
import { normalizeAuthenticationCredential } from '../../webauthnAuth/credentials/helpers';

export async function resolveMlDsaSigningOwner(walletId: WalletId) {
  const owner = await resolveFullWalletOwner(walletId);
  if (owner.kind !== 'owner') throw new Error('Unlock a full-owner method to sign');
  const method = owner.authMethod;
  const ownerDigestB64u = owner.authority.authorityDigestB64u;
  switch (method.kind) {
    case 'passkey':
      return {
        kind: 'passkey',
        ownerDigestB64u,
        actor: { kind: 'passkey', rpId: method.rpId, credentialIdB64u: method.credentialIdB64u },
        access: { kind: 'public' },
      } as const;
    case 'email_otp': {
      const exact = await walletSessionAuthorizations.readExactWithOperationCredential({
        walletId,
        authorityId: owner.authority.authorityId,
        authMethodId: method.walletAuthMethodId,
      });
      if (
        exact.kind !== 'found' ||
        exact.record.expiresAtMs <= Date.now() ||
        exact.record.authorityDigestB64u !== ownerDigestB64u ||
        exact.record.authorityRevocationEpoch !== owner.authority.revocationEpoch
      )
        throw new Error('Unlock this wallet again to approve signing');
      return {
        kind: 'email_otp',
        ownerDigestB64u,
        actor: { kind: 'email_otp', walletAuthMethodId: method.walletAuthMethodId },
        access: { kind: 'wallet_session', token: exact.operationCredential.token },
        operationCredential: exact.operationCredential,
      } as const;
    }
    case 'voiceid':
      throw new Error('Unlock with a passkey or email to approve ML-DSA signing.');
    default:
      return assertNever(method);
  }
}
type EmailOwner = Extract<
  Awaited<ReturnType<typeof resolveMlDsaSigningOwner>>,
  { kind: 'email_otp' }
>;
type EmailSessions = Pick<EmailOtpWalletSessionCoordinator, 'requestTransactionSigningChallenge'>;

async function requestEmailChallenge(
  sessions: EmailSessions,
  walletSession: WalletSessionRef,
  owner: EmailOwner,
  challenge: DigestB64u,
) {
  const current = await resolveMlDsaSigningOwner(walletSession.walletId);
  if (
    current.kind !== 'email_otp' ||
    current.actor.walletAuthMethodId !== owner.actor.walletAuthMethodId ||
    current.ownerDigestB64u !== owner.ownerDigestB64u ||
    current.operationCredential.token !== owner.operationCredential.token
  )
    throw new Error('The selected wallet owner changed');
  return sessions.requestTransactionSigningChallenge({
    kind: 'wallet_operation_challenge',
    walletSession,
    chain: 'near',
    operationCredential: owner.operationCredential,
    operationFingerprintDigest: challenge,
  });
}
export async function prepareMlDsaEmailPrompt(
  sessions: EmailSessions,
  walletSession: WalletSessionRef,
  owner: EmailOwner,
  challenge: DigestB64u,
): Promise<EmailOtpConfirmPrompt> {
  const delivered = await requestEmailChallenge(sessions, walletSession, owner, challenge);
  return {
    challengeId: delivered.challengeId,
    emailHint: delivered.emailHint,
    onResend: requestEmailChallenge.bind(null, sessions, walletSession, owner, challenge),
  };
}
export function mlDsaConfirmationProof(
  approval: MlDsaTransactionApproval,
  decision: UserConfirmDecision,
): MlDsaConfirmationProof {
  if (!decision.confirmed) throw new Error('Transaction approval was cancelled');
  if (approval.kind === 'session') return { kind: 'session' };
  switch (approval.actor.kind) {
    case 'passkey':
      if (!decision.credential) throw new Error('Signing requires its owner assertion');
      return {
        kind: 'passkey',
        credential: redactCredentialExtensionOutputs(
          normalizeAuthenticationCredential(decision.credential),
        ),
      };
    case 'email_otp':
      return {
        kind: 'email_otp',
        proof: parseMlDsaEmailOtpProof({
          challengeId: decision.emailOtpChallengeId,
          otpCode: decision.otpCode,
        }),
      };
    default:
      return assertNever(approval.actor);
  }
}
function assertNever(value: never): never {
  throw new Error(`Unknown wallet owner: ${String(value)}`);
}

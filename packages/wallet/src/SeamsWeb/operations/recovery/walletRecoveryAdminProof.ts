import { computeWalletCustodyAdminChallengeDigest } from '@shared/authorization/walletCustodyOperation';
import { IndexedDBManager } from '@/core/indexedDB';
import {
  acknowledgeWalletRecoveryBackup,
  readWalletRecoveryCodeStatus,
  requestWalletCustodyEmailOtpChallenge,
  type WalletCustodyFactorProof,
  type WalletRecoveryBackupAcknowledgementResult,
  type WalletRecoveryCodeStatusResult,
} from '@/core/rpcClients/relayer/walletRecoveryRotate';
import { TouchIdPrompt } from '@/core/signingEngine/stepUpConfirmation/passkeyPrompt/touchIdPrompt';
import { collectAuthenticationCredentialForWalletChallengeB64u } from '@/core/signingEngine/webauthnAuth/credentials/collectAuthenticationCredentialForChallengeB64u';
import { redactCredentialExtensionOutputs } from '@/core/signingEngine/webauthnAuth/credentials/credentialExtensions';
import { passkeyCredentialIdB64uFromAuthentication } from '@/SeamsWeb/operations/authMethods/passkey/ecdsaBootstrap';
import { secureRandomId } from '@shared/utils/secureRandomId';
import type { RegistrationWebContext } from '@/SeamsWeb/signingSurface/types';
import type { WalletRecoveryFactorProofRequest } from '@/core/signingEngine/walletCustody/walletRecoveryRotation';

type RecoveryAdminRequest =
  | WalletRecoveryFactorProofRequest
  | {
      readonly operation: 'recovery_backup_acknowledge';
      readonly payload: {
        readonly walletId: string;
        readonly requestId: string;
        readonly expectedIssuedAtMs: number;
      };
    };

async function createWalletRecoveryAdminPasskeyProof(args: {
  readonly rpId: string;
  readonly request: RecoveryAdminRequest;
}): Promise<Extract<WalletCustodyFactorProof, { readonly kind: 'passkey' }>> {
  const walletId = args.request.payload.walletId;
  const requestOrigin = window.location.origin;
  const challengeDigest = await computeWalletCustodyAdminChallengeDigest({
    walletId,
    operation: args.request.operation,
    payload: args.request.payload,
    requestOrigin,
  });
  const credential = await collectAuthenticationCredentialForWalletChallengeB64u({
    credentialStore: IndexedDBManager,
    touchIdPrompt: new TouchIdPrompt(args.rpId),
    walletId,
    challengeB64u: challengeDigest,
    includeSecondPrfOutput: false,
  });
  const credentialIdB64u = passkeyCredentialIdB64uFromAuthentication(credential);
  if (!credentialIdB64u) {
    throw new Error('Wallet recovery proof did not receive a passkey credential');
  }
  return {
    kind: 'passkey',
    walletId,
    rpId: args.rpId,
    credentialIdB64u,
    challenge_digest: challengeDigest,
    webauthn_authentication: redactCredentialExtensionOutputs(credential),
  };
}

function recoveryAdminRequestId(): string {
  return secureRandomId('wallet-recovery-admin', 16, 'wallet recovery administration request IDs');
}

export async function readWalletRecoveryCodeStatusWithPasskey(args: {
  readonly relayUrl: string;
  readonly walletId: string;
  readonly rpId: string;
}): Promise<WalletRecoveryCodeStatusResult> {
  const requestId = recoveryAdminRequestId();
  const payload = { walletId: args.walletId, requestId };
  const factorProof = await createWalletRecoveryAdminPasskeyProof({
    rpId: args.rpId,
    request: { operation: 'recovery_status', payload },
  });
  return await readWalletRecoveryCodeStatus({
    relayUrl: args.relayUrl,
    walletId: args.walletId,
    requestId,
    factorProof,
  });
}

export async function acknowledgeWalletRecoveryBackupWithPasskey(args: {
  readonly relayUrl: string;
  readonly walletId: string;
  readonly rpId: string;
  readonly expectedIssuedAtMs: number;
}): Promise<WalletRecoveryBackupAcknowledgementResult> {
  const requestId = recoveryAdminRequestId();
  const payload = {
    walletId: args.walletId,
    requestId,
    expectedIssuedAtMs: args.expectedIssuedAtMs,
  };
  const factorProof = await createWalletRecoveryAdminPasskeyProof({
    rpId: args.rpId,
    request: { operation: 'recovery_backup_acknowledge', payload },
  });
  return await acknowledgeWalletRecoveryBackup({
    relayUrl: args.relayUrl,
    walletId: args.walletId,
    requestId,
    expectedIssuedAtMs: args.expectedIssuedAtMs,
    factorProof,
  });
}

export async function selectedEmailOtpOwnerMethod(walletId: string): Promise<{
  readonly walletAuthMethodId: string;
  readonly providerSubjectId: string;
}> {
  const selected = await IndexedDBManager.resolveSelectedWalletAuthority(walletId);
  if (
    selected.kind !== 'resolved' ||
    selected.selection.lockState !== 'unlocked' ||
    String(selected.selection.walletId) !== walletId ||
    selected.selection.walletAuthMethodId !== selected.authMethod.walletAuthMethodId ||
    selected.authMethod.kind !== 'email_otp' ||
    selected.authMethod.status !== 'active' ||
    selected.authority.state !== 'active' ||
    String(selected.authMethod.walletId) !== walletId ||
    String(selected.authority.walletId) !== walletId
  ) {
    throw new Error('Unlock this wallet with its active Email OTP method');
  }
  const local = await IndexedDBManager.listWalletAuthMethodsForWallet(walletId);
  let providerSubjectId: string | null = null;
  for (const method of local) {
    if (
      method.kind !== 'email_otp' ||
      method.status !== 'active' ||
      method.localStatus !== 'synced' ||
      String(method.authority.bindingId) !== String(selected.authMethod.walletAuthMethodId)
    ) {
      continue;
    }
    if (providerSubjectId !== null) {
      throw new Error('The selected Email OTP owner method is duplicated');
    }
    providerSubjectId = String(method.authority.factor.providerUserId || '').trim();
  }
  if (!providerSubjectId) {
    throw new Error('The selected Email OTP owner method is unavailable on this wallet');
  }
  return {
    walletAuthMethodId: String(selected.authMethod.walletAuthMethodId),
    providerSubjectId,
  };
}

export async function createWalletRecoveryAdminEmailOtpProof(args: {
  readonly context: Pick<RegistrationWebContext, 'signingEngine'>;
  readonly relayUrl: string;
  readonly request: RecoveryAdminRequest;
}): Promise<Extract<WalletCustodyFactorProof, { readonly kind: 'email_otp' }>> {
  const walletId = args.request.payload.walletId;
  const { providerSubjectId } = await selectedEmailOtpOwnerMethod(walletId);
  const requestOrigin = window.location.origin;
  const challengeDigest = await computeWalletCustodyAdminChallengeDigest({
    walletId,
    operation: args.request.operation,
    payload: args.request.payload,
    requestOrigin,
  });
  const challenge = await requestWalletCustodyEmailOtpChallenge({
    relayUrl: args.relayUrl,
    walletId,
    providerSubjectId,
    operation: args.request.operation,
    payload: args.request.payload,
    requestOrigin,
  });
  if (challenge.kind !== 'ready') throw new Error(challenge.message);
  if (challenge.challenge_digest !== challengeDigest) {
    throw new Error('Recovery Email OTP challenge does not match this operation');
  }
  const confirmed = await args.context.signingEngine.requestEmailOtpOwnerConfirmation({
    purpose: args.request.operation,
    walletId,
    emailAddress: 'your email',
    challengeId: challenge.challengeId,
  });
  if (confirmed.challengeId !== challenge.challengeId) {
    throw new Error('Recovery Email OTP confirmation changed its challenge');
  }
  return {
    kind: 'email_otp',
    provider_subject_id: providerSubjectId,
    challenge_id: confirmed.challengeId,
    otp_code: confirmed.otpCode,
    challenge_digest: challengeDigest,
  };
}

export async function readWalletRecoveryCodeStatusWithEmailOtp(args: {
  readonly context: Pick<RegistrationWebContext, 'signingEngine'>;
  readonly relayUrl: string;
  readonly walletId: string;
}): Promise<WalletRecoveryCodeStatusResult> {
  const requestId = recoveryAdminRequestId();
  const payload = { walletId: args.walletId, requestId };
  const factorProof = await createWalletRecoveryAdminEmailOtpProof({
    context: args.context,
    relayUrl: args.relayUrl,
    request: { operation: 'recovery_status', payload },
  });
  return await readWalletRecoveryCodeStatus({
    relayUrl: args.relayUrl,
    walletId: args.walletId,
    requestId,
    factorProof,
  });
}

export async function acknowledgeWalletRecoveryBackupWithEmailOtp(args: {
  readonly context: Pick<RegistrationWebContext, 'signingEngine'>;
  readonly relayUrl: string;
  readonly walletId: string;
  readonly expectedIssuedAtMs: number;
}): Promise<WalletRecoveryBackupAcknowledgementResult> {
  const requestId = recoveryAdminRequestId();
  const payload = {
    walletId: args.walletId,
    requestId,
    expectedIssuedAtMs: args.expectedIssuedAtMs,
  };
  const factorProof = await createWalletRecoveryAdminEmailOtpProof({
    context: args.context,
    relayUrl: args.relayUrl,
    request: { operation: 'recovery_backup_acknowledge', payload },
  });
  return await acknowledgeWalletRecoveryBackup({
    relayUrl: args.relayUrl,
    walletId: args.walletId,
    requestId,
    expectedIssuedAtMs: args.expectedIssuedAtMs,
    factorProof,
  });
}

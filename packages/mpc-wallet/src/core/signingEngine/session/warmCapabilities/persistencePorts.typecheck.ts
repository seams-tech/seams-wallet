import type { AccountId } from '@/core/types/accountIds';
import type {
  ThresholdEcdsaChainTarget,
  WalletId,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { ThresholdEcdsaEmailOtpAuthContext } from '../identity/laneIdentity';
import type { EmailOtpEcdsaReadyPersistInput } from './persistencePorts';
import type { ThresholdEcdsaSessionId } from '../operationState/types';
import type {
  MpcWalletSigningQuotaId,
  WalletSessionId,
} from '@shared/authorization/capabilityKinds';
import type { SealedSigningSessionEcdsaRestoreMetadata } from '@shared/utils/signingSessionSeal';

declare const walletId: WalletId;
declare const accountId: AccountId;
declare const walletSessionId: WalletSessionId;
declare const quotaId: MpcWalletSigningQuotaId;
declare const thresholdSessionId: ThresholdEcdsaSessionId;
declare const chainTarget: ThresholdEcdsaChainTarget;
declare const emailOtpAuthContext: ThresholdEcdsaEmailOtpAuthContext;
declare const passkeyEcdsaRestore: Exclude<
  SealedSigningSessionEcdsaRestoreMetadata,
  { source: 'email_otp' }
>;

void accountId;

void ({
  authMethod: 'email_otp',
  curve: 'ecdsa',
  walletId,
  walletSessionId,
  quotaId,
  thresholdSessionId,
  chainTarget,
  emailOtpAuthContext,
  material: {
    kind: 'worker_handle',
    workerSessionId: 'email-otp-worker-session',
  },
} satisfies EmailOtpEcdsaReadyPersistInput);

// @ts-expect-error Email OTP ECDSA persistence must carry a concrete chain target.
const emailOtpEcdsaMissingChainTarget: EmailOtpEcdsaReadyPersistInput = {
  authMethod: 'email_otp',
  curve: 'ecdsa',
  walletId,
  walletSessionId,
  quotaId,
  thresholdSessionId,
  emailOtpAuthContext,
  material: {
    kind: 'inline',
    clientSecretB64u: 'client-secret',
  },
};
void emailOtpEcdsaMissingChainTarget;

const emailOtpEcdsaWithPasskeyMaterial: EmailOtpEcdsaReadyPersistInput = {
  authMethod: 'email_otp',
  curve: 'ecdsa',
  walletId,
  walletSessionId,
  quotaId,
  thresholdSessionId,
  chainTarget,
  emailOtpAuthContext,
  material: {
    kind: 'worker_handle',
    workerSessionId: 'email-otp-worker-session',
  },
  // @ts-expect-error Email OTP persistence cannot carry passkey PRF seal material.
  passkeyPrfSealMaterial: {
    kind: 'ecdsa_prf_first',
    passkeyPrfFirstB64u: 'passkey-prf-first',
    transport: {
      curve: 'ecdsa',
      authMethod: 'passkey',
      walletId: passkeyEcdsaRestore.authority.walletId,
      chainTarget,
      relayerUrl: 'https://relay.example.test',
      ecdsaRestore: passkeyEcdsaRestore,
    },
  },
};
void emailOtpEcdsaWithPasskeyMaterial;

export {};

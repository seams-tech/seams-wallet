import type {
  ThresholdEcdsaChainTarget,
  WalletId,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { ThresholdEcdsaEmailOtpAuthContext } from '../identity/laneIdentity';
import type { ThresholdEcdsaSessionId } from '../operationState/types';
import type {
  MpcWalletSigningQuotaId,
  WalletSessionId,
} from '@shared/authorization/capabilityKinds';
import type { ExclusiveUnion } from '@shared/utils/variant';

type EmailOtpWarmSessionMaterial = ExclusiveUnion<
  { kind: 'inline'; clientSecretB64u: string } | { kind: 'worker_handle'; workerSessionId: string }
>;

type BaseEmailOtpReadyPersistInput = {
  authMethod: 'email_otp';
  walletId: WalletId;
  walletSessionId: WalletSessionId;
  quotaId: MpcWalletSigningQuotaId;
  credentialIdB64u?: never;
  passkeyPrfSealMaterial?: never;
};

export type EmailOtpEcdsaReadyPersistInput = BaseEmailOtpReadyPersistInput & {
  curve: 'ecdsa';
  chainTarget: ThresholdEcdsaChainTarget;
  thresholdSessionId: ThresholdEcdsaSessionId;
  emailOtpAuthContext: ThresholdEcdsaEmailOtpAuthContext;
  material: EmailOtpWarmSessionMaterial;
  accountId?: never;
};

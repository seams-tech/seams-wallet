import type {
  EcdsaThresholdKeyId,
  DerivationClientSharePublicKey33B64u,
  EcdsaDerivationRelayerPublicKey33B64u,
  SigningRootId,
  SigningRootVersion,
} from '@shared/threshold/ecdsaDerivationRoleLocalBootstrap';
import type { WalletId } from '@shared/utils/domainIds';
import type { PlatformResult } from './http';
import type { RouterAbEcdsaDerivationPublicCapabilityV1 } from '@shared/utils/routerAbEcdsaDerivation';
import type { EcdsaRoleLocalReadyStateBlob } from './generated/signerCoreCommands';
import type { ThresholdEcdsaChainTarget } from '@shared/utils/thresholdEcdsaChainTarget';
import type { ExclusiveUnion } from '@shared/utils/variant';

export type {
  EcdsaThresholdKeyId,
  SigningRootId,
  SigningRootVersion,
} from '@shared/threshold/ecdsaDerivationRoleLocalBootstrap';
export type { WalletId } from '@shared/utils/domainIds';
export type {
  EvmEip155ChainTarget,
  TempoChainTarget,
  ThresholdEcdsaChainTarget,
} from '@shared/utils/thresholdEcdsaChainTarget';
export type {
  EcdsaRoleLocalPendingStateBlob,
  EcdsaRoleLocalReadyStateBlob,
} from './generated/signerCoreCommands';

export type CredentialIdB64u = string & { readonly __brand: 'CredentialIdB64u' };
export type RpId = string & { readonly __brand: 'RpId' };
export type EmailOtpAuthSubjectId = string & {
  readonly __brand: 'EmailOtpAuthSubjectId';
};
export type EcdsaGroupPublicKey33B64u = string & {
  readonly __brand: 'EcdsaGroupPublicKey33B64u';
};
export type RelayerKeyId = string & { readonly __brand: 'RelayerKeyId' };

export type EcdsaRoleLocalPublicFacts = {
  walletId: WalletId;
  chainTarget: ThresholdEcdsaChainTarget;
  keyHandle: string;
  ecdsaThresholdKeyId: EcdsaThresholdKeyId;
  signingRootId: SigningRootId;
  signingRootVersion: SigningRootVersion;
  applicationBindingDigestB64u: string;
  clientParticipantId: 1;
  relayerParticipantId: 2;
  participantIds: readonly [1, 2];
  contextBinding32B64u: string;
  derivationClientSharePublicKey33B64u: DerivationClientSharePublicKey33B64u;
  relayerPublicKey33B64u: EcdsaDerivationRelayerPublicKey33B64u;
  groupPublicKey33B64u: EcdsaGroupPublicKey33B64u;
  ethereumAddress: `0x${string}`;
  publicCapability: RouterAbEcdsaDerivationPublicCapabilityV1;
};

export type EcdsaRoleLocalAuthMethod = ExclusiveUnion<
  | { kind: 'passkey'; credentialIdB64u: CredentialIdB64u; rpId: RpId }
  | { kind: 'email_otp'; authSubjectId: EmailOtpAuthSubjectId }
>;

export type EcdsaRoleLocalReadyRecord =
  | {
      kind: 'ecdsa_role_local_ready_passkey_v1';
      stateBlob: EcdsaRoleLocalReadyStateBlob;
      publicFacts: EcdsaRoleLocalPublicFacts;
      authMethod: Extract<EcdsaRoleLocalAuthMethod, { kind: 'passkey' }>;
    }
  | {
      kind: 'ecdsa_role_local_ready_email_otp_v1';
      stateBlob: EcdsaRoleLocalReadyStateBlob;
      publicFacts: EcdsaRoleLocalPublicFacts;
      authMethod: Extract<EcdsaRoleLocalAuthMethod, { kind: 'email_otp' }>;
    };

export type EcdsaRoleLocalMaterialState =
  | {
      kind: 'ready';
      record: EcdsaRoleLocalReadyRecord;
      reauth?: never;
      cleanup?: never;
    }
  | {
      kind: 'reauth_required';
      walletId: WalletId;
      rpId: RpId;
      chainTarget: ThresholdEcdsaChainTarget;
      keyHandle: string;
      authMethod: EcdsaRoleLocalAuthMethod;
      reason: 'missing_session' | 'expired_session' | 'sealed_session_unavailable';
      record?: never;
      cleanup?: never;
    }
  | {
      kind: 'invalid_cleanup_required';
      cleanup: CleanupMalformedEcdsaRoleLocalRecordInput;
      reason: string;
      record?: never;
      reauth?: never;
    };

export type EcdsaRoleLocalRecordParseResult = ExclusiveUnion<
  | {
      ok: true;
      source: 'ready_record';
      state: Extract<EcdsaRoleLocalMaterialState, { kind: 'ready' | 'reauth_required' }>;
    }
  | {
      ok: false;
      code: 'malformed_record';
      message: string;
      cleanup: CleanupMalformedEcdsaRoleLocalRecordInput;
    }
>;

export type LoadEcdsaRoleLocalReadyRecordInput = {
  walletId: WalletId;
  chainTarget: ThresholdEcdsaChainTarget;
  keyHandle: string;
  ecdsaThresholdKeyId: EcdsaThresholdKeyId;
  signingRootId: SigningRootId;
  signingRootVersion: SigningRootVersion;
  participantIds: readonly [1, 2];
  authMethod: EcdsaRoleLocalAuthMethod;
};

export type LoadEcdsaRoleLocalReadyRecordResult = PlatformResult<
  | { kind: 'found'; record: EcdsaRoleLocalReadyRecord }
  | { kind: 'not_found'; record?: never }
  | {
      kind: 'reauth_required';
      state: Extract<EcdsaRoleLocalMaterialState, { kind: 'reauth_required' }>;
      record?: never;
    }
  | {
      kind: 'malformed';
      cleanup: CleanupMalformedEcdsaRoleLocalRecordInput;
      message: string;
      record?: never;
    },
  'unavailable'
>;

export type PersistEcdsaRoleLocalReadyRecordInput = {
  record: EcdsaRoleLocalReadyRecord;
  storageKeyFacts: LoadEcdsaRoleLocalReadyRecordInput;
};

export type PersistEcdsaRoleLocalReadyRecordResult = PlatformResult<
  { kind: 'persisted' },
  'unavailable' | 'invalid_record'
>;

export type CleanupMalformedEcdsaRoleLocalRecordInput = LoadEcdsaRoleLocalReadyRecordInput & {
  reason: string;
};

export type CleanupMalformedEcdsaRoleLocalRecordResult = PlatformResult<
  { kind: 'deleted' } | { kind: 'not_found' },
  'unavailable'
>;

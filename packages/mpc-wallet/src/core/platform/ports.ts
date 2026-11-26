import type {
  WebAuthnAuthenticationCredential,
  WebAuthnRegistrationCredential,
} from '../types/webauthn';
import type { RpId } from '../signingEngine/session/identity/evmFamilyEcdsaIdentity';
import type {
  DerivationClientSharePublicKey33B64u,
  EcdsaDerivationRelayerPublicKey33B64u,
} from '@shared/threshold/ecdsaDerivationRoleLocalBootstrap';
import type {
  FinalizeEcdsaClientBootstrapCommand as GeneratedFinalizeEcdsaClientBootstrapCommand,
  FinalizeEcdsaClientBootstrapErrorCode as GeneratedFinalizeEcdsaClientBootstrapErrorCode,
  FinalizeEcdsaClientBootstrapOutput as GeneratedFinalizeEcdsaClientBootstrapOutput,
  PrepareEcdsaClientBootstrapCommand as GeneratedPrepareEcdsaClientBootstrapCommand,
  PrepareEcdsaClientBootstrapErrorCode as GeneratedPrepareEcdsaClientBootstrapErrorCode,
  PrepareEcdsaClientBootstrapOutput as GeneratedPrepareEcdsaClientBootstrapOutput,
} from './generated/signerCoreCommands';
import type {
  CloseRouterAbEcdsaRegistrationCeremonyRequestV1,
  CloseRouterAbEcdsaRegistrationCeremonyResultV1,
  CreateRouterAbEcdsaRegistrationCeremonyRequestV1,
  CreateRouterAbEcdsaRegistrationCeremonyResultV1,
  FinalizeRouterAbEcdsaRegistrationActivationRequestV1,
  FinalizeRouterAbEcdsaRegistrationActivationResultV1,
  PersistInitialCanonicalEcdsaActivationRequestV1,
  PersistInitialCanonicalEcdsaActivationResultV1,
  VerifyRouterAbEcdsaRegistrationClientProofsRequestV1,
  VerifyRouterAbEcdsaRegistrationClientProofsResultV1,
} from '../signingEngine/routerAb/ecdsaDerivation/clientCeremony';
import type { PlatformResult } from './http';
import type {
  CleanupMalformedEcdsaRoleLocalRecordInput,
  CleanupMalformedEcdsaRoleLocalRecordResult,
  EcdsaRoleLocalPendingStateBlob,
  EcdsaRoleLocalReadyStateBlob,
  LoadEcdsaRoleLocalReadyRecordInput,
  LoadEcdsaRoleLocalReadyRecordResult,
  PersistEcdsaRoleLocalReadyRecordInput,
  PersistEcdsaRoleLocalReadyRecordResult,
} from './ecdsaRoleLocalRecords';
import type { EcdsaRoleLocalWorkerHandle } from '../signingEngine/session/keyMaterialBrands';
import type { EcdsaBootstrapSecretSource } from './secretSources';
import type { WalletAddAuthMethodRegistrationOptions } from '@shared/utils/addAuthMethodRegistration';
import type { ExclusiveUnion } from '@shared/utils/variant';

export type { CredentialIdB64u } from './ecdsaRoleLocalRecords';

export type SignerCryptoInvocationErrorCode =
  | 'unavailable'
  | 'worker_transport_failure'
  | 'native_binding_failure'
  | 'timeout';

export type SignerCryptoResult<Ok, CommandCode extends string> = ExclusiveUnion<
  | { ok: true; value: Ok }
  | { ok: false; failure: 'command'; code: CommandCode; message: string }
  | { ok: false; failure: 'invocation'; code: SignerCryptoInvocationErrorCode; message: string }
>;

export type DurableRecordStore = {
  kind: 'durable_record_store';
  loadEcdsaRoleLocalReadyRecord(
    input: LoadEcdsaRoleLocalReadyRecordInput,
  ): Promise<LoadEcdsaRoleLocalReadyRecordResult>;
  persistEcdsaRoleLocalReadyRecord(
    input: PersistEcdsaRoleLocalReadyRecordInput,
  ): Promise<PersistEcdsaRoleLocalReadyRecordResult>;
  cleanupMalformedEcdsaRoleLocalRecord(
    input: CleanupMalformedEcdsaRoleLocalRecordInput,
  ): Promise<CleanupMalformedEcdsaRoleLocalRecordResult>;
};

export type SecureSecretStore = {
  kind: 'secure_secret_store';
  seal(input: {
    purpose: string;
    secretB64u: string;
  }): Promise<PlatformResult<{ handle: string }, 'unavailable'>>;
  unseal(input: {
    handle: string;
  }): Promise<PlatformResult<{ secretB64u: string }, 'unavailable' | 'not_found'>>;
  delete(input: { handle: string }): Promise<PlatformResult<void, 'unavailable'>>;
};

export type AuthenticatorOperation =
  | {
      kind: 'create_passkey';
      registrationOptions: WalletAddAuthMethodRegistrationOptions;
      requirePrfFirst: true;
    }
  | {
      kind: 'create_passkey';
      registrationOptions: WalletAddAuthMethodRegistrationOptions;
      requirePrfFirst: false;
    }
  | {
      kind: 'get_passkey';
      rpId: RpId;
      credentialIdB64u: string;
      challengeB64u: string;
      requirePrfFirst: true;
    }
  | {
      kind: 'get_passkey';
      rpId: RpId;
      credentialIdB64u: string;
      challengeB64u: string;
      requirePrfFirst: false;
    };

export type AuthenticatorResult =
  | {
      ok: true;
      operation: 'create_passkey';
      requirePrfFirst: true;
      credential: WebAuthnRegistrationCredential;
      credentialIdB64u: string;
      rawIdB64u: string;
      rpId: RpId;
      prf: {
        kind: 'required';
        prfFirstB64u: string;
      };
    }
  | {
      ok: true;
      operation: 'create_passkey';
      requirePrfFirst: false;
      credential: WebAuthnRegistrationCredential;
      credentialIdB64u: string;
      rawIdB64u: string;
      rpId: RpId;
      prf:
        | {
            kind: 'available_without_requirement';
            prfFirstB64u: string;
          }
        | {
            kind: 'not_requested_or_unavailable';
            prfFirstB64u?: never;
          };
    }
  | {
      ok: true;
      operation: 'get_passkey';
      requirePrfFirst: true;
      credential: WebAuthnAuthenticationCredential;
      credentialIdB64u: string;
      rawIdB64u: string;
      rpId: RpId;
      prf: {
        kind: 'required';
        prfFirstB64u: string;
      };
    }
  | {
      ok: true;
      operation: 'get_passkey';
      requirePrfFirst: false;
      credential: WebAuthnAuthenticationCredential;
      credentialIdB64u: string;
      rawIdB64u: string;
      rpId: RpId;
      prf:
        | {
            kind: 'available_without_requirement';
            prfFirstB64u: string;
          }
        | {
            kind: 'not_requested_or_unavailable';
            prfFirstB64u?: never;
          };
    }
  | {
      ok: false;
      code:
        | 'unavailable'
        | 'cancelled'
        | 'not_allowed'
        | 'prf_unavailable'
        | 'invalid_credential'
        | 'platform_error';
      message: string;
    };

export type RequiredPrfAuthenticatorSuccess = Extract<
  AuthenticatorResult,
  { ok: true; requirePrfFirst: true }
>;

export type AuthenticatorPort = {
  kind: 'authenticator';
  run(operation: AuthenticatorOperation): Promise<AuthenticatorResult>;
};

export type PrepareEcdsaClientBootstrapInput = {
  kind: GeneratedPrepareEcdsaClientBootstrapCommand['kind'];
  algorithm: GeneratedPrepareEcdsaClientBootstrapCommand['algorithm'];
  context: {
    applicationBindingDigestB64u: string;
  };
  participants: {
    clientParticipantId: 1;
    relayerParticipantId: 2;
    participantIds: readonly [1, 2];
  };
  secretSource: EcdsaBootstrapSecretSource;
};

export type EcdsaClientBootstrapFacts = {
  contextBinding32B64u: GeneratedPrepareEcdsaClientBootstrapOutput['clientBootstrap']['contextBinding32B64u'];
  derivationClientSharePublicKey33B64u: DerivationClientSharePublicKey33B64u;
  clientShareRetryCounter: GeneratedPrepareEcdsaClientBootstrapOutput['clientBootstrap']['clientShareRetryCounter'];
  participantId: 1;
};

export type EcdsaPreparePublicFacts = {
  derivationClientSharePublicKey33B64u: DerivationClientSharePublicKey33B64u;
  clientVerifyingShareB64u: GeneratedPrepareEcdsaClientBootstrapOutput['publicFacts']['clientVerifyingShareB64u'];
};

export type PrepareEcdsaClientBootstrapOutput = {
  pendingStateBlob: EcdsaRoleLocalPendingStateBlob;
  clientBootstrap: EcdsaClientBootstrapFacts;
  publicFacts: EcdsaPreparePublicFacts;
};

export type FinalizeEcdsaClientBootstrapInput = {
  kind: GeneratedFinalizeEcdsaClientBootstrapCommand['kind'];
  pendingStateBlob: EcdsaRoleLocalPendingStateBlob;
  relayerPublicIdentity: {
    relayerKeyId: string;
    relayerPublicKey33B64u: EcdsaDerivationRelayerPublicKey33B64u;
    groupPublicKey33B64u: string;
    ethereumAddress: `0x${string}`;
    relayerShareRetryCounter: number;
  };
};

export type FinalizeEcdsaClientBootstrapOutput = {
  stateBlob: EcdsaRoleLocalReadyStateBlob;
  publicFacts: {
    contextBinding32B64u: GeneratedFinalizeEcdsaClientBootstrapOutput['publicFacts']['contextBinding32B64u'];
    derivationClientSharePublicKey33B64u: DerivationClientSharePublicKey33B64u;
    clientVerifyingShareB64u: GeneratedFinalizeEcdsaClientBootstrapOutput['publicFacts']['clientVerifyingShareB64u'];
    relayerPublicKey33B64u: EcdsaDerivationRelayerPublicKey33B64u;
    groupPublicKey33B64u: GeneratedFinalizeEcdsaClientBootstrapOutput['publicFacts']['groupPublicKey33B64u'];
    ethereumAddress: `0x${string}`;
  };
};

export type PrepareEcdsaClientBootstrapErrorCode = GeneratedPrepareEcdsaClientBootstrapErrorCode;

export type FinalizeEcdsaClientBootstrapErrorCode = GeneratedFinalizeEcdsaClientBootstrapErrorCode;

export type StoreEcdsaRoleLocalSigningMaterialInput = {
  kind: 'store_ecdsa_role_local_signing_material_v1';
  handle: EcdsaRoleLocalWorkerHandle;
  stateBlob: EcdsaRoleLocalReadyStateBlob;
};

export type StoreEcdsaRoleLocalSigningMaterialOutput = {
  handle: EcdsaRoleLocalWorkerHandle;
};

export type StoreEcdsaRoleLocalSigningMaterialErrorCode = 'invalid_ready_state' | 'crypto_failure';

export type SignerCryptoPort = {
  kind: 'signer_crypto';
  createRouterAbEcdsaRegistrationCeremony(
    input: CreateRouterAbEcdsaRegistrationCeremonyRequestV1,
  ): Promise<CreateRouterAbEcdsaRegistrationCeremonyResultV1>;
  verifyRouterAbEcdsaRegistrationClientProofs(
    input: VerifyRouterAbEcdsaRegistrationClientProofsRequestV1,
  ): Promise<VerifyRouterAbEcdsaRegistrationClientProofsResultV1>;
  persistInitialCanonicalEcdsaActivation(
    input: PersistInitialCanonicalEcdsaActivationRequestV1,
  ): Promise<PersistInitialCanonicalEcdsaActivationResultV1>;
  finalizeRouterAbEcdsaRegistrationActivation(
    input: FinalizeRouterAbEcdsaRegistrationActivationRequestV1,
  ): Promise<FinalizeRouterAbEcdsaRegistrationActivationResultV1>;
  closeRouterAbEcdsaRegistrationCeremony(
    input: CloseRouterAbEcdsaRegistrationCeremonyRequestV1,
  ): Promise<CloseRouterAbEcdsaRegistrationCeremonyResultV1>;
  prepareEcdsaClientBootstrap(
    input: PrepareEcdsaClientBootstrapInput,
  ): Promise<
    SignerCryptoResult<PrepareEcdsaClientBootstrapOutput, PrepareEcdsaClientBootstrapErrorCode>
  >;
  finalizeEcdsaClientBootstrap(
    input: FinalizeEcdsaClientBootstrapInput,
  ): Promise<
    SignerCryptoResult<FinalizeEcdsaClientBootstrapOutput, FinalizeEcdsaClientBootstrapErrorCode>
  >;
  storeEcdsaRoleLocalSigningMaterial(
    input: StoreEcdsaRoleLocalSigningMaterialInput,
  ): Promise<
    SignerCryptoResult<
      StoreEcdsaRoleLocalSigningMaterialOutput,
      StoreEcdsaRoleLocalSigningMaterialErrorCode
    >
  >;
};

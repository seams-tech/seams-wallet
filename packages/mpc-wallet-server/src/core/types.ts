// Platform-agnostic types for server functionality
import { AuthenticatorOptions, OriginPolicyInput } from '@shared/utils/authenticatorOptions';
import type { InitInput } from '../../../../wasm/near_signer/pkg/wasm_signer_worker.js';
import type { Ed25519AuthorityScope } from '@shared/threshold/sessionPolicy';
import type { RuntimePolicyScope } from '@shared/threshold/signingRootScope';
import type { EcdsaDerivationRoleLocalPublicIdentity } from '@shared/threshold/ecdsaDerivationRoleLocalBootstrap';
import type { RouterAbEd25519NormalSigningState } from '@shared/utils/signingSessionSeal';
import type {
  RouterAbEcdsaDerivationNormalSigningScopeV1,
  RouterAbEcdsaDerivationNormalSigningStateV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import type { WalletAuthAuthority } from '@shared/utils/walletAuthAuthority';
import type { RootShareEpoch } from '@shared/utils/domainIds';
import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking';
import type { WalletSessionId } from '@shared/authorization/capabilityKinds';

export interface ServerResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type SignerWasmModuleSupplier =
  | InitInput
  | Promise<InitInput>
  | (() => InitInput | Promise<InitInput>);

// Structural types so Workers can pass Durable Object bindings without depending on CF type packages.
export interface CloudflareDurableObjectStubLike {
  fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
}

export interface CloudflareDurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): CloudflareDurableObjectStubLike;
}

export type GithubOAuthConfig = {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
};

// Account creation and registration types shared by Router API flows.
export interface AccountCreationRequest {
  accountId: string;
  publicKey: string;
  recoveryPublicKey?: string;
}

export interface AccountCreationResult {
  success: boolean;
  transactionHash?: string;
  accountId?: string;
  error?: string;
  message?: string;
}

export interface FundImplicitNearAccountRequest {
  walletId: string;
  nearAccountId: string;
  nearPublicKeyStr: string;
}

export type FundImplicitNearAccountResult =
  | {
      ok: true;
      walletId: string;
      nearAccountId: string;
      fundedAmountYocto: string;
      transactionHash?: string;
      message?: string;
    }
  | {
      ok: false;
      code: 'not_configured' | 'invalid_request' | 'funding_failed';
      message: string;
    };

// Re-export authenticator types from core
export type { AuthenticatorOptions, OriginPolicyInput };

export interface WebAuthnAuthenticationCredential {
  id: string;
  rawId: string; // base64-encoded
  type: string;
  authenticatorAttachment: string | null;
  response: {
    clientDataJSON: string; // base64url-encoded
    authenticatorData: string; // base64url-encoded
    signature: string; // base64url-encoded
    userHandle: string | null; // base64url-encoded or null
  };
  clientExtensionResults: any | null;
}

// ================================
// Threshold Ed25519 (2-party) APIs
// ================================

export type ThresholdRuntimePolicyScope = RuntimePolicyScope;

export type ThresholdEcdsaSigningRootMetadata = {
  signingRootId: string;
  signingRootVersion?: string;
  walletKeyVersion: string;
  derivationVersion: number;
};

export type ThresholdRuntimeSnapshotExpectation = {
  snapshotId?: string;
  version?: number;
  checksum?: string;
};

export type ThresholdEd25519AuthorityScope = Ed25519AuthorityScope;

export type Ed25519SessionPolicy = {
  version: 'threshold_session_v1';
  nearAccountId: string;
  nearEd25519SigningKeyId: string;
  authority: WalletAuthAuthority;
  relayerKeyId: string;
  thresholdSessionId: string;
  runtimePolicyScope?: ThresholdRuntimePolicyScope;
  routerAbNormalSigning?: RouterAbEd25519NormalSigningState;
  /** Optional participant ids that scope the session to a signer set. */
  participantIds?: number[];
  ttlMs: number;
  remainingUses: number;
};
export type EcdsaThresholdKeyId = string;
export type ThresholdEcdsaChainTarget =
  import('./thresholdEcdsaChainTarget').ThresholdEcdsaChainTarget;

export type RegistrationPreparationId = string & { readonly __brand: 'RegistrationPreparationId' };

export function registrationPreparationIdFromString(value: string): RegistrationPreparationId {
  return String(value || '').trim() as RegistrationPreparationId;
}

export type WalletKeyFactsInventoryAuth =
  | {
      kind: 'webauthn_assertion';
      credential: WebAuthnAuthenticationCredential;
      expectedChallengeDigestB64u: string;
      serverNonceB64u: string;
      runtimePolicyScope?: RuntimePolicyScope;
      curve?: never;
    }
  | {
      kind: WalletSessionOperationCredentialV1['kind'];
      walletSessionId: WalletSessionId;
    }
  | {
      kind: 'opaque_hosted_wallet_session_operation_credential_v1';
      walletSessionId: WalletSessionId;
    };

export type EcdsaDerivationRoleLocalFormatVersion = 'ecdsa-derivation-role-local';
export type EcdsaDerivationKeyScope = 'evm-family';

export interface EcdsaDerivationPublicIdentity extends EcdsaDerivationRoleLocalPublicIdentity {}

export interface EcdsaDerivationServerBootstrapResponse {
  formatVersion: EcdsaDerivationRoleLocalFormatVersion;
  walletId: string;
  evmFamilySigningKeySlotId: string;
  ecdsaThresholdKeyId: EcdsaThresholdKeyId;
  relayerKeyId: string;
  applicationBindingDigestB64u: string;
  contextBinding32B64u: string;
  publicIdentity: EcdsaDerivationPublicIdentity;
  clientShareRetryCounter: number;
  relayerShareRetryCounter: number;
  keyHandle: string;
  signingRootId: string;
  signingRootVersion: string;
  thresholdEcdsaPublicKeyB64u: string;
  ethereumAddress: string;
  relayerVerifyingShareB64u: string;
  participantIds: number[];
  thresholdSessionId: string;
  activationEpoch: RootShareEpoch;
  expiresAtMs: number;
  expiresAt: string;
  remainingUses: number;
  routerAbEcdsaDerivationNormalSigning: RouterAbEcdsaDerivationNormalSigningStateV1;
}

// =====================================
// Router A/B ECDSA derivation pool-fill routes
// =====================================

export type RouterAbEcdsaDerivationPoolFillInitRequest = {
  presignSessionId: string;
  firstMessageB64u: string;
  keyHandle?: string;
  ecdsaThresholdKeyId?: EcdsaThresholdKeyId;
  /**
   * Number of presignatures to generate.
   * v1 supports only `1` (single presignature session).
   */
  count?: number;
  /**
   * Optional client-provided request classification for logging/observability.
   * Example: `background_presign_pool_refill`.
   */
  requestTag?: string;
  poolFill: {
    kind: 'router_ab_ecdsa_derivation_signing_worker_pool';
    scope: RouterAbEcdsaDerivationNormalSigningScopeV1;
    ceremonyExpiresAtMs: number;
    materialExpiresAtMs: number;
  };
};

export type RouterAbEcdsaDerivationPoolFillInitResponse = {
  ok: boolean;
  code?: string;
  message?: string;
  presignSessionId?: string;
  ceremonyExpiresAtMs?: number;
  materialExpiresAtMs?: number;
  stage?: 'triples' | 'triples_done' | 'presign' | 'done';
  outgoingMessagesB64u?: string[];
};

export type RouterAbEcdsaDerivationPoolFillStepRequest = {
  presignSessionId: string;
  ceremonyExpiresAtMs: number;
  materialExpiresAtMs: number;
  /**
   * The client-requested stage transition:
   * - `triples`: continue triple generation
   * - `presign`: start/continue presigning (only valid once server is `triples_done`)
   */
  stage: 'triples' | 'presign';
  outgoingMessagesB64u?: string[];
  /**
   * Optional client-provided request classification for logging/observability.
   * Example: `background_presign_pool_refill`.
   */
  requestTag?: string;
};

export type RouterAbEcdsaDerivationPoolFillStepResponse = {
  ok: boolean;
  code?: string;
  message?: string;
  stage?: 'triples' | 'triples_done' | 'presign' | 'done';
  event?: 'none' | 'triples_done' | 'presign_done';
  outgoingMessagesB64u?: string[];
  /** Deterministic id derived from `bigR` (only present when `event==='presign_done'`). */
  presignatureId?: string;
  /** Base64url-encoded compressed secp256k1 point (33 bytes) for `R` (only present when `event==='presign_done'`). */
  bigRB64u?: string;
};

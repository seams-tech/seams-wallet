import type { EcdsaDerivationServerBootstrapResponse } from './types';
import type {
  AddAuthMethodIntentGrant,
  AddAuthMethodIntentV1,
  AddSignerIntentGrant,
  AddSignerIntentV1,
  RegistrationIntentV1,
  WalletAddAuthMethodFinalizeSuccess,
  WalletAddSignerEcdsaPreparePayload,
  WalletAddSignerFinalizeRequest,
  WalletAddAuthMethodRegistrationOptions,
  WalletAddSignerFinalizeSuccess,
  WalletRegistrationEcdsaPreparePayload,
  WalletId,
} from './registrationContracts';
import type {
  RegistrationAuthority,
  RegistrationNearAccountProvisioning,
  RegistrationSignerPlanBranch,
  RegistrationSignerRequest,
  RegistrationSignerPlan,
  RegistrationSignerBranchKey,
} from '@shared/utils/registrationIntent';
import { type PasskeyCustodyEnvelopeRecord } from '@shared/passkey-custody';
import {
  normalizeRegistrationSignerPlan,
  registrationSignerPlanFromSelection,
} from '@shared/utils/registrationIntent';
import { type WalletAuthMethodId, type WalletAuthorityId } from '@shared/utils/domainIds';
import { type DeviceId } from '@shared/authorization/capabilityKinds';
import { type DigestB64u } from '@shared/utils/canonicalPrimitives';
import type { RuntimePolicyScope } from '@shared/threshold/signingRootScope';
import {
  thresholdEcdsaChainTargetFromValue,
  type ThresholdEcdsaChainTarget,
} from './thresholdEcdsaChainTarget';
import type {
  RouterAbEd25519YaoActivationAdmissionReceiptV1,
  RouterAbEd25519YaoActivationResultV1,
  RouterAbEd25519YaoBytes32V1,
  RouterAbEd25519YaoRegistrationAdmissionRequestV1,
} from '@shared/utils/routerAbEd25519Yao';
import type {
  RouterAbEcdsaDerivationPublicCapabilityV1,
  RouterAbEcdsaRegistrationActivationReceiptV1,
  RouterAbEcdsaRegistrationRequestV1,
  RouterAbEcdsaStrictForwardedRegistrationResponseV1,
  RouterAbEcdsaVerifiedClientActivationFactsV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import type { RouterAbEcdsaPendingActivationV1 } from '../router/domains/ecdsa/routerAbEcdsaStrictRegistration';
import type { WalletEd25519SignerRecord } from './WalletStore';
import { type WalletAuthAuthorityRef } from '@shared/utils/walletAuthAuthority';

export type StoredAddSignerIntent = {
  kind: 'add_signer_intent_allocated';
  grant: AddSignerIntentGrant;
  intent: AddSignerIntentV1;
  digestB64u: string;
  orgId: string;
  signingRootId?: string;
  signingRootVersion?: string;
  expectedOrigin?: string;
  expiresAtMs: number;
  consumedAtMs?: never;
};

type ConsumedAddSignerIntent = Omit<StoredAddSignerIntent, 'kind' | 'consumedAtMs'> & {
  kind: 'add_signer_intent_consumed';
  consumedAtMs: number;
};

export type StoredAddAuthMethodIntent = {
  kind: 'add_auth_method_intent_allocated';
  grant: AddAuthMethodIntentGrant;
  intent: AddAuthMethodIntentV1;
  digestB64u: string;
  orgId: string;
  signingRootId?: string;
  signingRootVersion?: string;
  expectedOrigin?: string;
  expiresAtMs: number;
  consumedAtMs?: never;
};

type ConsumedAddAuthMethodIntent = Omit<StoredAddAuthMethodIntent, 'kind' | 'consumedAtMs'> & {
  kind: 'add_auth_method_intent_consumed';
  consumedAtMs: number;
};

export type StoredRegistrationAuthority = RegistrationAuthority;

type WalletAddSignerEcdsaStartPayload = Omit<WalletAddSignerEcdsaPreparePayload, 'custodyEnvelope'>;

type StoredWalletRegistrationRuntimePolicyContext =
  | {
      kind: 'runtime_policy_scope';
      scope: RuntimePolicyScope;
    }
  | {
      kind: 'signing_root_only';
      scope?: never;
    };

type StoredWalletRegistrationEcdsaPreparedContext =
  | {
      kind: 'evm_family_ecdsa_requested';
      chainTargets: readonly ThresholdEcdsaChainTarget[];
    }
  | {
      kind: 'evm_family_ecdsa_absent';
      chainTargets?: never;
    };

export type StoredWalletRegistrationPreparedContext = {
  kind: 'wallet_registration_prepared_context_v1';
  signingRootId: string;
  signingRootVersion: string;
  runtimePolicy: StoredWalletRegistrationRuntimePolicyContext;
  ecdsa: StoredWalletRegistrationEcdsaPreparedContext;
};

export function buildStoredWalletRegistrationPreparedContext(input: {
  signingRootId: string;
  signingRootVersion: string;
  runtimePolicyScope: RuntimePolicyScope | null;
  ecdsaChainTargets: readonly ThresholdEcdsaChainTarget[] | null;
}): StoredWalletRegistrationPreparedContext {
  const signingRootId = String(input.signingRootId || '').trim();
  const signingRootVersion = String(input.signingRootVersion || '').trim();
  if (!signingRootId || !signingRootVersion) {
    throw new Error('registration prepared context requires signing-root scope');
  }
  return {
    kind: 'wallet_registration_prepared_context_v1',
    signingRootId,
    signingRootVersion,
    runtimePolicy: input.runtimePolicyScope
      ? {
          kind: 'runtime_policy_scope',
          scope: {
            orgId: input.runtimePolicyScope.orgId,
            projectId: input.runtimePolicyScope.projectId,
            envId: input.runtimePolicyScope.envId,
            signingRootVersion: input.runtimePolicyScope.signingRootVersion,
          },
        }
      : { kind: 'signing_root_only' },
    ecdsa:
      input.ecdsaChainTargets && input.ecdsaChainTargets.length > 0
        ? {
            kind: 'evm_family_ecdsa_requested',
            chainTargets: input.ecdsaChainTargets.map((target) => ({ ...target })),
          }
        : { kind: 'evm_family_ecdsa_absent' },
  };
}

export function storedRegistrationAuthoritiesMatch(
  left: StoredRegistrationAuthority,
  right: StoredRegistrationAuthority,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'passkey':
      return (
        right.kind === 'passkey' &&
        left.walletId === right.walletId &&
        left.rpId === right.rpId &&
        left.credentialIdB64u === right.credentialIdB64u &&
        left.credentialPublicKeyB64u === right.credentialPublicKeyB64u &&
        left.registrationIntentDigestB64u === right.registrationIntentDigestB64u
      );
    case 'email_otp':
      return (
        right.kind === 'email_otp' &&
        left.proofKind === right.proofKind &&
        left.walletId === right.walletId &&
        left.providerSubject === right.providerSubject &&
        left.emailHashHex === right.emailHashHex &&
        left.registrationAuthorityId === right.registrationAuthorityId &&
        left.finalWalletId === right.finalWalletId &&
        left.orgId === right.orgId &&
        left.registrationIntentDigestB64u === right.registrationIntentDigestB64u
      );
    default: {
      const exhaustive: never = left;
      return exhaustive;
    }
  }
}

type StoredEcdsaRegistrationBase = Omit<WalletRegistrationEcdsaPreparePayload, 'kind'> & {
  derivationKind: WalletRegistrationEcdsaPreparePayload['kind'];
  strictRegistrationBindingJson: string;
};

export type StoredWalletRegistrationEvmFamilyEcdsaPreparedBranch = StoredEcdsaRegistrationBase & {
  kind: 'evm_family_ecdsa_prepared';
  branchKey: RegistrationSignerBranchKey;
};

export type StoredWalletRegistrationEvmFamilyEcdsaPendingActivationBranch =
  StoredEcdsaRegistrationBase & {
    kind: 'evm_family_ecdsa_pending_activation';
    branchKey: RegistrationSignerBranchKey;
    registrationRequest: RouterAbEcdsaRegistrationRequestV1;
    pendingActivation: RouterAbEcdsaPendingActivationV1;
    publicResponse: RouterAbEcdsaStrictForwardedRegistrationResponseV1;
  };

export type StoredWalletRegistrationEvmFamilyEcdsaResponseClaimedBranch =
  StoredEcdsaRegistrationBase & {
    kind: 'evm_family_ecdsa_response_claimed';
    branchKey: RegistrationSignerBranchKey;
    registrationRequest: RouterAbEcdsaRegistrationRequestV1;
    projectEnvironmentId: string;
    tenantRootIdentityDigestB64u: string;
    tenantRootCustodyLineageB64u: string;
  };

export type StoredWalletRegistrationEvmFamilyEcdsaActivationClaimedBranch =
  StoredEcdsaRegistrationBase & {
    kind: 'evm_family_ecdsa_activation_claimed';
    branchKey: RegistrationSignerBranchKey;
    registrationRequest: RouterAbEcdsaRegistrationRequestV1;
    pendingActivation: RouterAbEcdsaPendingActivationV1;
    publicResponse: RouterAbEcdsaStrictForwardedRegistrationResponseV1;
    publicFacts: RouterAbEcdsaVerifiedClientActivationFactsV1;
    activationRequestDigestB64u: string;
    /**
     * The activate operation (idempotency key) that claimed this activation.
     * One owner per ceremony: only the claiming operation may resume the
     * claim or read its result, so a second activate with a different key
     * cannot adopt the claim and re-run custody. Empty only on rows written
     * before this field existed.
     */
    activationOwner: string;
  };

export type StoredWalletRegistrationEvmFamilyEcdsaActivatedBranch = StoredEcdsaRegistrationBase & {
  kind: 'evm_family_ecdsa_activated';
  branchKey: RegistrationSignerBranchKey;
  registrationRequest: RouterAbEcdsaRegistrationRequestV1;
  publicFacts: RouterAbEcdsaVerifiedClientActivationFactsV1;
  activation: RouterAbEcdsaRegistrationActivationReceiptV1;
  publicCapability: RouterAbEcdsaDerivationPublicCapabilityV1;
  bootstrap: EcdsaDerivationServerBootstrapResponse;
  /** Carried from the claim: only the owning operation may read this result back. */
  activationOwner: string;
};

/**
 * The ECDSA signer is durable and the wallet is usable. Reached only on a plan
 * that also has an Ed25519 branch: registration returns ECDSA-ready here and
 * the ceremony stays open for the Ed25519 finalize. On an ECDSA-only plan the
 * ceremony is deleted instead, so this state never appears.
 */
export type StoredWalletRegistrationEvmFamilyEcdsaFinalizedBranch = StoredEcdsaRegistrationBase & {
  kind: 'evm_family_ecdsa_finalized';
  branchKey: RegistrationSignerBranchKey;
  registrationRequest: RouterAbEcdsaRegistrationRequestV1;
  publicFacts: RouterAbEcdsaVerifiedClientActivationFactsV1;
  activation: RouterAbEcdsaRegistrationActivationReceiptV1;
  publicCapability: RouterAbEcdsaDerivationPublicCapabilityV1;
  bootstrap: EcdsaDerivationServerBootstrapResponse;
  finalizedAtMs: number;
};

export type StoredWalletRegistrationNearEd25519YaoAuthorizedBranch = {
  kind: 'near_ed25519_yao_authorized';
  branchKey: RegistrationSignerBranchKey;
  admissionRequest: RouterAbEd25519YaoRegistrationAdmissionRequestV1;
};

export type StoredWalletRegistrationSignerBranch =
  | StoredWalletRegistrationNearEd25519YaoAuthorizedBranch
  | StoredWalletRegistrationEvmFamilyEcdsaPreparedBranch
  | StoredWalletRegistrationEvmFamilyEcdsaResponseClaimedBranch
  | StoredWalletRegistrationEvmFamilyEcdsaPendingActivationBranch
  | StoredWalletRegistrationEvmFamilyEcdsaActivationClaimedBranch
  | StoredWalletRegistrationEvmFamilyEcdsaActivatedBranch
  | StoredWalletRegistrationEvmFamilyEcdsaFinalizedBranch;

export type StoredWalletRegistrationSignerSetState = {
  kind: 'signer_set_registration';
  branches: readonly StoredWalletRegistrationSignerBranch[];
};

type StoredWalletRegistrationEvmFamilyEcdsaBranch =
  | StoredWalletRegistrationEvmFamilyEcdsaPreparedBranch
  | StoredWalletRegistrationEvmFamilyEcdsaResponseClaimedBranch
  | StoredWalletRegistrationEvmFamilyEcdsaPendingActivationBranch
  | StoredWalletRegistrationEvmFamilyEcdsaActivationClaimedBranch
  | StoredWalletRegistrationEvmFamilyEcdsaActivatedBranch
  | StoredWalletRegistrationEvmFamilyEcdsaFinalizedBranch;

export function buildStoredWalletRegistrationEvmFamilyEcdsaFinalizedBranch(input: {
  readonly activated: StoredWalletRegistrationEvmFamilyEcdsaActivatedBranch;
  readonly finalizedAtMs: number;
}): StoredWalletRegistrationEvmFamilyEcdsaFinalizedBranch {
  /* The finalized branch is terminal: the activation owner has read its
     result, so the ownership field does not survive into it. */
  const { activationOwner: _activationOwner, ...activated } = input.activated;
  return { ...activated, kind: 'evm_family_ecdsa_finalized', finalizedAtMs: input.finalizedAtMs };
}

export function buildStoredWalletRegistrationEvmFamilyEcdsaPreparedBranch(input: {
  readonly branchKey: RegistrationSignerBranchKey;
  readonly ecdsa: {
    readonly kind: StoredWalletRegistrationEvmFamilyEcdsaPreparedBranch['derivationKind'];
    readonly chainTargets: StoredWalletRegistrationEvmFamilyEcdsaPreparedBranch['chainTargets'];
    readonly prepare: StoredWalletRegistrationEvmFamilyEcdsaPreparedBranch['prepare'];
    readonly strictRegistration: StoredWalletRegistrationEvmFamilyEcdsaPreparedBranch['strictRegistration'];
    readonly strictRegistrationBindingJson: string;
  };
}): StoredWalletRegistrationEvmFamilyEcdsaPreparedBranch {
  return {
    kind: 'evm_family_ecdsa_prepared',
    branchKey: input.branchKey,
    derivationKind: input.ecdsa.kind,
    chainTargets: input.ecdsa.chainTargets,
    prepare: input.ecdsa.prepare,
    strictRegistration: input.ecdsa.strictRegistration,
    strictRegistrationBindingJson: input.ecdsa.strictRegistrationBindingJson,
  };
}

export function buildStoredWalletRegistrationNearEd25519YaoAuthorizedBranch(input: {
  readonly branchKey: RegistrationSignerBranchKey;
  readonly admissionRequest: RouterAbEd25519YaoRegistrationAdmissionRequestV1;
}): StoredWalletRegistrationNearEd25519YaoAuthorizedBranch {
  return {
    kind: 'near_ed25519_yao_authorized',
    branchKey: input.branchKey,
    admissionRequest: input.admissionRequest,
  };
}

export function findStoredWalletRegistrationNearEd25519YaoBranch(
  state: StoredWalletRegistrationSignerSetState,
): StoredWalletRegistrationNearEd25519YaoAuthorizedBranch | null {
  for (const branch of state.branches) {
    if (branch.kind === 'near_ed25519_yao_authorized') return branch;
  }
  return null;
}

export function findStoredWalletRegistrationEvmFamilyEcdsaBranch(
  state: StoredWalletRegistrationSignerSetState,
): StoredWalletRegistrationEvmFamilyEcdsaBranch | null {
  for (const branch of state.branches) {
    if (
      branch.kind === 'evm_family_ecdsa_prepared' ||
      branch.kind === 'evm_family_ecdsa_response_claimed' ||
      branch.kind === 'evm_family_ecdsa_pending_activation' ||
      branch.kind === 'evm_family_ecdsa_activation_claimed' ||
      branch.kind === 'evm_family_ecdsa_activated' ||
      branch.kind === 'evm_family_ecdsa_finalized'
    ) {
      return branch;
    }
  }
  return null;
}

export function replaceStoredWalletRegistrationSignerBranch(input: {
  readonly state: StoredWalletRegistrationSignerSetState;
  readonly replacement: StoredWalletRegistrationSignerBranch;
}): StoredWalletRegistrationSignerSetState {
  return {
    kind: 'signer_set_registration',
    branches: input.state.branches.map((branch) =>
      branch.branchKey === input.replacement.branchKey ? input.replacement : branch,
    ),
  };
}

type StoredWalletRegistrationFailed = {
  kind: 'registration_failed';
  failedAtMs: number;
  failure: {
    code: string;
    message: string;
  };
  ceremonyHandle?: never;
  preparedSession?: never;
  clientOtOfferMessageB64u?: never;
  prepare?: never;
  walletKeys?: never;
  responded?: never;
  completed?: never;
};

type StoredWalletRegistrationSignerState =
  | StoredWalletRegistrationSignerSetState
  | StoredWalletRegistrationFailed;

/**
 * A registration ceremony exists before its authority proof does.
 *
 * `/wallets/register/setup` issues the challenge the client's WebAuthn create
 * must sign, so the ceremony — and the Router preparation work bound to it —
 * is necessarily created *before* the user has touched the sensor. The proof
 * arrives one leg later, on `/wallets/register/respond`, which binds it.
 *
 * This is a union rather than an optional field so that no reader can consume
 * an authority that has not been verified: the awaiting arm carries only the
 * requested auth method, which is public intent data, and offers no
 * `authority` to read.
 */
export type StoredWalletRegistrationCeremonyAuthorityState =
  | {
      kind: 'awaiting_proof';
      /** The requested method, echoed from the intent; not evidence of anything. */
      authMethod: RegistrationIntentV1['authMethod'];
      authority?: never;
    }
  | {
      kind: 'verified';
      authority: StoredRegistrationAuthority;
      authMethod?: never;
    };

type StoredWalletRegistrationCeremonyBase = {
  registrationCeremonyId: string;
  foundingWalletAuthorityId: WalletAuthorityId;
  foundingDeviceId: DeviceId;
  foundingWalletAuthMethodId: WalletAuthMethodId;
  intent: RegistrationIntentV1;
  digestB64u: string;
  signerPlan: RegistrationSignerPlan;
  preparedContext: StoredWalletRegistrationPreparedContext;
  orgId: string;
  signingRootId?: string;
  signingRootVersion?: string;
  expectedOrigin?: string;
  expiresAtMs: number;
  authorityState: StoredWalletRegistrationCeremonyAuthorityState;
};

export type StoredWalletRegistrationCeremony = StoredWalletRegistrationCeremonyBase & {
  signerState: StoredWalletRegistrationSignerState;
};

/**
 * The verified authority, or `null` while the ceremony is still awaiting its
 * proof. Legs downstream of respond (activation, finalization, persistence)
 * require a verified authority and treat `null` as an invalid state rather
 * than a missing field.
 */
export function verifiedRegistrationCeremonyAuthority(ceremony: {
  readonly authorityState: StoredWalletRegistrationCeremonyAuthorityState;
}): StoredRegistrationAuthority | null {
  return ceremony.authorityState.kind === 'verified' ? ceremony.authorityState.authority : null;
}

export type TerminalRegistrationCeremonyCancellationResult =
  | {
      kind: 'cancelled';
      ceremonyDeleted: true;
    }
  | {
      kind: 'not_found';
      ceremonyDeleted: false;
    };

type StoredEcdsaAddSignerBase = Omit<WalletAddSignerEcdsaStartPayload, 'kind'> & {
  derivationKind: WalletAddSignerEcdsaStartPayload['kind'];
};

type StoredEcdsaAddSignerPrepared = StoredEcdsaAddSignerBase & {
  kind: 'ecdsa_add_signer_prepared';
  pendingActivation?: never;
  publicResponse?: never;
  publicFacts?: never;
  activation?: never;
  bootstrap?: never;
};

type StoredEcdsaAddSignerPendingActivation = StoredEcdsaAddSignerBase & {
  kind: 'ecdsa_add_signer_pending_activation';
  registrationRequest: RouterAbEcdsaRegistrationRequestV1;
  pendingActivation: RouterAbEcdsaPendingActivationV1;
  publicResponse: RouterAbEcdsaStrictForwardedRegistrationResponseV1;
  publicFacts?: never;
  activation?: never;
  bootstrap?: never;
};

/**
 * The prepared activation coordinates, recorded before any Router custody work
 * runs. The client computed the activation request digest from the canonical
 * add-signer activation command; a retry after a crash between the Router
 * commit and the store update finds this claim, must present the exact same
 * coordinates, and replays the canonical Router activation to completion.
 */
export type StoredEcdsaAddSignerActivationClaimed = StoredEcdsaAddSignerBase & {
  kind: 'ecdsa_add_signer_activation_claimed';
  registrationRequest: RouterAbEcdsaRegistrationRequestV1;
  pendingActivation: RouterAbEcdsaPendingActivationV1;
  publicResponse: RouterAbEcdsaStrictForwardedRegistrationResponseV1;
  publicFacts: RouterAbEcdsaVerifiedClientActivationFactsV1;
  activationRequestDigestB64u: string;
  activation?: never;
  bootstrap?: never;
};

export type StoredEcdsaAddSignerActivated = StoredEcdsaAddSignerBase & {
  kind: 'ecdsa_add_signer_activated';
  pendingActivation?: never;
  publicResponse?: never;
  registrationRequest: RouterAbEcdsaRegistrationRequestV1;
  publicFacts: RouterAbEcdsaVerifiedClientActivationFactsV1;
  /** Carried from the claim so a replay is judged against what this server
   * committed to, not against what the Router echoed back. */
  activationRequestDigestB64u: string;
  activation: RouterAbEcdsaRegistrationActivationReceiptV1;
  publicCapability: RouterAbEcdsaDerivationPublicCapabilityV1;
  bootstrap: EcdsaDerivationServerBootstrapResponse;
};

type StoredEd25519YaoAddSignerAuthorized = {
  kind: 'near_ed25519_yao_add_signer_authorized';
  admissionRequest: RouterAbEd25519YaoRegistrationAdmissionRequestV1;
};

export type StoredEd25519YaoAddSignerActivation = {
  finalizeRequest: Extract<StoredWalletAddSignerFinalizeRequest, { kind: 'near_ed25519' }>;
  activation: {
    admissionRequest: RouterAbEd25519YaoRegistrationAdmissionRequestV1;
    admissionReceipt: RouterAbEd25519YaoActivationAdmissionReceiptV1<'registration'>;
    result: RouterAbEd25519YaoActivationResultV1<'registration'>;
  };
};

type StoredEd25519YaoAddSignerActivated = StoredEd25519YaoAddSignerActivation & {
  kind: 'near_ed25519_yao_add_signer_activated';
};

type StoredEd25519YaoAddSignerFinalizing = StoredEd25519YaoAddSignerActivation & {
  kind: 'near_ed25519_yao_add_signer_finalizing';
  response: Extract<WalletAddSignerFinalizeSuccess, { kind: 'near_ed25519' }>;
  signer: WalletEd25519SignerRecord;
  finalizingAtMs: number;
};

export type StoredWalletAddSignerSignerState =
  | StoredEcdsaAddSignerPrepared
  | StoredEcdsaAddSignerPendingActivation
  | StoredEcdsaAddSignerActivationClaimed
  | StoredEcdsaAddSignerActivated
  | StoredEd25519YaoAddSignerAuthorized
  | StoredEd25519YaoAddSignerActivated
  | StoredEd25519YaoAddSignerFinalizing;

export type StoredWalletAddSignerCeremony = {
  addSignerCeremonyId: string;
  intent: AddSignerIntentV1;
  digestB64u: string;
  orgId: string;
  signingRootId: string;
  signingRootVersion: string;
  expiresAtMs: number;
  auth: {
    kind: 'webauthn_assertion';
    rpId: string;
    credentialIdB64u: string;
  };
  signerState: StoredWalletAddSignerSignerState;
};

export type StoredWalletAddSignerFinalizeReplay = {
  kind: 'wallet_add_signer_finalize_replay_v1';
  addSignerCeremonyId: string;
  idempotencyKey: string;
  request: StoredWalletAddSignerFinalizeRequest;
  response: WalletAddSignerFinalizeSuccess;
  createdAtMs: number;
  expiresAtMs: number;
};

/**
 * An add-auth-method finalize that already succeeded.
 *
 * Finalize consumes its ceremony, so a client that lost the response has no way
 * to ask again — the ceremony is gone and the credential is already registered.
 * This record is what makes the retry answerable, and it is written in the same
 * batch as the credential, custody envelope, auth method, and owner binding so
 * a stored response always describes work that actually landed.
 *
 * `requestDigestB64u` covers the ceremony, the normalized request, the
 * authorization branch, and any linked admission. One comparison therefore
 * distinguishes an exact retry from a substituted credential, envelope, wallet,
 * device, enrollment, or key manifest.
 */
export type StoredWalletAddAuthMethodFinalizeReplay = {
  kind: 'wallet_add_auth_method_finalize_replay_v1';
  addAuthMethodCeremonyId: string;
  requestDigestB64u: string;
  response: WalletAddAuthMethodFinalizeSuccess;
  createdAtMs: number;
  expiresAtMs: number;
};

export type StoredWalletAddSignerFinalizeRequest =
  | {
      kind: 'near_ed25519';
      addSignerCeremonyId: string;
      idempotencyKey: string;
      custodyKeySet: Extract<
        WalletAddSignerFinalizeRequest,
        { readonly kind: 'near_ed25519' }
      >['custodyKeySet'];
      activationReference: {
        lifecycleId: string;
        sessionId: RouterAbEd25519YaoBytes32V1;
      };
      expectedKeyHandles?: never;
    }
  | {
      kind: 'evm_family_ecdsa';
      addSignerCeremonyId: string;
      idempotencyKey: string;
      custodyKeySet: Extract<
        WalletAddSignerFinalizeRequest,
        { readonly kind: 'evm_family_ecdsa' }
      >['custodyKeySet'];
      expectedKeyHandles: readonly [string];
      activationReference?: never;
    };

type StoredWalletAddAuthMethodCeremonyBase = {
  addAuthMethodCeremonyId: string;
  intent: AddAuthMethodIntentV1;
  digestB64u: string;
  orgId: string;
  sourceWalletAuthMethodId: WalletAuthMethodId;
  sourceWalletAuthorityId: WalletAuthorityId;
  sourceAuthorityDigestB64u: DigestB64u;
  sourceAuthorityRevocationEpoch: number;
  targetWalletAuthMethodId: WalletAuthMethodId;
  expectedOrigin?: string;
  expiresAtMs: number;
  auth:
    | {
        kind: 'webauthn_assertion';
        rpId: string;
        credentialIdB64u: string;
      }
    | {
        /* The ceremony was authorized by an active owner Wallet Session. The
           passkey identity is the session's minting authority, resolved
           server-side from the session binding — never from the request body. */
        kind: 'wallet_session';
        walletSessionId: string;
        authorizationId: string;
        rpId: string;
        credentialIdB64u: string;
      }
    | {
        kind: 'email_otp';
        providerUserId: string;
        enrollmentId: string;
        enrollmentSealKeyVersion: string;
        authorityRef: WalletAuthAuthorityRef;
      };
};

export type StoredWalletAddAuthMethodCeremony =
  | (StoredWalletAddAuthMethodCeremonyBase & {
      kind: 'email_otp';
      authority: Extract<StoredRegistrationAuthority, { kind: 'email_otp' }>;
      passkeyRegistration?: never;
      /**
       * The SOURCE method's envelope, exactly as the passkey branch below
       * carries it.
       *
       * This ceremony adds Email OTP to a wallet that already holds its custody
       * seed, so the browser has to open this envelope with the source factor
       * and reseal the same seed under the new Email OTP factor. Without it the
       * ceremony could only ever create an auth method that unlocks nothing.
       */
      custodyEnvelope: PasskeyCustodyEnvelopeRecord;
    })
  | (StoredWalletAddAuthMethodCeremonyBase & {
      kind: 'passkey';
      authority?: never;
      passkeyRegistration: {
        readonly rpId: string;
        readonly challengeB64u: string;
        readonly options: WalletAddAuthMethodRegistrationOptions;
      };
      custodyEnvelope: PasskeyCustodyEnvelopeRecord;
    });

export interface RegistrationCeremonyStore {
  putAddAuthMethodIntent(intent: StoredAddAuthMethodIntent): Promise<void>;
  getAddAuthMethodIntent(
    grant: AddAuthMethodIntentGrant,
  ): Promise<StoredAddAuthMethodIntent | null>;
  takeAddAuthMethodIntent(
    grant: AddAuthMethodIntentGrant,
  ): Promise<ConsumedAddAuthMethodIntent | null>;
  putAddSignerIntent(intent: StoredAddSignerIntent): Promise<void>;
  getAddSignerIntent(grant: AddSignerIntentGrant): Promise<StoredAddSignerIntent | null>;
  takeAddSignerIntent(grant: AddSignerIntentGrant): Promise<ConsumedAddSignerIntent | null>;
  putCeremony(ceremony: StoredWalletRegistrationCeremony): Promise<void>;
  getCeremony(registrationCeremonyId: string): Promise<StoredWalletRegistrationCeremony | null>;
  updateCeremony(ceremony: StoredWalletRegistrationCeremony): Promise<void>;
  takeCeremony(registrationCeremonyId: string): Promise<StoredWalletRegistrationCeremony | null>;
  cancelTerminalCeremony(input: {
    registrationCeremonyId: string;
    walletId: WalletId;
  }): Promise<TerminalRegistrationCeremonyCancellationResult>;
  putAddSignerFinalizeReplay(replay: StoredWalletAddSignerFinalizeReplay): Promise<void>;
  getAddSignerFinalizeReplay(input: {
    addSignerCeremonyId: string;
    idempotencyKey: string;
  }): Promise<StoredWalletAddSignerFinalizeReplay | null>;
  getAddSignerFinalizeReplayForCeremony(
    addSignerCeremonyId: string,
  ): Promise<StoredWalletAddSignerFinalizeReplay | null>;
  putAddSignerCeremony(ceremony: StoredWalletAddSignerCeremony): Promise<void>;
  getAddSignerCeremony(addSignerCeremonyId: string): Promise<StoredWalletAddSignerCeremony | null>;
  updateAddSignerCeremony(ceremony: StoredWalletAddSignerCeremony): Promise<void>;
  takeAddSignerCeremony(addSignerCeremonyId: string): Promise<StoredWalletAddSignerCeremony | null>;
  putAddAuthMethodCeremony(ceremony: StoredWalletAddAuthMethodCeremony): Promise<void>;
  getAddAuthMethodCeremony(
    addAuthMethodCeremonyId: string,
  ): Promise<StoredWalletAddAuthMethodCeremony | null>;
  updateAddAuthMethodCeremony(ceremony: StoredWalletAddAuthMethodCeremony): Promise<void>;
  takeAddAuthMethodCeremony(
    addAuthMethodCeremonyId: string,
  ): Promise<StoredWalletAddAuthMethodCeremony | null>;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected registration ceremony store branch: ${String(value)}`);
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

type StoredRegistrationSignerPlanRecord = {
  readonly kind?: unknown;
  readonly branches?: unknown;
};

type StoredRegistrationSignerPlanBranchRecord = {
  readonly kind?: unknown;
  readonly branchKey?: unknown;
  readonly accountProvisioning?: unknown;
  readonly signerSlot?: unknown;
  readonly participantIds?: unknown;
  readonly keyPurpose?: unknown;
  readonly keyVersion?: unknown;
  readonly derivationVersion?: unknown;
  readonly chainTargets?: unknown;
};

type StoredWalletRegistrationPreparedContextRecord = {
  readonly kind?: unknown;
  readonly signingRootId?: unknown;
  readonly signingRootVersion?: unknown;
  readonly runtimePolicy?: unknown;
  readonly ecdsa?: unknown;
};

type StoredWalletRegistrationRuntimePolicyContextRecord = {
  readonly kind?: unknown;
  readonly scope?: unknown;
};

type StoredRuntimePolicyScopeRecord = {
  readonly orgId?: unknown;
  readonly projectId?: unknown;
  readonly envId?: unknown;
  readonly signingRootVersion?: unknown;
};

type StoredWalletRegistrationEcdsaPreparedContextRecord = {
  readonly kind?: unknown;
  readonly chainTargets?: unknown;
};

export function parseStoredRegistrationSignerPlan(value: unknown): RegistrationSignerPlan | null {
  const parsed = normalizeRegistrationSignerPlan(value);
  if (parsed.ok) return parsed.value;
  const decoded = parseJsonValue(value);
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  const record: StoredRegistrationSignerPlanRecord = decoded;
  if (record.kind !== 'signer_set' || !Array.isArray(record.branches)) {
    return null;
  }
  const branches: RegistrationSignerPlanBranch[] = [];
  const signers: RegistrationSignerRequest[] = [];
  for (const rawBranch of record.branches) {
    const branch = parseStoredRegistrationSignerPlanBranch(rawBranch);
    if (!branch) return null;
    branches.push(branch.branch);
    signers.push(branch.signer);
  }
  const recomputed = registrationSignerPlanFromSelection({
    kind: 'signer_set',
    signers,
  });
  if (!recomputed.ok) return null;
  const storedPlan: RegistrationSignerPlan = {
    kind: 'signer_set',
    branches,
  };
  if (!storedRegistrationSignerPlansMatch(storedPlan, recomputed.value)) return null;
  return recomputed.value;
}

export function parseStoredWalletRegistrationPreparedContext(
  value: unknown,
): StoredWalletRegistrationPreparedContext | null {
  const decoded = parseJsonValue(value);
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
    return null;
  }
  const record: StoredWalletRegistrationPreparedContextRecord = decoded;
  if (
    record.kind !== 'wallet_registration_prepared_context_v1' ||
    record.runtimePolicy === null ||
    typeof record.runtimePolicy !== 'object' ||
    Array.isArray(record.runtimePolicy) ||
    record.ecdsa === null ||
    typeof record.ecdsa !== 'object' ||
    Array.isArray(record.ecdsa)
  ) {
    return null;
  }
  const signingRootId = trimString(record.signingRootId);
  const signingRootVersion = trimString(record.signingRootVersion);
  if (!signingRootId || !signingRootVersion) return null;
  const runtimePolicy = parseStoredWalletRegistrationRuntimePolicyContext(record.runtimePolicy);
  const ecdsa = parseStoredWalletRegistrationEcdsaPreparedContext(record.ecdsa);
  if (!runtimePolicy || !ecdsa) return null;
  return {
    kind: 'wallet_registration_prepared_context_v1',
    signingRootId,
    signingRootVersion,
    runtimePolicy,
    ecdsa,
  };
}

function parseStoredWalletRegistrationRuntimePolicyContext(
  value: unknown,
): StoredWalletRegistrationRuntimePolicyContext | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: StoredWalletRegistrationRuntimePolicyContextRecord = value;
  switch (record.kind) {
    case 'runtime_policy_scope': {
      const scope = parseStoredRuntimePolicyScope(record.scope);
      return scope ? { kind: 'runtime_policy_scope', scope } : null;
    }
    case 'signing_root_only':
      return record.scope !== undefined ? null : { kind: 'signing_root_only' };
    default:
      return null;
  }
}

function parseStoredRuntimePolicyScope(value: unknown): RuntimePolicyScope | null {
  const scope = parseStoredAddAuthMethodRuntimePolicyScope(value);
  if (!scope?.signingRootVersion) return null;
  return {
    orgId: scope.orgId,
    projectId: scope.projectId,
    envId: scope.envId,
    signingRootVersion: scope.signingRootVersion,
  };
}

function parseStoredWalletRegistrationEcdsaPreparedContext(
  value: unknown,
): StoredWalletRegistrationEcdsaPreparedContext | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: StoredWalletRegistrationEcdsaPreparedContextRecord = value;
  switch (record.kind) {
    case 'evm_family_ecdsa_requested': {
      if (!Array.isArray(record.chainTargets) || record.chainTargets.length === 0) return null;
      const chainTargets: ThresholdEcdsaChainTarget[] = [];
      for (const rawTarget of record.chainTargets) {
        const chainTarget = thresholdEcdsaChainTargetFromValue(rawTarget);
        if (!chainTarget) return null;
        chainTargets.push(chainTarget);
      }
      return { kind: 'evm_family_ecdsa_requested', chainTargets };
    }
    case 'evm_family_ecdsa_absent':
      return record.chainTargets !== undefined ? null : { kind: 'evm_family_ecdsa_absent' };
    default:
      return null;
  }
}

function parseStoredRegistrationSignerPlanBranch(
  value: unknown,
): { branch: RegistrationSignerPlanBranch; signer: RegistrationSignerRequest } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: StoredRegistrationSignerPlanBranchRecord = value;
  let signerCandidate: unknown;
  switch (record.kind) {
    case 'near_ed25519':
      signerCandidate = {
        kind: 'near_ed25519',
        accountProvisioning: record.accountProvisioning,
        signerSlot: Number(record.signerSlot),
        participantIds: Array.isArray(record.participantIds) ? [...record.participantIds] : [],
        derivationVersion: Number(record.derivationVersion),
      };
      break;
    case 'evm_family_ecdsa':
      signerCandidate = {
        kind: 'evm_family_ecdsa',
        participantIds: Array.isArray(record.participantIds) ? [...record.participantIds] : [],
        chainTargets: Array.isArray(record.chainTargets) ? [...record.chainTargets] : [],
      };
      break;
    default:
      return null;
  }
  let singleBranchPlan: ReturnType<typeof normalizeRegistrationSignerPlan>;
  try {
    singleBranchPlan = normalizeRegistrationSignerPlan({
      kind: 'signer_set',
      signers: [signerCandidate],
    });
  } catch {
    return null;
  }
  if (!singleBranchPlan.ok || singleBranchPlan.value.branches.length !== 1) return null;
  const branch = singleBranchPlan.value.branches[0];
  if (!branch || trimString(record.branchKey) !== branch.branchKey) return null;
  switch (branch.kind) {
    case 'near_ed25519': {
      if (
        trimString(record.keyPurpose) !== branch.keyPurpose ||
        trimString(record.keyVersion) !== branch.keyVersion ||
        record.chainTargets !== undefined
      ) {
        return null;
      }
      return {
        branch,
        signer: {
          kind: 'near_ed25519',
          accountProvisioning: branch.accountProvisioning,
          signerSlot: branch.signerSlot,
          participantIds: [...branch.participantIds],
          derivationVersion: branch.derivationVersion,
        },
      };
    }
    case 'evm_family_ecdsa': {
      if (
        record.accountProvisioning !== undefined ||
        record.signerSlot !== undefined ||
        record.keyPurpose !== undefined ||
        record.keyVersion !== undefined ||
        record.derivationVersion !== undefined
      ) {
        return null;
      }
      return {
        branch,
        signer: {
          kind: 'evm_family_ecdsa',
          participantIds: [...branch.participantIds],
          chainTargets: [...branch.chainTargets],
        },
      };
    }
    default:
      return assertNever(branch);
  }
}

export function storedRegistrationSignerPlansMatch(
  left: RegistrationSignerPlan,
  right: RegistrationSignerPlan,
): boolean {
  if (left.kind !== right.kind || left.branches.length !== right.branches.length) {
    return false;
  }
  for (let index = 0; index < left.branches.length; index += 1) {
    const rightBranch = right.branches[index];
    if (
      !rightBranch ||
      !storedRegistrationSignerPlanBranchesMatch(left.branches[index], rightBranch)
    ) {
      return false;
    }
  }
  return true;
}

function storedRegistrationSignerPlanBranchesMatch(
  left: RegistrationSignerPlanBranch,
  right: RegistrationSignerPlanBranch,
): boolean {
  if (
    left.kind !== right.kind ||
    left.branchKey !== right.branchKey ||
    !storedRegistrationNumberArraysMatch(left.participantIds, right.participantIds)
  ) {
    return false;
  }
  switch (left.kind) {
    case 'near_ed25519':
      return (
        right.kind === 'near_ed25519' &&
        sameStoredRegistrationNearAccountProvisioning(
          left.accountProvisioning,
          right.accountProvisioning,
        ) &&
        left.signerSlot === right.signerSlot &&
        left.keyPurpose === right.keyPurpose &&
        left.keyVersion === right.keyVersion &&
        left.derivationVersion === right.derivationVersion
      );
    case 'evm_family_ecdsa':
      /* branchKey is derived from the ordered canonical chain-target list. */
      return (
        right.kind === 'evm_family_ecdsa' && left.chainTargets.length === right.chainTargets.length
      );
    default:
      return assertNeverStoredRegistrationSignerPlanBranch(left);
  }
}

function storedRegistrationNumberArraysMatch(
  left: readonly number[],
  right: readonly number[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function sameStoredRegistrationNearAccountProvisioning(
  left: RegistrationNearAccountProvisioning,
  right: RegistrationNearAccountProvisioning,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'implicit_account':
      return right.kind === 'implicit_account' && left.accountIdSource === right.accountIdSource;
    case 'sponsored_named_account':
      return (
        right.kind === 'sponsored_named_account' &&
        left.requestedAccountId === right.requestedAccountId &&
        left.sponsor === right.sponsor
      );
    default:
      return assertNeverStoredRegistrationNearAccountProvisioning(left);
  }
}

function assertNeverStoredRegistrationSignerPlanBranch(branch: never): never {
  throw new Error(`Unexpected stored registration signer plan branch: ${String(branch)}`);
}

function assertNeverStoredRegistrationNearAccountProvisioning(provisioning: never): never {
  throw new Error(`Unexpected stored registration account provisioning: ${String(provisioning)}`);
}

function parseStoredAddAuthMethodRuntimePolicyScope(
  value: unknown,
): AddAuthMethodIntentV1['runtimePolicyScope'] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: StoredRuntimePolicyScopeRecord = value;
  const orgId = trimString(record.orgId);
  const projectId = trimString(record.projectId);
  const envId = trimString(record.envId);
  const signingRootVersion = trimString(record.signingRootVersion);
  if (!orgId || !projectId || !envId) return null;
  if (record.signingRootVersion !== undefined && !signingRootVersion) return null;
  return signingRootVersion
    ? { orgId, projectId, envId, signingRootVersion }
    : { orgId, projectId, envId };
}

import { parseWalletAddAuthMethodRegistrationOptions } from '@shared/utils/addAuthMethodRegistration';
import type {
  CloudflareDurableObjectNamespaceLike,
  EcdsaDerivationServerBootstrapResponse,
} from './types';
import type {
  AddAuthMethodIntentGrant,
  AddAuthMethodIntentV1,
  AddSignerIntentGrant,
  AddSignerIntentV1,
  RegistrationIntentV1,
  WalletAddSignerStartResponse,
  WalletAddSignerFinalizeRequest,
  WalletAddAuthMethodFinalizeResponse,
  WalletAddSignerFinalizeResponse,
  WalletAddAuthMethodRegistrationOptions,
  WalletRegistrationStartResponse,
  WalletId,
  WalletEd25519YaoSignerPublicResult,
  WalletRegistrationEcdsaWalletKey,
} from './registrationContracts';
import type {
  RegistrationAuthority,
  RegistrationNearAccountProvisioning,
  RegistrationSignerPlanBranch,
  RegistrationSignerRequest,
  RegistrationSignerPlan,
  RegistrationSignerBranchKey,
} from '@shared/utils/registrationIntent';
import {
  parsePasskeyCustodyEnvelopeRecord,
  type PasskeyCustodyEnvelopeRecord,
} from '@shared/passkey-custody';
import {
  addAuthMethodIntentGrantFromString,
  addSignerIntentGrantFromString,
  normalizeAddSignerSelection,
  normalizeAddAuthMethodInput,
  normalizeAddAuthMethodIntentCaller,
  normalizeRegistrationAuthMethodInput,
  normalizeRegistrationSignerPlan,
  registrationSignerBranchKeyFromString,
  registrationSignerSetSelectionFromPlan,
  registrationSignerPlanFromSelection,
} from '@shared/utils/registrationIntent';
import {
  parseChallengeSubjectId,
  parseEmailOtpChallengeId,
  parseOrgId,
  parseProviderSubject,
  parseRootShareEpoch,
  parseWalletAuthMethodId,
  parseWalletAuthorityId,
  parseWalletId,
  parseWebAuthnCredentialIdB64u,
  parseWebAuthnRpId,
  type WalletAuthMethodId,
  type WalletAuthorityId,
} from '@shared/utils/domainIds';
import { parseDeviceId, type DeviceId } from '@shared/authorization/capabilityKinds';
import { parseWebAuthnAuthenticatorDeviceInfo } from '@shared/utils/webauthnDeviceInfo';
import type { NormalizedLogger } from './logger';
import { THRESHOLD_DO_OBJECT_NAME_DEFAULT } from './defaultConfigsServer';
import { parseDigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  derivationClientSharePublicKey33B64uFromString,
  ecdsaClientRootPublicKey33B64uFromString,
} from '@shared/threshold/ecdsaDerivationRoleLocalBootstrap';
import { parseEcdsaDerivationPublicIdentity } from './ThresholdService/validation';
import type { RuntimePolicyScope } from '@shared/threshold/signingRootScope';
import {
  thresholdEcdsaChainTargetFromValue,
  thresholdEcdsaChainTargetKey,
  type ThresholdEcdsaChainTarget,
} from './thresholdEcdsaChainTarget';
import type {
  RouterAbEd25519YaoActivationAdmissionReceiptV1,
  RouterAbEd25519YaoActivationResultV1,
  RouterAbEd25519YaoBytes32V1,
  RouterAbEd25519YaoRegistrationAdmissionRequestV1,
} from '@shared/utils/routerAbEd25519Yao';
import {
  parseRouterAbEd25519YaoRegistrationActivationAdmissionReceiptV1,
  parseRouterAbEd25519YaoRegistrationActivationResultV1,
  parseRouterAbEd25519YaoRegistrationAdmissionRequestV1,
} from '@shared/utils/routerAbEd25519Yao';
import type {
  RouterAbEcdsaDerivationPublicCapabilityV1,
  RouterAbEcdsaRegistrationActivationReceiptV1,
  RouterAbEcdsaRegistrationRequestV1,
  RouterAbEcdsaStrictForwardedRegistrationResponseV1,
  RouterAbEcdsaVerifiedClientActivationFactsV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import {
  parseRouterAbEcdsaDerivationNormalSigningStateV1,
  parseRouterAbEcdsaDerivationPublicCapabilityV1,
  parseRouterAbEcdsaRegistrationActivationReceiptV1,
  parseRouterAbEcdsaRegistrationRequestFactsV1,
  parseRouterAbEcdsaRegistrationRequestV1,
  parseRouterAbEcdsaStrictForwardedRegistrationResponseV1,
  parseRouterAbEcdsaVerifiedClientActivationFactsV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import type { RouterAbEcdsaPendingActivationV1 } from '../router/domains/ecdsa/routerAbEcdsaStrictRegistration';
import { parseStoredRouterAbEcdsaPendingActivationV1 } from '../router/domains/ecdsa/routerAbEcdsaStrictRegistration';
import type { WalletEd25519SignerRecord } from './WalletStore';
import { parseWalletEd25519SignerRecord } from './d1WalletStore';
import { registrationPreparationIdFromString } from './registrationContracts';
import {
  parseWalletAuthAuthorityRef,
  type WalletAuthAuthorityRef,
} from '@shared/utils/walletAuthAuthority';

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

export type ConsumedAddSignerIntent = Omit<StoredAddSignerIntent, 'kind' | 'consumedAtMs'> & {
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

export type ConsumedAddAuthMethodIntent = Omit<
  StoredAddAuthMethodIntent,
  'kind' | 'consumedAtMs'
> & {
  kind: 'add_auth_method_intent_consumed';
  consumedAtMs: number;
};

export type StoredRegistrationWebAuthnCredential = {
  credentialIdB64u: string;
  credentialPublicKeyB64u: string;
  counter: number;
};

export type StoredRegistrationAuthority = RegistrationAuthority;

type WalletRegistrationEcdsaStartPayload = NonNullable<
  Extract<WalletRegistrationStartResponse, { ok: true }>['ecdsa']
>;

type WalletAddSignerEcdsaStartPayload = Omit<
  NonNullable<Extract<WalletAddSignerStartResponse, { ok: true }>['ecdsa']>,
  'custodyEnvelope'
>;

export type StoredWalletRegistrationRuntimePolicyContext =
  | {
      kind: 'runtime_policy_scope';
      scope: RuntimePolicyScope;
    }
  | {
      kind: 'signing_root_only';
      scope?: never;
    };

export type StoredWalletRegistrationEcdsaPreparedContext =
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

export function storedWalletRegistrationPreparedContextsMatch(
  left: StoredWalletRegistrationPreparedContext,
  right: StoredWalletRegistrationPreparedContext,
): boolean {
  if (
    left.kind !== right.kind ||
    left.signingRootId !== right.signingRootId ||
    left.signingRootVersion !== right.signingRootVersion ||
    left.runtimePolicy.kind !== right.runtimePolicy.kind ||
    left.ecdsa.kind !== right.ecdsa.kind
  ) {
    return false;
  }
  if (
    left.runtimePolicy.kind === 'runtime_policy_scope' &&
    right.runtimePolicy.kind === 'runtime_policy_scope' &&
    (left.runtimePolicy.scope.orgId !== right.runtimePolicy.scope.orgId ||
      left.runtimePolicy.scope.projectId !== right.runtimePolicy.scope.projectId ||
      left.runtimePolicy.scope.envId !== right.runtimePolicy.scope.envId ||
      left.runtimePolicy.scope.signingRootVersion !== right.runtimePolicy.scope.signingRootVersion)
  ) {
    return false;
  }
  if (
    left.ecdsa.kind === 'evm_family_ecdsa_requested' &&
    right.ecdsa.kind === 'evm_family_ecdsa_requested'
  ) {
    const leftTargets = left.ecdsa.chainTargets;
    const rightTargets = right.ecdsa.chainTargets;
    if (leftTargets.length !== rightTargets.length) return false;
    return leftTargets.every(
      (target, index) =>
        thresholdEcdsaChainTargetKey(target) === thresholdEcdsaChainTargetKey(rightTargets[index]),
    );
  }
  return true;
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

type StoredEcdsaRegistrationBase = Omit<WalletRegistrationEcdsaStartPayload, 'kind'> & {
  derivationKind: WalletRegistrationEcdsaStartPayload['kind'];
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
 * the ceremony stays open for the Ed25519 finalize (Refactor 94 Phase 4+5).
 * On an ECDSA-only plan the ceremony is deleted instead, so this state never
 * appears.
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

export type StoredWalletRegistrationEvmFamilyEcdsaBranch =
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

export type StoredWalletRegistrationFailed = {
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

export type StoredWalletRegistrationSignerState =
  | StoredWalletRegistrationSignerSetState
  | StoredWalletRegistrationFailed;

/**
 * Refactor 94C. A registration ceremony now exists before its authority proof
 * does.
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

export function registrationCeremonyAuthorityRpId(
  authorityState: StoredWalletRegistrationCeremonyAuthorityState,
): string | null {
  switch (authorityState.kind) {
    case 'awaiting_proof':
      return authorityState.authMethod.kind === 'passkey'
        ? String(authorityState.authMethod.rpId)
        : null;
    case 'verified':
      return authorityState.authority.kind === 'passkey'
        ? String(authorityState.authority.rpId)
        : null;
    default: {
      const exhaustive: never = authorityState;
      return exhaustive;
    }
  }
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

export function parseTerminalRegistrationCeremonyCancellationResult(
  value: unknown,
): TerminalRegistrationCeremonyCancellationResult | null {
  const parsed = parseJsonValue(value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record: {
    readonly kind?: unknown;
    readonly ceremonyDeleted?: unknown;
  } = parsed;
  switch (record.kind) {
    case 'cancelled':
      return record.ceremonyDeleted === true ? { kind: 'cancelled', ceremonyDeleted: true } : null;
    case 'not_found':
      return record.ceremonyDeleted === false
        ? { kind: 'not_found', ceremonyDeleted: false }
        : null;
    default:
      return null;
  }
}

type StoredEcdsaAddSignerBase = Omit<WalletAddSignerEcdsaStartPayload, 'kind'> & {
  derivationKind: WalletAddSignerEcdsaStartPayload['kind'];
};

export type StoredEcdsaAddSignerPrepared = StoredEcdsaAddSignerBase & {
  kind: 'ecdsa_add_signer_prepared';
  pendingActivation?: never;
  publicResponse?: never;
  publicFacts?: never;
  activation?: never;
  bootstrap?: never;
};

export type StoredEcdsaAddSignerPendingActivation = StoredEcdsaAddSignerBase & {
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

export type StoredEd25519YaoAddSignerAuthorized = {
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

export type StoredEd25519YaoAddSignerActivated = StoredEd25519YaoAddSignerActivation & {
  kind: 'near_ed25519_yao_add_signer_activated';
};

export type StoredEd25519YaoAddSignerFinalizing = StoredEd25519YaoAddSignerActivation & {
  kind: 'near_ed25519_yao_add_signer_finalizing';
  response: Extract<
    Extract<WalletAddSignerFinalizeResponse, { ok: true }>,
    { kind: 'near_ed25519' }
  >;
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
  response: Extract<WalletAddSignerFinalizeResponse, { ok: true }>;
  createdAtMs: number;
  expiresAtMs: number;
};

/**
 * Refactor 103 Phase 8: an add-auth-method finalize that already succeeded.
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
  response: Extract<WalletAddAuthMethodFinalizeResponse, { ok: true }>;
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
        /* R103 zero-prompt handoff: the ceremony was authorized by an active
           owner Wallet Session. The passkey identity is the session's minting
           authority, resolved server-side from the session binding — never
           from the request body. */
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
       * Refactor 109C adds Email OTP to a wallet that already holds its custody
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

export class MemoryRegistrationCeremonyStore implements RegistrationCeremonyStore {
  private readonly addAuthMethodIntents = new Map<string, StoredAddAuthMethodIntent>();
  private readonly addSignerIntents = new Map<string, StoredAddSignerIntent>();
  private readonly ceremonies = new Map<string, StoredWalletRegistrationCeremony>();
  private readonly addSignerFinalizeReplays = new Map<
    string,
    StoredWalletAddSignerFinalizeReplay
  >();
  private readonly addSignerFinalizeReplayClaims = new Map<
    string,
    StoredWalletAddSignerFinalizeReplay
  >();
  private readonly addAuthMethodCeremonies = new Map<string, StoredWalletAddAuthMethodCeremony>();
  private readonly addSignerCeremonies = new Map<string, StoredWalletAddSignerCeremony>();

  async putAddAuthMethodIntent(intent: StoredAddAuthMethodIntent): Promise<void> {
    this.pruneExpired();
    this.addAuthMethodIntents.set(intent.grant, intent);
  }

  async getAddAuthMethodIntent(
    grant: AddAuthMethodIntentGrant,
  ): Promise<StoredAddAuthMethodIntent | null> {
    this.pruneExpired();
    const intent = this.addAuthMethodIntents.get(String(grant || '').trim()) || null;
    if (!intent || intent.expiresAtMs <= Date.now()) return null;
    return intent;
  }

  async takeAddAuthMethodIntent(
    grant: AddAuthMethodIntentGrant,
  ): Promise<ConsumedAddAuthMethodIntent | null> {
    this.pruneExpired();
    const key = String(grant || '').trim();
    const intent = this.addAuthMethodIntents.get(key) || null;
    if (!intent) return null;
    this.addAuthMethodIntents.delete(key);
    if (intent.expiresAtMs <= Date.now()) return null;
    return { ...intent, kind: 'add_auth_method_intent_consumed', consumedAtMs: Date.now() };
  }

  async putAddSignerIntent(intent: StoredAddSignerIntent): Promise<void> {
    this.pruneExpired();
    this.addSignerIntents.set(intent.grant, intent);
  }

  async getAddSignerIntent(grant: AddSignerIntentGrant): Promise<StoredAddSignerIntent | null> {
    this.pruneExpired();
    const intent = this.addSignerIntents.get(String(grant || '').trim()) || null;
    if (!intent || intent.expiresAtMs <= Date.now()) return null;
    return intent;
  }

  async takeAddSignerIntent(grant: AddSignerIntentGrant): Promise<ConsumedAddSignerIntent | null> {
    this.pruneExpired();
    const key = String(grant || '').trim();
    const intent = this.addSignerIntents.get(key) || null;
    if (!intent) return null;
    this.addSignerIntents.delete(key);
    if (intent.expiresAtMs <= Date.now()) return null;
    return { ...intent, kind: 'add_signer_intent_consumed', consumedAtMs: Date.now() };
  }

  async putCeremony(ceremony: StoredWalletRegistrationCeremony): Promise<void> {
    this.pruneExpired();
    this.ceremonies.set(ceremony.registrationCeremonyId, ceremony);
  }

  async getCeremony(
    registrationCeremonyId: string,
  ): Promise<StoredWalletRegistrationCeremony | null> {
    this.pruneExpired();
    const ceremony = this.ceremonies.get(String(registrationCeremonyId || '').trim()) || null;
    if (!ceremony || ceremony.expiresAtMs <= Date.now()) return null;
    return ceremony;
  }

  async updateCeremony(ceremony: StoredWalletRegistrationCeremony): Promise<void> {
    this.pruneExpired();
    if (ceremony.expiresAtMs <= Date.now()) return;
    this.ceremonies.set(ceremony.registrationCeremonyId, ceremony);
  }

  async takeCeremony(
    registrationCeremonyId: string,
  ): Promise<StoredWalletRegistrationCeremony | null> {
    this.pruneExpired();
    const key = String(registrationCeremonyId || '').trim();
    const ceremony = this.ceremonies.get(key) || null;
    this.ceremonies.delete(key);
    if (!ceremony || ceremony.expiresAtMs <= Date.now()) return null;
    return ceremony;
  }

  async cancelTerminalCeremony(input: {
    registrationCeremonyId: string;
    walletId: WalletId;
  }): Promise<TerminalRegistrationCeremonyCancellationResult> {
    this.pruneExpired();
    const registrationCeremonyId = trimString(input.registrationCeremonyId);
    const ceremony = this.ceremonies.get(registrationCeremonyId);
    if (!ceremony) {
      return {
        kind: 'not_found',
        ceremonyDeleted: false,
      };
    }
    if (ceremony.intent.walletId !== input.walletId) {
      throw new Error('Terminal registration cancellation walletId mismatch');
    }
    this.ceremonies.delete(registrationCeremonyId);
    return {
      kind: 'cancelled',
      ceremonyDeleted: true,
    };
  }

  async putAddSignerFinalizeReplay(replay: StoredWalletAddSignerFinalizeReplay): Promise<void> {
    this.pruneExpired();
    this.addSignerFinalizeReplays.set(addSignerFinalizeReplayKey(replay), replay);
    this.addSignerFinalizeReplayClaims.set(replay.addSignerCeremonyId, replay);
  }

  async getAddSignerFinalizeReplay(input: {
    addSignerCeremonyId: string;
    idempotencyKey: string;
  }): Promise<StoredWalletAddSignerFinalizeReplay | null> {
    this.pruneExpired();
    const replay = this.addSignerFinalizeReplays.get(addSignerFinalizeReplayKey(input)) || null;
    if (!replay || replay.expiresAtMs <= Date.now()) return null;
    return replay;
  }

  async getAddSignerFinalizeReplayForCeremony(
    addSignerCeremonyId: string,
  ): Promise<StoredWalletAddSignerFinalizeReplay | null> {
    this.pruneExpired();
    const replay = this.addSignerFinalizeReplayClaims.get(trimString(addSignerCeremonyId)) || null;
    if (!replay || replay.expiresAtMs <= Date.now()) return null;
    return replay;
  }

  async putAddAuthMethodCeremony(ceremony: StoredWalletAddAuthMethodCeremony): Promise<void> {
    this.pruneExpired();
    this.addAuthMethodCeremonies.set(ceremony.addAuthMethodCeremonyId, ceremony);
  }

  async getAddAuthMethodCeremony(
    addAuthMethodCeremonyId: string,
  ): Promise<StoredWalletAddAuthMethodCeremony | null> {
    this.pruneExpired();
    const ceremony =
      this.addAuthMethodCeremonies.get(String(addAuthMethodCeremonyId || '').trim()) || null;
    if (!ceremony || ceremony.expiresAtMs <= Date.now()) return null;
    return ceremony;
  }

  async updateAddAuthMethodCeremony(ceremony: StoredWalletAddAuthMethodCeremony): Promise<void> {
    this.pruneExpired();
    if (ceremony.expiresAtMs <= Date.now()) return;
    this.addAuthMethodCeremonies.set(ceremony.addAuthMethodCeremonyId, ceremony);
  }

  async takeAddAuthMethodCeremony(
    addAuthMethodCeremonyId: string,
  ): Promise<StoredWalletAddAuthMethodCeremony | null> {
    this.pruneExpired();
    const key = String(addAuthMethodCeremonyId || '').trim();
    const ceremony = this.addAuthMethodCeremonies.get(key) || null;
    this.addAuthMethodCeremonies.delete(key);
    if (!ceremony || ceremony.expiresAtMs <= Date.now()) return null;
    return ceremony;
  }

  async putAddSignerCeremony(ceremony: StoredWalletAddSignerCeremony): Promise<void> {
    this.pruneExpired();
    this.addSignerCeremonies.set(ceremony.addSignerCeremonyId, ceremony);
  }

  async getAddSignerCeremony(
    addSignerCeremonyId: string,
  ): Promise<StoredWalletAddSignerCeremony | null> {
    this.pruneExpired();
    const ceremony = this.addSignerCeremonies.get(String(addSignerCeremonyId || '').trim()) || null;
    if (!ceremony || ceremony.expiresAtMs <= Date.now()) return null;
    return ceremony;
  }

  async updateAddSignerCeremony(ceremony: StoredWalletAddSignerCeremony): Promise<void> {
    this.pruneExpired();
    if (ceremony.expiresAtMs <= Date.now()) return;
    this.addSignerCeremonies.set(ceremony.addSignerCeremonyId, ceremony);
  }

  async takeAddSignerCeremony(
    addSignerCeremonyId: string,
  ): Promise<StoredWalletAddSignerCeremony | null> {
    this.pruneExpired();
    const key = String(addSignerCeremonyId || '').trim();
    const ceremony = this.addSignerCeremonies.get(key) || null;
    this.addSignerCeremonies.delete(key);
    if (!ceremony || ceremony.expiresAtMs <= Date.now()) return null;
    return ceremony;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, intent] of this.addAuthMethodIntents) {
      if (intent.expiresAtMs <= now) this.addAuthMethodIntents.delete(key);
    }
    for (const [key, intent] of this.addSignerIntents) {
      if (intent.expiresAtMs <= now) this.addSignerIntents.delete(key);
    }
    for (const [key, ceremony] of this.ceremonies) {
      if (ceremony.expiresAtMs <= now) this.ceremonies.delete(key);
    }
    for (const [key, replay] of this.addSignerFinalizeReplays) {
      if (replay.expiresAtMs <= now) this.addSignerFinalizeReplays.delete(key);
    }
    for (const [key, replay] of this.addSignerFinalizeReplayClaims) {
      if (replay.expiresAtMs <= now) this.addSignerFinalizeReplayClaims.delete(key);
    }
    for (const [key, ceremony] of this.addAuthMethodCeremonies) {
      if (ceremony.expiresAtMs <= now) this.addAuthMethodCeremonies.delete(key);
    }
    for (const [key, ceremony] of this.addSignerCeremonies) {
      if (ceremony.expiresAtMs <= now) this.addSignerCeremonies.delete(key);
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected registration ceremony store branch: ${String(value)}`);
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function addSignerFinalizeReplayKey(input: {
  addSignerCeremonyId: string;
  idempotencyKey: string;
}): string {
  return `${trimString(input.addSignerCeremonyId)}:${trimString(input.idempotencyKey)}`;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

type StoredWalletAddSignerFinalizeSuccessRecord = {
  readonly ok?: unknown;
  readonly walletId?: unknown;
  readonly kind?: unknown;
  readonly rpId?: unknown;
  readonly credentialIdB64u?: unknown;
  readonly ed25519?: unknown;
  readonly ecdsa?: unknown;
};

type StoredWalletAddSignerFinalizeEd25519Record = {
  readonly signerSlot?: unknown;
  readonly nearAccountId?: unknown;
  readonly nearEd25519SigningKeyId?: unknown;
  readonly publicKey?: unknown;
  readonly relayerKeyId?: unknown;
  readonly keyVersion?: unknown;
  readonly recoveryExportCapable?: unknown;
  readonly participantIds?: unknown;
};

type StoredWalletAddSignerFinalizeEcdsaRecord = {
  readonly walletKeys?: unknown;
};

type StoredWalletAddSignerFinalizeWalletKeyRecord = {
  readonly keyScope?: unknown;
  readonly chainTarget?: unknown;
  readonly walletId?: unknown;
  readonly evmFamilySigningKeySlotId?: unknown;
  readonly keyHandle?: unknown;
  readonly ecdsaThresholdKeyId?: unknown;
  readonly signingRootId?: unknown;
  readonly signingRootVersion?: unknown;
  readonly thresholdEcdsaPublicKeyB64u?: unknown;
  readonly thresholdOwnerAddress?: unknown;
  readonly relayerKeyId?: unknown;
  readonly relayerVerifyingShareB64u?: unknown;
  readonly contextBinding32B64u?: unknown;
  readonly derivationClientSharePublicKey33B64u?: unknown;
  readonly clientShareRetryCounter?: unknown;
  readonly relayerShareRetryCounter?: unknown;
  readonly participantIds?: unknown;
  readonly publicCapability?: unknown;
};

type StoredWalletAddSignerFinalizeReplayRecord = {
  readonly kind?: unknown;
  readonly addSignerCeremonyId?: unknown;
  readonly idempotencyKey?: unknown;
  readonly request?: unknown;
  readonly response?: unknown;
  readonly createdAtMs?: unknown;
  readonly expiresAtMs?: unknown;
};

type StoredWalletAddSignerFinalizeRequestRecord = {
  readonly kind?: unknown;
  readonly addSignerCeremonyId?: unknown;
  readonly idempotencyKey?: unknown;
  readonly custodyKeySet?: unknown;
  readonly activationReference?: unknown;
  readonly expectedKeyHandles?: unknown;
};

type StoredWalletAddSignerFinalizeNearCustodyKeySetRecord = {
  readonly kind?: unknown;
  readonly keyManifestDigestB64u?: unknown;
  readonly registeredPublicKeyB64u?: unknown;
};

type StoredWalletAddSignerFinalizeEcdsaCustodyKeySetRecord = {
  readonly kind?: unknown;
  readonly keyManifestDigestB64u?: unknown;
  readonly clientRootPublicKey33B64u?: unknown;
};

type StoredWalletAddSignerFinalizeActivationReferenceRecord = {
  readonly lifecycleId?: unknown;
  readonly sessionId?: unknown;
};

function parseStoredWalletAddSignerFinalizeParticipantIds(
  value: unknown,
): readonly [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const first = value[0];
  const second = value[1];
  if (
    typeof first !== 'number' ||
    !Number.isSafeInteger(first) ||
    first <= 0 ||
    typeof second !== 'number' ||
    !Number.isSafeInteger(second) ||
    second <= 0
  ) {
    return null;
  }
  return [first, second];
}

function parseStoredWalletAddSignerFinalizeEd25519Result(
  value: unknown,
): WalletEd25519YaoSignerPublicResult | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: StoredWalletAddSignerFinalizeEd25519Record = value;
  const signerSlot = Number(record.signerSlot);
  const nearAccountId = trimString(record.nearAccountId);
  const nearEd25519SigningKeyId = trimString(record.nearEd25519SigningKeyId);
  const publicKey = trimString(record.publicKey);
  const relayerKeyId = trimString(record.relayerKeyId);
  const keyVersion = trimString(record.keyVersion);
  const participantIds = parseStoredWalletAddSignerFinalizeParticipantIds(record.participantIds);
  if (
    record.recoveryExportCapable !== true ||
    !Number.isSafeInteger(signerSlot) ||
    signerSlot <= 0 ||
    !nearAccountId ||
    !nearEd25519SigningKeyId ||
    !publicKey.startsWith('ed25519:') ||
    !relayerKeyId ||
    !keyVersion ||
    !participantIds
  ) {
    return null;
  }
  return {
    signerSlot,
    nearAccountId,
    nearEd25519SigningKeyId,
    publicKey,
    relayerKeyId,
    keyVersion,
    recoveryExportCapable: true,
    participantIds,
  };
}

function parseStoredWalletAddSignerFinalizeEcdsaWalletKey(
  value: unknown,
): WalletRegistrationEcdsaWalletKey | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: StoredWalletAddSignerFinalizeWalletKeyRecord = value;
  if (record.keyScope !== 'evm-family') return null;
  const chainTarget = thresholdEcdsaChainTargetFromValue(record.chainTarget);
  const walletId = trimString(record.walletId);
  const evmFamilySigningKeySlotId = trimString(record.evmFamilySigningKeySlotId);
  const keyHandle = trimString(record.keyHandle);
  const ecdsaThresholdKeyId = trimString(record.ecdsaThresholdKeyId);
  const signingRootId = trimString(record.signingRootId);
  const signingRootVersion = trimString(record.signingRootVersion);
  const thresholdEcdsaPublicKeyB64u = trimString(record.thresholdEcdsaPublicKeyB64u);
  const thresholdOwnerAddress = trimString(record.thresholdOwnerAddress);
  const relayerKeyId = trimString(record.relayerKeyId);
  const relayerVerifyingShareB64u = trimString(record.relayerVerifyingShareB64u);
  const contextBinding32B64u = trimString(record.contextBinding32B64u);
  const derivationClientSharePublicKey33B64u = trimString(
    record.derivationClientSharePublicKey33B64u,
  );
  const clientShareRetryCounter = Number(record.clientShareRetryCounter);
  const relayerShareRetryCounter = Number(record.relayerShareRetryCounter);
  const participantIds = parseStoredWalletAddSignerFinalizeParticipantIds(record.participantIds);
  let publicCapability: RouterAbEcdsaDerivationPublicCapabilityV1;
  let parsedDerivationClientSharePublicKey33B64u: ReturnType<
    typeof derivationClientSharePublicKey33B64uFromString
  >;
  try {
    publicCapability = parseRouterAbEcdsaDerivationPublicCapabilityV1(record.publicCapability);
    parsedDerivationClientSharePublicKey33B64u = derivationClientSharePublicKey33B64uFromString(
      derivationClientSharePublicKey33B64u,
    );
  } catch {
    return null;
  }
  if (
    !chainTarget ||
    !walletId ||
    !evmFamilySigningKeySlotId ||
    !keyHandle ||
    !ecdsaThresholdKeyId ||
    !signingRootId ||
    !signingRootVersion ||
    !thresholdEcdsaPublicKeyB64u ||
    !thresholdOwnerAddress ||
    !relayerKeyId ||
    !relayerVerifyingShareB64u ||
    !contextBinding32B64u ||
    !derivationClientSharePublicKey33B64u ||
    !Number.isSafeInteger(clientShareRetryCounter) ||
    clientShareRetryCounter < 0 ||
    !Number.isSafeInteger(relayerShareRetryCounter) ||
    relayerShareRetryCounter < 0 ||
    !participantIds ||
    participantIds[0] !== 1 ||
    participantIds[1] !== 2
  ) {
    return null;
  }
  return {
    keyScope: 'evm-family',
    chainTarget,
    walletId,
    evmFamilySigningKeySlotId,
    keyHandle,
    ecdsaThresholdKeyId,
    signingRootId,
    signingRootVersion,
    thresholdEcdsaPublicKeyB64u,
    thresholdOwnerAddress,
    relayerKeyId,
    relayerVerifyingShareB64u,
    contextBinding32B64u,
    derivationClientSharePublicKey33B64u: parsedDerivationClientSharePublicKey33B64u,
    clientShareRetryCounter,
    relayerShareRetryCounter,
    participantIds: [1, 2],
    publicCapability,
  };
}

function parseStoredWalletAddSignerFinalizeEcdsaResult(
  value: unknown,
): Extract<WalletAddSignerFinalizeResponse, { ok: true }>['ecdsa'] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: StoredWalletAddSignerFinalizeEcdsaRecord = value;
  if (!Array.isArray(record.walletKeys) || record.walletKeys.length === 0) return null;
  const walletKeys: WalletRegistrationEcdsaWalletKey[] = [];
  for (const rawWalletKey of record.walletKeys) {
    const walletKey = parseStoredWalletAddSignerFinalizeEcdsaWalletKey(rawWalletKey);
    if (!walletKey) return null;
    walletKeys.push(walletKey);
  }
  return { walletKeys };
}

function parseStoredWalletAddSignerFinalizeSuccess(
  value: unknown,
): Extract<WalletAddSignerFinalizeResponse, { ok: true }> | null {
  const parsed = parseJsonValue(value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record: StoredWalletAddSignerFinalizeSuccessRecord = parsed;
  if (record.ok !== true) return null;
  const walletId = parseWalletId(record.walletId);
  if (!walletId.ok) return null;
  if (record.kind === 'near_ed25519') {
    if (!trimString(record.rpId) || !trimString(record.credentialIdB64u)) {
      return null;
    }
    const ed25519 = parseStoredWalletAddSignerFinalizeEd25519Result(record.ed25519);
    return ed25519
      ? {
          ok: true,
          kind: 'near_ed25519',
          walletId: walletId.value,
          rpId: trimString(record.rpId),
          credentialIdB64u: trimString(record.credentialIdB64u),
          ed25519,
        }
      : null;
  }
  if (record.kind !== 'evm_family_ecdsa') return null;
  const ecdsa = parseStoredWalletAddSignerFinalizeEcdsaResult(record.ecdsa);
  if (!ecdsa) return null;
  const rpId = trimString(record.rpId);
  return rpId
    ? { ok: true, kind: 'evm_family_ecdsa', walletId: walletId.value, rpId, ecdsa }
    : { ok: true, kind: 'evm_family_ecdsa', walletId: walletId.value, ecdsa };
}

function parseStoredWalletAddSignerFinalizeReplay(
  value: unknown,
): StoredWalletAddSignerFinalizeReplay | null {
  const parsed = parseJsonValue(value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record: StoredWalletAddSignerFinalizeReplayRecord = parsed;
  if (record.kind !== 'wallet_add_signer_finalize_replay_v1') return null;
  const addSignerCeremonyId = trimString(record.addSignerCeremonyId);
  const idempotencyKey = trimString(record.idempotencyKey);
  const createdAtMs = Number(record.createdAtMs);
  const expiresAtMs = Number(record.expiresAtMs);
  const request = parseStoredWalletAddSignerFinalizeRequest(record.request);
  const response = parseStoredWalletAddSignerFinalizeSuccess(record.response);
  if (
    !addSignerCeremonyId ||
    !idempotencyKey ||
    !request ||
    request.addSignerCeremonyId !== addSignerCeremonyId ||
    request.idempotencyKey !== idempotencyKey ||
    !response ||
    request.kind !== response.kind ||
    !Number.isSafeInteger(createdAtMs) ||
    createdAtMs <= 0 ||
    !Number.isSafeInteger(expiresAtMs) ||
    expiresAtMs <= 0
  ) {
    return null;
  }
  return {
    kind: 'wallet_add_signer_finalize_replay_v1',
    addSignerCeremonyId,
    idempotencyKey,
    request,
    response,
    createdAtMs,
    expiresAtMs,
  };
}

function parseStoredWalletAddSignerFinalizeRequest(
  value: unknown,
): StoredWalletAddSignerFinalizeRequest | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: StoredWalletAddSignerFinalizeRequestRecord = value;
  const addSignerCeremonyId = trimString(record.addSignerCeremonyId);
  const idempotencyKey = trimString(record.idempotencyKey);
  if (!addSignerCeremonyId || !idempotencyKey) return null;
  if (record.kind === 'near_ed25519') {
    if (
      record.custodyKeySet === null ||
      typeof record.custodyKeySet !== 'object' ||
      Array.isArray(record.custodyKeySet) ||
      record.activationReference === null ||
      typeof record.activationReference !== 'object' ||
      Array.isArray(record.activationReference)
    ) {
      return null;
    }
    const custodyKeySet: StoredWalletAddSignerFinalizeNearCustodyKeySetRecord =
      record.custodyKeySet;
    const activationReference: StoredWalletAddSignerFinalizeActivationReferenceRecord =
      record.activationReference;
    const lifecycleId = trimString(activationReference.lifecycleId);
    const sessionId = parseStoredBytes32(activationReference.sessionId);
    if (custodyKeySet.kind !== 'near_ed25519_v1' || !lifecycleId || !sessionId) return null;
    let keyManifestDigestB64u: string;
    try {
      keyManifestDigestB64u = parseDigestB64u(custodyKeySet.keyManifestDigestB64u);
    } catch {
      return null;
    }
    const registeredPublicKeyB64u = trimString(custodyKeySet.registeredPublicKeyB64u);
    if (!registeredPublicKeyB64u) return null;
    return {
      kind: 'near_ed25519',
      addSignerCeremonyId,
      idempotencyKey,
      custodyKeySet: {
        kind: 'near_ed25519_v1',
        keyManifestDigestB64u,
        registeredPublicKeyB64u,
      },
      activationReference: { lifecycleId, sessionId },
    };
  }
  if (
    record.kind !== 'evm_family_ecdsa' ||
    !Array.isArray(record.expectedKeyHandles) ||
    record.expectedKeyHandles.length !== 1
  ) {
    return null;
  }
  const expectedKeyHandle = trimString(record.expectedKeyHandles[0]);
  if (
    record.custodyKeySet === null ||
    typeof record.custodyKeySet !== 'object' ||
    Array.isArray(record.custodyKeySet)
  ) {
    return null;
  }
  const custodyKeySet: StoredWalletAddSignerFinalizeEcdsaCustodyKeySetRecord = record.custodyKeySet;
  if (!expectedKeyHandle || custodyKeySet.kind !== 'evm_family_ecdsa_v1') return null;
  let keyManifestDigestB64u: string;
  let clientRootPublicKey33B64u: ReturnType<typeof ecdsaClientRootPublicKey33B64uFromString>;
  try {
    keyManifestDigestB64u = parseDigestB64u(custodyKeySet.keyManifestDigestB64u);
    clientRootPublicKey33B64u = ecdsaClientRootPublicKey33B64uFromString(
      trimString(custodyKeySet.clientRootPublicKey33B64u),
    );
  } catch {
    return null;
  }
  return {
    kind: 'evm_family_ecdsa',
    addSignerCeremonyId,
    idempotencyKey,
    custodyKeySet: {
      kind: 'evm_family_ecdsa_v1',
      keyManifestDigestB64u,
      clientRootPublicKey33B64u,
    },
    expectedKeyHandles: [expectedKeyHandle],
  };
}

function parseStoredBytes32(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== 32) return null;
  const bytes: number[] = [];
  for (const byte of value) {
    if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255) return null;
    bytes.push(byte);
  }
  return bytes;
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

type StoredAddSignerIntentRecord = {
  readonly kind?: unknown;
  readonly grant?: unknown;
  readonly intent?: unknown;
  readonly digestB64u?: unknown;
  readonly orgId?: unknown;
  readonly signingRootId?: unknown;
  readonly signingRootVersion?: unknown;
  readonly expectedOrigin?: unknown;
  readonly expiresAtMs?: unknown;
};

type StoredAddSignerIntentPayloadRecord = {
  readonly version?: unknown;
  readonly walletId?: unknown;
  readonly signerSelection?: unknown;
  readonly runtimePolicyScope?: unknown;
  readonly nonceB64u?: unknown;
};

type StoredAddAuthMethodIntentRecord = {
  readonly kind?: unknown;
  readonly grant?: unknown;
  readonly intent?: unknown;
  readonly digestB64u?: unknown;
  readonly orgId?: unknown;
  readonly signingRootId?: unknown;
  readonly signingRootVersion?: unknown;
  readonly expectedOrigin?: unknown;
  readonly expiresAtMs?: unknown;
};

type StoredAddAuthMethodIntentPayloadRecord = {
  readonly version?: unknown;
  readonly walletId?: unknown;
  readonly authMethod?: unknown;
  readonly targetWalletAuthMethodId?: unknown;
  readonly runtimePolicyScope?: unknown;
  readonly nonceB64u?: unknown;
  readonly caller?: unknown;
  readonly source?: unknown;
};

type StoredRegistrationAuthorityRecord = {
  readonly kind?: unknown;
  readonly proofKind?: unknown;
  readonly walletId?: unknown;
  readonly rpId?: unknown;
  readonly credentialIdB64u?: unknown;
  readonly credentialPublicKeyB64u?: unknown;
  readonly counter?: unknown;
  readonly device?: unknown;
  readonly registrationIntentDigestB64u?: unknown;
  readonly emailHashHex?: unknown;
  readonly challengeId?: unknown;
  readonly providerSubject?: unknown;
  readonly challengeSubjectId?: unknown;
  readonly email?: unknown;
  readonly originalWalletId?: unknown;
  readonly finalWalletId?: unknown;
  readonly orgId?: unknown;
  readonly ownerProofBindingDigest?: unknown;
  readonly challengePurpose?: unknown;
  readonly googleEmailOtpRegistrationAttemptId?: unknown;
  readonly googleEmailOtpRegistrationOfferId?: unknown;
  readonly googleEmailOtpRegistrationCandidateId?: unknown;
  readonly registrationAuthorityId?: unknown;
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

function parseStoredAddSignerIntent(value: unknown): StoredAddSignerIntent | null {
  const decoded = parseJsonValue(value);
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  const record: StoredAddSignerIntentRecord = decoded;
  if (record.kind !== 'add_signer_intent_allocated') return null;
  const grant = trimString(record.grant);
  const digestB64u = trimString(record.digestB64u);
  const orgId = trimString(record.orgId);
  const expiresAtMs = Number(record.expiresAtMs);
  if (!grant || !digestB64u || !orgId || !Number.isSafeInteger(expiresAtMs)) return null;

  if (record.intent === null || typeof record.intent !== 'object' || Array.isArray(record.intent)) {
    return null;
  }
  const intent: StoredAddSignerIntentPayloadRecord = record.intent;
  if (intent.version !== 'add_signer_intent_v1') return null;
  const walletId = parseWalletId(intent.walletId);
  const signerSelection = normalizeAddSignerSelection(intent.signerSelection, {
    normalizeEcdsaChainTarget: thresholdEcdsaChainTargetFromValue,
  });
  const nonceB64u = trimString(intent.nonceB64u);
  if (!walletId.ok || !signerSelection.ok || !nonceB64u) return null;
  const runtimePolicyScope = Object.prototype.hasOwnProperty.call(intent, 'runtimePolicyScope')
    ? parseStoredAddAuthMethodRuntimePolicyScope(intent.runtimePolicyScope)
    : undefined;
  if (Object.prototype.hasOwnProperty.call(intent, 'runtimePolicyScope') && !runtimePolicyScope) {
    return null;
  }
  const parsedIntent: AddSignerIntentV1 = runtimePolicyScope
    ? {
        version: 'add_signer_intent_v1',
        walletId: walletId.value,
        signerSelection: signerSelection.value,
        runtimePolicyScope,
        nonceB64u,
      }
    : {
        version: 'add_signer_intent_v1',
        walletId: walletId.value,
        signerSelection: signerSelection.value,
        nonceB64u,
      };
  return {
    kind: 'add_signer_intent_allocated',
    grant: addSignerIntentGrantFromString(grant),
    intent: parsedIntent,
    digestB64u,
    orgId,
    expiresAtMs,
    ...(trimString(record.signingRootId)
      ? { signingRootId: trimString(record.signingRootId) }
      : {}),
    ...(trimString(record.signingRootVersion)
      ? { signingRootVersion: trimString(record.signingRootVersion) }
      : {}),
    ...(trimString(record.expectedOrigin)
      ? { expectedOrigin: trimString(record.expectedOrigin) }
      : {}),
  };
}

function parseStoredAddAuthMethodIntent(value: unknown): StoredAddAuthMethodIntent | null {
  const decoded = parseJsonValue(value);
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  const record: StoredAddAuthMethodIntentRecord = decoded;
  if (record.kind !== 'add_auth_method_intent_allocated') return null;
  const grant = trimString(record.grant);
  const digestB64u = trimString(record.digestB64u);
  const orgId = trimString(record.orgId);
  const expiresAtMs = Number(record.expiresAtMs);
  if (!grant || !digestB64u || !orgId || !Number.isSafeInteger(expiresAtMs)) return null;
  if (record.intent === null || typeof record.intent !== 'object' || Array.isArray(record.intent)) {
    return null;
  }
  const intent: StoredAddAuthMethodIntentPayloadRecord = record.intent;
  const walletId = parseWalletId(intent.walletId);
  const authMethod = normalizeAddAuthMethodInput(intent.authMethod);
  const targetWalletAuthMethodId = parseWalletAuthMethodId(intent.targetWalletAuthMethodId);
  const caller = normalizeAddAuthMethodIntentCaller(intent);
  const nonceB64u = trimString(intent.nonceB64u);
  if (
    intent.version !== 'add_auth_method_intent_v1' ||
    !walletId.ok ||
    !authMethod ||
    !targetWalletAuthMethodId.ok ||
    !caller ||
    !nonceB64u
  ) {
    return null;
  }
  const runtimePolicyScope = Object.prototype.hasOwnProperty.call(intent, 'runtimePolicyScope')
    ? parseStoredAddAuthMethodRuntimePolicyScope(intent.runtimePolicyScope)
    : undefined;
  if (Object.prototype.hasOwnProperty.call(intent, 'runtimePolicyScope') && !runtimePolicyScope) {
    return null;
  }
  const parsedIntent: AddAuthMethodIntentV1 =
    caller.caller === 'same_device_addition'
      ? {
          version: 'add_auth_method_intent_v1',
          walletId: walletId.value,
          authMethod,
          targetWalletAuthMethodId: targetWalletAuthMethodId.value,
          ...(runtimePolicyScope ? { runtimePolicyScope } : {}),
          nonceB64u,
          caller: 'same_device_addition',
          source: caller.source,
        }
      : {
          version: 'add_auth_method_intent_v1',
          walletId: walletId.value,
          authMethod,
          targetWalletAuthMethodId: targetWalletAuthMethodId.value,
          ...(runtimePolicyScope ? { runtimePolicyScope } : {}),
          nonceB64u,
          caller: 'linked_device_ceremony',
        };
  return {
    kind: 'add_auth_method_intent_allocated',
    grant: addAuthMethodIntentGrantFromString(grant),
    intent: parsedIntent,
    digestB64u,
    orgId,
    expiresAtMs,
    ...(trimString(record.signingRootId)
      ? { signingRootId: trimString(record.signingRootId) }
      : {}),
    ...(trimString(record.signingRootVersion)
      ? { signingRootVersion: trimString(record.signingRootVersion) }
      : {}),
    ...(trimString(record.expectedOrigin)
      ? { expectedOrigin: trimString(record.expectedOrigin) }
      : {}),
  };
}

function hasDefinedField(obj: Record<string, unknown>, field: string): boolean {
  return field in obj && obj[field] !== undefined;
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

function parseStoredRegistrationAuthority(value: unknown): StoredRegistrationAuthority | null {
  const decoded = parseJsonValue(value);
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  const record: StoredRegistrationAuthorityRecord = decoded;
  const walletId = parseWalletId(record.walletId);
  const registrationIntentDigestB64u = trimString(record.registrationIntentDigestB64u);
  if (!walletId.ok || !registrationIntentDigestB64u) return null;

  switch (record.kind) {
    case 'passkey': {
      if (record.emailHashHex !== undefined || record.challengeId !== undefined) {
        return null;
      }
      const rpId = parseWebAuthnRpId(record.rpId);
      const credentialIdB64u = parseWebAuthnCredentialIdB64u(record.credentialIdB64u);
      const credentialPublicKeyB64u = trimString(record.credentialPublicKeyB64u);
      const counter = Number(record.counter);
      const device = parseWebAuthnAuthenticatorDeviceInfo(record.device);
      if (
        !rpId.ok ||
        !credentialIdB64u.ok ||
        !credentialPublicKeyB64u ||
        !Number.isSafeInteger(counter) ||
        counter < 0 ||
        !device
      ) {
        return null;
      }
      return {
        kind: 'passkey',
        walletId: walletId.value,
        rpId: rpId.value,
        credentialIdB64u: credentialIdB64u.value,
        credentialPublicKeyB64u,
        counter,
        device,
        registrationIntentDigestB64u,
      };
    }
    case 'email_otp': {
      if (
        record.rpId !== undefined ||
        record.credentialIdB64u !== undefined ||
        record.credentialPublicKeyB64u !== undefined ||
        record.counter !== undefined
      ) {
        return null;
      }
      const emailHashHex = trimString(record.emailHashHex);
      const proofKind = trimString(record.proofKind);
      const providerSubject = parseProviderSubject(record.providerSubject);
      const email = trimString(record.email).toLowerCase();
      const finalWalletId = parseWalletId(record.finalWalletId);
      const orgId = parseOrgId(record.orgId);
      const ownerProofBindingDigest = trimString(record.ownerProofBindingDigest);
      if (
        !providerSubject.ok ||
        !email ||
        !emailHashHex ||
        !finalWalletId.ok ||
        !orgId.ok ||
        !ownerProofBindingDigest
      ) {
        return null;
      }
      if (proofKind === 'otp_challenge') {
        const parsedChallengeId = parseEmailOtpChallengeId(record.challengeId);
        const registrationAuthorityId = parseEmailOtpChallengeId(record.registrationAuthorityId);
        const challengeSubjectId = parseChallengeSubjectId(record.challengeSubjectId);
        const originalWalletId = parseWalletId(record.originalWalletId);
        const challengePurpose =
          record.challengePurpose === 'registration' ||
          record.challengePurpose === 'registration_reroll'
            ? record.challengePurpose
            : null;
        if (
          !challengeSubjectId.ok ||
          !parsedChallengeId.ok ||
          !registrationAuthorityId.ok ||
          parsedChallengeId.value !== registrationAuthorityId.value ||
          !originalWalletId.ok ||
          !challengePurpose
        ) {
          return null;
        }
        return {
          kind: 'email_otp',
          proofKind: 'otp_challenge',
          walletId: walletId.value,
          providerSubject: providerSubject.value,
          challengeSubjectId: challengeSubjectId.value,
          email,
          emailHashHex,
          challengeId: parsedChallengeId.value,
          registrationAuthorityId: registrationAuthorityId.value,
          originalWalletId: originalWalletId.value,
          finalWalletId: finalWalletId.value,
          orgId: orgId.value,
          ownerProofBindingDigest,
          challengePurpose,
          registrationIntentDigestB64u,
        };
      }
      if (proofKind === 'google_sso_registration') {
        const registrationAttemptId = trimString(record.googleEmailOtpRegistrationAttemptId);
        const registrationOfferId = trimString(record.googleEmailOtpRegistrationOfferId);
        const registrationCandidateId = trimString(record.googleEmailOtpRegistrationCandidateId);
        const registrationAuthorityId = trimString(record.registrationAuthorityId);
        if (
          !registrationAttemptId ||
          !registrationOfferId ||
          !registrationCandidateId ||
          !registrationAuthorityId ||
          registrationAuthorityId !== registrationAttemptId ||
          record.challengeId !== undefined ||
          record.challengeSubjectId !== undefined ||
          record.originalWalletId !== undefined ||
          record.challengePurpose !== undefined
        ) {
          return null;
        }
        return {
          kind: 'email_otp',
          proofKind: 'google_sso_registration',
          walletId: walletId.value,
          providerSubject: providerSubject.value,
          email,
          emailHashHex,
          googleEmailOtpRegistrationAttemptId: registrationAttemptId,
          googleEmailOtpRegistrationOfferId: registrationOfferId,
          googleEmailOtpRegistrationCandidateId: registrationCandidateId,
          registrationAuthorityId,
          finalWalletId: finalWalletId.value,
          orgId: orgId.value,
          ownerProofBindingDigest,
          registrationIntentDigestB64u,
        };
      }
      return null;
    }
  }
  return null;
}

type StoredRegistrationIntentRecord = {
  readonly version?: unknown;
  readonly walletId?: unknown;
  readonly authMethod?: unknown;
  readonly signerSelection?: unknown;
  readonly foundingWalletAuthMethodId?: unknown;
  readonly runtimePolicyScope?: unknown;
  readonly nonceB64u?: unknown;
};

type StoredWalletRegistrationCeremonyRecord = {
  readonly registrationCeremonyId?: unknown;
  readonly foundingWalletAuthorityId?: unknown;
  readonly foundingDeviceId?: unknown;
  readonly foundingWalletAuthMethodId?: unknown;
  readonly intent?: unknown;
  readonly digestB64u?: unknown;
  readonly signerPlan?: unknown;
  readonly preparedContext?: unknown;
  readonly orgId?: unknown;
  readonly signingRootId?: unknown;
  readonly signingRootVersion?: unknown;
  readonly expectedOrigin?: unknown;
  readonly expiresAtMs?: unknown;
  readonly authorityState?: unknown;
  readonly signerState?: unknown;
};

type StoredWalletRegistrationCeremonyAuthorityStateRecord = {
  readonly kind?: unknown;
  readonly authMethod?: unknown;
  readonly authority?: unknown;
};

type StoredRegistrationSignerStateRecord = {
  readonly kind?: unknown;
  readonly branches?: unknown;
  readonly failedAtMs?: unknown;
  readonly failure?: unknown;
};

type StoredRegistrationFailureRecord = {
  readonly code?: unknown;
  readonly message?: unknown;
};

type StoredRegistrationSignerBranchRecord = {
  readonly kind?: unknown;
  readonly branchKey?: unknown;
  readonly admissionRequest?: unknown;
  readonly admissionReceipt?: unknown;
  readonly derivationKind?: unknown;
  readonly chainTargets?: unknown;
  readonly prepare?: unknown;
  readonly strictRegistration?: unknown;
  readonly strictRegistrationBindingJson?: unknown;
  readonly registrationRequest?: unknown;
  readonly pendingActivation?: unknown;
  readonly publicResponse?: unknown;
  readonly publicFacts?: unknown;
  readonly activationRequestDigestB64u?: unknown;
  readonly activationOwner?: unknown;
  readonly activation?: unknown;
  readonly publicCapability?: unknown;
  readonly bootstrap?: unknown;
  readonly finalizedAtMs?: unknown;
};

type StoredRegistrationEcdsaPrepareRecord = {
  readonly formatVersion?: unknown;
  readonly walletId?: unknown;
  readonly evmFamilySigningKeySlotId?: unknown;
  readonly ecdsaThresholdKeyId?: unknown;
  readonly signingRootId?: unknown;
  readonly signingRootVersion?: unknown;
  readonly keyScope?: unknown;
  readonly relayerKeyId?: unknown;
  readonly registrationPreparationId?: unknown;
  readonly requestId?: unknown;
  readonly thresholdSessionId?: unknown;
  readonly ttlMs?: unknown;
  readonly remainingUses?: unknown;
  readonly participantIds?: unknown;
  readonly runtimePolicyScope?: unknown;
};

type StoredEcdsaDerivationBootstrapRecord = {
  readonly formatVersion?: unknown;
  readonly walletId?: unknown;
  readonly evmFamilySigningKeySlotId?: unknown;
  readonly ecdsaThresholdKeyId?: unknown;
  readonly relayerKeyId?: unknown;
  readonly applicationBindingDigestB64u?: unknown;
  readonly contextBinding32B64u?: unknown;
  readonly publicIdentity?: unknown;
  readonly clientShareRetryCounter?: unknown;
  readonly relayerShareRetryCounter?: unknown;
  readonly publicTranscriptDigest32B64u?: unknown;
  readonly keyHandle?: unknown;
  readonly signingRootId?: unknown;
  readonly signingRootVersion?: unknown;
  readonly thresholdEcdsaPublicKeyB64u?: unknown;
  readonly ethereumAddress?: unknown;
  readonly relayerVerifyingShareB64u?: unknown;
  readonly participantIds?: unknown;
  readonly thresholdSessionId?: unknown;
  readonly activationEpoch?: unknown;
  readonly expiresAtMs?: unknown;
  readonly expiresAt?: unknown;
  readonly remainingUses?: unknown;
  readonly routerAbEcdsaDerivationNormalSigning?: unknown;
};

type StoredEcdsaDerivationPublicIdentityRecord = {
  readonly derivationClientSharePublicKey33B64u?: unknown;
  readonly relayerPublicKey33B64u?: unknown;
  readonly groupPublicKey33B64u?: unknown;
  readonly ethereumAddress?: unknown;
};

type StoredWalletAddSignerCeremonyRecord = {
  readonly addSignerCeremonyId?: unknown;
  readonly intent?: unknown;
  readonly digestB64u?: unknown;
  readonly orgId?: unknown;
  readonly signingRootId?: unknown;
  readonly signingRootVersion?: unknown;
  readonly expiresAtMs?: unknown;
  readonly auth?: unknown;
  readonly signerState?: unknown;
};

type StoredWalletAddSignerAuthRecord = {
  readonly kind?: unknown;
  readonly rpId?: unknown;
  readonly credentialIdB64u?: unknown;
};

type StoredWalletAddSignerSignerStateRecord = {
  readonly kind?: unknown;
  readonly admissionRequest?: unknown;
  readonly finalizeRequest?: unknown;
  readonly activation?: unknown;
  readonly response?: unknown;
  readonly signer?: unknown;
  readonly finalizingAtMs?: unknown;
  readonly derivationKind?: unknown;
  readonly chainTargets?: unknown;
  readonly prepare?: unknown;
  readonly strictRegistration?: unknown;
  readonly registrationRequest?: unknown;
  readonly pendingActivation?: unknown;
  readonly publicResponse?: unknown;
  readonly publicFacts?: unknown;
  readonly activationRequestDigestB64u?: unknown;
  readonly publicCapability?: unknown;
  readonly bootstrap?: unknown;
};

type StoredWalletAddSignerNearActivationRecord = {
  readonly admissionRequest?: unknown;
  readonly admissionReceipt?: unknown;
  readonly result?: unknown;
};

type StoredWalletAddAuthMethodCeremonyRecord = {
  readonly kind?: unknown;
  readonly addAuthMethodCeremonyId?: unknown;
  readonly intent?: unknown;
  readonly digestB64u?: unknown;
  readonly orgId?: unknown;
  readonly sourceWalletAuthMethodId?: unknown;
  readonly sourceWalletAuthorityId?: unknown;
  readonly sourceAuthorityDigestB64u?: unknown;
  readonly sourceAuthorityRevocationEpoch?: unknown;
  readonly targetWalletAuthMethodId?: unknown;
  readonly expectedOrigin?: unknown;
  readonly expiresAtMs?: unknown;
  readonly auth?: unknown;
  readonly custodyEnvelope?: unknown;
  readonly authority?: unknown;
  readonly passkeyRegistration?: unknown;
};

type StoredWalletAddAuthMethodPasskeyRegistrationRecord = {
  readonly rpId?: unknown;
  readonly challengeB64u?: unknown;
  readonly options?: unknown;
};

type StoredWalletAddAuthMethodCeremonyAuthRecord = {
  readonly kind?: unknown;
  readonly providerUserId?: unknown;
  readonly enrollmentId?: unknown;
  readonly enrollmentSealKeyVersion?: unknown;
  readonly authorityRef?: unknown;
  readonly walletSessionId?: unknown;
  readonly authorizationId?: unknown;
  readonly rpId?: unknown;
  readonly credentialIdB64u?: unknown;
};

function parseStoredRegistrationIntent(value: unknown): RegistrationIntentV1 | null {
  const decoded = parseJsonValue(value);
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  const record: StoredRegistrationIntentRecord = decoded;
  if (record.version !== 'registration_intent_v1') return null;
  const walletId = parseWalletId(record.walletId);
  const authMethod = normalizeRegistrationAuthMethodInput(record.authMethod);
  const signerPlan = parseStoredRegistrationSignerPlan(record.signerSelection);
  const foundingWalletAuthMethodId = parseWalletAuthMethodId(record.foundingWalletAuthMethodId);
  const nonceB64u = trimString(record.nonceB64u);
  if (!walletId.ok || !authMethod || !signerPlan || !foundingWalletAuthMethodId.ok || !nonceB64u) {
    return null;
  }
  const signerSelection = registrationSignerSetSelectionFromPlan(signerPlan, {
    normalizeEcdsaChainTarget: thresholdEcdsaChainTargetFromValue,
  });
  if (!signerSelection.ok) return null;
  const runtimePolicyScope = Object.prototype.hasOwnProperty.call(record, 'runtimePolicyScope')
    ? parseStoredAddAuthMethodRuntimePolicyScope(record.runtimePolicyScope)
    : undefined;
  if (Object.prototype.hasOwnProperty.call(record, 'runtimePolicyScope') && !runtimePolicyScope) {
    return null;
  }
  return runtimePolicyScope
    ? {
        version: 'registration_intent_v1',
        walletId: walletId.value,
        authMethod,
        signerSelection: signerSelection.value,
        foundingWalletAuthMethodId: foundingWalletAuthMethodId.value,
        runtimePolicyScope,
        nonceB64u,
      }
    : {
        version: 'registration_intent_v1',
        walletId: walletId.value,
        authMethod,
        signerSelection: signerSelection.value,
        foundingWalletAuthMethodId: foundingWalletAuthMethodId.value,
        nonceB64u,
      };
}

function parseStoredRegistrationSignerBranchKey(
  value: unknown,
): RegistrationSignerBranchKey | null {
  const branchKey = trimString(value);
  if (!branchKey) return null;
  try {
    return registrationSignerBranchKeyFromString(branchKey);
  } catch {
    return null;
  }
}

function parseStoredRegistrationEcdsaChainTargets(
  value: unknown,
): readonly [ThresholdEcdsaChainTarget, ...ThresholdEcdsaChainTarget[]] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const chainTargets: ThresholdEcdsaChainTarget[] = [];
  const seen = new Set<string>();
  for (const rawTarget of value) {
    const chainTarget = thresholdEcdsaChainTargetFromValue(rawTarget);
    if (!chainTarget) return null;
    const key = thresholdEcdsaChainTargetKey(chainTarget);
    if (seen.has(key)) return null;
    seen.add(key);
    chainTargets.push(chainTarget);
  }
  const first = chainTargets[0];
  return first ? [first, ...chainTargets.slice(1)] : null;
}

function parseStoredRegistrationEcdsaParticipantPair(value: unknown): readonly [1, 2] | null {
  if (!Array.isArray(value) || value.length !== 2 || value[0] !== 1 || value[1] !== 2) {
    return null;
  }
  return [1, 2];
}

function parseStoredWalletRegistrationEcdsaPrepare(
  value: unknown,
): StoredWalletRegistrationEvmFamilyEcdsaPreparedBranch['prepare'] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: StoredRegistrationEcdsaPrepareRecord = value;
  if (record.formatVersion !== 'ecdsa-derivation-role-local') return null;
  const walletId = trimString(record.walletId);
  const evmFamilySigningKeySlotId = trimString(record.evmFamilySigningKeySlotId);
  const ecdsaThresholdKeyId = trimString(record.ecdsaThresholdKeyId);
  const signingRootId = trimString(record.signingRootId);
  const signingRootVersion = trimString(record.signingRootVersion);
  const relayerKeyId = trimString(record.relayerKeyId);
  const registrationPreparationId = trimString(record.registrationPreparationId);
  const requestId = trimString(record.requestId);
  const thresholdSessionId = trimString(record.thresholdSessionId);
  const ttlMs = Number(record.ttlMs);
  const remainingUses = Number(record.remainingUses);
  const participantIds = parseStoredRegistrationEcdsaParticipantPair(record.participantIds);
  const runtimePolicyScope = parseStoredRuntimePolicyScope(record.runtimePolicyScope);
  if (
    !walletId ||
    !evmFamilySigningKeySlotId ||
    !ecdsaThresholdKeyId ||
    !signingRootId ||
    !signingRootVersion ||
    record.keyScope !== 'evm-family' ||
    !relayerKeyId ||
    !registrationPreparationId ||
    !requestId ||
    !thresholdSessionId ||
    !Number.isSafeInteger(ttlMs) ||
    !Number.isSafeInteger(remainingUses) ||
    !participantIds ||
    !runtimePolicyScope
  ) {
    return null;
  }
  try {
    return {
      formatVersion: 'ecdsa-derivation-role-local',
      walletId,
      evmFamilySigningKeySlotId,
      ecdsaThresholdKeyId,
      signingRootId,
      signingRootVersion,
      keyScope: 'evm-family',
      relayerKeyId,
      registrationPreparationId: registrationPreparationIdFromString(registrationPreparationId),
      requestId,
      thresholdSessionId,
      ttlMs,
      remainingUses,
      participantIds,
      runtimePolicyScope,
    };
  } catch {
    return null;
  }
}

function parseStoredEcdsaDerivationPublicIdentity(
  value: unknown,
): EcdsaDerivationServerBootstrapResponse['publicIdentity'] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: StoredEcdsaDerivationPublicIdentityRecord = value;
  const derivationClientSharePublicKey33B64u = trimString(
    record.derivationClientSharePublicKey33B64u,
  );
  const relayerPublicKey33B64u = trimString(record.relayerPublicKey33B64u);
  const groupPublicKey33B64u = trimString(record.groupPublicKey33B64u);
  const ethereumAddress = trimString(record.ethereumAddress);
  if (
    !derivationClientSharePublicKey33B64u ||
    !relayerPublicKey33B64u ||
    !groupPublicKey33B64u ||
    !ethereumAddress
  ) {
    return null;
  }
  return parseEcdsaDerivationPublicIdentity({
    derivationClientSharePublicKey33B64u,
    relayerPublicKey33B64u,
    groupPublicKey33B64u,
    ethereumAddress,
  });
}

function parseStoredEcdsaDerivationServerBootstrapResponse(
  value: unknown,
): EcdsaDerivationServerBootstrapResponse | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: StoredEcdsaDerivationBootstrapRecord = value;
  if (record.formatVersion !== 'ecdsa-derivation-role-local') return null;
  const publicIdentity = parseStoredEcdsaDerivationPublicIdentity(record.publicIdentity);
  const walletId = trimString(record.walletId);
  const evmFamilySigningKeySlotId = trimString(record.evmFamilySigningKeySlotId);
  const ecdsaThresholdKeyId = trimString(record.ecdsaThresholdKeyId);
  const relayerKeyId = trimString(record.relayerKeyId);
  const applicationBindingDigestB64u = trimString(record.applicationBindingDigestB64u);
  const contextBinding32B64u = trimString(record.contextBinding32B64u);
  const clientShareRetryCounter = Number(record.clientShareRetryCounter);
  const relayerShareRetryCounter = Number(record.relayerShareRetryCounter);
  const publicTranscriptDigest32B64u = trimString(record.publicTranscriptDigest32B64u);
  const keyHandle = trimString(record.keyHandle);
  const signingRootId = trimString(record.signingRootId);
  const signingRootVersion = trimString(record.signingRootVersion);
  const thresholdEcdsaPublicKeyB64u = trimString(record.thresholdEcdsaPublicKeyB64u);
  const ethereumAddress = trimString(record.ethereumAddress);
  const relayerVerifyingShareB64u = trimString(record.relayerVerifyingShareB64u);
  const participantIds = parseStoredRegistrationEcdsaParticipantPair(record.participantIds);
  const thresholdSessionId = trimString(record.thresholdSessionId);
  const activationEpoch = parseRootShareEpoch(record.activationEpoch);
  const expiresAtMs = Number(record.expiresAtMs);
  const expiresAt = trimString(record.expiresAt);
  const remainingUses = Number(record.remainingUses);
  let routerAbEcdsaDerivationNormalSigning;
  try {
    routerAbEcdsaDerivationNormalSigning = parseRouterAbEcdsaDerivationNormalSigningStateV1(
      record.routerAbEcdsaDerivationNormalSigning,
    );
  } catch {
    return null;
  }
  if (
    !walletId ||
    !evmFamilySigningKeySlotId ||
    !ecdsaThresholdKeyId ||
    !relayerKeyId ||
    !applicationBindingDigestB64u ||
    !contextBinding32B64u ||
    !publicIdentity ||
    !Number.isSafeInteger(clientShareRetryCounter) ||
    clientShareRetryCounter < 0 ||
    !Number.isSafeInteger(relayerShareRetryCounter) ||
    relayerShareRetryCounter < 0 ||
    !publicTranscriptDigest32B64u ||
    !keyHandle ||
    !signingRootId ||
    !signingRootVersion ||
    !thresholdEcdsaPublicKeyB64u ||
    !ethereumAddress ||
    !relayerVerifyingShareB64u ||
    !participantIds ||
    !thresholdSessionId ||
    !activationEpoch.ok ||
    !Number.isSafeInteger(expiresAtMs) ||
    !expiresAt ||
    !Number.isSafeInteger(remainingUses) ||
    remainingUses < 0 ||
    !routerAbEcdsaDerivationNormalSigning
  ) {
    return null;
  }
  return {
    formatVersion: 'ecdsa-derivation-role-local',
    walletId,
    evmFamilySigningKeySlotId,
    ecdsaThresholdKeyId,
    relayerKeyId,
    applicationBindingDigestB64u,
    contextBinding32B64u,
    publicIdentity,
    clientShareRetryCounter,
    relayerShareRetryCounter,
    publicTranscriptDigest32B64u,
    keyHandle,
    signingRootId,
    signingRootVersion,
    thresholdEcdsaPublicKeyB64u,
    ethereumAddress,
    relayerVerifyingShareB64u,
    participantIds: [1, 2],
    thresholdSessionId,
    activationEpoch: activationEpoch.value,
    expiresAtMs,
    expiresAt,
    remainingUses,
    routerAbEcdsaDerivationNormalSigning,
  };
}

type StoredWalletRegistrationEcdsaBranchBase = {
  readonly branchKey: RegistrationSignerBranchKey;
  readonly derivationKind: WalletRegistrationEcdsaStartPayload['kind'];
  readonly chainTargets: readonly [ThresholdEcdsaChainTarget, ...ThresholdEcdsaChainTarget[]];
  readonly prepare: WalletRegistrationEcdsaStartPayload['prepare'];
  readonly strictRegistration: WalletRegistrationEcdsaStartPayload['strictRegistration'];
  readonly strictRegistrationBindingJson: string;
};

function parseStoredWalletRegistrationEcdsaBranchBase(
  value: unknown,
): StoredWalletRegistrationEcdsaBranchBase | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: StoredRegistrationSignerBranchRecord = value;
  const branchKey = parseStoredRegistrationSignerBranchKey(record.branchKey);
  const chainTargets = parseStoredRegistrationEcdsaChainTargets(record.chainTargets);
  const prepare = parseStoredWalletRegistrationEcdsaPrepare(record.prepare);
  const strictRegistrationBindingJson = trimString(record.strictRegistrationBindingJson);
  if (
    !branchKey ||
    record.derivationKind !== 'evm_family_ecdsa_keygen' ||
    !chainTargets ||
    !prepare ||
    !strictRegistrationBindingJson
  ) {
    return null;
  }
  let strictRegistration: WalletRegistrationEcdsaStartPayload['strictRegistration'];
  try {
    strictRegistration = parseRouterAbEcdsaRegistrationRequestFactsV1(record.strictRegistration);
  } catch {
    return null;
  }
  return strictRegistration.registration_purpose === 'wallet_registration'
    ? {
        branchKey,
        derivationKind: 'evm_family_ecdsa_keygen',
        chainTargets,
        prepare,
        strictRegistration,
        strictRegistrationBindingJson,
      }
    : null;
}

function parseStoredWalletRegistrationSignerBranch(
  value: unknown,
): StoredWalletRegistrationSignerBranch | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: StoredRegistrationSignerBranchRecord = value;
  switch (record.kind) {
    case 'near_ed25519_yao_authorized': {
      const branchKey = parseStoredRegistrationSignerBranchKey(record.branchKey);
      const admissionRequest = parseRouterAbEd25519YaoRegistrationAdmissionRequestV1(
        record.admissionRequest,
      );
      return branchKey && admissionRequest.ok
        ? {
            kind: 'near_ed25519_yao_authorized',
            branchKey,
            admissionRequest: admissionRequest.value,
          }
        : null;
    }
    case 'evm_family_ecdsa_prepared': {
      const base = parseStoredWalletRegistrationEcdsaBranchBase(record);
      return base
        ? {
            kind: 'evm_family_ecdsa_prepared',
            branchKey: base.branchKey,
            derivationKind: base.derivationKind,
            chainTargets: base.chainTargets,
            prepare: base.prepare,
            strictRegistration: base.strictRegistration,
            strictRegistrationBindingJson: base.strictRegistrationBindingJson,
          }
        : null;
    }
    case 'evm_family_ecdsa_response_claimed': {
      const base = parseStoredWalletRegistrationEcdsaBranchBase(record);
      if (!base) return null;
      try {
        const registrationRequest = parseRouterAbEcdsaRegistrationRequestV1(
          record.registrationRequest,
        );
        return registrationRequest.registration_purpose === 'wallet_registration'
          ? {
              kind: 'evm_family_ecdsa_response_claimed',
              branchKey: base.branchKey,
              derivationKind: base.derivationKind,
              chainTargets: base.chainTargets,
              prepare: base.prepare,
              strictRegistration: base.strictRegistration,
              strictRegistrationBindingJson: base.strictRegistrationBindingJson,
              registrationRequest,
            }
          : null;
      } catch {
        return null;
      }
    }
    case 'evm_family_ecdsa_pending_activation': {
      const base = parseStoredWalletRegistrationEcdsaBranchBase(record);
      if (!base) return null;
      try {
        const registrationRequest = parseRouterAbEcdsaRegistrationRequestV1(
          record.registrationRequest,
        );
        const pendingActivation = parseStoredRouterAbEcdsaPendingActivationV1(
          record.pendingActivation,
        );
        const publicResponse = parseRouterAbEcdsaStrictForwardedRegistrationResponseV1(
          record.publicResponse,
        );
        return registrationRequest.registration_purpose === 'wallet_registration'
          ? {
              kind: 'evm_family_ecdsa_pending_activation',
              branchKey: base.branchKey,
              derivationKind: base.derivationKind,
              chainTargets: base.chainTargets,
              prepare: base.prepare,
              strictRegistration: base.strictRegistration,
              strictRegistrationBindingJson: base.strictRegistrationBindingJson,
              registrationRequest,
              pendingActivation,
              publicResponse,
            }
          : null;
      } catch {
        return null;
      }
    }
    case 'evm_family_ecdsa_activation_claimed': {
      const base = parseStoredWalletRegistrationEcdsaBranchBase(record);
      const activationRequestDigestB64u = parseStoredRegistrationDigest(
        record.activationRequestDigestB64u,
      );
      const activationOwner = trimString(record.activationOwner);
      if (!base || !activationRequestDigestB64u || !activationOwner) return null;
      try {
        const registrationRequest = parseRouterAbEcdsaRegistrationRequestV1(
          record.registrationRequest,
        );
        const pendingActivation = parseStoredRouterAbEcdsaPendingActivationV1(
          record.pendingActivation,
        );
        const publicResponse = parseRouterAbEcdsaStrictForwardedRegistrationResponseV1(
          record.publicResponse,
        );
        const publicFacts = parseRouterAbEcdsaVerifiedClientActivationFactsV1(record.publicFacts);
        return registrationRequest.registration_purpose === 'wallet_registration'
          ? {
              kind: 'evm_family_ecdsa_activation_claimed',
              branchKey: base.branchKey,
              derivationKind: base.derivationKind,
              chainTargets: base.chainTargets,
              prepare: base.prepare,
              strictRegistration: base.strictRegistration,
              strictRegistrationBindingJson: base.strictRegistrationBindingJson,
              registrationRequest,
              pendingActivation,
              publicResponse,
              publicFacts,
              activationRequestDigestB64u,
              activationOwner,
            }
          : null;
      } catch {
        return null;
      }
    }
    case 'evm_family_ecdsa_activated':
    case 'evm_family_ecdsa_finalized': {
      const base = parseStoredWalletRegistrationEcdsaBranchBase(record);
      const bootstrap = parseStoredEcdsaDerivationServerBootstrapResponse(record.bootstrap);
      if (!base || !bootstrap) return null;
      try {
        const registrationRequest = parseRouterAbEcdsaRegistrationRequestV1(
          record.registrationRequest,
        );
        const publicFacts = parseRouterAbEcdsaVerifiedClientActivationFactsV1(record.publicFacts);
        const activation = parseRouterAbEcdsaRegistrationActivationReceiptV1(record.activation);
        const publicCapability = parseRouterAbEcdsaDerivationPublicCapabilityV1(
          record.publicCapability,
        );
        if (registrationRequest.registration_purpose !== 'wallet_registration') return null;
        if (record.kind === 'evm_family_ecdsa_activated') {
          const activationOwner = trimString(record.activationOwner);
          return activationOwner
            ? {
                kind: 'evm_family_ecdsa_activated',
                branchKey: base.branchKey,
                derivationKind: base.derivationKind,
                chainTargets: base.chainTargets,
                prepare: base.prepare,
                strictRegistration: base.strictRegistration,
                strictRegistrationBindingJson: base.strictRegistrationBindingJson,
                registrationRequest,
                publicFacts,
                activation,
                publicCapability,
                bootstrap,
                activationOwner,
              }
            : null;
        }
        const finalizedAtMs = Number(record.finalizedAtMs);
        return Number.isSafeInteger(finalizedAtMs) && finalizedAtMs > 0
          ? {
              kind: 'evm_family_ecdsa_finalized',
              branchKey: base.branchKey,
              derivationKind: base.derivationKind,
              chainTargets: base.chainTargets,
              prepare: base.prepare,
              strictRegistration: base.strictRegistration,
              strictRegistrationBindingJson: base.strictRegistrationBindingJson,
              registrationRequest,
              publicFacts,
              activation,
              publicCapability,
              bootstrap,
              finalizedAtMs,
            }
          : null;
      } catch {
        return null;
      }
    }
    default:
      return null;
  }
}

function parseStoredWalletRegistrationSignerState(
  value: unknown,
): StoredWalletRegistrationSignerState | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: StoredRegistrationSignerStateRecord = value;
  if (record.kind === 'signer_set_registration') {
    if (!Array.isArray(record.branches)) return null;
    const branches: StoredWalletRegistrationSignerBranch[] = [];
    for (const rawBranch of record.branches) {
      const branch = parseStoredWalletRegistrationSignerBranch(rawBranch);
      if (!branch) return null;
      branches.push(branch);
    }
    return { kind: 'signer_set_registration', branches };
  }
  if (record.kind !== 'registration_failed') return null;
  const failedAtMs = Number(record.failedAtMs);
  if (
    !Number.isSafeInteger(failedAtMs) ||
    failedAtMs <= 0 ||
    record.failure === null ||
    typeof record.failure !== 'object' ||
    Array.isArray(record.failure)
  ) {
    return null;
  }
  const failure: StoredRegistrationFailureRecord = record.failure;
  const code = trimString(failure.code);
  const message = trimString(failure.message);
  return code && message
    ? { kind: 'registration_failed', failedAtMs, failure: { code, message } }
    : null;
}

function parseStoredRegistrationDigest(value: unknown): string | null {
  try {
    return parseDigestB64u(value);
  } catch {
    return null;
  }
}

function parseStoredWalletRegistrationCeremony(
  value: unknown,
): StoredWalletRegistrationCeremony | null {
  const decoded = parseJsonValue(value);
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  const record: StoredWalletRegistrationCeremonyRecord = decoded;
  const registrationCeremonyId = trimString(record.registrationCeremonyId);
  const foundingWalletAuthorityId = parseWalletAuthorityId(record.foundingWalletAuthorityId);
  const foundingDeviceId = parseDeviceId(record.foundingDeviceId);
  const foundingWalletAuthMethodId = parseWalletAuthMethodId(record.foundingWalletAuthMethodId);
  const intent = parseStoredRegistrationIntent(record.intent);
  const digestB64u = trimString(record.digestB64u);
  const signerPlan = parseStoredRegistrationSignerPlan(record.signerPlan);
  const preparedContext = parseStoredWalletRegistrationPreparedContext(record.preparedContext);
  const orgId = trimString(record.orgId);
  const signingRootId = trimString(record.signingRootId);
  const signingRootVersion = trimString(record.signingRootVersion);
  const expectedOrigin = trimString(record.expectedOrigin);
  const expiresAtMs = Number(record.expiresAtMs);
  const authorityState = parseStoredWalletRegistrationCeremonyAuthorityState(record.authorityState);
  const signerState = parseStoredWalletRegistrationSignerState(record.signerState);
  const intentSignerPlan = intent
    ? parseStoredRegistrationSignerPlan(intent.signerSelection)
    : null;
  if (
    !registrationCeremonyId ||
    !authorityState ||
    !foundingWalletAuthorityId.ok ||
    !foundingDeviceId.ok ||
    !foundingWalletAuthMethodId.ok ||
    !intent ||
    !digestB64u ||
    !orgId ||
    !Number.isSafeInteger(expiresAtMs) ||
    !signerPlan ||
    !preparedContext ||
    !intentSignerPlan ||
    !storedRegistrationSignerPlansMatch(signerPlan, intentSignerPlan) ||
    (signingRootId && preparedContext.signingRootId !== signingRootId) ||
    (signingRootVersion && preparedContext.signingRootVersion !== signingRootVersion) ||
    !signerState
  ) {
    return null;
  }
  return {
    registrationCeremonyId,
    foundingWalletAuthorityId: foundingWalletAuthorityId.value,
    foundingDeviceId: foundingDeviceId.value,
    foundingWalletAuthMethodId: foundingWalletAuthMethodId.value,
    intent,
    digestB64u,
    signerPlan,
    preparedContext,
    orgId,
    ...(signingRootId ? { signingRootId } : {}),
    ...(signingRootVersion ? { signingRootVersion } : {}),
    ...(expectedOrigin ? { expectedOrigin } : {}),
    expiresAtMs,
    authorityState,
    signerState,
  };
}

function parseStoredWalletRegistrationCeremonyAuthorityState(
  value: unknown,
): StoredWalletRegistrationCeremonyAuthorityState | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: StoredWalletRegistrationCeremonyAuthorityStateRecord = value;
  switch (record.kind) {
    case 'awaiting_proof': {
      const authMethod = parseStoredRegistrationCeremonyAuthMethod(record.authMethod);
      return authMethod ? { kind: 'awaiting_proof', authMethod } : null;
    }
    case 'verified': {
      const authority = parseStoredRegistrationAuthority(record.authority);
      return authority ? { kind: 'verified', authority } : null;
    }
    default:
      return null;
  }
}

function parseStoredRegistrationCeremonyAuthMethod(
  value: unknown,
): RegistrationIntentV1['authMethod'] | null {
  return normalizeRegistrationAuthMethodInput(parseJsonValue(value));
}

function parseStoredWalletAddSignerAuth(
  value: unknown,
): StoredWalletAddSignerCeremony['auth'] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: StoredWalletAddSignerAuthRecord = value;
  if (record.kind !== 'webauthn_assertion') return null;
  const rpId = parseWebAuthnRpId(record.rpId);
  const credentialIdB64u = parseWebAuthnCredentialIdB64u(record.credentialIdB64u);
  return rpId.ok && credentialIdB64u.ok
    ? { kind: 'webauthn_assertion', rpId: rpId.value, credentialIdB64u: credentialIdB64u.value }
    : null;
}

type StoredWalletAddSignerEcdsaStateBase = Pick<
  StoredEcdsaAddSignerPrepared,
  'derivationKind' | 'chainTargets' | 'prepare' | 'strictRegistration'
>;

function parseStoredWalletAddSignerEcdsaStateBase(
  value: unknown,
): StoredWalletAddSignerEcdsaStateBase | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: StoredWalletAddSignerSignerStateRecord = value;
  const chainTargets = parseStoredRegistrationEcdsaChainTargets(record.chainTargets);
  const prepare = parseStoredWalletRegistrationEcdsaPrepare(record.prepare);
  if (record.derivationKind !== 'evm_family_ecdsa_keygen' || !chainTargets || !prepare) {
    return null;
  }
  let strictRegistration: StoredEcdsaAddSignerPrepared['strictRegistration'];
  try {
    strictRegistration = parseRouterAbEcdsaRegistrationRequestFactsV1(record.strictRegistration);
  } catch {
    return null;
  }
  return strictRegistration.registration_purpose === 'wallet_add_signer'
    ? { derivationKind: 'evm_family_ecdsa_keygen', chainTargets, prepare, strictRegistration }
    : null;
}

function parseStoredWalletAddSignerNearActivation(
  value: unknown,
): Omit<StoredEd25519YaoAddSignerActivated, 'kind'> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: StoredWalletAddSignerSignerStateRecord = value;
  if (
    record.finalizeRequest === null ||
    typeof record.finalizeRequest !== 'object' ||
    Array.isArray(record.finalizeRequest) ||
    record.activation === null ||
    typeof record.activation !== 'object' ||
    Array.isArray(record.activation)
  ) {
    return null;
  }
  const finalizeRequest = parseStoredWalletAddSignerFinalizeRequest(record.finalizeRequest);
  const activation: StoredWalletAddSignerNearActivationRecord = record.activation;
  const admissionRequest = parseRouterAbEd25519YaoRegistrationAdmissionRequestV1(
    activation.admissionRequest,
  );
  const admissionReceipt = parseRouterAbEd25519YaoRegistrationActivationAdmissionReceiptV1(
    activation.admissionReceipt,
  );
  const result = parseRouterAbEd25519YaoRegistrationActivationResultV1(activation.result);
  if (
    !finalizeRequest ||
    finalizeRequest.kind !== 'near_ed25519' ||
    !admissionRequest.ok ||
    !admissionReceipt.ok ||
    !result.ok
  ) {
    return null;
  }
  const { lifecycleId, sessionId } = finalizeRequest.activationReference;
  if (
    lifecycleId !== admissionRequest.value.scope.lifecycle_id ||
    !storedWalletAddSignerByteArraysEqual(sessionId, admissionReceipt.value.binding.session_id) ||
    !storedWalletAddSignerByteArraysEqual(sessionId, result.value.binding.session_id)
  ) {
    return null;
  }
  return {
    finalizeRequest,
    activation: {
      admissionRequest: admissionRequest.value,
      admissionReceipt: admissionReceipt.value,
      result: result.value,
    },
  };
}

function parseStoredWalletAddSignerSignerState(
  value: unknown,
): StoredWalletAddSignerSignerState | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: StoredWalletAddSignerSignerStateRecord = value;
  switch (record.kind) {
    case 'near_ed25519_yao_add_signer_authorized': {
      const admissionRequest = parseRouterAbEd25519YaoRegistrationAdmissionRequestV1(
        record.admissionRequest,
      );
      return admissionRequest.ok
        ? {
            kind: 'near_ed25519_yao_add_signer_authorized',
            admissionRequest: admissionRequest.value,
          }
        : null;
    }
    case 'near_ed25519_yao_add_signer_activated': {
      const activation = parseStoredWalletAddSignerNearActivation(record);
      return activation
        ? {
            kind: 'near_ed25519_yao_add_signer_activated',
            finalizeRequest: activation.finalizeRequest,
            activation: activation.activation,
          }
        : null;
    }
    case 'near_ed25519_yao_add_signer_finalizing': {
      const activation = parseStoredWalletAddSignerNearActivation(record);
      const response = parseStoredWalletAddSignerFinalizeSuccess(record.response);
      if (!activation || !response || response.kind !== 'near_ed25519') return null;
      const signer = parseWalletEd25519SignerRecord(record.signer);
      const finalizingAtMs = Number(record.finalizingAtMs);
      return signer && Number.isSafeInteger(finalizingAtMs) && finalizingAtMs > 0
        ? {
            kind: 'near_ed25519_yao_add_signer_finalizing',
            finalizeRequest: activation.finalizeRequest,
            activation: activation.activation,
            response,
            signer,
            finalizingAtMs,
          }
        : null;
    }
    case 'ecdsa_add_signer_prepared': {
      const base = parseStoredWalletAddSignerEcdsaStateBase(record);
      return base
        ? {
            kind: 'ecdsa_add_signer_prepared',
            derivationKind: base.derivationKind,
            chainTargets: base.chainTargets,
            prepare: base.prepare,
            strictRegistration: base.strictRegistration,
          }
        : null;
    }
    case 'ecdsa_add_signer_pending_activation': {
      const base = parseStoredWalletAddSignerEcdsaStateBase(record);
      if (!base) return null;
      try {
        const registrationRequest = parseRouterAbEcdsaRegistrationRequestV1(
          record.registrationRequest,
        );
        const pendingActivation = parseStoredRouterAbEcdsaPendingActivationV1(
          record.pendingActivation,
        );
        const publicResponse = parseRouterAbEcdsaStrictForwardedRegistrationResponseV1(
          record.publicResponse,
        );
        return registrationRequest.registration_purpose === 'wallet_add_signer'
          ? {
              kind: 'ecdsa_add_signer_pending_activation',
              derivationKind: base.derivationKind,
              chainTargets: base.chainTargets,
              prepare: base.prepare,
              strictRegistration: base.strictRegistration,
              registrationRequest,
              pendingActivation,
              publicResponse,
            }
          : null;
      } catch {
        return null;
      }
    }
    case 'ecdsa_add_signer_activation_claimed': {
      const base = parseStoredWalletAddSignerEcdsaStateBase(record);
      const activationRequestDigestB64u = parseStoredRegistrationDigest(
        record.activationRequestDigestB64u,
      );
      if (!base || !activationRequestDigestB64u) return null;
      try {
        const registrationRequest = parseRouterAbEcdsaRegistrationRequestV1(
          record.registrationRequest,
        );
        const pendingActivation = parseStoredRouterAbEcdsaPendingActivationV1(
          record.pendingActivation,
        );
        const publicResponse = parseRouterAbEcdsaStrictForwardedRegistrationResponseV1(
          record.publicResponse,
        );
        const publicFacts = parseRouterAbEcdsaVerifiedClientActivationFactsV1(record.publicFacts);
        return registrationRequest.registration_purpose === 'wallet_add_signer'
          ? {
              kind: 'ecdsa_add_signer_activation_claimed',
              derivationKind: base.derivationKind,
              chainTargets: base.chainTargets,
              prepare: base.prepare,
              strictRegistration: base.strictRegistration,
              registrationRequest,
              pendingActivation,
              publicResponse,
              publicFacts,
              activationRequestDigestB64u,
            }
          : null;
      } catch {
        return null;
      }
    }
    case 'ecdsa_add_signer_activated': {
      const base = parseStoredWalletAddSignerEcdsaStateBase(record);
      const activationRequestDigestB64u = parseStoredRegistrationDigest(
        record.activationRequestDigestB64u,
      );
      const bootstrap = parseStoredEcdsaDerivationServerBootstrapResponse(record.bootstrap);
      if (!base || !activationRequestDigestB64u || !bootstrap) return null;
      try {
        const registrationRequest = parseRouterAbEcdsaRegistrationRequestV1(
          record.registrationRequest,
        );
        const publicFacts = parseRouterAbEcdsaVerifiedClientActivationFactsV1(record.publicFacts);
        const activation = parseRouterAbEcdsaRegistrationActivationReceiptV1(record.activation);
        const publicCapability = parseRouterAbEcdsaDerivationPublicCapabilityV1(
          record.publicCapability,
        );
        return registrationRequest.registration_purpose === 'wallet_add_signer'
          ? {
              kind: 'ecdsa_add_signer_activated',
              derivationKind: base.derivationKind,
              chainTargets: base.chainTargets,
              prepare: base.prepare,
              strictRegistration: base.strictRegistration,
              registrationRequest,
              publicFacts,
              activationRequestDigestB64u,
              activation,
              publicCapability,
              bootstrap,
            }
          : null;
      } catch {
        return null;
      }
    }
    default:
      return null;
  }
}

function storedWalletAddSignerByteArraysEqual(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function parseStoredWalletAddSignerCeremony(value: unknown): StoredWalletAddSignerCeremony | null {
  const decoded = parseJsonValue(value);
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  const record: StoredWalletAddSignerCeremonyRecord = decoded;
  const addSignerCeremonyId = trimString(record.addSignerCeremonyId);
  const digestB64u = trimString(record.digestB64u);
  const orgId = trimString(record.orgId);
  const signingRootId = trimString(record.signingRootId);
  const signingRootVersion = trimString(record.signingRootVersion);
  const expiresAtMs = Number(record.expiresAtMs);
  const intentRecord = parseStoredAddSignerIntent({
    kind: 'add_signer_intent_allocated',
    grant: 'ignored',
    intent: record.intent,
    digestB64u,
    orgId,
    expiresAtMs,
  });
  const auth = parseStoredWalletAddSignerAuth(record.auth);
  const signerState = parseStoredWalletAddSignerSignerState(record.signerState);
  if (
    !addSignerCeremonyId ||
    !digestB64u ||
    !orgId ||
    !signingRootId ||
    !signingRootVersion ||
    !Number.isSafeInteger(expiresAtMs) ||
    !intentRecord ||
    !auth ||
    !signerState
  ) {
    return null;
  }
  if (
    (signerState.kind === 'near_ed25519_yao_add_signer_activated' ||
      signerState.kind === 'near_ed25519_yao_add_signer_finalizing') &&
    signerState.finalizeRequest.addSignerCeremonyId !== addSignerCeremonyId
  ) {
    return null;
  }
  return {
    addSignerCeremonyId,
    intent: intentRecord.intent,
    digestB64u,
    orgId,
    signingRootId,
    signingRootVersion,
    expiresAtMs,
    auth,
    signerState,
  };
}

function parseStoredWalletAddAuthMethodCeremonyAuth(
  value: unknown,
): StoredWalletAddAuthMethodCeremony['auth'] | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record: StoredWalletAddAuthMethodCeremonyAuthRecord = value;
  if (record.kind === 'email_otp') {
    const providerUserId = trimString(record.providerUserId);
    const enrollmentId = trimString(record.enrollmentId);
    const enrollmentSealKeyVersion = trimString(record.enrollmentSealKeyVersion);
    const authorityRef = parseWalletAuthAuthorityRef(record.authorityRef);
    if (!providerUserId || !enrollmentId || !enrollmentSealKeyVersion || !authorityRef) {
      return null;
    }
    return {
      kind: 'email_otp',
      providerUserId,
      enrollmentId,
      enrollmentSealKeyVersion,
      authorityRef,
    };
  }
  if (record.kind === 'wallet_session') {
    const walletSessionId = trimString(record.walletSessionId);
    const authorizationId = trimString(record.authorizationId);
    const rpId = trimString(record.rpId);
    const credentialIdB64u = trimString(record.credentialIdB64u);
    if (!walletSessionId || !authorizationId || !rpId || !credentialIdB64u) return null;
    return {
      kind: 'wallet_session',
      walletSessionId,
      authorizationId,
      rpId,
      credentialIdB64u,
    };
  }
  if (record.kind !== 'webauthn_assertion') return null;
  const rpId = trimString(record.rpId);
  const credentialIdB64u = trimString(record.credentialIdB64u);
  if (!rpId || !credentialIdB64u) return null;
  return {
    kind: 'webauthn_assertion',
    rpId,
    credentialIdB64u,
  };
}

function addAuthMethodCustodyFactorMatches(
  auth: StoredWalletAddAuthMethodCeremony['auth'],
  custodyEnvelope: PasskeyCustodyEnvelopeRecord,
): boolean {
  switch (auth.kind) {
    case 'webauthn_assertion':
    case 'wallet_session':
      return (
        custodyEnvelope.factor.kind === 'passkey' &&
        custodyEnvelope.factor.rpId === auth.rpId &&
        custodyEnvelope.factor.credentialIdB64u === auth.credentialIdB64u
      );
    case 'email_otp':
      return (
        custodyEnvelope.factor.kind === 'email_otp' &&
        custodyEnvelope.factor.enrollmentId === auth.enrollmentId &&
        custodyEnvelope.factor.enrollmentSealKeyVersion === auth.enrollmentSealKeyVersion
      );
    default:
      return assertNever(auth);
  }
}

/**
 * Nullable wrapper over the canonical parser. Reading these options a second,
 * looser way here is what would let a stored ceremony and a live one disagree.
 */
function parseStoredWalletAddAuthMethodRegistrationOptions(
  value: unknown,
): WalletAddAuthMethodRegistrationOptions | null {
  try {
    return parseWalletAddAuthMethodRegistrationOptions(value);
  } catch {
    return null;
  }
}

function parseStoredWalletAddAuthMethodCeremony(
  value: unknown,
): StoredWalletAddAuthMethodCeremony | null {
  const decoded = parseJsonValue(value);
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  const record: StoredWalletAddAuthMethodCeremonyRecord = decoded;
  const addAuthMethodCeremonyId = trimString(record.addAuthMethodCeremonyId);
  const digestB64u = trimString(record.digestB64u);
  const orgId = trimString(record.orgId);
  const expiresAtMs = Number(record.expiresAtMs);
  const sourceWalletAuthMethodId = parseWalletAuthMethodId(record.sourceWalletAuthMethodId);
  const sourceWalletAuthorityId = parseWalletAuthorityId(record.sourceWalletAuthorityId);
  const targetWalletAuthMethodId = parseWalletAuthMethodId(record.targetWalletAuthMethodId);
  let sourceAuthorityDigestB64u: DigestB64u;
  try {
    sourceAuthorityDigestB64u = parseDigestB64u(record.sourceAuthorityDigestB64u);
  } catch {
    return null;
  }
  const sourceAuthorityRevocationEpoch = Number(record.sourceAuthorityRevocationEpoch);
  if (
    !addAuthMethodCeremonyId ||
    !digestB64u ||
    !orgId ||
    !Number.isSafeInteger(expiresAtMs) ||
    !sourceWalletAuthMethodId.ok ||
    !sourceWalletAuthorityId.ok ||
    !Number.isSafeInteger(sourceAuthorityRevocationEpoch) ||
    sourceAuthorityRevocationEpoch < 0 ||
    !targetWalletAuthMethodId.ok
  ) {
    return null;
  }
  const auth = parseStoredWalletAddAuthMethodCeremonyAuth(record.auth);
  const intentRecord = parseStoredAddAuthMethodIntent({
    kind: 'add_auth_method_intent_allocated',
    grant: 'ignored',
    intent: record.intent,
    digestB64u,
    orgId,
    expiresAtMs,
  });
  if (!auth || !intentRecord) return null;
  /* Both branches carry the SOURCE method's envelope, and both validate it the
     same way: it belongs to this wallet, it is sealed under the factor that
     authorized this ceremony, and it is still active. R109C's Email OTP target
     needs it to reseal the seed, so the check is shared rather than duplicated
     into the branch below. */
  let custodyEnvelope: PasskeyCustodyEnvelopeRecord;
  try {
    custodyEnvelope = parsePasskeyCustodyEnvelopeRecord(record.custodyEnvelope);
  } catch {
    return null;
  }
  if (
    custodyEnvelope.walletId !== intentRecord.intent.walletId ||
    !addAuthMethodCustodyFactorMatches(auth, custodyEnvelope) ||
    custodyEnvelope.lifecycle.state !== 'active'
  ) {
    return null;
  }
  const kind = record.kind;
  if (kind === 'email_otp') {
    const authority = parseStoredRegistrationAuthority(record.authority);
    if (!authority || authority.kind !== 'email_otp') return null;
    return {
      kind: 'email_otp',
      custodyEnvelope,
      addAuthMethodCeremonyId,
      intent: intentRecord.intent,
      digestB64u,
      orgId,
      sourceWalletAuthMethodId: sourceWalletAuthMethodId.value,
      sourceWalletAuthorityId: sourceWalletAuthorityId.value,
      sourceAuthorityDigestB64u,
      sourceAuthorityRevocationEpoch,
      targetWalletAuthMethodId: targetWalletAuthMethodId.value,
      expiresAtMs: Math.floor(expiresAtMs),
      auth,
      authority,
      ...(trimString(record.expectedOrigin)
        ? { expectedOrigin: trimString(record.expectedOrigin) }
        : {}),
    };
  }
  if (
    kind !== 'passkey' ||
    record.passkeyRegistration === null ||
    typeof record.passkeyRegistration !== 'object' ||
    Array.isArray(record.passkeyRegistration)
  ) {
    return null;
  }
  const passkeyRegistration: StoredWalletAddAuthMethodPasskeyRegistrationRecord =
    record.passkeyRegistration;
  const rpId = parseWebAuthnRpId(passkeyRegistration.rpId);
  const challengeB64u = trimString(passkeyRegistration.challengeB64u);
  const options = parseStoredWalletAddAuthMethodRegistrationOptions(passkeyRegistration.options);
  if (
    !rpId.ok ||
    !challengeB64u ||
    !options ||
    options.rpId !== rpId.value ||
    options.challengeB64u !== challengeB64u ||
    intentRecord.intent.authMethod.kind !== 'passkey' ||
    intentRecord.intent.authMethod.rpId !== rpId.value
  ) {
    return null;
  }
  return {
    kind: 'passkey',
    addAuthMethodCeremonyId,
    intent: intentRecord.intent,
    digestB64u,
    orgId,
    sourceWalletAuthMethodId: sourceWalletAuthMethodId.value,
    sourceWalletAuthorityId: sourceWalletAuthorityId.value,
    sourceAuthorityDigestB64u,
    sourceAuthorityRevocationEpoch,
    targetWalletAuthMethodId: targetWalletAuthMethodId.value,
    expiresAtMs: Math.floor(expiresAtMs),
    auth,
    passkeyRegistration: { rpId: rpId.value, challengeB64u, options },
    custodyEnvelope,
    ...(trimString(record.expectedOrigin)
      ? { expectedOrigin: trimString(record.expectedOrigin) }
      : {}),
  };
}

type DurableObjectStubLike = { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> };
type DoOk = { ok: true; value: unknown };
type DoErr = { ok: false; code: string; message: string };
type DoResp = DoOk | DoErr;

type DoRequest =
  | { op: 'get'; key: string }
  | { op: 'set'; key: string; value: unknown; ttlMs?: number }
  | { op: 'del'; key: string }
  | { op: 'getdel'; key: string }
  | {
      op: 'registrationCancelTerminal';
      ceremonyKey: string;
      registrationCeremonyId: string;
      walletId: string;
    }
  | {
      op: 'getdelIfRelatedMatches';
      key: string;
      relatedKey: string;
      expectedRelated: unknown;
    };

type DoConditionalGetDelResponse = {
  matched: boolean;
  value: unknown | null;
};

function isDurableObjectNamespaceLike(
  value: unknown,
): value is CloudflareDurableObjectNamespaceLike {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return (
    'idFromName' in value &&
    typeof value.idFromName === 'function' &&
    'get' in value &&
    typeof value.get === 'function'
  );
}

function resolveDoNamespaceFromConfig(
  config: Record<string, unknown>,
): CloudflareDurableObjectNamespaceLike | null {
  const direct = config.namespace;
  if (isDurableObjectNamespaceLike(direct)) return direct;

  const durableObjectNamespace = config.durableObjectNamespace;
  if (isDurableObjectNamespaceLike(durableObjectNamespace)) return durableObjectNamespace;

  const envStyle = config.THRESHOLD_DO_NAMESPACE;
  if (isDurableObjectNamespaceLike(envStyle)) return envStyle;

  return null;
}

function resolveDoStub(input: {
  namespace: CloudflareDurableObjectNamespaceLike;
  objectName: string;
}): DurableObjectStubLike {
  const id = input.namespace.idFromName(input.objectName);
  return input.namespace.get(id) as unknown as DurableObjectStubLike;
}

async function callDo(stub: DurableObjectStubLike, request: DoRequest): Promise<DoResp> {
  const response = await stub.fetch('https://threshold-store.invalid/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Registration ceremony DO store HTTP ${response.status}: ${text}`);
  }
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `Registration ceremony DO store returned non-JSON response: ${text.slice(0, 200)}`,
    );
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('Registration ceremony DO store returned invalid JSON shape');
  }
  const responseKeys = Reflect.ownKeys(json);
  if (
    Reflect.get(json, 'ok') === true &&
    responseKeys.length === 2 &&
    responseKeys.includes('ok') &&
    responseKeys.includes('value')
  ) {
    return { ok: true, value: Reflect.get(json, 'value') };
  }
  if (
    Reflect.get(json, 'ok') !== false ||
    responseKeys.length !== 3 ||
    !responseKeys.includes('ok') ||
    !responseKeys.includes('code') ||
    !responseKeys.includes('message')
  ) {
    throw new Error('Registration ceremony DO store returned invalid JSON shape');
  }
  const code = trimString(Reflect.get(json, 'code'));
  const message = trimString(Reflect.get(json, 'message'));
  return {
    ok: false,
    code: code || 'internal',
    message: message || 'Registration ceremony DO store error',
  };
}

class CloudflareDurableObjectRegistrationCeremonyStore implements RegistrationCeremonyStore {
  private readonly stub: DurableObjectStubLike;
  private readonly prefix: string;

  constructor(input: {
    namespace: CloudflareDurableObjectNamespaceLike;
    objectName: string;
    prefix: string;
  }) {
    this.stub = resolveDoStub({ namespace: input.namespace, objectName: input.objectName });
    this.prefix = input.prefix;
  }

  private key(
    scope:
      | 'add-auth-method-intent'
      | 'add-signer-intent'
      | 'ceremony'
      | 'add-signer-finalize-replay'
      | 'add-signer-finalize-claim'
      | 'add-auth-method'
      | 'add-signer',
    id: string,
  ): string {
    return `${this.prefix}${scope}:${id}`;
  }

  async putAddSignerIntent(intent: StoredAddSignerIntent): Promise<void> {
    const parsed = parseStoredAddSignerIntent(intent);
    if (!parsed) throw new Error('Invalid add-signer intent record');
    const ttlMs = Math.max(1, parsed.expiresAtMs - Date.now());
    const response = await callDo(this.stub, {
      op: 'set',
      key: this.key('add-signer-intent', parsed.grant),
      value: parsed,
      ttlMs,
    });
    if (!response.ok) throw new Error(response.message);
  }

  async getAddSignerIntent(grant: AddSignerIntentGrant): Promise<StoredAddSignerIntent | null> {
    const key = trimString(grant);
    if (!key) return null;
    const response = await callDo(this.stub, {
      op: 'get',
      key: this.key('add-signer-intent', key),
    });
    if (!response.ok) return null;
    const intent = parseStoredAddSignerIntent(response.value);
    if (!intent || intent.expiresAtMs <= Date.now()) return null;
    return intent;
  }

  async takeAddSignerIntent(grant: AddSignerIntentGrant): Promise<ConsumedAddSignerIntent | null> {
    const key = trimString(grant);
    if (!key) return null;
    const response = await callDo(this.stub, {
      op: 'getdel',
      key: this.key('add-signer-intent', key),
    });
    if (!response.ok) return null;
    const intent = parseStoredAddSignerIntent(response.value);
    if (!intent || intent.expiresAtMs <= Date.now()) return null;
    return { ...intent, kind: 'add_signer_intent_consumed', consumedAtMs: Date.now() };
  }

  async putAddAuthMethodIntent(intent: StoredAddAuthMethodIntent): Promise<void> {
    const parsed = parseStoredAddAuthMethodIntent(intent);
    if (!parsed) throw new Error('Invalid add-auth-method intent record');
    const ttlMs = Math.max(1, parsed.expiresAtMs - Date.now());
    const response = await callDo(this.stub, {
      op: 'set',
      key: this.key('add-auth-method-intent', parsed.grant),
      value: parsed,
      ttlMs,
    });
    if (!response.ok) throw new Error(response.message);
  }

  async getAddAuthMethodIntent(
    grant: AddAuthMethodIntentGrant,
  ): Promise<StoredAddAuthMethodIntent | null> {
    const key = trimString(grant);
    if (!key) return null;
    const response = await callDo(this.stub, {
      op: 'get',
      key: this.key('add-auth-method-intent', key),
    });
    if (!response.ok) return null;
    const intent = parseStoredAddAuthMethodIntent(response.value);
    if (!intent || intent.expiresAtMs <= Date.now()) return null;
    return intent;
  }

  async takeAddAuthMethodIntent(
    grant: AddAuthMethodIntentGrant,
  ): Promise<ConsumedAddAuthMethodIntent | null> {
    const key = trimString(grant);
    if (!key) return null;
    const response = await callDo(this.stub, {
      op: 'getdel',
      key: this.key('add-auth-method-intent', key),
    });
    if (!response.ok) return null;
    const intent = parseStoredAddAuthMethodIntent(response.value);
    if (!intent || intent.expiresAtMs <= Date.now()) return null;
    return { ...intent, kind: 'add_auth_method_intent_consumed', consumedAtMs: Date.now() };
  }

  async putCeremony(ceremony: StoredWalletRegistrationCeremony): Promise<void> {
    const parsed = parseStoredWalletRegistrationCeremony(ceremony);
    if (!parsed) throw new Error('Invalid registration ceremony record');
    const ttlMs = Math.max(1, parsed.expiresAtMs - Date.now());
    const response = await callDo(this.stub, {
      op: 'set',
      key: this.key('ceremony', parsed.registrationCeremonyId),
      value: parsed,
      ttlMs,
    });
    if (!response.ok) throw new Error(response.message);
  }

  async getCeremony(
    registrationCeremonyId: string,
  ): Promise<StoredWalletRegistrationCeremony | null> {
    const key = trimString(registrationCeremonyId);
    if (!key) return null;
    const response = await callDo(this.stub, {
      op: 'get',
      key: this.key('ceremony', key),
    });
    if (!response.ok) return null;
    const ceremony = parseStoredWalletRegistrationCeremony(response.value);
    if (!ceremony || ceremony.expiresAtMs <= Date.now()) return null;
    return ceremony;
  }

  async updateCeremony(ceremony: StoredWalletRegistrationCeremony): Promise<void> {
    const parsed = parseStoredWalletRegistrationCeremony(ceremony);
    if (!parsed) throw new Error('Invalid registration ceremony record');
    if (parsed.expiresAtMs <= Date.now()) return;
    const ttlMs = Math.max(1, parsed.expiresAtMs - Date.now());
    const response = await callDo(this.stub, {
      op: 'set',
      key: this.key('ceremony', parsed.registrationCeremonyId),
      value: parsed,
      ttlMs,
    });
    if (!response.ok) throw new Error(response.message);
  }

  async takeCeremony(
    registrationCeremonyId: string,
  ): Promise<StoredWalletRegistrationCeremony | null> {
    const key = trimString(registrationCeremonyId);
    if (!key) return null;
    const response = await callDo(this.stub, {
      op: 'getdel',
      key: this.key('ceremony', key),
    });
    if (!response.ok) return null;
    const ceremony = parseStoredWalletRegistrationCeremony(response.value);
    if (!ceremony || ceremony.expiresAtMs <= Date.now()) return null;
    return ceremony;
  }

  async cancelTerminalCeremony(input: {
    registrationCeremonyId: string;
    walletId: WalletId;
  }): Promise<TerminalRegistrationCeremonyCancellationResult> {
    const registrationCeremonyId = trimString(input.registrationCeremonyId);
    const walletId = trimString(input.walletId);
    if (!registrationCeremonyId || !walletId) {
      throw new Error('Terminal registration cancellation requires ceremony and wallet IDs');
    }
    const response = await callDo(this.stub, {
      op: 'registrationCancelTerminal',
      ceremonyKey: this.key('ceremony', registrationCeremonyId),
      registrationCeremonyId,
      walletId,
    });
    if (!response.ok) throw new Error(response.message);
    const result = parseTerminalRegistrationCeremonyCancellationResult(response.value);
    if (!result) throw new Error('Terminal registration cancellation returned an invalid result');
    return result;
  }

  async putAddSignerFinalizeReplay(replay: StoredWalletAddSignerFinalizeReplay): Promise<void> {
    const parsed = parseStoredWalletAddSignerFinalizeReplay(replay);
    if (!parsed) throw new Error('Invalid wallet add-signer finalize replay record');
    const ttlMs = Math.max(1, parsed.expiresAtMs - Date.now());
    const response = await callDo(this.stub, {
      op: 'set',
      key: this.key('add-signer-finalize-replay', addSignerFinalizeReplayKey(parsed)),
      value: parsed,
      ttlMs,
    });
    if (!response.ok) throw new Error(response.message);
    const claimResponse = await callDo(this.stub, {
      op: 'set',
      key: this.key('add-signer-finalize-claim', parsed.addSignerCeremonyId),
      value: parsed,
      ttlMs,
    });
    if (!claimResponse.ok) throw new Error(claimResponse.message);
  }

  async getAddSignerFinalizeReplay(input: {
    addSignerCeremonyId: string;
    idempotencyKey: string;
  }): Promise<StoredWalletAddSignerFinalizeReplay | null> {
    if (!trimString(input.addSignerCeremonyId) || !trimString(input.idempotencyKey)) return null;
    const response = await callDo(this.stub, {
      op: 'get',
      key: this.key('add-signer-finalize-replay', addSignerFinalizeReplayKey(input)),
    });
    if (!response.ok) return null;
    const replay = parseStoredWalletAddSignerFinalizeReplay(response.value);
    if (!replay || replay.expiresAtMs <= Date.now()) return null;
    return replay;
  }

  async getAddSignerFinalizeReplayForCeremony(
    addSignerCeremonyId: string,
  ): Promise<StoredWalletAddSignerFinalizeReplay | null> {
    const ceremonyId = trimString(addSignerCeremonyId);
    if (!ceremonyId) return null;
    const response = await callDo(this.stub, {
      op: 'get',
      key: this.key('add-signer-finalize-claim', ceremonyId),
    });
    if (!response.ok) return null;
    const replay = parseStoredWalletAddSignerFinalizeReplay(response.value);
    if (!replay || replay.expiresAtMs <= Date.now()) return null;
    return replay;
  }

  async putAddAuthMethodCeremony(ceremony: StoredWalletAddAuthMethodCeremony): Promise<void> {
    const parsed = parseStoredWalletAddAuthMethodCeremony(ceremony);
    if (!parsed) throw new Error('Invalid add-auth-method ceremony record');
    const ttlMs = Math.max(1, parsed.expiresAtMs - Date.now());
    const response = await callDo(this.stub, {
      op: 'set',
      key: this.key('add-auth-method', parsed.addAuthMethodCeremonyId),
      value: parsed,
      ttlMs,
    });
    if (!response.ok) throw new Error(response.message);
  }

  async getAddAuthMethodCeremony(
    addAuthMethodCeremonyId: string,
  ): Promise<StoredWalletAddAuthMethodCeremony | null> {
    const key = trimString(addAuthMethodCeremonyId);
    if (!key) return null;
    const response = await callDo(this.stub, {
      op: 'get',
      key: this.key('add-auth-method', key),
    });
    if (!response.ok) return null;
    const ceremony = parseStoredWalletAddAuthMethodCeremony(response.value);
    if (!ceremony || ceremony.expiresAtMs <= Date.now()) return null;
    return ceremony;
  }

  async updateAddAuthMethodCeremony(ceremony: StoredWalletAddAuthMethodCeremony): Promise<void> {
    const parsed = parseStoredWalletAddAuthMethodCeremony(ceremony);
    if (!parsed) throw new Error('Invalid add-auth-method ceremony record');
    if (parsed.expiresAtMs <= Date.now()) return;
    const ttlMs = Math.max(1, parsed.expiresAtMs - Date.now());
    const response = await callDo(this.stub, {
      op: 'set',
      key: this.key('add-auth-method', parsed.addAuthMethodCeremonyId),
      value: parsed,
      ttlMs,
    });
    if (!response.ok) throw new Error(response.message);
  }

  async takeAddAuthMethodCeremony(
    addAuthMethodCeremonyId: string,
  ): Promise<StoredWalletAddAuthMethodCeremony | null> {
    const key = trimString(addAuthMethodCeremonyId);
    if (!key) return null;
    const response = await callDo(this.stub, {
      op: 'getdel',
      key: this.key('add-auth-method', key),
    });
    if (!response.ok) return null;
    const ceremony = parseStoredWalletAddAuthMethodCeremony(response.value);
    if (!ceremony || ceremony.expiresAtMs <= Date.now()) return null;
    return ceremony;
  }

  async putAddSignerCeremony(ceremony: StoredWalletAddSignerCeremony): Promise<void> {
    const parsed = parseStoredWalletAddSignerCeremony(ceremony);
    if (!parsed) throw new Error('Invalid add-signer ceremony record');
    const ttlMs = Math.max(1, parsed.expiresAtMs - Date.now());
    const response = await callDo(this.stub, {
      op: 'set',
      key: this.key('add-signer', parsed.addSignerCeremonyId),
      value: parsed,
      ttlMs,
    });
    if (!response.ok) throw new Error(response.message);
  }

  async getAddSignerCeremony(
    addSignerCeremonyId: string,
  ): Promise<StoredWalletAddSignerCeremony | null> {
    const key = trimString(addSignerCeremonyId);
    if (!key) return null;
    const response = await callDo(this.stub, {
      op: 'get',
      key: this.key('add-signer', key),
    });
    if (!response.ok) return null;
    const ceremony = parseStoredWalletAddSignerCeremony(response.value);
    if (!ceremony || ceremony.expiresAtMs <= Date.now()) return null;
    return ceremony;
  }

  async updateAddSignerCeremony(ceremony: StoredWalletAddSignerCeremony): Promise<void> {
    const parsed = parseStoredWalletAddSignerCeremony(ceremony);
    if (!parsed) throw new Error('Invalid add-signer ceremony record');
    if (parsed.expiresAtMs <= Date.now()) return;
    const ttlMs = Math.max(1, parsed.expiresAtMs - Date.now());
    const response = await callDo(this.stub, {
      op: 'set',
      key: this.key('add-signer', parsed.addSignerCeremonyId),
      value: parsed,
      ttlMs,
    });
    if (!response.ok) throw new Error(response.message);
  }

  async takeAddSignerCeremony(
    addSignerCeremonyId: string,
  ): Promise<StoredWalletAddSignerCeremony | null> {
    const key = trimString(addSignerCeremonyId);
    if (!key) return null;
    const response = await callDo(this.stub, {
      op: 'getdel',
      key: this.key('add-signer', key),
    });
    if (!response.ok) return null;
    const ceremony = parseStoredWalletAddSignerCeremony(response.value);
    if (!ceremony || ceremony.expiresAtMs <= Date.now()) return null;
    return ceremony;
  }
}

function resolveRegistrationDoPrefix(config: Record<string, unknown>): string {
  const explicit =
    trimString(config.WALLET_REGISTRATION_PREFIX) || trimString(config.walletRegistrationPrefix);
  const base = explicit || trimString(config.keyPrefix) || trimString(config.THRESHOLD_PREFIX);
  if (!base) return 'wallet-registration:';
  return base.endsWith(':') ? `${base}wallet-registration:` : `${base}:wallet-registration:`;
}

export function createRegistrationCeremonyStore(
  input: {
    config?: unknown;
    logger?: NormalizedLogger;
    isNode?: boolean;
  } = {},
): RegistrationCeremonyStore {
  const config = (input.config || {}) as Record<string, unknown>;
  const kind = typeof config.kind === 'string' ? config.kind.trim() : '';
  if (kind === 'cloudflare-do') {
    const namespace = resolveDoNamespaceFromConfig(config);
    if (!namespace) {
      throw new Error(
        'cloudflare-do registration ceremony store selected but no Durable Object namespace was provided (expected config.namespace)',
      );
    }
    const objectName =
      trimString(config.objectName) || trimString(config.name) || THRESHOLD_DO_OBJECT_NAME_DEFAULT;
    input.logger?.info(
      '[wallet-registration] Using Cloudflare Durable Object store for registration ceremonies',
    );
    return new CloudflareDurableObjectRegistrationCeremonyStore({
      namespace,
      objectName,
      prefix: resolveRegistrationDoPrefix(config),
    });
  }
  if (kind && kind !== 'memory' && kind !== 'in-memory') {
    throw new Error(`[wallet-registration] Unknown registration ceremony store kind: ${kind}`);
  }
  input.logger?.warn?.(
    '[wallet-registration] Using in-memory registration ceremony store; configure Cloudflare Durable Object storage for durable registration ceremonies',
  );
  return new MemoryRegistrationCeremonyStore();
}

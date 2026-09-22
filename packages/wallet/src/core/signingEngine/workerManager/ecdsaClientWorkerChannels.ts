import { parseDigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  parseRootShareEpoch,
  parseThresholdEcdsaSessionId,
  type RootShareEpoch,
  type ThresholdEcdsaSessionId,
} from '@shared/utils/domainIds';
import {
  parseRouterAbNormalSigningAuthorization,
  type RouterAbNormalSigningAuthorizationWire,
} from '@shared/utils/routerAbNormalSigningIdentity';
import { requireRouterAbX25519PublicKey } from '@shared/utils/routerAbPublicKeyset';
import { isObject } from '@shared/utils/validation';
import {
  parseRouterAbEcdsaOperationStepUpPreparationV1,
  parseRouterAbEcdsaDerivationPublicCapabilityV1,
  parseRouterAbEcdsaExplicitExportForwardedResponseV1,
  parseRouterAbEcdsaSigningWorkerExportShareBindingV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import type {
  RouterAbEcdsaDerivationActivationRefreshRequestV1,
  RouterAbEcdsaDerivationExportLifecycleScopeV1,
  RouterAbEcdsaDerivationExplicitExportRequestV1,
  RouterAbEcdsaDerivationExplicitExportProtocolRequestV1,
  RouterAbEcdsaDerivationRefreshLifecycleScopeV1,
  RouterAbEcdsaExplicitExportForwardedResponseV1,
  RouterAbEcdsaOperationStepUpPreparationV1Wire,
  RouterAbEcdsaDerivationPublicCapabilityV1,
  RouterAbEcdsaRegistrationRecipientKeysV1,
  RouterAbEcdsaSigningWorkerExportShareEnvelopeV1,
  RouterAbEcdsaSigningWorkerExportShareBindingV1,
  RouterAbEcdsaStableClientProofFinalizationV2,
} from '@shared/utils/routerAbEcdsaDerivation';
import type {
  EcdsaRoleLocalPersistedMaterialRef,
  EcdsaRoleLocalWorkerHandle,
} from '@/core/signingEngine/session/keyMaterialBrands';
import type { EcdsaRoleLocalPublicFacts } from '@/core/platform';
import type { EcdsaRoleLocalReadyStateBlob } from '@/core/platform';
import type { EcdsaClientPresignPoolIdentity } from './ecdsaPresignPoolIdentity';
import type {
  EcdsaClientPresignAdmissionStorage,
  EcdsaClientPresignUnavailableReason,
} from './ecdsaPresignLifecycle';
import type { MpcMaterialActivationRef } from '@shared/utils/domainIds';
import type { RouterAbMpcMaterialActivationRefWire } from '@shared/utils/routerAbNormalSigningIdentity';
import type { WalletAuthAuthorityRef } from '@shared/utils/walletAuthAuthority';
import type {
  WalletRecoveryEcdsaPossessionChallengeV1,
  WalletRecoveryEcdsaPossessionProofV1,
} from '@shared/wallet-recovery/walletRecoveryEcdsaPossession';
import type {
  EcdsaAdditiveLaneHolderPreparationV1,
  EcdsaAdditiveLaneJobV1,
} from '@shared/signing-lanes/rotation';
import { parseRotatableSigningLaneJobV1 } from '@shared/signing-lanes/rotationParsers';
import {
  parseLinkedDeviceEcdsaSourceContributionPackageV1,
  parseLinkedDeviceEcdsaSourceContributionPreparationV1,
  type LinkedDeviceEcdsaSourceContributionPackageV1,
  type LinkedDeviceEcdsaSourceContributionPreparationV1,
} from '@shared/device-linking/sourceContribution';

export const EcdsaClientWorkerControlKind = {
  AttachDerivationToPresign: 'attach_ecdsa_derivation_to_presign_v1',
  AttachLinkedHolderToPresign: 'attach_linked_holder_to_ecdsa_presign_v1',
  AttachPresignToOnline: 'attach_ecdsa_presign_to_online_v1',
} as const;

export type AttachEcdsaDerivationToPresignPort = {
  readonly kind: typeof EcdsaClientWorkerControlKind.AttachDerivationToPresign;
  readonly port: MessagePort;
};

export type AttachLinkedHolderToPresignPort = {
  readonly kind: typeof EcdsaClientWorkerControlKind.AttachLinkedHolderToPresign;
  readonly port: MessagePort;
};

export type AttachPresignToOnlinePort = {
  readonly kind: typeof EcdsaClientWorkerControlKind.AttachPresignToOnline;
  readonly port: MessagePort;
};

type OpaqueEcdsaPresignRequestBaseV1 = {
  readonly requestId: string;
};

type OpaqueEcdsaPresignSessionRequestBaseV1 = OpaqueEcdsaPresignRequestBaseV1 & {
  readonly sessionId: string;
};

type OpaqueEcdsaPresignSessionInitBaseV1 = OpaqueEcdsaPresignSessionRequestBaseV1 & {
  readonly kind: 'opaque_ecdsa_presign_session_init_v1';
  readonly poolIdentity: EcdsaClientPresignPoolIdentity;
  readonly groupPublicKey33: ArrayBuffer;
  readonly ceremonyExpiresAtMs: number;
  readonly materialExpiresAtMs: number;
};

export type OpaqueEcdsaPresignAuthorityRequestV1 =
  | (OpaqueEcdsaPresignSessionInitBaseV1 & {
      readonly authority: {
        readonly kind: 'role_local_derivation_handle';
        readonly materialHandle: string;
        readonly material:
          | {
              readonly kind: 'persisted';
              readonly materialRef: EcdsaRoleLocalPersistedMaterialRef;
              readonly expectedBindingDigest?: never;
            }
          | {
              readonly kind: 'runtime_loaded';
              readonly expectedBindingDigest: string;
              readonly materialRef?: never;
            };
        readonly holderHandleId?: never;
      };
    })
  | (OpaqueEcdsaPresignSessionInitBaseV1 & {
      readonly authority: {
        readonly kind: 'linked_holder_signing_material';
        readonly holderHandleId: string;
        readonly materialHandle?: never;
        readonly material?: never;
      };
    })
  | (OpaqueEcdsaPresignSessionRequestBaseV1 & {
      readonly kind: 'opaque_ecdsa_presign_session_step_v1';
      readonly stage: 'triples' | 'presign';
      readonly incomingMessages: readonly ArrayBuffer[];
    })
  | (OpaqueEcdsaPresignSessionRequestBaseV1 & {
      readonly kind: 'opaque_ecdsa_presign_session_abort_v1';
    })
  | (OpaqueEcdsaPresignRequestBaseV1 & {
      readonly kind: 'opaque_ecdsa_online_compute_v1';
      readonly materialHandle: string;
      readonly groupPublicKey33: ArrayBuffer;
      readonly expectedPresignBigR33: ArrayBuffer;
      readonly digest32: ArrayBuffer;
      readonly clientRerandomizationContribution32: ArrayBuffer;
      readonly signingWorkerRerandomizationContribution32: ArrayBuffer;
    })
  | (OpaqueEcdsaPresignRequestBaseV1 & {
      readonly kind: 'opaque_ecdsa_presign_material_destroy_v1';
      readonly materialHandle: string;
    })
  | (OpaqueEcdsaPresignRequestBaseV1 & {
      readonly kind: 'opaque_ecdsa_presign_material_admit_v1';
      readonly materialHandle: string;
      readonly expectedPresignatureId: string;
      readonly admissionMode: 'durable' | 'resident';
    })
  | (OpaqueEcdsaPresignRequestBaseV1 & {
      readonly kind: 'opaque_ecdsa_presign_material_restore_v1';
      readonly recordId: string;
      readonly expectedPresignatureId: string;
      readonly poolIdentity: EcdsaClientPresignPoolIdentity;
      readonly groupPublicKey33: ArrayBuffer;
      readonly bigR33: ArrayBuffer;
    })
  | (OpaqueEcdsaPresignRequestBaseV1 & {
      readonly kind: 'opaque_ecdsa_presign_material_list_v1';
      readonly poolIdentity: EcdsaClientPresignPoolIdentity;
    })
  | (OpaqueEcdsaPresignRequestBaseV1 & {
      readonly kind: 'opaque_ecdsa_presign_material_delete_v1';
      readonly recordId: string;
      readonly poolIdentity: EcdsaClientPresignPoolIdentity;
    });

type OpaqueEcdsaPresignSessionInitAuthorityV1 = Extract<
  OpaqueEcdsaPresignAuthorityRequestV1,
  { readonly kind: 'opaque_ecdsa_presign_session_init_v1' }
>['authority'];

export type OpaqueEcdsaPresignMaterialAuthorityIdentityV1 =
  | Pick<
      Extract<
        OpaqueEcdsaPresignSessionInitAuthorityV1,
        { readonly kind: 'role_local_derivation_handle' }
      >,
      'kind' | 'materialHandle'
    >
  | Pick<
      Extract<
        OpaqueEcdsaPresignSessionInitAuthorityV1,
        { readonly kind: 'linked_holder_signing_material' }
      >,
      'kind' | 'holderHandleId'
    >;

export type OpaqueEcdsaPresignAuthorityResponseV1 =
  | {
      readonly kind: 'opaque_ecdsa_presign_authority_result_v1';
      readonly requestId: string;
      readonly ok: true;
      readonly result:
        | {
            readonly kind: 'progress';
            readonly progress: {
              readonly stage: 'triples' | 'triples_done' | 'presign' | 'done';
              readonly event: 'none' | 'triples_done' | 'final_batch_ready' | 'presign_done';
              readonly outgoingMessages: ArrayBuffer[];
              readonly presignatureHandle?: string;
              readonly presignatureBigR33?: ArrayBuffer;
            };
          }
        | {
            readonly kind: 'metered_progress';
            readonly progress: {
              readonly stage: 'triples' | 'triples_done' | 'presign' | 'done';
              readonly event: 'none' | 'triples_done' | 'final_batch_ready' | 'presign_done';
              readonly outgoingMessages: ArrayBuffer[];
              readonly presignatureHandle?: string;
              readonly presignatureBigR33?: ArrayBuffer;
            };
            readonly remainingUses: number;
            readonly expiresAtMs: number;
          }
        | {
            readonly kind: 'aborted';
            readonly sessionId: string;
          }
        | {
            readonly kind: 'online_share';
            readonly signatureShare32: ArrayBuffer;
          }
        | {
            readonly kind: 'material_destroyed';
            readonly materialHandle: string;
          }
        | {
            readonly kind: 'material_admitted';
            readonly materialHandle: string;
            readonly storage: EcdsaClientPresignAdmissionStorage;
            readonly presignatureId: string;
          }
        | {
            readonly kind: 'durable_list';
            readonly entries: readonly {
              readonly recordId: string;
              readonly presignatureId: string;
              readonly groupPublicKey33B64u: string;
              readonly bigR33B64u: string;
              readonly createdAtMs: number;
              readonly expiresAtMs: number;
            }[];
          }
        | {
            readonly kind: 'durable_restored';
            readonly materialHandle: string;
          }
        | {
            readonly kind: 'durable_restore_failed';
            readonly reason: EcdsaClientPresignUnavailableReason;
          }
        | {
            readonly kind: 'durable_deleted';
            readonly recordId: string;
          };
      readonly error?: never;
    }
  | {
      readonly kind: 'opaque_ecdsa_presign_authority_result_v1';
      readonly requestId: string;
      readonly ok: false;
      readonly result?: never;
      readonly error: string;
    };

export type RehydrateEcdsaRoleLocalSigningMaterialRequestV1 = {
  readonly kind: 'open_ecdsa_role_local_signing_material_v1';
  readonly authority: WalletAuthAuthorityRef;
  readonly materialActivation: MpcMaterialActivationRef;
  readonly materialRef?: never;
};

export type RehydrateEcdsaRoleLocalSigningMaterialResultV1 =
  | {
      readonly kind: 'ecdsa_role_local_signing_material_opened_v1';
      readonly ok: true;
      readonly liveHandle: EcdsaRoleLocalWorkerHandle;
      readonly materialRef: EcdsaRoleLocalPersistedMaterialRef;
      readonly reason?: never;
    }
  | {
      readonly kind: 'ecdsa_role_local_signing_material_unavailable_v1';
      readonly ok: false;
      readonly reason: 'missing' | 'expired' | 'binding_mismatch' | 'corrupt';
      readonly liveHandle?: never;
      readonly materialRef?: never;
    };

export type SignWalletRecoveryEcdsaMaterialPossessionProofRequestV1 = {
  readonly kind: 'sign_wallet_recovery_ecdsa_material_possession_proof_v1';
  readonly challenge: WalletRecoveryEcdsaPossessionChallengeV1;
  readonly stateBlob: EcdsaRoleLocalReadyStateBlob;
};

export type SignWalletRecoveryEcdsaMaterialPossessionProofResultV1 = {
  readonly kind: 'ecdsa_wallet_recovery_material_possession_proof_v1';
  readonly proof: WalletRecoveryEcdsaPossessionProofV1;
  readonly challengeDigestB64u: DigestB64u;
  readonly derivationClientSharePublicKey33B64u: string;
};

export type PrepareEcdsaAdditiveLaneHolderRequestV1 = {
  readonly kind: 'prepare_ecdsa_additive_lane_holder_v1';
  readonly job: EcdsaAdditiveLaneJobV1;
  readonly holderCommittedAtMs: number;
};

export type PrepareEcdsaAdditiveLaneHolderResultV1 = EcdsaAdditiveLaneHolderPreparationV1;

export type PrepareLinkedDeviceEcdsaSourceContributionRequestV1 = {
  readonly kind: 'prepare_linked_device_ecdsa_source_contribution_v1';
  readonly preparation: LinkedDeviceEcdsaSourceContributionPreparationV1;
};

export type PrepareLinkedDeviceEcdsaSourceContributionResultV1 = {
  readonly kind: 'linked_device_ecdsa_source_contribution_package_v1';
  readonly package: LinkedDeviceEcdsaSourceContributionPackageV1;
};

export function parsePrepareEcdsaAdditiveLaneHolderRequestV1(
  raw: unknown,
): PrepareEcdsaAdditiveLaneHolderRequestV1 {
  if (!isObject(raw) || Array.isArray(raw)) {
    throw new Error('ECDSA lane holder request must be an object');
  }
  const fields = Object.keys(raw);
  if (
    fields.length !== 3 ||
    !fields.includes('kind') ||
    !fields.includes('job') ||
    !fields.includes('holderCommittedAtMs')
  ) {
    throw new Error('ECDSA lane holder request has invalid fields');
  }
  if (raw.kind !== 'prepare_ecdsa_additive_lane_holder_v1') {
    throw new Error('ECDSA lane holder request kind is invalid');
  }
  const job = parseRotatableSigningLaneJobV1(raw.job, 'ecdsaLaneHolderRequest.job');
  if (job.keyFamily !== 'ecdsa_secp256k1') {
    throw new Error('ECDSA lane holder request requires an ECDSA lane job');
  }
  const holderCommittedAtMs = raw.holderCommittedAtMs;
  if (
    typeof holderCommittedAtMs !== 'number' ||
    !Number.isSafeInteger(holderCommittedAtMs) ||
    holderCommittedAtMs < 0
  ) {
    throw new Error('ECDSA lane holder request holderCommittedAtMs is invalid');
  }
  return {
    kind: 'prepare_ecdsa_additive_lane_holder_v1',
    job,
    holderCommittedAtMs,
  };
}

export function parsePrepareLinkedDeviceEcdsaSourceContributionRequestV1(
  raw: unknown,
): PrepareLinkedDeviceEcdsaSourceContributionRequestV1 {
  if (!isObject(raw) || Array.isArray(raw)) {
    throw new Error('linked-device ECDSA source contribution request must be an object');
  }
  const fields = Object.keys(raw);
  if (fields.length !== 2 || !fields.includes('kind') || !fields.includes('preparation')) {
    throw new Error('linked-device ECDSA source contribution request has invalid fields');
  }
  if (raw.kind !== 'prepare_linked_device_ecdsa_source_contribution_v1') {
    throw new Error('linked-device ECDSA source contribution request kind is invalid');
  }
  return {
    kind: 'prepare_linked_device_ecdsa_source_contribution_v1',
    preparation: parseLinkedDeviceEcdsaSourceContributionPreparationV1(raw.preparation),
  };
}

export function parsePrepareLinkedDeviceEcdsaSourceContributionResultV1(
  raw: unknown,
): PrepareLinkedDeviceEcdsaSourceContributionResultV1 {
  if (!isObject(raw) || Array.isArray(raw)) {
    throw new Error('linked-device ECDSA source contribution result must be an object');
  }
  const fields = Object.keys(raw);
  if (fields.length !== 2 || !fields.includes('kind') || !fields.includes('package')) {
    throw new Error('linked-device ECDSA source contribution result has invalid fields');
  }
  if (raw.kind !== 'linked_device_ecdsa_source_contribution_package_v1') {
    throw new Error('linked-device ECDSA source contribution result kind is invalid');
  }
  return {
    kind: 'linked_device_ecdsa_source_contribution_package_v1',
    package: parseLinkedDeviceEcdsaSourceContributionPackageV1(raw.package),
  };
}

type RouterAbEcdsaExplicitExportRequestFactsBaseV1 = Omit<
  RouterAbEcdsaDerivationExplicitExportProtocolRequestV1,
  'client_ephemeral_public_key' | 'deriver_a_export_envelope' | 'deriver_b_export_envelope'
> & {
  readonly deriver_recipient_keys: RouterAbEcdsaRegistrationRecipientKeysV1;
};

type RouterAbEcdsaReusableExplicitExportRequestFactsV1 =
  RouterAbEcdsaExplicitExportRequestFactsBaseV1 & {
    readonly authorization: Extract<
      RouterAbNormalSigningAuthorizationWire,
      { readonly kind: 'reusable_wallet_session' }
    >;
    readonly operation?: never;
    readonly authorization_id?: never;
  };

type RouterAbEcdsaOperationStepUpExplicitExportRequestFactsV1 =
  RouterAbEcdsaExplicitExportRequestFactsBaseV1 & {
    readonly authorization: Extract<
      RouterAbNormalSigningAuthorizationWire,
      { readonly kind: 'operation_step_up' }
    >;
    readonly operation: RouterAbEcdsaOperationStepUpPreparationV1Wire;
    readonly authorization_id: DigestB64u;
  };

export type RouterAbEcdsaExplicitExportRequestFactsV1 =
  | RouterAbEcdsaReusableExplicitExportRequestFactsV1
  | RouterAbEcdsaOperationStepUpExplicitExportRequestFactsV1;

type RouterAbEcdsaReusableExplicitExportRequestWasmInputV1 =
  RouterAbEcdsaExplicitExportRequestFactsBaseV1 & {
    readonly authorization: Extract<
      RouterAbNormalSigningAuthorizationWire,
      { readonly kind: 'reusable_wallet_session' }
    >;
    readonly authorization_id?: never;
  };

type RouterAbEcdsaOperationStepUpExplicitExportRequestWasmInputV1 = Omit<
  RouterAbEcdsaExplicitExportRequestFactsBaseV1,
  'authorization'
> & {
  readonly authorization: {
    readonly kind: 'operation_step_up';
    readonly authorization_id: DigestB64u;
  };
};

export type RouterAbEcdsaExplicitExportRequestWasmInputV1 =
  | RouterAbEcdsaReusableExplicitExportRequestWasmInputV1
  | RouterAbEcdsaOperationStepUpExplicitExportRequestWasmInputV1;

function isOperationStepUpExplicitExportFacts(
  request: RouterAbEcdsaExplicitExportRequestFactsV1,
): request is RouterAbEcdsaOperationStepUpExplicitExportRequestFactsV1 {
  return request.authorization.kind === 'operation_step_up';
}

function projectReusableExplicitExportRequestForWasm(
  request: RouterAbEcdsaReusableExplicitExportRequestFactsV1,
): RouterAbEcdsaReusableExplicitExportRequestWasmInputV1 {
  const { operation: _operation, authorization_id: _authorizationId, ...wasmInput } = request;
  return wasmInput;
}

function projectOperationStepUpExplicitExportRequestForWasm(
  request: RouterAbEcdsaOperationStepUpExplicitExportRequestFactsV1,
): RouterAbEcdsaOperationStepUpExplicitExportRequestWasmInputV1 {
  const {
    operation: _operation,
    authorization: _authorization,
    authorization_id: authorizationId,
    ...wasmInput
  } = request;
  if (!authorizationId) {
    throw new Error('ECDSA explicit-export operation authorization id is missing');
  }
  return {
    ...wasmInput,
    authorization: {
      kind: 'operation_step_up',
      authorization_id: authorizationId,
    },
  };
}

export function projectRouterAbEcdsaExplicitExportRequestForWasmV1(
  request: RouterAbEcdsaExplicitExportRequestFactsV1,
): RouterAbEcdsaExplicitExportRequestWasmInputV1 {
  if (isOperationStepUpExplicitExportFacts(request)) {
    return projectOperationStepUpExplicitExportRequestForWasm(request);
  }
  return projectReusableExplicitExportRequestForWasm(request);
}

export function attachRouterAbEcdsaExplicitExportOperationV1(input: {
  readonly facts: RouterAbEcdsaExplicitExportRequestFactsV1;
  readonly protocolRequest: RouterAbEcdsaDerivationExplicitExportProtocolRequestV1;
}): RouterAbEcdsaDerivationExplicitExportRequestV1 {
  if (!isOperationStepUpExplicitExportFacts(input.facts)) {
    if (input.protocolRequest.authorization.kind !== 'reusable_wallet_session') {
      throw new Error('ECDSA explicit-export authorization changed across the WASM boundary');
    }
    return {
      ...input.protocolRequest,
      authorization: input.protocolRequest.authorization,
    };
  }
  if (input.protocolRequest.authorization.kind !== 'operation_step_up') {
    throw new Error('ECDSA explicit-export authorization changed across the WASM boundary');
  }
  return {
    ...input.protocolRequest,
    authorization: input.protocolRequest.authorization,
    operation: input.facts.operation,
  };
}

export type RouterAbEcdsaActivationRefreshRequestFactsV1 = Omit<
  RouterAbEcdsaDerivationActivationRefreshRequestV1,
  'deriver_a_refresh_envelope' | 'deriver_b_refresh_envelope'
> & {
  readonly deriver_recipient_keys: RouterAbEcdsaRegistrationRecipientKeysV1;
};

export type CreateRouterAbEcdsaPostRegistrationCeremonyRequestV1 =
  | {
      readonly kind: 'create_router_ab_ecdsa_explicit_export_ceremony_v1';
      readonly ceremonyId: string;
      readonly request: RouterAbEcdsaExplicitExportRequestFactsV1;
    }
  | {
      readonly kind: 'create_router_ab_ecdsa_activation_refresh_ceremony_v1';
      readonly ceremonyId: string;
      readonly publicCapability: RouterAbEcdsaDerivationPublicCapabilityV1;
      readonly request: RouterAbEcdsaActivationRefreshRequestFactsV1;
    };

export type CreateRouterAbEcdsaPostRegistrationCeremonyResultV1 =
  | {
      readonly kind: 'router_ab_ecdsa_explicit_export_ceremony_created_v1';
      readonly ceremonyId: string;
      readonly request: RouterAbEcdsaDerivationExplicitExportRequestV1;
      readonly requestDigestB64u: string;
    }
  | {
      readonly kind: 'router_ab_ecdsa_activation_refresh_ceremony_created_v1';
      readonly ceremonyId: string;
      readonly request: RouterAbEcdsaDerivationActivationRefreshRequestV1;
      readonly requestDigestB64u: string;
    };

export type FinalizeRouterAbEcdsaExplicitExportRequestV1 = {
  readonly kind: 'finalize_router_ab_ecdsa_explicit_export_v1';
  readonly ceremonyId: string;
  readonly clientProofFinalization: RouterAbEcdsaStableClientProofFinalizationV2;
  readonly signingWorkerExport: RouterAbEcdsaSigningWorkerExportShareEnvelopeV1;
  readonly authorizationKind: RouterAbEcdsaSigningWorkerExportShareBindingV1['authorization_kind'];
  readonly authorizationId: RouterAbEcdsaSigningWorkerExportShareBindingV1['authorization_id'];
  readonly materialActivation: RouterAbMpcMaterialActivationRefWire;
  readonly roleLocalMaterial: EcdsaRoleLocalWorkerHandle;
  readonly roleLocalMaterialRef: EcdsaRoleLocalPersistedMaterialRef;
  readonly publicFacts: EcdsaRoleLocalPublicFacts;
};

export type FinalizeRouterAbEcdsaExplicitExportResultV1 = {
  readonly kind: 'router_ab_ecdsa_explicit_export_finalized_v1';
  readonly ceremonyId: string;
  readonly artifactKind: 'ecdsa-derivation-secp256k1-export';
  readonly publicKeyHex: string;
  readonly privateKeyHex: string;
  readonly ethereumAddress: string;
  readonly stateBlob?: never;
  readonly output32B64u?: never;
};

export type VerifyRouterAbEcdsaPostRegistrationProofsRequestV1 = {
  readonly kind: 'verify_router_ab_ecdsa_post_registration_proofs_v1';
  readonly ceremonyId: string;
  readonly clientProofFinalization: RouterAbEcdsaStableClientProofFinalizationV2;
};

export type VerifyRouterAbEcdsaPostRegistrationProofsResultV1 = {
  readonly kind: 'router_ab_ecdsa_activation_refresh_proofs_verified_v1';
  readonly ceremonyId: string;
};

export type CloseRouterAbEcdsaPostRegistrationCeremonyRequestV1 = {
  readonly kind: 'close_router_ab_ecdsa_post_registration_ceremony_v1';
  readonly ceremonyId: string;
};

export type CloseRouterAbEcdsaPostRegistrationCeremonyResultV1 = {
  readonly kind: 'router_ab_ecdsa_post_registration_ceremony_closed_v1';
  readonly ceremonyId: string;
};

/** Ordinary post-unlock export request preparation on one holder-owned share. */
export type CreateEcdsaHolderOrdinaryExportRequestV1 = {
  readonly kind: 'create_ecdsa_holder_ordinary_export_request_v1';
  readonly holderHandleId: string;
  readonly request: RouterAbEcdsaExplicitExportRequestFactsV1;
};

export type CreateEcdsaHolderOrdinaryExportResultV1 = {
  readonly kind: 'ecdsa_holder_ordinary_export_request_created_v1';
  readonly holderHandleId: string;
  readonly request: RouterAbEcdsaDerivationExplicitExportRequestV1;
  readonly requestDigestB64u: string;
};

/** Standard forwarded response plus the exact binding derived from the active authority. */
export type FinalizeEcdsaHolderOrdinaryExportRequestV1 = {
  readonly kind: 'finalize_ecdsa_holder_ordinary_export_v1';
  readonly holderHandleId: string;
  readonly requestDigestB64u: string;
  readonly expectedBinding: RouterAbEcdsaSigningWorkerExportShareBindingV1;
  readonly forwardedResponse: RouterAbEcdsaExplicitExportForwardedResponseV1;
};

export type FinalizeEcdsaHolderOrdinaryExportResultV1 = {
  readonly kind: 'ecdsa_holder_ordinary_export_finalized_v1';
  readonly holderHandleId: string;
  readonly artifactKind: 'ecdsa-derivation-secp256k1-export';
  readonly publicKeyHex: string;
  readonly privateKeyHex: string;
  readonly ethereumAddress: string;
};

const ECDSA_CLIENT_CHANNEL_PROBE_DIGEST_B64U = 'A'.repeat(43);

function requireEcdsaClientChannelObject(value: unknown, label: string): object {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function readEcdsaClientChannelField(value: object, field: string): unknown {
  return Reflect.get(value, field);
}

function requireExactEcdsaClientChannelObject(
  value: unknown,
  expectedFields: readonly string[],
  label: string,
): object {
  const record = requireEcdsaClientChannelObject(value, label);
  const actualFields = Object.keys(record);
  if (
    actualFields.length !== expectedFields.length ||
    actualFields.some((field) => !expectedFields.includes(field))
  ) {
    throw new Error(`${label} has invalid fields`);
  }
  return record;
}

function parseEcdsaClientChannelString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const parsed = value.trim();
  if (!parsed) throw new Error(`${label} is required`);
  if (!/^[\x20-\x7e]+$/.test(parsed)) {
    throw new Error(`${label} must be printable ASCII`);
  }
  return parsed;
}

function parseEcdsaClientChannelDigest(value: unknown, label: string): DigestB64u {
  try {
    return parseDigestB64u(value);
  } catch (error) {
    throw new Error(`${label} ${error instanceof Error ? error.message : 'is invalid'}`);
  }
}

function parseEcdsaClientChannelPositiveMs(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function parseEcdsaClientChannelRootShareEpoch(value: unknown, label: string): RootShareEpoch {
  const parsed = parseRootShareEpoch(value);
  if (!parsed.ok) throw new Error(`${label} is invalid`);
  return parsed.value;
}

function parseEcdsaClientChannelSessionId(value: unknown, label: string): ThresholdEcdsaSessionId {
  const parsed = parseThresholdEcdsaSessionId(value);
  if (!parsed.ok) throw new Error(`${label} is invalid`);
  return parsed.value;
}

function parseEcdsaClientChannelCapabilityParts(input: {
  readonly context: unknown;
  readonly publicIdentity: unknown;
  readonly materialActivation: unknown;
  readonly signerSet: unknown;
  readonly deriverRecipientKeys: unknown;
  readonly activationEpoch: unknown;
  readonly routerId: unknown;
  readonly clientId: unknown;
}): RouterAbEcdsaDerivationPublicCapabilityV1 {
  // Facts omit capability transcript digests; the shared decoder still owns
  // the nested capability graph, so use sentinels for those two fields.
  return parseRouterAbEcdsaDerivationPublicCapabilityV1({
    kind: 'router_ab_ecdsa_derivation_public_capability_v1',
    context: input.context,
    public_identity: input.publicIdentity,
    material_activation: input.materialActivation,
    signer_set: input.signerSet,
    deriver_recipient_keys: input.deriverRecipientKeys,
    router_id: input.routerId,
    client_id: input.clientId,
    activation_epoch: input.activationEpoch,
    registration_request_digest_b64u: ECDSA_CLIENT_CHANNEL_PROBE_DIGEST_B64U,
    proof_transcript_digest_b64u: ECDSA_CLIENT_CHANNEL_PROBE_DIGEST_B64U,
  });
}

function parseEcdsaClientChannelExportLifecycle(
  value: unknown,
): RouterAbEcdsaDerivationExportLifecycleScopeV1 {
  const label = 'ECDSA explicit-export lifecycle';
  const record = requireExactEcdsaClientChannelObject(
    value,
    [
      'lifecycle_id',
      'work_kind',
      'primitive_request_kind',
      'root_share_epoch',
      'account_id',
      'session_id',
      'signer_set_id',
      'selected_server_id',
    ],
    label,
  );
  if (
    readEcdsaClientChannelField(record, 'work_kind') !== 'key_export' ||
    readEcdsaClientChannelField(record, 'primitive_request_kind') !== 'export'
  ) {
    throw new Error(`${label} metadata is invalid`);
  }
  return {
    lifecycle_id: parseEcdsaClientChannelString(
      readEcdsaClientChannelField(record, 'lifecycle_id'),
      `${label}.lifecycle_id`,
    ),
    work_kind: 'key_export',
    primitive_request_kind: 'export',
    root_share_epoch: parseEcdsaClientChannelRootShareEpoch(
      readEcdsaClientChannelField(record, 'root_share_epoch'),
      `${label}.root_share_epoch`,
    ),
    account_id: parseEcdsaClientChannelString(
      readEcdsaClientChannelField(record, 'account_id'),
      `${label}.account_id`,
    ),
    session_id: parseEcdsaClientChannelSessionId(
      readEcdsaClientChannelField(record, 'session_id'),
      `${label}.session_id`,
    ),
    signer_set_id: parseEcdsaClientChannelString(
      readEcdsaClientChannelField(record, 'signer_set_id'),
      `${label}.signer_set_id`,
    ),
    selected_server_id: parseEcdsaClientChannelString(
      readEcdsaClientChannelField(record, 'selected_server_id'),
      `${label}.selected_server_id`,
    ),
  };
}

function parseEcdsaClientChannelRefreshLifecycle(
  value: unknown,
): RouterAbEcdsaDerivationRefreshLifecycleScopeV1 {
  const label = 'ECDSA activation-refresh lifecycle';
  const record = requireExactEcdsaClientChannelObject(
    value,
    [
      'lifecycle_id',
      'work_kind',
      'primitive_request_kind',
      'root_share_epoch',
      'account_id',
      'session_id',
      'signer_set_id',
      'selected_server_id',
    ],
    label,
  );
  if (
    readEcdsaClientChannelField(record, 'work_kind') !== 'server_share_refresh' ||
    readEcdsaClientChannelField(record, 'primitive_request_kind') !== 'refresh'
  ) {
    throw new Error(`${label} metadata is invalid`);
  }
  return {
    lifecycle_id: parseEcdsaClientChannelString(
      readEcdsaClientChannelField(record, 'lifecycle_id'),
      `${label}.lifecycle_id`,
    ),
    work_kind: 'server_share_refresh',
    primitive_request_kind: 'refresh',
    root_share_epoch: parseEcdsaClientChannelRootShareEpoch(
      readEcdsaClientChannelField(record, 'root_share_epoch'),
      `${label}.root_share_epoch`,
    ),
    account_id: parseEcdsaClientChannelString(
      readEcdsaClientChannelField(record, 'account_id'),
      `${label}.account_id`,
    ),
    session_id: parseEcdsaClientChannelSessionId(
      readEcdsaClientChannelField(record, 'session_id'),
      `${label}.session_id`,
    ),
    signer_set_id: parseEcdsaClientChannelString(
      readEcdsaClientChannelField(record, 'signer_set_id'),
      `${label}.signer_set_id`,
    ),
    selected_server_id: parseEcdsaClientChannelString(
      readEcdsaClientChannelField(record, 'selected_server_id'),
      `${label}.selected_server_id`,
    ),
  };
}

const ECDSA_EXPLICIT_EXPORT_FACT_FIELDS = [
  'context',
  'lifecycle',
  'public_identity',
  'signer_set',
  'router_id',
  'client_id',
  'authorization',
  'material_activation',
  'export_authorization_digest_b64u',
  'export_nonce',
  'expires_at_ms',
  'deriver_recipient_keys',
] as const;

export function parseRouterAbEcdsaExplicitExportRequestFactsV1(
  value: unknown,
): RouterAbEcdsaExplicitExportRequestFactsV1 {
  const object = requireEcdsaClientChannelObject(value, 'ECDSA explicit-export facts');
  const authorization = parseRouterAbNormalSigningAuthorization(
    readEcdsaClientChannelField(object, 'authorization'),
  );
  const fields =
    authorization.kind === 'operation_step_up'
      ? [...ECDSA_EXPLICIT_EXPORT_FACT_FIELDS, 'operation', 'authorization_id']
      : ECDSA_EXPLICIT_EXPORT_FACT_FIELDS;
  const record = requireExactEcdsaClientChannelObject(
    object,
    fields,
    'ECDSA explicit-export facts',
  );
  const lifecycle = parseEcdsaClientChannelExportLifecycle(
    readEcdsaClientChannelField(record, 'lifecycle'),
  );
  const capability = parseEcdsaClientChannelCapabilityParts({
    context: readEcdsaClientChannelField(record, 'context'),
    publicIdentity: readEcdsaClientChannelField(record, 'public_identity'),
    materialActivation: readEcdsaClientChannelField(record, 'material_activation'),
    signerSet: readEcdsaClientChannelField(record, 'signer_set'),
    deriverRecipientKeys: readEcdsaClientChannelField(record, 'deriver_recipient_keys'),
    activationEpoch: lifecycle.root_share_epoch,
    routerId: readEcdsaClientChannelField(record, 'router_id'),
    clientId: readEcdsaClientChannelField(record, 'client_id'),
  });
  if (
    capability.material_activation.material_owner !== lifecycle.account_id ||
    capability.material_activation.signing_worker !== lifecycle.selected_server_id
  ) {
    throw new Error(
      'ECDSA explicit-export facts.material_activation is not bound to lifecycle owner and selected server',
    );
  }
  const base = {
    context: capability.context,
    lifecycle,
    public_identity: capability.public_identity,
    signer_set: capability.signer_set,
    router_id: capability.router_id,
    client_id: capability.client_id,
    material_activation: capability.material_activation,
    export_authorization_digest_b64u: parseEcdsaClientChannelDigest(
      readEcdsaClientChannelField(record, 'export_authorization_digest_b64u'),
      'ECDSA explicit-export facts.export_authorization_digest_b64u',
    ),
    export_nonce: parseEcdsaClientChannelString(
      readEcdsaClientChannelField(record, 'export_nonce'),
      'ECDSA explicit-export facts.export_nonce',
    ),
    expires_at_ms: parseEcdsaClientChannelPositiveMs(
      readEcdsaClientChannelField(record, 'expires_at_ms'),
      'ECDSA explicit-export facts.expires_at_ms',
    ),
    deriver_recipient_keys: capability.deriver_recipient_keys,
  };
  if (authorization.kind === 'reusable_wallet_session') {
    return { ...base, authorization };
  }
  return {
    ...base,
    authorization,
    authorization_id: parseEcdsaClientChannelDigest(
      readEcdsaClientChannelField(record, 'authorization_id'),
      'ECDSA explicit-export facts.authorization_id',
    ),
    operation: parseRouterAbEcdsaOperationStepUpPreparationV1(
      readEcdsaClientChannelField(record, 'operation'),
    ),
  };
}

const ECDSA_REFRESH_FACT_FIELDS = [
  'context',
  'lifecycle',
  'public_identity',
  'signer_set',
  'router_id',
  'client_id',
  'signing_worker_ephemeral_public_key',
  'refresh_authorization_digest_b64u',
  'refresh_nonce',
  'previous_activation_epoch',
  'next_activation_epoch',
  'material_activation',
  'expires_at_ms',
  'deriver_recipient_keys',
] as const;

export function parseRouterAbEcdsaActivationRefreshRequestFactsV1(
  value: unknown,
): RouterAbEcdsaActivationRefreshRequestFactsV1 {
  const record = requireExactEcdsaClientChannelObject(
    value,
    ECDSA_REFRESH_FACT_FIELDS,
    'ECDSA activation-refresh facts',
  );
  const lifecycle = parseEcdsaClientChannelRefreshLifecycle(
    readEcdsaClientChannelField(record, 'lifecycle'),
  );
  const previousActivationEpoch = parseEcdsaClientChannelRootShareEpoch(
    readEcdsaClientChannelField(record, 'previous_activation_epoch'),
    'ECDSA activation-refresh facts.previous_activation_epoch',
  );
  const nextActivationEpoch = parseEcdsaClientChannelRootShareEpoch(
    readEcdsaClientChannelField(record, 'next_activation_epoch'),
    'ECDSA activation-refresh facts.next_activation_epoch',
  );
  if (previousActivationEpoch === nextActivationEpoch) {
    throw new Error('ECDSA activation-refresh facts must advance activation epoch');
  }
  if (lifecycle.root_share_epoch !== nextActivationEpoch) {
    throw new Error(
      'ECDSA activation-refresh facts.lifecycle.root_share_epoch must equal next_activation_epoch',
    );
  }
  const capability = parseEcdsaClientChannelCapabilityParts({
    context: readEcdsaClientChannelField(record, 'context'),
    publicIdentity: readEcdsaClientChannelField(record, 'public_identity'),
    materialActivation: readEcdsaClientChannelField(record, 'material_activation'),
    signerSet: readEcdsaClientChannelField(record, 'signer_set'),
    deriverRecipientKeys: readEcdsaClientChannelField(record, 'deriver_recipient_keys'),
    activationEpoch: nextActivationEpoch,
    routerId: readEcdsaClientChannelField(record, 'router_id'),
    clientId: readEcdsaClientChannelField(record, 'client_id'),
  });
  if (
    capability.material_activation.material_owner !== lifecycle.account_id ||
    capability.material_activation.signing_worker !== lifecycle.selected_server_id
  ) {
    throw new Error(
      'ECDSA activation-refresh facts.material_activation is not bound to lifecycle owner and selected server',
    );
  }
  return {
    context: capability.context,
    lifecycle,
    public_identity: capability.public_identity,
    signer_set: capability.signer_set,
    router_id: capability.router_id,
    client_id: capability.client_id,
    signing_worker_ephemeral_public_key: requireRouterAbX25519PublicKey(
      readEcdsaClientChannelField(record, 'signing_worker_ephemeral_public_key'),
      'ECDSA activation-refresh facts.signing_worker_ephemeral_public_key',
    ),
    refresh_authorization_digest_b64u: parseEcdsaClientChannelDigest(
      readEcdsaClientChannelField(record, 'refresh_authorization_digest_b64u'),
      'ECDSA activation-refresh facts.refresh_authorization_digest_b64u',
    ),
    refresh_nonce: parseEcdsaClientChannelString(
      readEcdsaClientChannelField(record, 'refresh_nonce'),
      'ECDSA activation-refresh facts.refresh_nonce',
    ),
    previous_activation_epoch: previousActivationEpoch,
    next_activation_epoch: nextActivationEpoch,
    material_activation: capability.material_activation,
    expires_at_ms: parseEcdsaClientChannelPositiveMs(
      readEcdsaClientChannelField(record, 'expires_at_ms'),
      'ECDSA activation-refresh facts.expires_at_ms',
    ),
    deriver_recipient_keys: capability.deriver_recipient_keys,
  };
}

export function parseCreateRouterAbEcdsaPostRegistrationCeremonyRequestV1(
  value: unknown,
): CreateRouterAbEcdsaPostRegistrationCeremonyRequestV1 {
  const object = requireEcdsaClientChannelObject(value, 'ECDSA post-registration ceremony request');
  switch (readEcdsaClientChannelField(object, 'kind')) {
    case 'create_router_ab_ecdsa_explicit_export_ceremony_v1': {
      const record = requireExactEcdsaClientChannelObject(
        object,
        ['kind', 'ceremonyId', 'request'],
        'ECDSA post-registration explicit-export ceremony request',
      );
      return {
        kind: 'create_router_ab_ecdsa_explicit_export_ceremony_v1',
        ceremonyId: parseEcdsaClientChannelString(
          readEcdsaClientChannelField(record, 'ceremonyId'),
          'ECDSA post-registration ceremony request.ceremonyId',
        ),
        request: parseRouterAbEcdsaExplicitExportRequestFactsV1(
          readEcdsaClientChannelField(record, 'request'),
        ),
      };
    }
    case 'create_router_ab_ecdsa_activation_refresh_ceremony_v1': {
      const record = requireExactEcdsaClientChannelObject(
        object,
        ['kind', 'ceremonyId', 'publicCapability', 'request'],
        'ECDSA post-registration activation-refresh ceremony request',
      );
      return {
        kind: 'create_router_ab_ecdsa_activation_refresh_ceremony_v1',
        ceremonyId: parseEcdsaClientChannelString(
          readEcdsaClientChannelField(record, 'ceremonyId'),
          'ECDSA post-registration ceremony request.ceremonyId',
        ),
        publicCapability: parseRouterAbEcdsaDerivationPublicCapabilityV1(
          readEcdsaClientChannelField(record, 'publicCapability'),
        ),
        request: parseRouterAbEcdsaActivationRefreshRequestFactsV1(
          readEcdsaClientChannelField(record, 'request'),
        ),
      };
    }
    default:
      throw new Error('ECDSA post-registration ceremony request kind is invalid');
  }
}

export function parseCreateEcdsaHolderOrdinaryExportRequestV1(
  value: unknown,
): CreateEcdsaHolderOrdinaryExportRequestV1 {
  const record = requireExactEcdsaClientChannelObject(
    value,
    ['kind', 'holderHandleId', 'request'],
    'ECDSA holder ordinary-export request',
  );
  if (
    readEcdsaClientChannelField(record, 'kind') !== 'create_ecdsa_holder_ordinary_export_request_v1'
  ) {
    throw new Error('ECDSA holder ordinary-export request kind is invalid');
  }
  return {
    kind: 'create_ecdsa_holder_ordinary_export_request_v1',
    holderHandleId: parseEcdsaClientChannelString(
      readEcdsaClientChannelField(record, 'holderHandleId'),
      'ECDSA holder ordinary-export request.holderHandleId',
    ),
    request: parseRouterAbEcdsaExplicitExportRequestFactsV1(
      readEcdsaClientChannelField(record, 'request'),
    ),
  };
}

export function parseFinalizeEcdsaHolderOrdinaryExportRequestV1(
  value: unknown,
): FinalizeEcdsaHolderOrdinaryExportRequestV1 {
  const record = requireExactEcdsaClientChannelObject(
    value,
    ['kind', 'holderHandleId', 'requestDigestB64u', 'expectedBinding', 'forwardedResponse'],
    'ECDSA holder ordinary-export finalization request',
  );
  if (readEcdsaClientChannelField(record, 'kind') !== 'finalize_ecdsa_holder_ordinary_export_v1') {
    throw new Error('ECDSA holder ordinary-export finalization kind is invalid');
  }
  return {
    kind: 'finalize_ecdsa_holder_ordinary_export_v1',
    holderHandleId: parseEcdsaClientChannelString(
      readEcdsaClientChannelField(record, 'holderHandleId'),
      'ECDSA holder ordinary-export finalization.holderHandleId',
    ),
    requestDigestB64u: parseEcdsaClientChannelDigest(
      readEcdsaClientChannelField(record, 'requestDigestB64u'),
      'ECDSA holder ordinary-export finalization.requestDigestB64u',
    ),
    expectedBinding: parseRouterAbEcdsaSigningWorkerExportShareBindingV1(
      readEcdsaClientChannelField(record, 'expectedBinding'),
    ),
    forwardedResponse: parseRouterAbEcdsaExplicitExportForwardedResponseV1(
      readEcdsaClientChannelField(record, 'forwardedResponse'),
    ),
  };
}

type ParsedWorkerChannelControl = {
  readonly kind: unknown;
  readonly port: unknown;
};

function parseWorkerChannelControl(value: unknown): ParsedWorkerChannelControl | null {
  if (!isObject(value)) return null;
  return { kind: value.kind, port: value.port };
}

export function isAttachEcdsaDerivationToPresignPort(
  value: unknown,
): value is AttachEcdsaDerivationToPresignPort {
  const parsed = parseWorkerChannelControl(value);
  return (
    parsed?.kind === EcdsaClientWorkerControlKind.AttachDerivationToPresign &&
    parsed.port instanceof MessagePort
  );
}

export function isAttachLinkedHolderToPresignPort(
  value: unknown,
): value is AttachLinkedHolderToPresignPort {
  const parsed = parseWorkerChannelControl(value);
  return (
    parsed?.kind === EcdsaClientWorkerControlKind.AttachLinkedHolderToPresign &&
    parsed.port instanceof MessagePort
  );
}

export function isAttachPresignToOnlinePort(value: unknown): value is AttachPresignToOnlinePort {
  const parsed = parseWorkerChannelControl(value);
  return (
    parsed?.kind === EcdsaClientWorkerControlKind.AttachPresignToOnline &&
    parsed.port instanceof MessagePort
  );
}

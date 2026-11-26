import {
  computeWalletAuthorityDigestB64u,
  computeWalletSignerActivationSetDigestB64u,
  type ActiveWalletAuthorityV1,
  type WalletAuthorityV1,
  type WalletEcdsaSignerActivationV1,
  type WalletEd25519SignerActivationV1,
  type WalletSignerActivationSetV1,
} from '@shared/authorization/walletAuthority';
import type {
  ActiveWalletAuthMethodRecordV2,
  WalletAuthMethodRecordV2,
} from '@shared/utils/walletAuthMethodRecord';
import type {
  MpcMaterialActivationRef,
  WalletAuthMethodId,
  WalletAuthorityId,
  WalletId,
} from '@shared/utils/domainIds';

export type WalletAuthorityOperationV1 =
  | {
      readonly kind: 'near_sign';
      readonly operation: 'sign';
      readonly keyFamily: 'ed25519';
    }
  | {
      readonly kind: 'near_export';
      readonly operation: 'export_keys';
      readonly keyFamily: 'ed25519';
    }
  | {
      readonly kind: 'evm_sign';
      readonly operation: 'sign';
      readonly keyFamily: 'ecdsa_secp256k1';
    }
  | {
      readonly kind: 'evm_export';
      readonly operation: 'export_keys';
      readonly keyFamily: 'ecdsa_secp256k1';
    };

export type SelectedWalletAuthorityV1 = {
  readonly authMethod: WalletAuthMethodRecordV2;
  readonly authority: WalletAuthorityV1;
};

export type ResolveWalletAuthorityOperationInputV1 = {
  readonly selected: SelectedWalletAuthorityV1;
  readonly operation: WalletAuthorityOperationV1;
};

type ResolvedWalletAuthorityOperationCommonV1 = {
  readonly kind: 'resolved';
  readonly walletId: WalletId;
  readonly authorityId: WalletAuthorityId;
  readonly authMethodId: WalletAuthMethodId;
  readonly materialActivation: MpcMaterialActivationRef;
};

export type ResolvedWalletAuthorityOperationV1 =
  | (ResolvedWalletAuthorityOperationCommonV1 & {
      readonly keyFamily: 'ed25519';
      readonly registeredPublicKeyB64u: string;
      readonly thresholdPublicKey33B64u?: never;
      readonly evmAddress?: never;
    })
  | (ResolvedWalletAuthorityOperationCommonV1 & {
      readonly keyFamily: 'ecdsa_secp256k1';
      readonly thresholdPublicKey33B64u: string;
      readonly evmAddress: string;
      readonly registeredPublicKeyB64u?: never;
    });

export type WalletAuthorityOperationResolutionFailureV1 =
  | { readonly kind: 'wallet_id_mismatch' }
  | { readonly kind: 'authority_id_mismatch' }
  | { readonly kind: 'authority_not_active' }
  | { readonly kind: 'auth_method_not_active' }
  | { readonly kind: 'authority_activation_set_digest_mismatch' }
  | { readonly kind: 'authority_digest_mismatch' }
  | { readonly kind: 'permission_missing' }
  | { readonly kind: 'signer_family_unavailable' }
  | { readonly kind: 'signer_wallet_id_mismatch' };

export type ResolveWalletAuthorityOperationResultV1 =
  | { readonly kind: 'resolved'; readonly value: ResolvedWalletAuthorityOperationV1 }
  | { readonly kind: 'rejected'; readonly reason: WalletAuthorityOperationResolutionFailureV1 };

export async function resolveWalletAuthorityOperation(
  input: ResolveWalletAuthorityOperationInputV1,
): Promise<ResolveWalletAuthorityOperationResultV1> {
  const { authMethod, authority } = input.selected;
  if (authority.state !== 'active') {
    return {
      kind: 'rejected',
      reason: { kind: 'authority_not_active' },
    };
  }
  if (authMethod.status !== 'active') {
    return {
      kind: 'rejected',
      reason: { kind: 'auth_method_not_active' },
    };
  }
  if (authority.walletId !== authMethod.walletId) {
    return {
      kind: 'rejected',
      reason: { kind: 'wallet_id_mismatch' },
    };
  }
  if (authority.authorityId !== authMethod.walletAuthorityId) {
    return {
      kind: 'rejected',
      reason: { kind: 'authority_id_mismatch' },
    };
  }

  const activationDigest = await computeWalletSignerActivationSetDigestB64u(
    authority.signerActivations,
  );
  if (activationDigest !== authority.signerActivationSetDigestB64u) {
    return {
      kind: 'rejected',
      reason: { kind: 'authority_activation_set_digest_mismatch' },
    };
  }
  const authorityDigest = await computeWalletAuthorityDigestB64u(authority);
  if (authorityDigest !== authority.authorityDigestB64u) {
    return {
      kind: 'rejected',
      reason: { kind: 'authority_digest_mismatch' },
    };
  }

  const requiredPermission = requiredPermissionForOperation(input.operation);
  if (!authority.permissions.includes(requiredPermission)) {
    return {
      kind: 'rejected',
      reason: { kind: 'permission_missing' },
    };
  }

  switch (input.operation.kind) {
    case 'near_sign':
    case 'near_export':
      return resolveEd25519Operation(authority, authMethod);
    case 'evm_sign':
    case 'evm_export':
      return resolveEcdsaOperation(authority, authMethod);
    default:
      return assertNeverOperation(input.operation);
  }
}

function requiredPermissionForOperation(
  operation: WalletAuthorityOperationV1,
): 'sign' | 'export_keys' {
  switch (operation.kind) {
    case 'near_sign':
    case 'evm_sign':
      return 'sign';
    case 'near_export':
    case 'evm_export':
      return 'export_keys';
    default:
      return assertNeverOperation(operation);
  }
}

function resolveEd25519Operation(
  authority: ActiveWalletAuthorityV1,
  authMethod: ActiveWalletAuthMethodRecordV2,
): ResolveWalletAuthorityOperationResultV1 {
  const activation = ed25519Activation(authority.signerActivations);
  if (activation === null) {
    return {
      kind: 'rejected',
      reason: { kind: 'signer_family_unavailable' },
    };
  }
  if (activation.signer.walletId !== authority.walletId) {
    return {
      kind: 'rejected',
      reason: { kind: 'signer_wallet_id_mismatch' },
    };
  }
  return {
    kind: 'resolved',
    value: {
      kind: 'resolved',
      keyFamily: 'ed25519',
      walletId: authority.walletId,
      authorityId: authority.authorityId,
      authMethodId: authMethod.walletAuthMethodId,
      materialActivation: activation.materialActivation,
      registeredPublicKeyB64u: activation.signer.registeredPublicKeyB64u,
    },
  };
}

function resolveEcdsaOperation(
  authority: ActiveWalletAuthorityV1,
  authMethod: ActiveWalletAuthMethodRecordV2,
): ResolveWalletAuthorityOperationResultV1 {
  const activation = ecdsaActivation(authority.signerActivations);
  if (activation === null) {
    return {
      kind: 'rejected',
      reason: { kind: 'signer_family_unavailable' },
    };
  }
  if (activation.signer.walletId !== authority.walletId) {
    return {
      kind: 'rejected',
      reason: { kind: 'signer_wallet_id_mismatch' },
    };
  }
  return {
    kind: 'resolved',
    value: {
      kind: 'resolved',
      keyFamily: 'ecdsa_secp256k1',
      walletId: authority.walletId,
      authorityId: authority.authorityId,
      authMethodId: authMethod.walletAuthMethodId,
      materialActivation: activation.materialActivation,
      thresholdPublicKey33B64u: activation.signer.thresholdPublicKey33B64u,
      evmAddress: activation.signer.evmAddress,
    },
  };
}

function ed25519Activation(
  activations: WalletSignerActivationSetV1,
): WalletEd25519SignerActivationV1 | null {
  if (activations.keyFamilies[0] !== 'ed25519') return null;
  if (activations.ed25519 === undefined) return null;
  return activations.ed25519;
}

function ecdsaActivation(
  activations: WalletSignerActivationSetV1,
): WalletEcdsaSignerActivationV1 | null {
  if (activations.keyFamilies[0] !== 'ecdsa_secp256k1' && activations.keyFamilies.length !== 2) {
    return null;
  }
  if (activations.ecdsa === undefined) return null;
  return activations.ecdsa;
}

function assertNeverOperation(value: never): never {
  throw new Error(`unsupported wallet authority operation: ${String(value)}`);
}

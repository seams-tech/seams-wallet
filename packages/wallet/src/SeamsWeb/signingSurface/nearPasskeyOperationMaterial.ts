import { IndexedDBManager } from '@/core/indexedDB';
import type { ResolveSelectedWalletAuthorityResultV1 } from '@/core/indexedDB/seamsWalletDB/repositories';
import { type WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type {
  NearEd25519YaoOperationMaterial,
  NearEd25519YaoOperationMaterialFacts,
} from '@/core/signingEngine/interfaces/near';
import type {
  NearEd25519MaterialIdentity,
  NearSigningApiDeps,
} from '@/core/signingEngine/interfaces/operationDeps';
import { resolveWalletAuthorityOperation } from '@/core/signingEngine/session/authority';
import { nearEd25519YaoMaterialActivationFromMetadata } from '@/core/signingEngine/session/material/nearEd25519YaoMaterialActivation';
import {
  invalidWalletSigningMaterial,
  walletSigningMaterialBlockError,
} from '@/core/signingEngine/session/material/walletSigningStateFailure';
import {
  hydratePasskeyEd25519YaoLocalMaterialV1,
  preparePasskeyEd25519YaoLocalMaterialRehydrationV1,
  readPasskeyEd25519YaoLocalMaterialLocatorV1,
  type Ed25519YaoLocalMaterialIdentity,
  type PasskeyEd25519YaoPublicLocatorObservationV1,
} from '@/core/signingEngine/session/passkey/ed25519YaoLocalMaterial';
import { buildThresholdEd25519WebAuthnPrfSecretSource } from '@/core/signingEngine/threshold/ed25519/walletSession';
import type { WebAuthnAuthenticationCredential } from '@/core/types';
import { signingRootScopeFromRuntimePolicyScope } from '@shared/threshold/signingRootScope';
import {
  mpcMaterialActivationRefsEqual,
  type MpcMaterialActivationRef,
} from '@shared/utils/domainIds';
import { WALLET_AUTH_METHODS } from '@shared/utils/signerDomain';
import {
  walletAuthAuthorityRef,
  type WalletAuthAuthorityRef,
} from '@shared/utils/walletAuthAuthority';
import { type ActivePasskeyWalletAuthMethodRecordV2 } from '@shared/utils/walletAuthMethodRecord';
import type { NearEd25519SignerBinding } from '@shared/utils/walletCapabilityBindings';

export async function resolveBrowserExactPasskeyWalletAuthAuthorityRef(args: {
  readonly walletId: WalletId;
  readonly rpId: string;
  readonly credentialIdB64u: string;
}): Promise<WalletAuthAuthorityRef | null> {
  const records = await IndexedDBManager.listWalletAuthMethodsV2ForWallet(String(args.walletId));
  const matches = records.filter(
    (record) =>
      record.kind === WALLET_AUTH_METHODS.passkey &&
      record.status === 'active' &&
      record.walletId === args.walletId &&
      String(record.rpId) === args.rpId &&
      String(record.credentialIdB64u) === args.credentialIdB64u,
  );
  const [record] = matches;
  if (matches.length !== 1 || !record || record.kind !== WALLET_AUTH_METHODS.passkey) {
    return null;
  }
  return await walletAuthAuthorityRef({
    authority: {
      walletId: record.walletId,
      factor: {
        kind: WALLET_AUTH_METHODS.passkey,
        credentialIdB64u: record.credentialIdB64u,
      },
      verifier: {
        kind: 'webauthn',
        rpId: record.rpId,
      },
      bindingId: record.walletAuthMethodId,
    },
  });
}

export type PasskeyEd25519MaterialAccess =
  | { readonly kind: 'wallet_session' }
  | {
      readonly kind: 'owner_operation';
      readonly authMethod: ActivePasskeyWalletAuthMethodRecordV2;
      readonly authority: import('@shared/authorization/walletAuthority').ActiveWalletAuthorityV1;
      readonly assertCurrent: () => void;
    };

export async function preparePasskeyEd25519OperationMaterial(args: {
  walletId: WalletId;
  identity: NearEd25519MaterialIdentity;
  relayerUrl: string;
  access: PasskeyEd25519MaterialAccess;
}) {
  const { identity } = args;
  if (identity.auth.kind !== WALLET_AUTH_METHODS.passkey) {
    throw invalidWalletSigningMaterial('binding_mismatch');
  }
  const selected = await IndexedDBManager.resolveSelectedWalletAuthority(String(args.walletId));
  if (
    selected.kind !== 'resolved' ||
    selected.selection.walletId !== args.walletId ||
    selected.authMethod.kind !== WALLET_AUTH_METHODS.passkey ||
    String(selected.authMethod.rpId) !== String(identity.auth.rpId) ||
    selected.authMethod.credentialIdB64u !== identity.auth.credentialIdB64u
  )
    throw invalidWalletSigningMaterial('binding_mismatch');
  assertPasskeyEd25519MaterialAccess(args.access, selected);
  const operation = await resolveWalletAuthorityOperation({
    selected: { authMethod: selected.authMethod, authority: selected.authority },
    operation: { kind: 'near_sign', operation: 'sign', keyFamily: 'ed25519' },
  });
  if (operation.kind !== 'resolved') throw invalidWalletSigningMaterial('missing_capability');
  const authority = await resolveBrowserExactPasskeyWalletAuthAuthorityRef({
    walletId: args.walletId,
    rpId: identity.auth.rpId,
    credentialIdB64u: identity.auth.credentialIdB64u,
  });
  if (!authority || authority.walletAuthMethodId !== selected.authMethod.walletAuthMethodId) {
    throw invalidWalletSigningMaterial('binding_mismatch');
  }
  const local = await readPasskeyEd25519YaoLocalMaterialLocatorV1({
    store: IndexedDBManager,
    walletId: String(args.walletId),
    nearAccountId: String(identity.signer.account.nearAccountId),
    nearEd25519SigningKeyId: String(identity.signer.nearEd25519SigningKeyId),
    signerSlot: identity.signer.signerSlot,
    rpId: identity.auth.rpId,
    credentialIdB64u: identity.auth.credentialIdB64u,
    authority,
  });
  if (local.kind !== 'available') throw invalidWalletSigningMaterial('missing_runtime');
  if (
    !mpcMaterialActivationRefsEqual(
      local.locator.materialActivation,
      operation.value.materialActivation,
    )
  ) {
    throw invalidWalletSigningMaterial('binding_mismatch');
  }
  const scope = local.locator.stableServerScope;
  const root = signingRootScopeFromRuntimePolicyScope(scope.runtimePolicyScope);
  if (!root.signingRootVersion) throw invalidWalletSigningMaterial('binding_mismatch');
  const localIdentity: Ed25519YaoLocalMaterialIdentity = {
    walletId: String(args.walletId),
    nearAccountId: String(identity.signer.account.nearAccountId),
    nearEd25519SigningKeyId: String(identity.signer.nearEd25519SigningKeyId),
    thresholdSessionId: String(identity.thresholdSessionId),
    signerSlot: identity.signer.signerSlot,
    rpId: identity.auth.rpId,
    credentialIdB64u: identity.auth.credentialIdB64u,
    signingRootId: root.signingRootId,
    signingRootVersion: root.signingRootVersion,
    signingWorkerId: scope.routerAbNormalSigning.signingWorkerId,
  };
  const publicLocator: PasskeyEd25519YaoPublicLocatorObservationV1 = {
    kind: 'available',
    walletId: localIdentity.walletId,
    nearAccountId: localIdentity.nearAccountId,
    signerSlot: localIdentity.signerSlot,
    materialActivation: local.locator.materialActivation,
  };
  const prepared = await prepareExactPasskeyEd25519YaoLocalMaterialRehydration({
    store: IndexedDBManager,
    identity: localIdentity,
    authority,
    publicLocator,
  });
  if (prepared.kind === 'blocked') throw walletSigningMaterialBlockError(prepared.plan.reason);
  const facts: NearEd25519YaoOperationMaterialFacts = {
    thresholdSessionId: identity.thresholdSessionId,
    signer: identity.signer,
    signingRootId: root.signingRootId,
    signingRootVersion: root.signingRootVersion,
    routerAbNormalSigning: scope.routerAbNormalSigning,
    runtimePolicyScope: scope.runtimePolicyScope,
    relayerUrl: args.relayerUrl,
  };
  return {
    prepared,
    localIdentity,
    authority,
    publicLocator,
    facts,
    participantIds: scope.participantIds,
  };
}

export function assertPasskeyEd25519MaterialAccess(
  access: PasskeyEd25519MaterialAccess,
  selected: Extract<ResolveSelectedWalletAuthorityResultV1, { kind: 'resolved' }>,
): void {
  switch (access.kind) {
    case 'wallet_session':
      if (selected.selection.lockState !== 'unlocked') {
        throw invalidWalletSigningMaterial('binding_mismatch');
      }
      return;
    case 'owner_operation':
      access.assertCurrent();
      if (
        selected.authority.state !== 'active' ||
        selected.authority.authorityId !== access.authority.authorityId ||
        selected.authority.revocationEpoch !== access.authority.revocationEpoch ||
        selected.authMethod.status !== 'active' ||
        selected.authMethod.walletAuthMethodId !== access.authMethod.walletAuthMethodId ||
        selected.authMethod.walletId !== access.authMethod.walletId
      ) {
        throw invalidWalletSigningMaterial('binding_mismatch');
      }
      return;
    default:
      access satisfies never;
      throw new Error('Unsupported passkey material access');
  }
}

export async function prepareExactPasskeyEd25519YaoLocalMaterialRehydration(
  input: Parameters<typeof preparePasskeyEd25519YaoLocalMaterialRehydrationV1>[0],
): Promise<Awaited<ReturnType<typeof preparePasskeyEd25519YaoLocalMaterialRehydrationV1>>> {
  try {
    return await preparePasskeyEd25519YaoLocalMaterialRehydrationV1(input);
  } catch {
    throw invalidWalletSigningMaterial('binding_mismatch');
  }
}

async function hydrateExactPasskeyEd25519YaoLocalMaterial(
  input: Parameters<typeof hydratePasskeyEd25519YaoLocalMaterialV1>[0],
): Promise<Awaited<ReturnType<typeof hydratePasskeyEd25519YaoLocalMaterialV1>>> {
  try {
    return await hydratePasskeyEd25519YaoLocalMaterialV1(input);
  } catch {
    throw invalidWalletSigningMaterial('corrupt');
  }
}

export type PrepareNearEd25519YaoMaterialBoundaryInput = Parameters<
  NearSigningApiDeps['prepareNearEd25519YaoMaterialBoundary']
>[0];

export function nearEd25519MaterialIdentityFromBoundaryInput(
  input: PrepareNearEd25519YaoMaterialBoundaryInput,
): NearEd25519MaterialIdentity {
  if (input.laneIdentity !== undefined) {
    return {
      kind: 'near_ed25519_material_identity',
      signer: input.laneIdentity.signer,
      auth: input.laneIdentity.auth,
      thresholdSessionId: input.laneIdentity.thresholdSessionId,
    };
  }
  return input.materialIdentity;
}

export function nearEd25519SignerFromBoundaryInput(
  input: PrepareNearEd25519YaoMaterialBoundaryInput,
): NearEd25519SignerBinding {
  return nearEd25519MaterialIdentityFromBoundaryInput(input).signer;
}

function nearEd25519ThresholdSessionIdFromBoundaryInput(
  input: PrepareNearEd25519YaoMaterialBoundaryInput,
): string {
  return String(nearEd25519MaterialIdentityFromBoundaryInput(input).thresholdSessionId);
}

export function validateExactNearEd25519YaoOperationMaterial(args: {
  material: NearEd25519YaoOperationMaterial;
  input: PrepareNearEd25519YaoMaterialBoundaryInput;
  expectedActivation: MpcMaterialActivationRef;
}): NearEd25519YaoOperationMaterial {
  const facts = args.material.facts;
  const metadata = args.material.activeClient.metadata();
  const thresholdSessionId = nearEd25519ThresholdSessionIdFromBoundaryInput(args.input);
  const expectedSigner = nearEd25519SignerFromBoundaryInput(args.input);
  const actualSigner = facts.signer;
  if (String(facts.thresholdSessionId) !== thresholdSessionId) {
    throw new Error('[SigningEngine][near] active Ed25519 Yao capability session mismatch');
  }
  if (metadata.scope.threshold_session_id !== String(facts.thresholdSessionId)) {
    throw new Error('[SigningEngine][near] active Ed25519 Yao metadata session mismatch');
  }
  if (
    metadata.scope.account_id !== String(args.input.walletId) ||
    metadata.applicationBinding.wallet_id !== String(args.input.walletId)
  ) {
    throw new Error('[SigningEngine][near] active Ed25519 Yao capability subject mismatch');
  }
  if (
    String(actualSigner.account.wallet.walletId) !==
      String(expectedSigner.account.wallet.walletId) ||
    String(actualSigner.account.nearAccountId) !== String(expectedSigner.account.nearAccountId) ||
    actualSigner.signerSlot !== expectedSigner.signerSlot ||
    String(actualSigner.nearEd25519SigningKeyId) !== String(expectedSigner.nearEd25519SigningKeyId)
  ) {
    throw new Error('[SigningEngine][near] active Ed25519 Yao capability signer mismatch');
  }
  const materialActivation = nearEd25519YaoMaterialActivationFromMetadata(metadata);
  if (!mpcMaterialActivationRefsEqual(args.expectedActivation, materialActivation)) {
    throw new Error('[SigningEngine][near] active Ed25519 Yao capability activation mismatch');
  }
  return args.material;
}

export async function rehydratePreparedPasskeyEd25519YaoOperationStepUp(
  prepared: {
    input: PrepareNearEd25519YaoMaterialBoundaryInput;
    access: PasskeyEd25519MaterialAccess;
    identity: Ed25519YaoLocalMaterialIdentity;
    facts: NearEd25519YaoOperationMaterialFacts;
    authority: WalletAuthAuthorityRef;
    rpId: string;
    credentialIdB64u: string;
    publicLocator: PasskeyEd25519YaoPublicLocatorObservationV1;
    materialActivation: MpcMaterialActivationRef;
  },
  credential: WebAuthnAuthenticationCredential,
): Promise<NearEd25519YaoOperationMaterial> {
  const selected = await IndexedDBManager.resolveSelectedWalletAuthority(
    String(prepared.input.walletId),
  );
  if (selected.kind !== 'resolved') throw invalidWalletSigningMaterial('binding_mismatch');
  assertPasskeyEd25519MaterialAccess(prepared.access, selected);
  const credentialIdB64u = String(credential.rawId || credential.id || '').trim();
  if (credentialIdB64u !== prepared.credentialIdB64u) {
    throw invalidWalletSigningMaterial('binding_mismatch');
  }
  const secretSource = buildThresholdEd25519WebAuthnPrfSecretSource({
    credential,
    rpId: prepared.rpId,
  });
  const hydrated = await hydrateExactPasskeyEd25519YaoLocalMaterial({
    store: IndexedDBManager,
    identity: prepared.identity,
    authority: prepared.authority,
    publicLocator: prepared.publicLocator,
    unlockSource: {
      kind: 'available',
      passkeyPrfFirstB64u: secretSource.secretSource.prfFirstB64u,
    },
    liveMaterial: null,
  });
  if (hydrated.kind === 'blocked') {
    throw walletSigningMaterialBlockError(hydrated.plan.reason);
  }
  if (hydrated.kind !== 'rehydrated') {
    throw invalidWalletSigningMaterial('corrupt');
  }
  if (
    !mpcMaterialActivationRefsEqual(prepared.materialActivation, hydrated.plan.materialActivation)
  ) {
    hydrated.activeClient.dispose();
    throw invalidWalletSigningMaterial('binding_mismatch');
  }
  const material = {
    activeClient: hydrated.activeClient,
    facts: prepared.facts,
  };
  try {
    const current = await IndexedDBManager.resolveSelectedWalletAuthority(
      String(prepared.input.walletId),
    );
    if (current.kind !== 'resolved') throw invalidWalletSigningMaterial('binding_mismatch');
    assertPasskeyEd25519MaterialAccess(prepared.access, current);
    return validateExactNearEd25519YaoOperationMaterial({
      material,
      input: prepared.input,
      expectedActivation: prepared.materialActivation,
    });
  } catch {
    material.activeClient.dispose();
    throw invalidWalletSigningMaterial('binding_mismatch');
  }
}

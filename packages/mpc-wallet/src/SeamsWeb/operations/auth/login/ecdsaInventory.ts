import type { WalletAuthMethod } from '@/core/types/seams';
import type { LoginWebContext, WalletSessionWebContext } from '@/SeamsWeb/signingSurface/types';
import type { WebAuthnAuthenticationCredential } from '@/core/types';
import { IndexedDBManager } from '@/core/indexedDB';
import { listBrowserCanonicalEcdsaSigningCapabilitiesForWallet } from '@/SeamsWeb/assembly/browserSigningSurfaceAssembly';
import {
  fetchWalletEcdsaKeyFactsInventoryWithOperationCredential,
  fetchWalletEcdsaKeyFactsInventoryWithWebAuthn,
  type WalletEcdsaKeyFactsInventoryResponse,
  type WalletEcdsaKeyFactsInventoryTarget,
} from '@/core/rpcClients/relayer/walletRegistration';
import type { AccountSignerRecord } from '@/core/indexedDB/passkeyClientDB.types';
import { type ThresholdRuntimePolicyScope } from '@/core/signingEngine/threshold/sessionPolicy';
import { listConfiguredThresholdEcdsaPublicationTargets } from '@/SeamsWeb/operations/session/thresholdEcdsaProvisioning';
import {
  thresholdEcdsaChainTargetKey,
  type ThresholdEcdsaChainTarget,
  type WalletId,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { RouterAbEcdsaDerivationPublicCapabilityV1 } from '@shared/utils/routerAbEcdsaDerivation';
import {
  buildBaseEvmFamilyEcdsaKeyIdentity,
  evmFamilyEcdsaWalletKeyToIdentity,
  resolveThresholdSigningRootBindingFromRuntimePolicyScope,
} from '@/core/signingEngine/session/identity/evmFamilyEcdsaIdentity';
import {
  buildConfiguredTargetKeyCompletion,
  collectConfiguredTargetThresholdEcdsaWarmKeys,
  configuredTargetThresholdEcdsaWarmKey,
  parseActiveEcdsaSignerRecordForUnlock,
  planUnlockEcdsaWarmup,
  type ActiveEcdsaSignerRecord,
  type BlockedEcdsaSignerRecord,
  type CanonicalThresholdEcdsaWarmSessionContext,
  type ConfiguredTargetThresholdEcdsaWarmKey,
  type KeyFactsInventoryRequiredEcdsaSignerRecord,
} from '@/core/signingEngine/session/passkey/unlockEcdsaWarmupPlanner';
import type { ThresholdEcdsaKeyIdentityInventoryEntry } from '@/core/signingEngine/session/passkey/ecdsaKeyFactsInventory';
import { computeWalletEcdsaKeyFactsInventoryChallengeDigestB64u } from '@shared/utils/ecdsaKeyFactsInventory';
import { createLocalUnlockChallengeB64u } from '@/SeamsWeb/operations/authMethods/passkey/localUnlock';
import type { LoginEcdsaKeyFactsInventoryAuthority } from './unlockPlanning';
import type { ConfiguredThresholdEcdsaPublicationTarget } from './passkeyExchange';
import {
  sameThresholdRuntimePolicyScope,
  mergeThresholdEcdsaWarmSessionContexts,
} from './signerState';

function normalizeEvmOwnerAddress(value: unknown): string {
  const candidate = String(value || '')
    .trim()
    .toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(candidate) ? candidate : '';
}

async function readProfileContinuityThresholdEcdsaWalletKeys(
  context: WalletSessionWebContext,
  walletId: WalletId,
): Promise<ActiveEcdsaSignerRecord['walletKey'][]> {
  const configuredTargets = listConfiguredThresholdEcdsaPublicationTargets(
    context.configs.network.chains,
  ).map((target) => target.chainTarget);
  if (!configuredTargets.length) return [];
  const walletSigners = await IndexedDBManager.listAccountSignersByProfile({
    profileId: String(walletId),
    status: 'active',
  }).catch(() => []);
  const walletKeys: ActiveEcdsaSignerRecord['walletKey'][] = [];
  for (const signer of walletSigners) {
    const parsed = parseActiveEcdsaSignerRecordForUnlock({
      walletId,
      configuredTargets,
      signer,
    });
    if (parsed.kind === 'active_ecdsa_signer_record') {
      walletKeys.push(parsed.walletKey);
    }
  }
  return walletKeys;
}

async function resolveProfileContinuityThresholdEcdsaEthereumAddress(
  context: WalletSessionWebContext,
  walletId: WalletId,
): Promise<string | null> {
  const addresses = [
    ...new Set(
      (await readProfileContinuityThresholdEcdsaWalletKeys(context, walletId))
        .map((walletKey) => normalizeEvmOwnerAddress(walletKey.keyFacts.thresholdOwnerAddress))
        .filter(Boolean),
    ),
  ];
  if (addresses.length === 1) return addresses[0]!;
  if (addresses.length > 1) {
    console.warn('[WalletSession] conflicting profile threshold ECDSA addresses', {
      walletId: String(walletId),
      addresses,
    });
  }
  return null;
}

async function resolveWalletEcdsaKeyFactsInventoryWithWebAuthn(args: {
  walletId: WalletId;
  relayerUrl: string;
  rpId: string;
  keyTargets: readonly WalletEcdsaKeyFactsInventoryTarget[];
  runtimePolicyScope?: ThresholdRuntimePolicyScope;
  collectCredential?: (challengeB64u: string) => Promise<WebAuthnAuthenticationCredential>;
}) {
  if (!args.collectCredential) {
    throw new Error('[login] WebAuthn ECDSA key-facts inventory requires a credential collector');
  }
  const serverNonceB64u = createLocalUnlockChallengeB64u();
  const expectedChallengeDigestB64u = await computeWalletEcdsaKeyFactsInventoryChallengeDigestB64u({
    walletId: args.walletId,
    rpId: args.rpId,
    keyTargets: args.keyTargets,
    serverNonceB64u,
    ...(args.runtimePolicyScope ? { runtimePolicyScope: args.runtimePolicyScope } : {}),
  });
  const credential = await args.collectCredential(expectedChallengeDigestB64u);
  return await fetchWalletEcdsaKeyFactsInventoryWithWebAuthn({
    relayerUrl: args.relayerUrl,
    walletId: args.walletId,
    rpId: args.rpId,
    credential,
    keyTargets: args.keyTargets,
    serverNonceB64u,
    expectedChallengeDigestB64u,
    ...(args.runtimePolicyScope ? { runtimePolicyScope: args.runtimePolicyScope } : {}),
  });
}

async function resolveWalletEcdsaKeyFactsInventoryForLogin(args: {
  walletId: WalletId;
  relayerUrl: string;
  rpId: string;
  keyTargets: readonly WalletEcdsaKeyFactsInventoryTarget[];
  authority: LoginEcdsaKeyFactsInventoryAuthority | null;
  runtimePolicyScope?: ThresholdRuntimePolicyScope;
  collectWebAuthnInventoryCredential?: (
    challengeB64u: string,
  ) => Promise<WebAuthnAuthenticationCredential>;
}): Promise<WalletEcdsaKeyFactsInventoryResponse> {
  const relayerUrl = String(args.relayerUrl || '').trim();
  const rpId = String(args.rpId || '').trim();
  if (!relayerUrl || !rpId) {
    throw new Error('[login] threshold ECDSA key-facts inventory requires relayerUrl and rpId');
  }
  if (args.authority?.kind === 'wallet_session_operation_credential_v1') {
    return await fetchWalletEcdsaKeyFactsInventoryWithOperationCredential({
      relayerUrl,
      walletId: args.walletId,
      rpId,
      operationCredential: args.authority.operationCredential,
      keyTargets: args.keyTargets,
    });
  }
  return await resolveWalletEcdsaKeyFactsInventoryWithWebAuthn({
    walletId: args.walletId,
    relayerUrl,
    rpId,
    keyTargets: args.keyTargets,
    ...(args.runtimePolicyScope ? { runtimePolicyScope: args.runtimePolicyScope } : {}),
    collectCredential: args.collectWebAuthnInventoryCredential,
  });
}

type AuthenticatedEcdsaInventoryProfileRepairStore = Pick<
  typeof IndexedDBManager,
  'activateAccountSigner'
>;

function authenticatedInventorySignerMatch(args: {
  walletId: WalletId;
  configuredTargets: readonly ThresholdEcdsaChainTarget[];
  signer: AccountSignerRecord;
  record: ThresholdEcdsaKeyIdentityInventoryEntry;
}): boolean {
  const parsed = parseActiveEcdsaSignerRecordForUnlock({
    walletId: args.walletId,
    configuredTargets: args.configuredTargets,
    signer: args.signer,
  });
  switch (parsed.kind) {
    case 'active_ecdsa_signer_record':
      return (
        parsed.targetKey === thresholdEcdsaChainTargetKey(args.record.walletKey.chainTarget) &&
        String(parsed.walletKey.keyHandle) === String(args.record.walletKey.keyHandle)
      );
    case 'key_facts_inventory_required':
      return (
        parsed.targetKey === thresholdEcdsaChainTargetKey(args.record.walletKey.chainTarget) &&
        parsed.keyHandle === String(args.record.walletKey.keyHandle)
      );
    case 'blocked':
    case 'skipped':
      return false;
  }
  parsed satisfies never;
  return false;
}

function repairedEcdsaSignerMetadata(args: {
  signer: AccountSignerRecord;
  record: ThresholdEcdsaKeyIdentityInventoryEntry;
}): Record<string, unknown> {
  const walletKey = args.record.walletKey;
  const keyFacts = walletKey.keyFacts;
  const targetKey = thresholdEcdsaChainTargetKey(walletKey.chainTarget);
  return {
    ...(args.signer.metadata || {}),
    accountModel: 'threshold-ecdsa',
    accountAddress: args.record.accountAddress,
    ownerAddress: args.record.ownerAddress,
    thresholdOwnerAddress: keyFacts.thresholdOwnerAddress,
    keyScope: keyFacts.keyScope,
    keyHandle: walletKey.keyHandle,
    walletId: walletKey.walletId,
    ecdsaThresholdKeyId: keyFacts.ecdsaThresholdKeyId,
    signingRootId: keyFacts.signingRootId,
    signingRootVersion: keyFacts.signingRootVersion,
    publicCapability: args.record.publicCapability,
    thresholdEcdsaPublicKeyB64u: keyFacts.thresholdEcdsaPublicKeyB64u,
    participantIds: [...keyFacts.participantIds],
    chainTarget: walletKey.chainTarget,
    targetMembership: {
      targetKey,
      chainTarget: walletKey.chainTarget,
    },
    sharedEvmFamilyKey: {
      walletId: walletKey.walletId,
      keyScope: keyFacts.keyScope,
      keyHandle: walletKey.keyHandle,
      ecdsaThresholdKeyId: keyFacts.ecdsaThresholdKeyId,
      signingRootId: keyFacts.signingRootId,
      signingRootVersion: keyFacts.signingRootVersion,
      participantIds: [...keyFacts.participantIds],
      thresholdOwnerAddress: keyFacts.thresholdOwnerAddress,
      thresholdEcdsaPublicKeyB64u: keyFacts.thresholdEcdsaPublicKeyB64u,
    },
    chainId: walletKey.chainTarget.chainId,
  };
}

async function persistAuthenticatedEcdsaInventoryProfileRepairs(args: {
  store: AuthenticatedEcdsaInventoryProfileRepairStore;
  walletId: WalletId;
  configuredTargets: readonly ThresholdEcdsaChainTarget[];
  walletSigners: readonly AccountSignerRecord[];
  records: readonly ThresholdEcdsaKeyIdentityInventoryEntry[];
}): Promise<void> {
  for (const record of args.records) {
    const matchingSigners = args.walletSigners.filter((signer) =>
      authenticatedInventorySignerMatch({
        walletId: args.walletId,
        configuredTargets: args.configuredTargets,
        signer,
        record,
      }),
    );
    if (matchingSigners.length !== 1) {
      throw new Error(
        `[login] authenticated ECDSA key inventory could not identify one profile signer for ${thresholdEcdsaChainTargetKey(record.walletKey.chainTarget)}`,
      );
    }
    const signer = matchingSigners[0]!;
    if (
      String(record.walletKey.walletId) !== String(args.walletId) ||
      record.accountAddress !== signer.accountAddress ||
      record.ownerAddress !== signer.accountAddress ||
      String(record.walletKey.keyFacts.thresholdOwnerAddress) !== signer.accountAddress
    ) {
      throw new Error(
        `[login] authenticated ECDSA key inventory profile identity mismatch for ${thresholdEcdsaChainTargetKey(record.walletKey.chainTarget)}`,
      );
    }
    await args.store.activateAccountSigner({
      account: {
        profileId: signer.profileId,
        chainIdKey: signer.chainIdKey,
        accountAddress: signer.accountAddress,
        accountModel: 'threshold-ecdsa',
      },
      signer: {
        signerId: signer.signerId,
        signerType: signer.signerType,
        signerKind: signer.signerKind,
        signerAuthMethod: signer.signerAuthMethod,
        signerSource: signer.signerSource,
        metadata: repairedEcdsaSignerMetadata({ signer, record }),
      },
      activationPolicy: { mode: 'allocate_next_free' },
      preferredSlot: signer.signerSlot,
      selectAsActive: false,
      mutation: { routeThroughOutbox: false },
    });
  }
}

type LoginEcdsaKeyFactsInventoryInput = {
  keyFactsInventoryAuthority: LoginEcdsaKeyFactsInventoryAuthority | null;
  keyFactsInventoryRequested: boolean;
  relayerUrl: string;
  rpId: string;
  collectWebAuthnInventoryCredential?: (
    challengeB64u: string,
  ) => Promise<WebAuthnAuthenticationCredential>;
};

type ProfileContinuityEcdsaInventoryInput = LoginEcdsaKeyFactsInventoryInput &
  (
    | {
        kind: 'runtime_policy_scoped';
        runtimePolicyScope: ThresholdRuntimePolicyScope;
      }
    | {
        kind: 'runtime_policy_unscoped';
        runtimePolicyScope?: never;
      }
  );

function buildCanonicalThresholdEcdsaWarmSessionContext(
  ecdsaKeys: ConfiguredTargetThresholdEcdsaWarmKey[],
  runtimePolicyScope: ThresholdRuntimePolicyScope | undefined,
): CanonicalThresholdEcdsaWarmSessionContext {
  if (runtimePolicyScope) {
    return {
      ecdsaKeys,
      runtimePolicyScope,
    };
  }
  return { ecdsaKeys };
}

function buildProfileContinuityEcdsaInventoryInput(args: {
  input: LoginEcdsaKeyFactsInventoryInput | undefined;
  runtimePolicyScope: ThresholdRuntimePolicyScope | undefined;
}): ProfileContinuityEcdsaInventoryInput {
  const keyFactsInventoryAuthority = args.input?.keyFactsInventoryAuthority || null;
  const keyFactsInventoryRequested = args.input?.keyFactsInventoryRequested === true;
  const relayerUrl = args.input?.relayerUrl || '';
  const rpId = args.input?.rpId || '';
  const collectWebAuthnInventoryCredential = args.input?.collectWebAuthnInventoryCredential;
  if (args.runtimePolicyScope) {
    return {
      kind: 'runtime_policy_scoped',
      keyFactsInventoryAuthority,
      keyFactsInventoryRequested,
      relayerUrl,
      rpId,
      runtimePolicyScope: args.runtimePolicyScope,
      collectWebAuthnInventoryCredential,
    };
  }
  return {
    kind: 'runtime_policy_unscoped',
    keyFactsInventoryAuthority,
    keyFactsInventoryRequested,
    relayerUrl,
    rpId,
    collectWebAuthnInventoryCredential,
  };
}

async function resolveProfileContinuityEcdsaWarmKeys(
  walletId: WalletId,
  configuredTargets: readonly ConfiguredThresholdEcdsaPublicationTarget[],
  keyFactsInventoryInput?: ProfileContinuityEcdsaInventoryInput,
): Promise<ConfiguredTargetThresholdEcdsaWarmKey[]> {
  const configuredChainTargets = configuredTargets.map((target) => target.chainTarget);
  const walletSigners = await IndexedDBManager.listAccountSignersByProfile({
    profileId: String(walletId),
    status: 'active',
  }).catch(() => []);
  const activeSignerRecords: ActiveEcdsaSignerRecord[] = [];
  const keyFactsInventoryRequiredRecords: KeyFactsInventoryRequiredEcdsaSignerRecord[] = [];
  const blockedRecords: BlockedEcdsaSignerRecord[] = [];
  for (const signer of walletSigners) {
    const parsed = parseActiveEcdsaSignerRecordForUnlock({
      walletId,
      configuredTargets: configuredChainTargets,
      signer,
    });
    switch (parsed.kind) {
      case 'active_ecdsa_signer_record':
        activeSignerRecords.push(parsed);
        break;
      case 'key_facts_inventory_required':
        keyFactsInventoryRequiredRecords.push(parsed);
        break;
      case 'blocked':
        blockedRecords.push(parsed);
        break;
      case 'skipped':
        break;
      default:
        parsed satisfies never;
    }
  }
  if (
    !activeSignerRecords.length &&
    !keyFactsInventoryRequiredRecords.length &&
    !blockedRecords.length
  ) {
    return [];
  }
  const plan = planUnlockEcdsaWarmup({
    selection: { mode: 'ecdsa_only', ecdsa: true },
    configuredTargets: configuredChainTargets,
    activeSignerRecords,
    keyFactsInventoryRequiredRecords,
    blockedRecords,
    runtimeConfig: {
      explicitKeyFactsInventoryMode: keyFactsInventoryInput?.keyFactsInventoryRequested === true,
      allowAuthenticatedKeyFactsInventory: Boolean(
        keyFactsInventoryInput?.keyFactsInventoryAuthority,
      ),
    },
  });
  switch (plan.kind) {
    case 'ready': {
      const missingCapabilityTargets = plan.readyTargets.filter(
        (target) => target.publicCapability.kind === 'missing_public_capability',
      );
      const repairedCapabilities = new Map<string, RouterAbEcdsaDerivationPublicCapabilityV1>();
      let repairedInventoryRecords: readonly ThresholdEcdsaKeyIdentityInventoryEntry[] = [];
      if (missingCapabilityTargets.length) {
        const inventory = await resolveWalletEcdsaKeyFactsInventoryForLogin({
          walletId,
          relayerUrl: keyFactsInventoryInput?.relayerUrl || '',
          rpId: keyFactsInventoryInput?.rpId || '',
          keyTargets: missingCapabilityTargets.map((target) => ({
            keyHandle: target.walletKey.keyHandle,
            chainTarget: target.chainTarget,
          })),
          authority: keyFactsInventoryInput?.keyFactsInventoryAuthority || null,
          ...(keyFactsInventoryInput?.runtimePolicyScope
            ? { runtimePolicyScope: keyFactsInventoryInput.runtimePolicyScope }
            : {}),
          collectWebAuthnInventoryCredential:
            keyFactsInventoryInput?.collectWebAuthnInventoryCredential,
        });
        repairedInventoryRecords = inventory.records;
        for (const record of inventory.records) {
          repairedCapabilities.set(
            thresholdEcdsaChainTargetKey(record.walletKey.chainTarget),
            record.publicCapability,
          );
        }
      }
      const keys = plan.readyTargets.map((target) =>
        configuredTargetThresholdEcdsaWarmKey({
          chainTarget: target.chainTarget,
          keyHandle: target.walletKey.keyHandle,
          key: evmFamilyEcdsaWalletKeyToIdentity(target.walletKey),
          publicCapability:
            target.publicCapability.kind === 'persisted_public_capability'
              ? target.publicCapability.value
              : repairedCapabilities.get(target.targetKey),
        }),
      );
      const canonicalKeys = collectConfiguredTargetThresholdEcdsaWarmKeys({
        source: 'profile continuity',
        keys,
      });
      const unresolvedCapabilities = canonicalKeys
        .filter((key) => key.publicCapability.kind === 'missing_public_capability')
        .map((key) => key.targetKey);
      if (unresolvedCapabilities.length) {
        throw new Error(
          `[login] authenticated ECDSA key inventory did not return public capabilities for ${unresolvedCapabilities.join(', ')}`,
        );
      }
      await persistAuthenticatedEcdsaInventoryProfileRepairs({
        store: IndexedDBManager,
        walletId,
        configuredTargets: configuredChainTargets,
        walletSigners,
        records: repairedInventoryRecords,
      });
      return canonicalKeys;
    }
    case 'no_configured_ecdsa_targets':
      return [];
    case 'awaiting_authenticated_key_facts_inventory': {
      const keyFactsInventoryAuthority = keyFactsInventoryInput?.keyFactsInventoryAuthority;
      if (!keyFactsInventoryAuthority) {
        throw new Error(
          '[login] threshold ECDSA key-facts inventory requires authenticated inventory authority',
        );
      }
      const inventory = await resolveWalletEcdsaKeyFactsInventoryForLogin({
        walletId,
        relayerUrl: keyFactsInventoryInput.relayerUrl,
        rpId: keyFactsInventoryInput.rpId,
        keyTargets: plan.keyTargets,
        authority: keyFactsInventoryAuthority,
        ...(keyFactsInventoryInput.runtimePolicyScope
          ? { runtimePolicyScope: keyFactsInventoryInput.runtimePolicyScope }
          : {}),
        collectWebAuthnInventoryCredential:
          keyFactsInventoryInput.collectWebAuthnInventoryCredential,
      });
      const inventoriedKeys = collectConfiguredTargetThresholdEcdsaWarmKeys({
        source: 'profile continuity inventory',
        keys: inventory.records.map((record) =>
          configuredTargetThresholdEcdsaWarmKey({
            chainTarget: record.walletKey.chainTarget,
            keyHandle: record.walletKey.keyHandle,
            key: evmFamilyEcdsaWalletKeyToIdentity(record.walletKey),
            publicCapability: record.publicCapability,
          }),
        ),
      });
      const inventoriedCompletion = buildConfiguredTargetKeyCompletion({
        context: { ecdsaKeys: inventoriedKeys },
        configuredTargets,
      });
      if (inventoriedCompletion.kind !== 'complete_configured_target_keys') {
        throw new Error(
          '[login] threshold ECDSA key-facts inventory returned incomplete key facts',
        );
      }
      await persistAuthenticatedEcdsaInventoryProfileRepairs({
        store: IndexedDBManager,
        walletId,
        configuredTargets: configuredChainTargets,
        walletSigners,
        records: inventory.records,
      });
      return inventoriedCompletion.context.ecdsaKeys;
    }
    case 'key_facts_inventory_required': {
      const targets = plan.keyFactsInventoryRequiredRecords
        .map((record) => record.targetKey)
        .join(', ');
      if (keyFactsInventoryInput?.keyFactsInventoryRequested) {
        throw new Error(
          `[login] threshold ECDSA key-facts inventory requires authenticated inventory authority for ${targets}`,
        );
      }
      throw new Error(
        `[login] threshold ECDSA warm-up requires complete local key facts for ${targets}; run explicit authenticated ECDSA key-facts inventory before unlock`,
      );
    }
    case 'blocked': {
      const reasons = plan.blockedRecords
        .map((record) => `${record.targetKey || 'unknown'}:${record.reason}`)
        .join(', ');
      throw new Error(
        `[login] threshold ECDSA warm-up requires complete local key facts before unlock; run explicit authenticated ECDSA key-facts inventory before unlock; blocked profile signer records: ${reasons}`,
      );
    }
  }
  plan satisfies never;
  return [];
}

export async function resolveCanonicalThresholdEcdsaWarmSessionContext(
  context: LoginWebContext,
  walletId: WalletId,
  keyFactsInventoryInput?: LoginEcdsaKeyFactsInventoryInput,
  /**
   * Sibling auth methods hold their own access projections over one
   * activation, so a wallet-wide read returns a lane per method. Warming has to
   * name the method being unlocked, or it warms the sibling's lane and the
   * Wallet Session is minted against a credential the user is not presenting.
   */
  authMethod?: WalletAuthMethod,
): Promise<CanonicalThresholdEcdsaWarmSessionContext> {
  const configuredTargets = listConfiguredThresholdEcdsaPublicationTargets(
    context.configs.network.chains,
  );
  const storedKeys: ConfiguredTargetThresholdEcdsaWarmKey[] = [];
  let runtimePolicyScope: ThresholdRuntimePolicyScope | undefined;
  const exactStoredKeys = collectConfiguredTargetThresholdEcdsaWarmKeys({
    source: 'stored',
    keys: storedKeys,
  });
  let canonicalContext = buildCanonicalThresholdEcdsaWarmSessionContext(
    exactStoredKeys,
    runtimePolicyScope,
  );
  const capabilities = await listBrowserCanonicalEcdsaSigningCapabilitiesForWallet({
    walletId,
    chainTargets: configuredTargets.map((target) => target.chainTarget),
    ...(authMethod ? { authMethod } : {}),
  });
  const availableLaneKeys: ConfiguredTargetThresholdEcdsaWarmKey[] = [];
  let availableLaneRuntimePolicyScope: ThresholdRuntimePolicyScope | undefined;
  for (const capability of capabilities) {
    const manifest = capability.manifest;
    for (const { chainTarget: target } of configuredTargets) {
      const includesTarget = manifest.signer.scope.targetMemberships.some(
        (membership) =>
          thresholdEcdsaChainTargetKey(membership) === thresholdEcdsaChainTargetKey(target),
      );
      if (!includesTarget) continue;
      const publicFacts = manifest.durableMaterial.roleLocalPublicFacts;
      const keyHandle = String(publicFacts.keyHandle);
      const publicCapability = publicFacts.publicCapability;
      const existingRoleLocalMaterial = capability.material;
      const laneRuntimePolicyScope = manifest.durableMaterial.runtimePolicyScope;
      const signingRootBinding = resolveThresholdSigningRootBindingFromRuntimePolicyScope({
        runtimePolicyScope: laneRuntimePolicyScope,
      });
      if (
        String(signingRootBinding.signingRootId) !== String(manifest.signer.signingRootId) ||
        String(signingRootBinding.signingRootVersion) !== String(manifest.signer.signingRootVersion)
      ) {
        throw new Error(
          `[login] threshold ECDSA canonical runtime policy scope mismatch for ${thresholdEcdsaChainTargetKey(target)}`,
        );
      }
      if (
        availableLaneRuntimePolicyScope &&
        laneRuntimePolicyScope &&
        !sameThresholdRuntimePolicyScope(availableLaneRuntimePolicyScope, laneRuntimePolicyScope)
      ) {
        throw new Error(
          '[login] threshold ECDSA durable lanes have conflicting runtime policy scopes',
        );
      }
      if (!availableLaneRuntimePolicyScope && laneRuntimePolicyScope) {
        availableLaneRuntimePolicyScope = laneRuntimePolicyScope;
      }
      availableLaneKeys.push(
        configuredTargetThresholdEcdsaWarmKey({
          chainTarget: target,
          keyHandle,
          key: buildBaseEvmFamilyEcdsaKeyIdentity({
            walletId: manifest.signer.walletId,
            ecdsaThresholdKeyId: manifest.durableMaterial.roleLocalBinding.ecdsaThresholdKeyId,
            signingRootId: manifest.signer.signingRootId,
            signingRootVersion: manifest.signer.signingRootVersion,
            participantIds: manifest.signer.registeredPublicFacts.participantIds,
            thresholdOwnerAddress: manifest.signer.registeredPublicFacts.thresholdOwnerAddress,
          }),
          publicCapability,
          existingRoleLocalMaterial,
        }),
      );
    }
  }
  const exactAvailableLaneKeys = collectConfiguredTargetThresholdEcdsaWarmKeys({
    source: 'available lane',
    keys: availableLaneKeys,
  });
  canonicalContext = mergeThresholdEcdsaWarmSessionContexts({
    current: canonicalContext,
    incoming: buildCanonicalThresholdEcdsaWarmSessionContext(
      exactAvailableLaneKeys,
      availableLaneRuntimePolicyScope,
    ),
    source: 'durable lanes',
  });
  const configuredTargetCompletion = buildConfiguredTargetKeyCompletion({
    context: canonicalContext,
    configuredTargets,
  });
  if (configuredTargetCompletion.kind === 'complete_configured_target_keys') {
    return configuredTargetCompletion.context;
  }
  const missingTargets = new Set(configuredTargetCompletion.missingTargets);
  const missingConfiguredTargets = configuredTargets.filter((target) =>
    missingTargets.has(thresholdEcdsaChainTargetKey(target.chainTarget)),
  );
  const profileEcdsaThresholdKeys = await resolveProfileContinuityEcdsaWarmKeys(
    walletId,
    missingConfiguredTargets,
    buildProfileContinuityEcdsaInventoryInput({
      input: keyFactsInventoryInput,
      runtimePolicyScope: canonicalContext.runtimePolicyScope,
    }),
  );
  canonicalContext = mergeThresholdEcdsaWarmSessionContexts({
    current: canonicalContext,
    incoming: {
      ecdsaKeys: profileEcdsaThresholdKeys,
    },
    source: 'profile continuity',
  });
  return canonicalContext;
}

async function resolveProfileContinuityThresholdEcdsaPublicKeyB64u(
  context: WalletSessionWebContext,
  walletId: WalletId,
): Promise<string | null> {
  const publicKeys = [
    ...new Set(
      (await readProfileContinuityThresholdEcdsaWalletKeys(context, walletId))
        .map((walletKey) => String(walletKey.keyFacts.thresholdEcdsaPublicKeyB64u || '').trim())
        .filter(Boolean),
    ),
  ];
  if (publicKeys.length === 1) return publicKeys[0]!;
  if (publicKeys.length > 1) {
    console.warn('[WalletSession] conflicting profile threshold ECDSA public keys', {
      walletId: String(walletId),
      publicKeyCount: publicKeys.length,
    });
  }
  return null;
}

export async function resolveThresholdEcdsaLoginMetadata(
  context: WalletSessionWebContext,
  walletId: WalletId,
): Promise<{
  ethereumAddress: string | null;
  thresholdEcdsaPublicKeyB64u: string | null;
}> {
  const [profileAddress, profilePublicKey] = await Promise.all([
    resolveProfileContinuityThresholdEcdsaEthereumAddress(context, walletId),
    resolveProfileContinuityThresholdEcdsaPublicKeyB64u(context, walletId),
  ]);
  if (profileAddress && profilePublicKey) {
    return { ethereumAddress: profileAddress, thresholdEcdsaPublicKeyB64u: profilePublicKey };
  }
  const capabilities = await listBrowserCanonicalEcdsaSigningCapabilitiesForWallet({
    walletId,
    chainTargets: listConfiguredThresholdEcdsaPublicationTargets(
      context.configs.network.chains,
    ).map((target) => target.chainTarget),
  });
  const addresses = new Set<string>();
  const publicKeys = new Set<string>();
  for (const capability of capabilities) {
    const facts = capability.manifest.signer.registeredPublicFacts;
    addresses.add(normalizeEvmOwnerAddress(facts.thresholdOwnerAddress));
    publicKeys.add(facts.publicKeyB64u);
  }
  return {
    ethereumAddress: profileAddress ?? (addresses.size === 1 ? [...addresses][0]! : null),
    thresholdEcdsaPublicKeyB64u:
      profilePublicKey ?? (publicKeys.size === 1 ? [...publicKeys][0]! : null),
  };
}

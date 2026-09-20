import { expect, test, type Page } from '@playwright/test';
import { setupBasicPasskeyTest } from '../setup';

type DurablePresignatureBrowserResult = {
  readonly capacityAdmissionKinds: readonly string[];
  readonly admissionKinds: readonly [string, string];
  readonly concurrentTakeKinds: readonly string[];
  readonly openedPlaintextMatches: boolean;
  readonly restoredAfterThirtyDays: number;
  readonly tamperedTakeKind: string;
  readonly takeAfterTamperKind: string;
  readonly malformedRowsDeleted: number;
  readonly remainingRows: number;
};

async function runDurablePresignatureBrowserChecks(): Promise<DurablePresignatureBrowserResult> {
  const storeModule =
    await import('/_test-sdk/esm/core/indexedDB/seamsWalletDB/ecdsaCapabilityManifestStore.js');
  const managerModule = await import('/_test-sdk/esm/core/indexedDB/seamsWalletDB/manager.js');
  const schemaModule = await import('/_test-sdk/esm/core/indexedDB/schemaNames.js');
  const encoders = await import('/_test-sdk/esm/shared-ts/src/utils/base64.js');
  const digests = await import('/_test-sdk/esm/shared-ts/src/utils/digests.js');
  const ecdsaDerivation =
    await import('/_test-sdk/esm/shared-ts/src/utils/routerAbEcdsaDerivation.js');
  const normalSigningIdentity =
    await import('/_test-sdk/esm/shared-ts/src/utils/routerAbNormalSigningIdentity.js');

  const dbName = `seams_test_wallet_durable_presignature_${crypto.randomUUID()}`;
  const manager = new managerModule.SeamsWalletDBManager();
  manager.setDbName(dbName);
  const store = new storeModule.IndexedDbEcdsaCapabilityManifestStore(manager);
  const walletId = 'wallet-1';
  const capability = 'capability-1';
  const materialActivationWire = {
    kind: 'mpc_material_activation_ref',
    activation_id: 'activation-1',
    capability,
    material_owner: walletId,
    key_binding: 'key-binding-1',
    lifecycle_binding: 'lifecycle-binding-1',
    signing_worker: 'signing-worker-1',
  } as const;
  const materialActivation =
    normalSigningIdentity.routerAbMpcMaterialActivationRefFromWire(materialActivationWire);
  const scope = {
    wallet_id: walletId,
    ecdsa_threshold_key_id: 'ecdsa-key-1',
    signing_root_id: 'root-1',
    signing_root_version: 'root-v1',
    context: {
      application_binding_digest_b64u: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',
    },
    public_identity: {
      context_binding_b64u: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc',
      derivation_client_share_public_key33_b64u: 'Anm-Zn753LusVaBilc6HCwcCm_zbLc4o2VnygVsW-BeY',
      server_public_key33_b64u: 'AsYEf5RB7X1tMEVAbpXAfNhcd45LjO88p6usCblccJ7l',
      threshold_public_key33_b64u: 'AvkwigGSWMMQSTRPhfidUim1MchFg2-ZsIYB8RO84Db5',
      ethereum_address20_b64u: 'BQUFBQUFBQUFBQUFBQUFBQUFBQU',
      client_share_retry_counter: 0,
      server_share_retry_counter: 1,
    },
    material_activation: materialActivationWire,
    signing_worker: {
      server_id: 'signing-worker-1',
      key_epoch: 'worker-epoch-1',
      recipient_encryption_key:
        'x25519:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    activation_epoch: 'activation-epoch-1',
  };
  const poolIdentity = {
    relayerUrl: 'https://router.example',
    materialActivationB64u: encoders.base64UrlEncode(
      normalSigningIdentity.canonicalRouterAbMpcMaterialActivationRefBytes(materialActivationWire),
    ),
    materialActivationId: materialActivationWire.activation_id,
    capability,
    keyBinding: materialActivationWire.key_binding,
    walletId,
    signingScopeB64u: encoders.base64UrlEncode(
      ecdsaDerivation.routerAbEcdsaDerivationNormalSigningScopeCanonicalBytesV1(scope),
    ),
    pairRole: 'client' as const,
    keyEpoch: scope.signing_worker.key_epoch,
    activationEpoch: scope.activation_epoch,
    protocolId: 'seams/router-ab-ecdsa-presign/fixed-2of2/v1' as const,
  };
  const durableMaterialRef = {
    kind: 'ecdsa_role_local_persisted_material_ref_v1',
    durableMaterialRef: 'durable-material-1',
    bindingDigest: 'binding-digest-1',
    materialActivation,
  } as const;
  const sealingKeyId = 'sealing-key-1';
  const sealingKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const activeMaterial = {
    sealingKeyId,
    binding: {
      durableMaterialRef: durableMaterialRef.durableMaterialRef,
      bindingDigest: durableMaterialRef.bindingDigest,
      materialActivation,
      routerAbEcdsaDerivationNormalSigning: {
        kind: 'router_ab_ecdsa_derivation_normal_signing_v1',
        scope,
      },
    },
  };
  Object.assign(store, {
    lookupByMaterialRef: async () => ({ kind: 'active', material: activeMaterial }),
    readMaterialSealingKey: async () => sealingKey,
  });

  const materialStore = schemaModule.SEAMS_WALLET_STORES.ecdsaRoleLocalMaterial;
  const presignatureStore = schemaModule.SEAMS_WALLET_STORES.ecdsaClientPresignatures;
  await manager.runTransaction([materialStore], 'readwrite', async (context: any) => {
    await context.store(materialStore).put({
      record_version: 'ecdsa_role_local_material_v2',
      durable_material_ref: durableMaterialRef.durableMaterialRef,
      binding_digest: durableMaterialRef.bindingDigest,
      capability_ref: capability,
      wallet_id: walletId,
      authority_digest: 'authority-digest-1',
      wallet_auth_method_id: 'wallet-auth-method-1',
      sealing_key_id: sealingKeyId,
      iv: 'AA',
      ciphertext: 'AA',
    });
  });

  const groupPublicKey33 = encoders.base64UrlDecode(
    scope.public_identity.threshold_public_key33_b64u,
  );
  const bigR33 = encoders.base64UrlDecode('A_KHc8LZdSiLx9HSBcN0hlGwdfvGYQ5Yzd7t348ZQFqo');
  const dayMs = 24 * 60 * 60_000;
  const createdAtMs = Date.now() - 30 * dayMs;
  const firstPlaintext = new Uint8Array(97).fill(17);
  const firstAdmission = await store.admitClientPresignature({
    poolIdentity,
    durableMaterialRef,
    presignatureId: 'presignature-1',
    groupPublicKey33,
    bigR33,
    plaintext97: firstPlaintext,
    createdAtMs,
    expiresAtMs: createdAtMs + 90 * dayMs,
  });
  if (firstAdmission.kind !== 'stored') {
    throw new Error(`First durable presignature admission failed: ${firstAdmission.kind}`);
  }
  manager.close();
  const restoredEntries = await store.listAvailableClientPresignatures(poolIdentity);
  const restoredAfterThirtyDays = restoredEntries.length;
  const concurrentTakes = await Promise.all([
    store.takeClientPresignature({
      recordId: firstAdmission.metadata.recordId,
      poolIdentity,
    }),
    store.takeClientPresignature({
      recordId: firstAdmission.metadata.recordId,
      poolIdentity,
    }),
  ]);
  const opened = concurrentTakes.find((result: { kind: string }) => result.kind === 'opened');
  const openedPlaintextMatches =
    opened?.kind === 'opened' &&
    opened.plaintext97.every((value: number) => value === 17) &&
    opened.plaintext97.length === 97;
  if (opened?.kind === 'opened') opened.plaintext97.fill(0);

  const secondPlaintext = new Uint8Array(97).fill(29);
  const secondAdmission = await store.admitClientPresignature({
    poolIdentity,
    durableMaterialRef,
    presignatureId: 'presignature-2',
    groupPublicKey33,
    bigR33,
    plaintext97: secondPlaintext,
    createdAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
  });
  if (secondAdmission.kind !== 'stored') {
    throw new Error(`Second durable presignature admission failed: ${secondAdmission.kind}`);
  }
  const tamperedRow = await manager.runTransaction(
    [presignatureStore],
    'readonly',
    async (context: any) =>
      await context.store(presignatureStore).get(secondAdmission.metadata.recordId),
  );
  const ciphertext = encoders.base64UrlDecode(tamperedRow.sealed.ciphertext_b64u);
  ciphertext[0] ^= 1;
  tamperedRow.sealed.ciphertext_b64u = encoders.base64UrlEncode(ciphertext);
  tamperedRow.sealed.ciphertext_digest_b64u = encoders.base64UrlEncode(
    await digests.sha256Bytes(ciphertext),
  );
  await manager.runTransaction([presignatureStore], 'readwrite', async (context: any) => {
    await context.store(presignatureStore).put(tamperedRow);
  });
  const tamperedTake = await store.takeClientPresignature({
    recordId: secondAdmission.metadata.recordId,
    poolIdentity,
  });
  const takeAfterTamper = await store.takeClientPresignature({
    recordId: secondAdmission.metadata.recordId,
    poolIdentity,
  });
  const capacityAdmissions = [];
  for (let index = 0; index < 6; index += 1) {
    capacityAdmissions.push(
      store.admitClientPresignature({
        poolIdentity,
        durableMaterialRef,
        presignatureId: `capacity-${index}`,
        groupPublicKey33,
        bigR33,
        plaintext97: new Uint8Array(97).fill(index + 1),
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 90 * dayMs,
      }),
    );
  }
  const capacityAdmissionKinds = (await Promise.all(capacityAdmissions))
    .map((entry) => entry.kind)
    .sort();
  await store.deleteClientPresignatures({ kind: 'wallet', walletId });
  await manager.runTransaction([presignatureStore], 'readwrite', async (context: any) => {
    await context.store(presignatureStore).put({ record_id: 42, wallet_id: walletId });
  });
  const malformedRowsDeleted = await store.deleteClientPresignatures({
    kind: 'wallet',
    walletId,
  });
  const remainingRows = await manager.runTransaction(
    [presignatureStore],
    'readonly',
    async (context: any) => (await context.store(presignatureStore).getAll()).length,
  );

  manager.close();
  return {
    capacityAdmissionKinds,
    admissionKinds: [firstAdmission.kind, secondAdmission.kind],
    concurrentTakeKinds: concurrentTakes.map((result: { kind: string }) => result.kind).sort(),
    openedPlaintextMatches,
    restoredAfterThirtyDays,
    tamperedTakeKind: tamperedTake.kind,
    takeAfterTamperKind: takeAfterTamper.kind,
    malformedRowsDeleted,
    remainingRows,
  };
}

async function runDurablePresignatureChecks(page: Page): Promise<DurablePresignatureBrowserResult> {
  await setupBasicPasskeyTest(page);
  return await page.evaluate(runDurablePresignatureBrowserChecks);
}

test('90-day presignatures restore after 30 days and preserve single-claim and ciphertext checks', async ({
  page,
}) => {
  const result = await runDurablePresignatureChecks(page);

  expect(result.capacityAdmissionKinds).toEqual([
    'capacity_full',
    'stored',
    'stored',
    'stored',
    'stored',
    'stored',
  ]);
  expect(result.admissionKinds).toEqual(['stored', 'stored']);
  expect(result.concurrentTakeKinds).toEqual(['claimed_elsewhere', 'opened']);
  expect(result.openedPlaintextMatches).toBe(true);
  expect(result.restoredAfterThirtyDays).toBe(1);
  expect(result.tamperedTakeKind).toBe('corrupt');
  expect(result.takeAfterTamperKind).toBe('claimed_elsewhere');
  expect(result.malformedRowsDeleted).toBe(1);
  expect(result.remainingRows).toBe(0);
});

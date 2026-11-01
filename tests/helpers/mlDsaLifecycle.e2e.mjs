import assert from 'node:assert/strict';
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { GatewayTransport, signingAssertion } from './mlDsaPublicSigning.e2e.mjs';

const origin = 'https://wallet.example.test';
const relayerUrl = 'https://gateway.example.test';

async function activatedAuthority(input, kind, key, label, permissions, signerSet) {
  const original = input.owner.authority.signerActivations.ed25519.signer;
  const fixture = await input.api.buildLinkedDeviceManagementAuthorityFixture({
    label,
    provenance: kind,
    permissions,
    keyFamily: signerSet === 'wallet_signers' ? 'ed25519' : signerSet,
    sourceAuthorityId: input.owner.authority.authorityId,
    ed25519Signer: original,
    credentialPublicKeyB64u: key.publicKey,
    identity: {
      walletId: input.walletId,
      authorityId: `authority:${label}`,
      walletAuthMethodId: `wallet-auth-method:${label}`,
      rpId: 'wallet.example.test',
      credentialIdB64u: key.credentialId,
    },
  });
  if (signerSet === 'wallet_signers') {
    const store = new input.api.D1WalletAuthorityStore({
      database: input.database,
      scope: input.scope,
    });
    const source = await store.readById(input.owner.authority.authorityId);
    assert.equal(source?.state, 'active');
    assert.ok(source.signerActivations.mlDsa);
    const activations = source.signerActivations.mlDsa.filter(
      selectedSigner.bind(undefined, input.signingKeyId),
    );
    assert.equal(activations.length, 1);
    return input.api.seedRetainedMlDsaOwner({
      database: input.database,
      scope: input.scope,
      owner: fixture,
      signer: activations[0].signer,
    });
  }
  await input.api.seedOwner(input.database, input.scope, fixture);
  return fixture;
}
function selectedSigner(signingKeyId, activation) {
  return activation.signer.mlDsaSigningKeyId === signingKeyId;
}
async function inventory(input, key, counter = 1) {
  const prepared = await input.api.prepareMlDsaSignerInventory({
    relayerUrl,
    walletId: input.walletId,
    rpId: 'wallet.example.test',
    credentialIdB64u: key.credentialId,
    origin,
  });
  if (prepared.kind === 'refused') return prepared;
  return input.api.fetchMlDsaSignerInventory({
    relayerUrl,
    preparation: prepared.preparation,
    credential: signingAssertion(key, prepared.challengeB64u, counter),
  });
}
async function signRetainedKey(input, key) {
  const prepared = await input.api.prepareMlDsaNearSigning({
    access: { kind: 'public' },
    relayerUrl,
    publicKeyB64u: input.publicKeyB64u,
    request: {
      walletId: input.walletId,
      signingKeyId: input.signingKeyId,
      operationIdB64u: randomBytes(32).toString('base64url'),
      unsignedTransactionBorshB64u: input.unsignedTransactionBorshB64u,
      actor: { kind: 'passkey', rpId: 'wallet.example.test', credentialIdB64u: key.credentialId },
    },
  });
  assert.equal(prepared.kind, 'prepared', JSON.stringify(prepared));
  const inventoryApproval = await input.api.prepareMlDsaSignerInventory({
    relayerUrl,
    walletId: input.walletId,
    rpId: 'wallet.example.test',
    credentialIdB64u: key.credentialId,
    origin,
  });
  assert.equal(inventoryApproval.kind, 'prepared');
  const confused = await input.api.executeMlDsaNearSigning({
    relayerUrl,
    preparation: prepared.preparation,
    authorization: {
      kind: 'passkey',
      credential: signingAssertion(key, inventoryApproval.challengeB64u, 2),
    },
  });
  assert.equal(confused.kind, 'refused');
  assert.equal(confused.code, 'unauthorized');
  const tokenB64u = randomBytes(32).toString('base64url');
  const session = await input.api.prepareMlDsaSigningSession({
    relayerUrl,
    request: {
      walletId: input.walletId,
      operationIdB64u: prepared.preparation.request.operationIdB64u,
      tokenDigestB64u: createHash('sha256')
        .update(`seams/ml-dsa/session-token/v1|${tokenB64u}`)
        .digest('base64url'),
      maxOperations: 2,
      durationMs: 600000,
    },
  });
  assert.equal(session.kind, 'prepared', JSON.stringify(session));
  const request = {
    relayerUrl,
    preparation: prepared.preparation,
    authorization: {
      kind: 'session_start',
      credential: signingAssertion(key, session.preparation.challengeB64u, 2),
      sessionIdB64u: session.preparation.sessionIdB64u,
      tokenB64u,
    },
  };
  const retries = [];
  let signed = await input.api.executeMlDsaNearSigning(request);
  while (signed.kind === 'retry') {
    assert.ok(signed.retryAtMs < prepared.preparation.expiresAtMs);
    retries.push(signed);
    await waitUntil(signed.retryAtMs);
    signed = await input.api.executeMlDsaNearSigning(request);
  }
  assert.equal(signed.kind, 'signed', JSON.stringify(signed));
  const publicKey = createPublicKey({
    key: Buffer.concat([
      Buffer.from('308207b2300b0609608648016503040312038207a100', 'hex'),
      Buffer.from(input.publicKeyB64u, 'base64url'),
    ]),
    format: 'der',
    type: 'spki',
  });
  const message = createHash('sha256')
    .update(Buffer.from(input.unsignedTransactionBorshB64u, 'base64url'))
    .digest();
  assert.equal(
    verify(null, message, publicKey, Buffer.from(signed.transaction.signatureB64u, 'base64url')),
    true,
  );
  assert.deepEqual(await input.api.executeMlDsaNearSigning(request), signed);
  return { request, signed, retries };
}
function timer(milliseconds, resolve) {
  setTimeout(resolve, milliseconds);
}
async function waitUntil(atMs) {
  await new Promise(timer.bind(undefined, Math.max(100, atMs - Date.now())));
}
function publishedIdentity(entry) {
  return entry.kind === 'published';
}
async function rejectSigning(input, key) {
  const result = await input.api.prepareMlDsaNearSigning({
    access: { kind: 'public' },
    relayerUrl,
    publicKeyB64u: input.publicKeyB64u,
    request: {
      walletId: input.walletId,
      signingKeyId: input.signingKeyId,
      operationIdB64u: randomBytes(32).toString('base64url'),
      unsignedTransactionBorshB64u: input.unsignedTransactionBorshB64u,
      actor: { kind: 'passkey', rpId: 'wallet.example.test', credentialIdB64u: key.credentialId },
    },
  });
  assert.equal(result.kind, 'refused');
  assert.equal(result.code, 'unauthorized');
}

/** Gateway/Worker qualification from the existing recovery/link activation boundary. */
export async function verifyMlDsaRetainedSignerLifecycle(input) {
  const originalFetch = globalThis.fetch;
  const transport = new GatewayTransport(input.gateway);
  globalThis.fetch = transport.fetch.bind(transport);
  const checks = {};
  try {
    const recoveredKey = input.credentialKey();
    const recovered = await activatedAuthority(
      input,
      'wallet_recovery',
      recoveredKey,
      'ml-dsa-recovered-owner',
      input.api.buildFullOwnerPermissionsV1(),
      'wallet_signers',
    );
    const future = await input.api.prepareMlDsaSignerInventory({
      relayerUrl,
      walletId: input.walletId,
      rpId: 'wallet.example.test',
      credentialIdB64u: recoveredKey.credentialId,
      origin,
    });
    assert.equal(future.kind, 'prepared');
    const unissued = { ...future.preparation, nonceB64u: randomBytes(32).toString('base64url') };
    const refusedUnissued = await input.api.fetchMlDsaSignerInventory({
      relayerUrl,
      preparation: unissued,
      credential: signingAssertion(
        recoveredKey,
        await input.api.mlDsaInventoryChallenge(unissued, origin),
        1,
      ),
    });
    assert.equal(refusedUnissued.kind, 'refused');
    assert.equal(refusedUnissued.code, 'unauthorized');
    checks.inventoryRequiresTheExactServerIssuedChallenge = true;
    const futurePreparation = { ...future.preparation, expiresAtMs: Date.now() + 600_000 };
    const refusedFuture = await input.api.fetchMlDsaSignerInventory({
      relayerUrl,
      preparation: futurePreparation,
      credential: signingAssertion(
        recoveredKey,
        await input.api.mlDsaInventoryChallenge(futurePreparation, origin),
        1,
      ),
    });
    assert.equal(refusedFuture.kind, 'refused');
    assert.equal(refusedFuture.code, 'expired');
    checks.inventoryCannotExtendApprovalWindow = true;
    const recoveredInventory = await inventory(input, recoveredKey);
    assert.equal(recoveredInventory.kind, 'inventory', JSON.stringify(recoveredInventory));
    const keys = recoveredInventory.entries.filter(publishedIdentity);
    assert.equal(keys.length, 1);
    assert.equal(keys[0].key.publicKeyB64u, input.publicKeyB64u);
    assert.equal(keys[0].key.signingKeyId, input.signingKeyId);
    checks.recoveredOwnerDiscoversOriginalPublishedKey = true;
    const recoveredSignature = await signRetainedKey(input, recoveredKey);
    checks.recoveredOwnerSignsWithoutRekeying = true;
    checks.inventoryApprovalCannotAuthorizeSigning = true;
    checks.recoveredOwnerKeepsWalletCooldown = recoveredSignature.retries.length > 0;
    assert.equal(checks.recoveredOwnerKeepsWalletCooldown, true);

    const linkedKey = input.credentialKey();
    const linked = await activatedAuthority(
      input,
      'device_link',
      linkedKey,
      'ml-dsa-linked-owner',
      input.api.buildFullOwnerPermissionsV1(),
      'wallet_signers',
    );
    const linkedInventory = await inventory(input, linkedKey);
    assert.equal(linkedInventory.kind, 'inventory', JSON.stringify(linkedInventory));
    assert.deepEqual(linkedInventory.entries, recoveredInventory.entries);
    checks.linkedFullOwnerDiscoversSameServerSigner = true;

    const signingOnlyKey = input.credentialKey();
    await activatedAuthority(
      input,
      'device_link',
      signingOnlyKey,
      'ml-dsa-linked-signing-only',
      input.api.buildSigningOnlyDelegatedWalletAuthorityV1().permissions,
      'ed25519',
    );
    assert.equal((await inventory(input, signingOnlyKey)).kind, 'refused');
    await rejectSigning(input, signingOnlyKey);
    checks.signingOnlyDeviceCannotDiscoverOrSignMlDsa = true;
    const ed25519OnlyKey = input.credentialKey();
    await activatedAuthority(
      input,
      'device_link',
      ed25519OnlyKey,
      'ml-dsa-linked-ed25519-only',
      input.api.buildFullOwnerPermissionsV1(),
      'ed25519',
    );
    assert.equal((await inventory(input, ed25519OnlyKey)).kind, 'refused');
    await rejectSigning(input, ed25519OnlyKey);
    checks.linkedDeviceWithoutMlDsaActivationCannotSign = true;

    const linkedSignature = await signRetainedKey(input, linkedKey);
    assert.ok(linkedSignature.retries.length > 0, 'Linking must preserve the wallet cooldown');
    checks.linkedOwnerSignsAndKeepsWalletCooldown = true;
    const revoked = await new input.api.D1WalletAuthorityStore({
      database: input.database,
      scope: input.scope,
    }).revokeWalletAuthMethod({
      walletId: input.walletId,
      authorityId: linked.authority.authorityId,
      walletAuthMethodId: linked.authMethod.walletAuthMethodId,
      expectedAuthorityRevocationEpoch: linked.authority.revocationEpoch,
      requestedAtMs: Date.now(),
    });
    assert.equal(revoked.kind, 'revoked_method');
    assert.equal(
      (await input.api.executeMlDsaNearSigning(linkedSignature.request)).kind,
      'refused',
    );
    assert.equal((await inventory(input, linkedKey, 3)).kind, 'refused');
    await rejectSigning(input, linkedKey);
    checks.revokedLinkedOwnerCannotReadCachedSignatureOrStartAgain = true;
    assert.equal(
      (await input.api.executeMlDsaNearSigning(recoveredSignature.request)).kind,
      'signed',
    );
    checks.revocationPreservesRecoveredOwnerAccess = true;
    return {
      checks,
      recoveredAuthorityId: recovered.authority.authorityId,
      linkedAuthorityId: linked.authority.authorityId,
      recoveredSigningRetries: recoveredSignature.retries,
      linkedSigningRetries: linkedSignature.retries,
      scope:
        'Production Gateway routes, D1 authority/counter/claim handling, independent signature verification, and real local A/B Worker signing. Recovery and linked-device authorities start at their trusted completed-activation boundary through shared fixture factories. This campaign does not execute recovery-code replacement or QR linking ceremonies.',
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

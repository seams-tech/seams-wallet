const worker = new Worker('/custody-worker.js', { type: 'module' });
const pending = new Map();
const completedRoleResults = new Map();
let sequence = 0;
const checks = {};
const status = document.querySelector('#status');
worker.onmessage = received;
worker.onerror = failedWorker;
document.querySelector('#run').onclick = run;

function received(event) {
  const request = pending.get(event.data.id);
  if (!request) return;
  pending.delete(event.data.id);
  if (event.data.ok) request.resolve(event.data.result);
  else request.reject(new Error(event.data.error));
}
function failedWorker(event) {
  status.textContent = `Worker failed: ${event.message}`;
  for (const request of pending.values()) request.reject(new Error(event.message));
  pending.clear();
}
function rpc(type, payload) {
  const id = String(++sequence);
  const request = Promise.withResolvers();
  pending.set(id, request);
  worker.postMessage({ id, type, payload });
  return request.promise;
}
async function api(path, body = {}) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
function ensure(value, message) {
  if (!value) throw new Error(message);
}
function encoded(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
function factor(envelopeId, byte) {
  return JSON.stringify({
    envelopeId,
    factor: {
      kind: 'passkey',
      rpId: 'wallet.example',
      credentialIdB64u: encoded(new Uint8Array(32).fill(byte)),
      kekVersion: 'passkey_prf_kek_hkdf_sha256_v1',
    },
    walletAuthMethodId: `fixture-method-${byte}`,
  });
}
function codes() {
  const result = [];
  for (let index = 0; index < 10; index += 1)
    result.push({ codeBytesB64u: encoded(new Uint8Array(32).fill(0x80 + index)) });
  return JSON.stringify(result);
}
function beginPayload(fixture, custody, continuity = { kind: 'create' }) {
  const protocolInputs = structuredClone(fixture.protocol);
  protocolInputs.continuity = continuity;
  return { ceremonyId: fixture.id, keySet: 'near_ml_dsa_65_v1', custody, protocolInputs };
}
async function begin(fixture, custody, continuity) {
  const begun = await rpc(
    'beginWalletCustodyKeySetRun',
    beginPayload(fixture, custody, continuity),
  );
  const dispatch = JSON.parse(begun.roleInputsJson);
  ensure(
    Object.keys(dispatch).sort().join(',') === 'binding,roleA,roleB',
    'Unexpected role dispatch fields',
  );
  ensure(
    dispatch.roleA.ciphertext.length === 80 && dispatch.roleB.ciphertext.length === 80,
    'Invalid encrypted input size',
  );
  return begun;
}
async function perform(fixture, custody, continuity) {
  const begun = await begin(fixture, custody, continuity);
  const roles = await api('/execute', { id: fixture.id, roleInputsJson: begun.roleInputsJson });
  await rpc('completeWalletCustodyKeySetRun', {
    ceremonyId: fixture.id,
    keySet: 'near_ml_dsa_65_v1',
    protocolResultJson: roles.resultsJson,
  });
  return roles;
}
async function routerRound(id, roleInputsJson) {
  const dispatch = JSON.parse(roleInputsJson);
  ensure(
    Object.keys(dispatch).sort().join(',') === 'binding,roleA,roleB',
    'Unexpected dispatch fields',
  );
  ensure(
    dispatch.roleA.ciphertext.length === 80 && dispatch.roleB.ciphertext.length === 80,
    'Invalid encrypted inputs',
  );
  const roles = await api('/execute', { id, roleInputsJson });
  completedRoleResults.set(id, roles.resultsJson);
  return roles.resultsJson;
}
async function failRouterRound() {
  throw new Error('Injected Router transport failure');
}
async function expectFailure(type, payload, name) {
  let failed = false;
  try {
    await rpc(type, payload);
  } catch {
    failed = true;
  }
  ensure(failed, `${name} unexpectedly succeeded`);
  checks[name] = true;
}
async function assertGone(id, name) {
  const result = await rpc('discardWalletCustodyCeremony', { ceremonyId: id });
  ensure(result.discarded === false, `${name} retained a ceremony`);
  checks[name] = true;
}
function joining(commit) {
  const record = commit.custody;
  return {
    origin: 'join',
    factorSecret: new Uint8Array(32).fill(0x61).buffer,
    custodyJson: JSON.stringify({
      envelopeBinding: JSON.parse(record.envelopeBindingJson),
      nonceB64u: record.envelopeNonceB64u,
      sealedCustodySecretB64u: record.sealedCustodySecretB64u,
      aadHashB64u: record.envelopeAadHashB64u,
      ciphertextDigestB64u: record.envelopeCiphertextDigestB64u,
    }),
  };
}
function recovering(commit) {
  const record = commit.custody;
  const wrap = record.recoveryManifestKekWraps[0];
  return {
    origin: 'recover',
    recoveryCode: new Uint8Array(32).fill(0x80).buffer,
    custodyJson: JSON.stringify({
      walletId: commit.key.walletId,
      wrap: {
        nonceB64u: wrap.nonceB64u,
        wrappedManifestKekB64u: wrap.ciphertextB64u,
        aadHashB64u: wrap.aadHashB64u,
      },
      entry: {
        custodySecretKind: 'wallet_custody_seed_v1',
        nonceB64u: record.recoveryEntryNonceB64u,
        wrappedCustodySecretB64u: record.recoveryEntryCiphertextB64u,
        aadHashB64u: record.recoveryEntryAadHashB64u,
      },
    }),
  };
}
async function run() {
  document.querySelector('#run').disabled = true;
  try {
    status.textContent = 'Establishing browser custody and signing through separate roles…';
    const first = await api('/fixture');
    const commit = await runMlDsaCustodyKeySetCeremony({
      ceremonyId: first.id,
      runStep: rpc,
      runRouterRound: routerRound.bind(null, first.id),
      kind: 'establish',
      protocolInputs: first.protocol,
      factorJson: factor('browser-fixture-envelope', 0x62),
      factorSecret: new Uint8Array(32).fill(0x61).buffer,
      recoveryCodesJson: codes(),
    });
    ensure(commit.custodyAction === 'established', 'Establishment returned the wrong action');
    await api('/verify-export', { id: first.id, commit });
    checks.browser_establishment_and_threshold_signature = true;
    await expectFailure(
      'finishMlDsaCustodyKeySetRun',
      { ceremonyId: first.id, finish: { kind: 'existing' } },
      'completed_handle_cannot_be_reused',
    );

    status.textContent = 'Recovering through a code with replacement holder keys…';
    const second = await api('/fixture');
    const continuity = {
      kind: 'recover',
      recordedKeyManifestDigestB64u: commit.key.keyManifestDigestB64u,
    };
    const recoveryInput = recovering(commit);
    const recovered = await runMlDsaCustodyKeySetCeremony({
      ceremonyId: second.id,
      runStep: rpc,
      runRouterRound: routerRound.bind(null, second.id),
      kind: 'recover',
      protocolInputs: { ...second.protocol, continuity },
      custodyJson: recoveryInput.custodyJson,
      recoveryCode: recoveryInput.recoveryCode,
      replacementFactorJson: factor('browser-recovered-envelope', 0x66),
      replacementFactorSecret: new Uint8Array(32).fill(0x67).buffer,
    });
    ensure(
      recovered.custodyAction === 'recovered' &&
        recovered.key.publicKeyB64u === commit.key.publicKeyB64u,
      'Recovery changed the public key',
    );
    ensure(
      recovered.key.keyManifestDigestB64u === commit.key.keyManifestDigestB64u,
      'Recovery changed the manifest',
    );
    await api('/verify-export', { id: second.id, commit: recovered });
    checks.browser_code_recovery_preserves_key_and_manifest = true;

    status.textContent = 'Joining existing custody through the SDK driver…';
    const third = await api('/fixture');
    const joinInput = joining(commit);
    const joinedCommit = await runMlDsaCustodyKeySetCeremony({
      ceremonyId: third.id,
      runStep: rpc,
      runRouterRound: routerRound.bind(null, third.id),
      kind: 'join',
      protocolInputs: { ...third.protocol, continuity },
      custodyJson: joinInput.custodyJson,
      factorSecret: joinInput.factorSecret,
    });
    ensure(joinedCommit.custodyAction === 'joined', 'Joining returned the wrong action');
    ensure(
      Object.keys(joinedCommit).sort().join(',') === 'custodyAction,key',
      'Joining replaced custody records',
    );
    ensure(
      joinedCommit.key.keyManifestDigestB64u === commit.key.keyManifestDigestB64u,
      'Joining changed the manifest',
    );
    await api('/verify-export', { id: third.id, commit: joinedCommit });
    checks.driver_join_preserves_key_without_replacing_recovery_set = true;

    const interrupted = await api('/fixture');
    const beforeInterruption = await rpc('fixtureLifetime', {});
    let interruptedError;
    try {
      await runMlDsaCustodyKeySetCeremony({
        ceremonyId: interrupted.id,
        runStep: rpc,
        runRouterRound: failRouterRound,
        kind: 'join',
        protocolInputs: { ...interrupted.protocol, continuity },
        custodyJson: joinInput.custodyJson,
        factorSecret: joinInput.factorSecret,
      });
    } catch (error) {
      interruptedError = error;
    }
    ensure(
      interruptedError?.message === 'Injected Router transport failure',
      'Driver masked the transport error',
    );
    const afterInterruption = await rpc('fixtureLifetime', {});
    ensure(
      afterInterruption.preparedFreed === beforeInterruption.preparedFreed + 1,
      'Driver retained private state after a network failure',
    );
    await assertGone(interrupted.id, 'driver_network_failure_discards_custody');

    status.textContent = 'Checking malformed boundaries, terminal failures, and handle cleanup…';
    for (const invalid of ['secret-input', 'missing-manifest', 'unsafe-epoch']) {
      const fixture = await api('/fixture');
      const payload = beginPayload(fixture, {
        origin: 'establish',
        walletId: fixture.protocol.walletId,
      });
      if (invalid === 'secret-input') payload.protocolInputs.ownerRoot = 'forbidden';
      if (invalid === 'missing-manifest') payload.protocolInputs.continuity = { kind: 'recover' };
      if (invalid === 'unsafe-epoch') payload.protocolInputs.materialEpoch = 2 ** 53;
      await expectFailure('beginWalletCustodyKeySetRun', payload, invalid);
      await assertGone(fixture.id, `${invalid}-is-terminal`);
    }
    let lifetime = await rpc('fixtureLifetime', {});
    const discard = await api('/fixture');
    await begin(discard, joining(commit));
    ensure(
      (await rpc('discardWalletCustodyCeremony', { ceremonyId: discard.id })).discarded,
      'Discard failed',
    );
    let after = await rpc('fixtureLifetime', {});
    ensure(
      after.preparedFreed === lifetime.preparedFreed + 1,
      'Discard did not explicitly free Wasm',
    );
    checks.discard_explicitly_frees_wasm = true;

    lifetime = after;
    const wrongStep = await api('/fixture');
    await begin(wrongStep, joining(commit));
    await expectFailure(
      'finishMlDsaCustodyKeySetRun',
      { ceremonyId: wrongStep.id, finish: { kind: 'existing' } },
      'wrong-step',
    );
    after = await rpc('fixtureLifetime', {});
    ensure(
      after.preparedFreed === lifetime.preparedFreed + 1,
      'Wrong-step handling did not free Wasm',
    );
    checks.wrong_step_explicitly_frees_wasm = true;

    lifetime = after;
    const badType = await api('/fixture');
    await begin(badType, joining(commit));
    await expectFailure(
      'completeWalletCustodyKeySetRun',
      { ceremonyId: badType.id, keySet: 'near_ml_dsa_65_v1', protocolResultJson: {} },
      'non-string-result',
    );
    after = await rpc('fixtureLifetime', {});
    ensure(
      after.preparedFreed === lifetime.preparedFreed + 1,
      'Invalid JS argument did not free Wasm',
    );
    await assertGone(badType.id, 'non-string-result-is-terminal');

    const replay = await api('/fixture');
    await begin(replay, joining(commit));
    await expectFailure(
      'completeWalletCustodyKeySetRun',
      {
        ceremonyId: replay.id,
        keySet: 'near_ml_dsa_65_v1',
        protocolResultJson: completedRoleResults.get(first.id),
      },
      'old-holder-replies',
    );
    await assertGone(replay.id, 'old-holder-replies-are-terminal');

    const joined = await api('/fixture');
    await perform(joined, joining(commit), continuity);
    lifetime = await rpc('fixtureLifetime', {});
    await expectFailure(
      'finishMlDsaCustodyKeySetRun',
      {
        ceremonyId: joined.id,
        finish: {
          kind: 'establish',
          factorJson: 42,
          factorSecret: new Uint8Array(32).buffer,
          recoveryCodesJson: codes(),
        },
      },
      'non-string-factor',
    );
    after = await rpc('fixtureLifetime', {});
    ensure(
      after.verifiedFreed === lifetime.verifiedFreed + 1,
      'Invalid finish argument did not free Wasm',
    );
    await assertGone(joined.id, 'non-string-factor-is-terminal');

    const invalidSecret = await api('/fixture');
    await perform(invalidSecret, joining(commit), continuity);
    lifetime = await rpc('fixtureLifetime', {});
    await expectFailure(
      'finishMlDsaCustodyKeySetRun',
      {
        ceremonyId: invalidSecret.id,
        finish: {
          kind: 'establish',
          factorJson: factor('invalid-secret', 0x62),
          factorSecret: 32,
          recoveryCodesJson: codes(),
        },
      },
      'non-buffer-factor-secret',
    );
    after = await rpc('fixtureLifetime', {});
    ensure(
      after.verifiedFreed === lifetime.verifiedFreed + 1,
      'Invalid factor bytes did not free Wasm',
    );
    await assertGone(invalidSecret.id, 'non-buffer-factor-secret-is-terminal');

    const active = [];
    for (let index = 0; index < 4; index += 1) {
      const fixture = await api('/fixture');
      await begin(fixture, joining(commit));
      active.push(fixture.id);
    }
    const overflow = await api('/fixture');
    await expectFailure(
      'beginWalletCustodyKeySetRun',
      beginPayload(overflow, joining(commit)),
      'concurrent-ceremony-limit',
    );
    for (const id of active)
      ensure(
        (await rpc('discardWalletCustodyCeremony', { ceremonyId: id })).discarded,
        'Concurrent discard failed',
      );
    const final = await api('/fixture');
    await begin(final, joining(commit));
    ensure(
      (await rpc('discardWalletCustodyCeremony', { ceremonyId: final.id })).discarded,
      'Capacity was not restored',
    );
    checks.capacity_restored_after_discard = true;
    worker.terminate();
    await api('/record', { browser: navigator.userAgent, checks });
    status.textContent = `Passed ${Object.keys(checks).length} checks. Evidence saved.`;
  } catch (error) {
    worker.terminate();
    status.textContent = `FAILED: ${error.stack || error}`;
    console.error(error);
  }
}
import { runMlDsaCustodyKeySetCeremony } from '/custody-driver.js';

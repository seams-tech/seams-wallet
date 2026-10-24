import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey, hkdfSync, sign, verify } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import init, * as wasm from '../../wasm/near_signer/pkg-ml-dsa/ml_dsa_signer.js';

const repo = resolve(import.meta.dirname, '../..');
const artifactPath = resolve(process.argv[2] ?? '/private/tmp/ml-dsa-device-root-e2e.json');
const scratch = await mkdtemp(`${tmpdir()}/ml-dsa-device-roots-`);
const walletId = 'ml-dsa-device-root-e2e';
await writeFile(
  `${scratch}/source.json`,
  JSON.stringify({
    wallet_id: walletId,
    wallet_auth_method_id: 'owner-original',
    rp_id: 'wallet.example.test',
    credential_id_b64u: b64(Buffer.from('original-credential')),
  }),
);
const child = spawn(
  `${repo}/tools/ml-dsa-investigation/target/release/ml-dsa-investigation`,
  ['gateway-registration-client', `${scratch}/source.json`],
  { stdio: ['pipe', 'pipe', 'pipe'] },
);
const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
let owner;
const checks = [];
try {
  const first = await lines.next();
  assert.equal(first.done, false);
  const ready = JSON.parse(first.value);
  assert.equal(ready.ready, true);
  const source = ready.envelope;
  await init({
    module_or_path: await readFile(`${repo}/wasm/near_signer/pkg-ml-dsa/ml_dsa_signer_bg.wasm`),
  });
  owner = wasm.passkey_custody_open_wallet_seed_v1(
    Buffer.alloc(32, 0x61),
    JSON.stringify(source.binding),
    bytes(source.nonceB64u),
    source.ciphertextB64u,
    source.aadHashB64u,
    source.ciphertextDigestB64u,
  );
  for (const slot of [1, 2]) {
    const keyId = `near-ml-dsa-65:${slot}`;
    const application = hash(
      Buffer.concat([
        Buffer.from('seams/wallet-custody/ml-dsa-65/application-binding/v1'),
        field('walletId', Buffer.from(walletId)),
        field('mlDsa65SigningKeyId', Buffer.from(keyId)),
      ]),
    );
    const root = Buffer.from(
      hkdfSync(
        'sha256',
        Buffer.alloc(32),
        Buffer.from('seams/wallet-custody/seed/ml-dsa-65-owner-root/v1'),
        field('applicationBindingDigest', application),
        32,
      ),
    );
    const seed = createHash('shake256', { outputLength: 32 })
      .update('seams/ml-dsa-65/canonical-seed/v1')
      .update(root)
      .digest();
    const key = ordinaryKey(seed);
    const publicKey = createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-1952);
    const manifest = hash(
      Buffer.concat([
        field('context', Buffer.from('seams/wallet-custody/key-set-manifest/near-ml-dsa-65/v1')),
        field('applicationBindingDigest', application),
        field('registeredPublicKey', publicKey),
      ]),
    );
    const identity = {
      linkSessionId: 'link-first',
      walletKeyId: `wallet-key:ml-dsa:${walletId}:${keyId}`,
      mlDsaSigningKeyId: keyId,
      targetFactor: { kind: 'passkey_prf' },
      applicationBindingDigestB64u: b64(application),
      registeredPublicKeyB64u: b64(publicKey),
      keyManifestDigestB64u: b64(manifest),
      enrollmentId: 'enrollment-first',
      deviceId: 'device-first',
      revocationEpoch: 0,
    };
    const recipient = wasm.ml_dsa65_link_recipient_v1();
    const binding = {
      walletId,
      walletAuthMethodId: 'method-first',
      root: identity,
      recipientPublicKeyB64u: recipient.public_key_b64u(),
    };
    const sealed = JSON.parse(
      owner.seal_ml_dsa65_root_for_linked_device_v1(JSON.stringify(binding)),
    );
    const target = targetEnvelope(binding, source.binding.factor);
    const factor = Buffer.alloc(32, 0x37);
    const result = JSON.parse(
      wasm.ml_dsa65_accept_linked_root_v1(
        recipient,
        factor,
        JSON.stringify(binding),
        JSON.stringify(sealed),
        JSON.stringify(target),
      ),
    );
    assert.throws(
      () =>
        wasm.ml_dsa65_accept_linked_root_v1(
          recipient,
          factor,
          JSON.stringify(binding),
          JSON.stringify(sealed),
          JSON.stringify(target),
        ),
      /consumed/,
    );
    recipient.free();
    const envelope = cacheEnvelope(target, result);
    wasm.ml_dsa65_verify_linked_root_v1(
      factor,
      JSON.stringify(envelope),
      walletId,
      keyId,
      b64(publicKey),
    );
    const exported = JSON.parse(
      wasm.ml_dsa65_export_linked_seed_v1(
        factor,
        JSON.stringify(envelope),
        walletId,
        keyId,
        b64(publicKey),
      ),
    );
    assert.equal(exported.seedB64u, b64(seed));
    const exportHandle = wasm.passkey_custody_open_wallet_seed_v1(
      Buffer.alloc(32, 0x61),
      JSON.stringify(source.binding),
      bytes(source.nonceB64u),
      source.ciphertextB64u,
      source.aadHashB64u,
      source.ciphertextDigestB64u,
    );
    const originalExport = JSON.parse(
      exportHandle.export_ml_dsa65_seed(walletId, keyId, b64(publicKey)),
    );
    assert.equal(exported.seedB64u, originalExport.seedB64u);
    const message = Buffer.from('ML-DSA linked-device canonical FIPS export E2E');
    const imported = ordinaryKey(bytes(exported.seedB64u));
    assert.equal(verify(null, message, createPublicKey(key), sign(null, message, imported)), true);
    assert.throws(() =>
      wasm.ml_dsa65_export_linked_seed_v1(
        Buffer.alloc(32),
        JSON.stringify(envelope),
        walletId,
        keyId,
        b64(publicKey),
      ),
    );
    assert.throws(() =>
      wasm.ml_dsa65_export_linked_seed_v1(
        factor,
        JSON.stringify(envelope),
        walletId,
        'another-key',
        b64(publicKey),
      ),
    );
    const third = wasm.ml_dsa65_link_recipient_v1();
    const thirdBinding = {
      walletId,
      walletAuthMethodId: 'method-email',
      root: {
        ...identity,
        linkSessionId: 'link-third',
        enrollmentId: 'enrollment-third',
        deviceId: 'device-third',
        targetFactor: { kind: 'email_otp' },
      },
      recipientPublicKeyB64u: third.public_key_b64u(),
    };
    const forwarded = JSON.parse(
      wasm.ml_dsa65_forward_linked_root_v1(
        factor,
        JSON.stringify(envelope),
        JSON.stringify(thirdBinding),
      ),
    );
    const emailFactor = {
      kind: 'email_otp',
      enrollmentId: 'email-enrollment',
      enrollmentSealKeyVersion: 'seal-1',
      kekVersion: 'email_otp_factor_kek_hkdf_sha256_v1',
    };
    const emailEnvelope = targetEnvelope(thirdBinding, emailFactor);
    const emailSecret = Buffer.alloc(32, 0x51);
    const emailSealed = JSON.parse(
      wasm.ml_dsa65_accept_linked_root_v1(
        third,
        emailSecret,
        JSON.stringify(thirdBinding),
        JSON.stringify(forwarded),
        JSON.stringify(emailEnvelope),
      ),
    );
    third.free();
    const emailExport = JSON.parse(
      wasm.ml_dsa65_export_linked_seed_v1(
        emailSecret,
        JSON.stringify(cacheEnvelope(emailEnvelope, emailSealed)),
        walletId,
        keyId,
        b64(publicKey),
      ),
    );
    assert.equal(emailExport.seedB64u, exported.seedB64u);
    const tamperRecipient = wasm.ml_dsa65_link_recipient_v1();
    const tamperBinding = { ...binding, recipientPublicKeyB64u: tamperRecipient.public_key_b64u() };
    const tamperPackage = JSON.parse(
      owner.seal_ml_dsa65_root_for_linked_device_v1(JSON.stringify(tamperBinding)),
    );
    const changed = bytes(tamperPackage.ciphertextB64u);
    changed[0] ^= 1;
    assert.throws(() =>
      wasm.ml_dsa65_accept_linked_root_v1(
        tamperRecipient,
        factor,
        JSON.stringify(tamperBinding),
        JSON.stringify({ ...tamperPackage, ciphertextB64u: b64(changed) }),
        JSON.stringify(target),
      ),
    );
    assert.throws(
      () =>
        wasm.ml_dsa65_accept_linked_root_v1(
          tamperRecipient,
          factor,
          JSON.stringify(tamperBinding),
          JSON.stringify(tamperPackage),
          JSON.stringify(target),
        ),
      /consumed/,
    );
    tamperRecipient.free();
    checks.push({
      keyId,
      publicKeySha256: b64(hash(publicKey)),
      keyManifestDigestB64u: b64(manifest),
      canonicalExportMatchesOriginal: true,
      ordinaryLibrarySignatureVerified: true,
      onwardEmailOwnerExport: true,
      recipientSingleUseOnSuccessAndFailure: true,
      wrongFactorAndKeyRefused: true,
    });
    root.fill(0);
    seed.fill(0);
    factor.fill(0);
    emailSecret.fill(0);
  }
  assert.notEqual(checks[0].publicKeySha256, checks[1].publicKeySha256);
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(
    artifactPath,
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        scope:
          'Executable native fixture to production Wasm, original owner to passkey-linked owner to Email OTP-linked owner, two signer slots, canonical FIPS export verified independently by Node crypto. No hosted admission or browser UI claim.',
        syntheticPublicFixture: true,
        result: 'passed',
        checks,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({ result: 'passed', artifact: artifactPath, signerSlots: checks.length }),
  );
} finally {
  owner?.destroy();
  owner?.free();
  child.kill();
}
function b64(value) {
  return Buffer.from(value).toString('base64url');
}
function bytes(value) {
  return Buffer.from(value, 'base64url');
}
function hash(value) {
  return createHash('sha256').update(value).digest();
}
function lp(value) {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(value.length);
  return Buffer.concat([size, value]);
}
function field(label, value) {
  return Buffer.concat([lp(Buffer.from(label)), lp(value)]);
}
function ordinaryKey(seed) {
  return createPrivateKey({
    key: Buffer.concat([Buffer.from('3034020100300b060960864801650304031204228020', 'hex'), seed]),
    format: 'der',
    type: 'pkcs8',
  });
}
function targetEnvelope(binding, factor) {
  return {
    walletId: binding.walletId,
    envelopeId: `root:${binding.walletAuthMethodId}:${binding.root.mlDsaSigningKeyId}`,
    factor,
    envelopeRevision: 1,
    binding: { kind: 'ml_dsa_65_owner_root_v1', ...binding.root },
    ownership: { methodBound: { walletAuthMethodId: binding.walletAuthMethodId } },
  };
}
function cacheEnvelope(binding, sealed) {
  return {
    bindingJson: JSON.stringify(binding),
    nonceB64u: sealed.nonceB64u,
    ciphertextB64u: sealed.sealedCustodySecretB64u,
    aadHashB64u: sealed.aadHashB64u,
    ciphertextDigestB64u: sealed.ciphertextDigestB64u,
  };
}

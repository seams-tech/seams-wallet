import { expect, test } from '@playwright/test';
import { parseVoiceIdDevicePublicKeyB64u } from '../../packages/shared-ts/src/authorization/voiceIdDeviceAssertion';
import { requireParsed } from '../../packages/shared-ts/src/passkey-custody/primitives';
import { parseDigestB64u } from '../../packages/shared-ts/src/utils/canonicalPrimitives';
import { sha256HexUtf8 } from '../../packages/shared-ts/src/utils/digests';
import {
  parseWalletAuthMethodId,
  parseWalletAuthorityId,
  parseWalletId,
  parseWebAuthnCredentialIdB64u,
  parseWebAuthnRpId,
} from '../../packages/shared-ts/src/utils/domainIds';
import type { WalletAuthMethodRecordV2 } from '../../packages/shared-ts/src/utils/walletAuthMethodRecord';
import { deviceKeyIdOf } from '../../packages/auth/src/proofs/deviceKey';
import type { PublicAuthMethod, SignedIn } from '../../packages/auth/src/worker/core';
import {
  answerMethodRemoval,
  verifyWalletFactorProof,
  type WalletFactorProof,
} from '../../packages/mpc-wallet-server/src/accountLayer/walletFactorProof';
import {
  assertionResponse,
  createSoftwarePasskey,
  type SoftwarePasskey,
} from '../conformance/ceremonies/passkeyCredentials';
import {
  ACCOUNT_ORIGIN,
  ISSUER,
  RP_ID,
  createDeviceKey,
  openAuthWorker,
  type AuthWorkerHarness,
} from './harness';
import { webauthnChallengeB64u } from '../../packages/auth/src/proofs/audience';

// The wallet's check of a proof from auth for the audience `wallet` (D7, Section 10): the
// wallet checks each proof against the key that it pinned with the envelope, and it reads no
// record of the Auth Worker at unlock.

const SUBSCRIBER_URL = 'https://gateway.example.test/auth/method-removal';
const WALLET_CHALLENGE = 'wallet-unlock-challenge-0123456789';
let worker: AuthWorkerHarness;

test.beforeAll(async () => {
  worker = await openAuthWorker({ removalSubscribers: [SUBSCRIBER_URL] });
});

test.afterAll(async () => {
  await worker.close();
});

function context() {
  return {
    passkeys: { rpId: RP_ID, origins: [ACCOUNT_ORIGIN] },
    authJwks: worker.jwks,
    authIssuer: ISSUER,
    nowMs: worker.clock.nowMs,
  };
}

const common = (walletId: string, methodId: string) => ({
  version: 'wallet_auth_method_v2' as const,
  walletAuthMethodId: requireParsed(parseWalletAuthMethodId(methodId), 'test'),
  walletId: requireParsed(parseWalletId(walletId), 'test'),
  walletAuthorityId: requireParsed(parseWalletAuthorityId('authority-1'), 'test'),
  createdAtMs: 1,
  updatedAtMs: 1,
  status: 'active' as const,
  activatedAtMs: 1,
});

/** The wallet's record of a passkey method: it pins the credential key. */
function passkeyRecord(walletId: string, methodId: string, passkey: SoftwarePasskey) {
  return {
    ...common(walletId, methodId),
    kind: 'passkey',
    rpId: requireParsed(parseWebAuthnRpId(RP_ID), 'test'),
    credentialIdB64u: requireParsed(
      parseWebAuthnCredentialIdB64u(passkey.credentialIdB64u),
      'test',
    ),
    credentialPublicKeyB64u: passkey.publicKeyB64u,
    counter: 0,
  } as WalletAuthMethodRecordV2;
}

async function passkeyProof(
  passkey: SoftwarePasskey,
  audience = 'wallet',
  challenge = WALLET_CHALLENGE,
) {
  return {
    factor: 'webauthn',
    assertion: assertionResponse(
      passkey,
      { rpId: RP_ID, origin: ACCOUNT_ORIGIN },
      await webauthnChallengeB64u(audience, challenge),
    ),
  } as const;
}

test('a passkey proof for the wallet passes against the pinned key, and no other proof does', async () => {
  const { passkey, session } = await worker.signUpWithPasskey();
  const [method] = session.methods as PublicAuthMethod[];
  const record = passkeyRecord(session.accountId, method?.id ?? '', passkey);
  const check = (proof: WalletFactorProof, challenge = WALLET_CHALLENGE) =>
    verifyWalletFactorProof({ method: record, challenge, proof, context: context() });

  expect(await check(await passkeyProof(passkey))).toMatchObject({ ok: true });
  // A proof for another audience, another challenge or another passkey is refused.
  for (const proof of [
    await passkeyProof(passkey, 'login'),
    await passkeyProof(passkey, 'checkout'),
    await passkeyProof(passkey, 'wallet', 'another-challenge-0123456789'),
    await passkeyProof(createSoftwarePasskey()),
  ]) {
    expect(await check(proof)).toMatchObject({ ok: false });
  }
  // A login token and a proof statement are refused as a passkey proof.
  expect(await check({ factor: 'email_code', statement: session.loginToken })).toMatchObject({
    ok: false,
    code: 'wrong_factor',
  });
  // A revoked record proves nothing.
  expect(
    await verifyWalletFactorProof({
      method: { ...record, status: 'revoked', revokedAtMs: 2 } as WalletAuthMethodRecordV2,
      challenge: WALLET_CHALLENGE,
      proof: await passkeyProof(passkey),
      context: context(),
    }),
  ).toMatchObject({ ok: false, code: 'method_not_active' });
});

test('a changed method record in auth does not change which key unlocks the wallet', async () => {
  const { passkey, session } = await worker.signUpWithPasskey();
  const [method] = session.methods as PublicAuthMethod[];
  const record = passkeyRecord(session.accountId, method?.id ?? '', passkey);
  // Someone with the Auth Worker's database puts another key on the method.
  const attacker = createSoftwarePasskey();
  await worker.database
    .prepare('UPDATE auth_methods SET public_key_b64u = ?, identifier = ? WHERE method_id = ?')
    .bind(attacker.publicKeyB64u, attacker.credentialIdB64u, method?.id)
    .run();
  const attackerProof = await passkeyProof(attacker);
  expect(
    await verifyWalletFactorProof({
      method: record,
      challenge: WALLET_CHALLENGE,
      proof: attackerProof,
      context: context(),
    }),
  ).toMatchObject({ ok: false });
  expect(
    await verifyWalletFactorProof({
      method: record,
      challenge: WALLET_CHALLENGE,
      proof: await passkeyProof(passkey),
      context: context(),
    }),
  ).toMatchObject({ ok: true });
});

test('an email statement passes when it names the pinned method and address', async () => {
  const email = `wallet-${Date.now()}@example.test`;
  const session = worker.requireOk<SignedIn>(await worker.signInWithEmail(email));
  const [method] = session.methods as PublicAuthMethod[];
  const sent = worker.requireOk<{ codeId: string }>(
    await worker.call('/v1/email-codes', {
      audience: 'wallet',
      challenge: WALLET_CHALLENGE,
      purpose: 'wallet_unlock',
      methodId: method?.id,
    }),
  );
  const { statement } = worker.requireOk<{ statement: string }>(
    await worker.call(
      '/v1/proofs',
      {
        audience: 'wallet',
        challenge: WALLET_CHALLENGE,
        proof: { factor: 'email_code', codeId: sent.codeId, code: worker.emailCode(email) },
      },
      { session: session.sessionToken },
    ),
  );
  const emailRecord = (emailHashHex: string, methodId = method?.id ?? '') =>
    ({
      ...common(session.accountId, methodId),
      kind: 'email_otp',
      emailHashHex,
      registrationAuthorityId: 'registration-1',
    }) as WalletAuthMethodRecordV2;
  const pinned = await sha256HexUtf8(email);
  const check = (record: WalletAuthMethodRecordV2, challenge = WALLET_CHALLENGE) =>
    verifyWalletFactorProof({
      method: record,
      challenge,
      proof: { factor: 'email_code', statement },
      context: context(),
    });
  expect(await check(emailRecord(pinned))).toMatchObject({ ok: true });
  expect(await check(emailRecord(await sha256HexUtf8('other@example.test')))).toMatchObject({
    ok: false,
  });
  expect(await check(emailRecord(pinned, 'email_another_method'))).toMatchObject({ ok: false });
  expect(await check(emailRecord(pinned), 'another-challenge-0123456789')).toMatchObject({
    ok: false,
  });
  // A login token is not a statement.
  expect(
    await verifyWalletFactorProof({
      method: emailRecord(pinned),
      challenge: WALLET_CHALLENGE,
      proof: { factor: 'email_code', statement: session.loginToken },
      context: context(),
    }),
  ).toMatchObject({ ok: false, code: 'proof_rejected' });
});

test('a device key proof passes against the pinned device key with the wallet message', async () => {
  const device = await createDeviceKey();
  const deviceKeyId = await deviceKeyIdOf(device.publicKeyB64u);
  const record = {
    ...common('wallet-device-1', 'voiceid-method-1'),
    kind: 'voiceid',
    deviceKeyId: parseDigestB64u(deviceKeyId),
    devicePublicKeyB64u: parseVoiceIdDevicePublicKeyB64u(device.publicKeyB64u),
  } as WalletAuthMethodRecordV2;
  const message = new TextEncoder().encode('seams:wallet-session:voiceid-device:v1 challenge');
  const check = (signatureB64u: string, deviceKeyMessage = message) =>
    verifyWalletFactorProof({
      method: record,
      challenge: WALLET_CHALLENGE,
      proof: { factor: 'device_key', signatureB64u },
      deviceKeyMessage,
      context: context(),
    });
  expect(await check(await device.sign(message))).toMatchObject({ ok: true });
  expect(
    await check(await device.sign(message), new TextEncoder().encode('another message')),
  ).toMatchObject({ ok: false });
  expect(await check(await (await createDeviceKey()).sign(message))).toMatchObject({ ok: false });
});

test('the wallet answers a removal notice: it refuses its last method and agrees otherwise', async () => {
  const { passkey, session } = await worker.signUpWithPasskey();
  const [method] = session.methods as PublicAuthMethod[];
  const first = passkeyRecord(session.accountId, method?.id ?? '', passkey);
  const wallet: WalletAuthMethodRecordV2[] = [first];
  // The Auth Worker's removal subscriber is the wallet's answer.
  worker.subscriber.answer = { status: 200, body: { ok: true } };
  const answer = async (notice: string) =>
    answerMethodRemoval({
      notice,
      subscriberUrl: SUBSCRIBER_URL,
      context: context(),
      readMethod: async (id) => wallet.find((record) => record.walletAuthMethodId === id) ?? null,
      activeMethodsOfWallet: async (walletId) =>
        wallet.filter((record) => record.walletId === walletId && record.status === 'active'),
    });

  // The account gets a second passkey in auth, which the wallet does not have.
  const second = createSoftwarePasskey();
  const options = worker.requireOk<{ challengeId: string; challengeB64u: string }>(
    await worker.call('/v1/passkeys/options', {}, { session: session.sessionToken }),
  );
  const { registrationResponse } = await import('../conformance/ceremonies/passkeyCredentials');
  worker.requireOk(
    await worker.call(
      '/v1/passkeys',
      {
        challengeId: options.challengeId,
        registration: registrationResponse(
          second,
          { rpId: RP_ID, origin: ACCOUNT_ORIGIN },
          options.challengeB64u,
        ),
      },
      { session: session.sessionToken },
    ),
  );
  worker.notices.length = 0;
  const change = worker.requireOk<{ challengeId: string; challenge: string }>(
    await worker.call(
      '/v1/methods/change',
      { removeMethodId: method?.id },
      { session: session.sessionToken },
    ),
  );
  const removal = worker.call(
    '/v1/methods/remove',
    {
      methodId: method?.id,
      challengeId: change.challengeId,
      proof: await worker.passkeyProof(second, 'auth_remove_method', change.challenge),
    },
    { session: session.sessionToken },
  );
  await removal;
  // The wallet's last envelope belongs to the first passkey, so the wallet refuses.
  const notice = worker.notices[0]?.notice ?? '';
  expect(await answer(notice)).toEqual({ status: 409, body: { ok: false, code: 'last_envelope' } });
  // With an envelope for a second method, the wallet agrees and names the envelope to revoke.
  wallet.push({ ...passkeyRecord(session.accountId, 'other-method', second) });
  expect(await answer(notice)).toMatchObject({ status: 200, body: { ok: true }, revoke: first });
  // A notice for another subscriber, or a changed notice, is refused.
  expect(
    await answerMethodRemoval({
      notice,
      subscriberUrl: 'https://other.example.test/removal',
      context: context(),
      readMethod: async () => first,
      activeMethodsOfWallet: async () => wallet,
    }),
  ).toEqual({ status: 401, body: { ok: false, code: 'invalid_notice' } });
});

test('the check needs no Auth Worker: it passes after the Auth Worker is gone', async () => {
  const local = await openAuthWorker();
  const { passkey, session } = await local.signUpWithPasskey();
  const [method] = session.methods as PublicAuthMethod[];
  const record = passkeyRecord(session.accountId, method?.id ?? '', passkey);
  const proof = await passkeyProof(passkey);
  await local.close();
  expect(
    await verifyWalletFactorProof({
      method: record,
      challenge: WALLET_CHALLENGE,
      proof,
      context: { ...context(), authJwks: { keys: [] } },
    }),
  ).toMatchObject({ ok: true });
});

import { expect, test } from '@playwright/test';
import { deviceKeyIdOf, deviceKeyProofBytes } from '../../packages/auth/src/proofs/deviceKey';
import {
  verifyLoginTokenWithJwks,
  verifyProofStatement,
  verifyRemovalNotice,
} from '../../packages/auth/src/proofs/tokens';
import type { PublicAuthMethod, SignedIn } from '../../packages/auth/src/worker/service';
import {
  ACCOUNT_ORIGIN,
  APP_ORIGIN,
  ISSUER,
  PROJECT_ID,
  createDeviceKey,
  openAuthWorker,
  type AuthWorkerHarness,
} from './harness';

// The Auth Worker through its routes: sign-in with each method, the login token, the proof of a
// method to an audience, the methods of an account and the removal subscribers.

const SUBSCRIBER_URL = 'https://gateway.example.test/auth/method-removal';
let worker: AuthWorkerHarness;

test.beforeAll(async () => {
  worker = await openAuthWorker({ removalSubscribers: [SUBSCRIBER_URL] });
});

test.afterAll(async () => {
  await worker.close();
});

test.beforeEach(() => {
  worker.subscriber.answer = { status: 200, body: { ok: true } };
  worker.notices.length = 0;
});

let emailCounter = 0;
function newEmail(): string {
  emailCounter += 1;
  return `user-${emailCounter}-${Date.now()}@example.test`;
}

function tokenCheck(nowMs = worker.clock.nowMs) {
  return { jwks: worker.jwks, issuer: ISSUER, nowMs };
}

test('a new passkey makes an account, a login session and a login token', async () => {
  const { session } = await worker.signUpWithPasskey();
  expect(session.accountId).toMatch(/^acct_[A-Za-z0-9_-]{22}$/);
  expect(session.methods).toEqual([
    {
      id: expect.stringMatching(/^passkey_/),
      kind: 'passkey',
      label: '',
      createdAtMs: expect.any(Number),
    },
  ]);
  const user = await verifyLoginTokenWithJwks(session.loginToken, {
    ...tokenCheck(),
    audience: PROJECT_ID,
  });
  expect(user).toMatchObject({
    ok: true,
    accountId: session.accountId,
    projectId: PROJECT_ID,
    envId: 'production',
    method: 'passkey',
    email: null,
  });
  // The session answers for the same account, and a token of another kind is no session.
  expect(await worker.call('/v1/account', {}, { session: session.sessionToken })).toMatchObject({
    status: 200,
    body: { accountId: session.accountId },
  });
  expect(await worker.call('/v1/account', {}, { session: session.loginToken })).toMatchObject({
    status: 401,
    body: { ok: false, code: 'unauthorized' },
  });
});

test('GET /.well-known/jwks.json gives the key that checks a login token', async () => {
  const response = await worker.send('GET', '/.well-known/jwks.json', undefined, {
    key: null,
    origin: null,
    appOrigin: null,
    environmentId: null,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('access-control-allow-origin')).toBe('*');
  expect(await response.json()).toEqual(worker.jwks);
});

test('a passkey signs in with a challenge that is used once', async () => {
  const { passkey, session } = await worker.signUpWithPasskey();
  const signedIn = await worker.signInWithPasskey(passkey);
  expect(signedIn).toMatchObject({ status: 200, body: { accountId: session.accountId } });

  const start = worker.requireOk<{ challengeId: string; challenge: string }>(
    await worker.call('/v1/sign-in/start'),
  );
  const proof = await worker.passkeyProof(passkey, 'login', start.challenge);
  expect(await worker.call('/v1/sign-in', { challengeId: start.challengeId, proof })).toMatchObject(
    { status: 200 },
  );
  expect(await worker.call('/v1/sign-in', { challengeId: start.challengeId, proof })).toMatchObject(
    { status: 401, body: { code: 'challenge_expired_or_invalid' } },
  );
});

test('a passkey sign-in refuses another audience, another origin, no user verification and an old challenge', async () => {
  const { passkey } = await worker.signUpWithPasskey();
  async function attempt(
    audience: string,
    overrides: Parameters<AuthWorkerHarness['passkeyProof']>[3] = {},
    afterMs = 0,
  ) {
    const start = worker.requireOk<{ challengeId: string; challenge: string }>(
      await worker.call('/v1/sign-in/start'),
    );
    const proof = await worker.passkeyProof(passkey, audience, start.challenge, overrides);
    worker.clock.nowMs += afterMs;
    const result = await worker.call('/v1/sign-in', { challengeId: start.challengeId, proof });
    worker.clock.nowMs -= afterMs;
    return { status: result.status, code: result.body.code };
  }
  // The audience name is in the bytes that the passkey signs.
  expect(await attempt('checkout')).toEqual({ status: 401, code: 'invalid_proof' });
  expect(await attempt('login', { origin: APP_ORIGIN })).toEqual({
    status: 403,
    code: 'invalid_origin',
  });
  expect(await attempt('login', { userVerified: false })).toEqual({
    status: 401,
    code: 'user_verification_required',
  });
  expect(await attempt('login', {}, 5 * 60_000)).toEqual({
    status: 401,
    code: 'challenge_expired_or_invalid',
  });
  expect(await attempt('login')).toEqual({ status: 200, code: undefined });
});

test('an email code makes an account for a new address and signs in to it afterwards', async () => {
  const email = newEmail();
  const first = worker.requireOk<SignedIn>(await worker.signInWithEmail(email));
  expect(first.methods).toEqual([
    expect.objectContaining({ kind: 'email_otp', label: `u•••@example.test` }),
  ]);
  expect(worker.outbox.at(-1)).toMatchObject({
    to: email,
    subject: expect.stringMatching(/^[0-9]{6} is your Example Shop code$/),
    text: expect.stringContaining('This code is for: sign in'),
  });
  const again = worker.requireOk<SignedIn>(await worker.signInWithEmail(email.toUpperCase()));
  expect(again.accountId).toBe(first.accountId);
  const user = await verifyLoginTokenWithJwks(again.loginToken, {
    ...tokenCheck(),
    audience: PROJECT_ID,
  });
  expect(user).toMatchObject({ ok: true, method: 'email_otp', email });
});

test('a wrong email code counts, and the code locks after five wrong codes', async () => {
  const email = newEmail();
  const sent = worker.requireOk<{ codeId: string }>(
    await worker.call('/v1/email-codes', { audience: 'login', email }),
  );
  const right = worker.emailCode(email);
  const wrong = right === '000000' ? '000001' : '000000';
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = await worker.call('/v1/sign-in', {
      proof: { factor: 'email_code', codeId: sent.codeId, code: wrong },
    });
    expect(result.body.code).toBe(attempt < 5 ? 'email_code_invalid' : 'email_code_locked');
  }
  expect(
    await worker.call('/v1/sign-in', {
      proof: { factor: 'email_code', codeId: sent.codeId, code: right },
    }),
  ).toMatchObject({ status: 429, body: { code: 'email_code_locked' } });
});

test('an email code is used once, and it expires', async () => {
  const email = newEmail();
  const sent = worker.requireOk<{ codeId: string }>(
    await worker.call('/v1/email-codes', { audience: 'login', email }),
  );
  const proof = { factor: 'email_code', codeId: sent.codeId, code: worker.emailCode(email) };
  expect(await worker.call('/v1/sign-in', { proof })).toMatchObject({ status: 200 });
  expect(await worker.call('/v1/sign-in', { proof })).toMatchObject({
    status: 401,
    body: { code: 'challenge_expired_or_invalid' },
  });

  const late = worker.requireOk<{ codeId: string }>(
    await worker.call('/v1/email-codes', { audience: 'login', email }),
  );
  const lateCode = worker.emailCode(email);
  worker.clock.nowMs += 10 * 60_000;
  expect(
    await worker.call('/v1/sign-in', {
      proof: { factor: 'email_code', codeId: late.codeId, code: lateCode },
    }),
  ).toMatchObject({ status: 401, body: { code: 'challenge_expired_or_invalid' } });
  worker.clock.nowMs -= 10 * 60_000;
});

test('the sixth code to one address in an hour is refused', async () => {
  const email = newEmail();
  for (let sent = 0; sent < 5; sent += 1) {
    expect(await worker.call('/v1/email-codes', { audience: 'login', email })).toMatchObject({
      status: 200,
    });
  }
  expect(await worker.call('/v1/email-codes', { audience: 'login', email })).toMatchObject({
    status: 429,
    body: { code: 'rate_limited' },
  });
});

test('an address of two accounts asks for the account', async () => {
  const email = newEmail();
  const first = worker.requireOk<SignedIn>(await worker.signInWithEmail(email));
  // A second account gets the same address as a method.
  const { session: second } = await worker.signUpWithPasskey();
  const code = worker.requireOk<{ codeId: string }>(
    await worker.call(
      '/v1/email-codes',
      { audience: 'auth_add_method', email },
      { session: second.sessionToken },
    ),
  );
  worker.requireOk(
    await worker.call(
      '/v1/methods/email',
      { proof: { factor: 'email_code', codeId: code.codeId, code: worker.emailCode(email) } },
      { session: second.sessionToken },
    ),
  );

  const sent = worker.requireOk<{ codeId: string }>(
    await worker.call('/v1/email-codes', { audience: 'login', email }),
  );
  const proof = { factor: 'email_code', codeId: sent.codeId, code: worker.emailCode(email) };
  const choice = await worker.call('/v1/sign-in', { proof });
  expect(choice).toMatchObject({ status: 409, body: { code: 'account_choice_required' } });
  expect(new Set(choice.body.accounts as string[])).toEqual(
    new Set([first.accountId, second.accountId]),
  );
  // The same code then signs in to the chosen account, and to no other account.
  expect(await worker.call('/v1/sign-in', { proof, accountId: 'acct_other' })).toMatchObject({
    status: 403,
  });
  expect(await worker.call('/v1/sign-in', { proof, accountId: second.accountId })).toMatchObject({
    status: 200,
    body: { accountId: second.accountId },
  });
});

test('a passkey proof for the checkout gives a statement that only the checkout accepts', async () => {
  const { passkey, session } = await worker.signUpWithPasskey();
  const challenge = 'order_1234567890:nonce-abcdef';
  const proven = await worker.call('/v1/proofs', {
    audience: 'checkout',
    challenge,
    proof: await worker.passkeyProof(passkey, 'checkout', challenge),
  });
  const { statement } = worker.requireOk<{ statement: string }>(proven);
  expect(
    await verifyProofStatement(statement, { ...tokenCheck(), audience: 'checkout', challenge }),
  ).toMatchObject({
    ok: true,
    accountId: session.accountId,
    method: 'passkey',
    factor: 'webauthn',
    purpose: null,
  });
  // Each other server refuses the statement: another audience, another challenge, a login check.
  expect(
    await verifyProofStatement(statement, { ...tokenCheck(), audience: 'wallet', challenge }),
  ).toMatchObject({ ok: false });
  expect(
    await verifyProofStatement(statement, {
      ...tokenCheck(),
      audience: 'checkout',
      challenge: 'order_9999999999:nonce-abcdef',
    }),
  ).toMatchObject({ ok: false });
  expect(
    await verifyLoginTokenWithJwks(statement, { ...tokenCheck(), audience: PROJECT_ID }),
  ).toMatchObject({ ok: false });
  expect(
    await verifyProofStatement(session.loginToken, {
      ...tokenCheck(),
      audience: 'checkout',
      challenge,
    }),
  ).toMatchObject({ ok: false });
  // The statement is short-lived.
  expect(
    await verifyProofStatement(statement, {
      ...tokenCheck(worker.clock.nowMs + 3 * 60_000),
      audience: 'checkout',
      challenge,
    }),
  ).toMatchObject({ ok: false });
});

test('the Auth Worker signs no passkey statement for the wallet, and none for an unknown audience', async () => {
  const { passkey } = await worker.signUpWithPasskey();
  const challenge = 'wallet-challenge-0123456789';
  for (const audience of ['wallet', 'payroll', 'login']) {
    expect(
      await worker.call('/v1/proofs', {
        audience,
        challenge,
        proof: await worker.passkeyProof(passkey, audience, challenge),
      }),
    ).toMatchObject({ status: 403, body: { code: 'audience_not_allowed' } });
  }
});

test('an email statement for the wallet names the method, the address digest and the purpose', async () => {
  const email = newEmail();
  const session = worker.requireOk<SignedIn>(await worker.signInWithEmail(email));
  const [method] = session.methods as PublicAuthMethod[];
  const challenge = 'wallet-challenge-export-0123456789';
  const sent = worker.requireOk<{ codeId: string }>(
    await worker.call('/v1/email-codes', {
      audience: 'wallet',
      challenge,
      purpose: 'export_key',
      methodId: method?.id,
      locale: 'ja',
    }),
  );
  // The email names the purpose in the operator's words.
  expect(worker.outbox.at(-1)?.text).toContain('このコードの用途: ウォレットの鍵のエクスポート');
  const proof = { factor: 'email_code', codeId: sent.codeId, code: worker.emailCode(email) };
  // The code is for one challenge.
  expect(
    await worker.call('/v1/proofs', {
      audience: 'wallet',
      challenge: 'wallet-challenge-other-0123456789',
      proof,
    }),
  ).toMatchObject({ status: 401, body: { code: 'challenge_expired_or_invalid' } });
  const { statement } = worker.requireOk<{ statement: string }>(
    await worker.call('/v1/proofs', { audience: 'wallet', challenge, proof }),
  );
  const checked = await verifyProofStatement(statement, {
    ...tokenCheck(),
    audience: 'wallet',
    challenge,
  });
  expect(checked).toMatchObject({
    ok: true,
    accountId: session.accountId,
    methodId: method?.id,
    method: 'email_otp',
    factor: 'email_code',
    purpose: 'export_key',
    emailHashHex: expect.stringMatching(/^[0-9a-f]{64}$/),
  });
  // A purpose that the operator did not list is refused, and a sign-in code is no wallet proof.
  expect(
    await worker.call('/v1/email-codes', {
      audience: 'wallet',
      challenge,
      purpose: 'send_all_funds',
      methodId: method?.id,
    }),
  ).toMatchObject({ status: 400 });
  const loginCode = worker.requireOk<{ codeId: string }>(
    await worker.call('/v1/email-codes', { audience: 'login', email }),
  );
  expect(
    await worker.call('/v1/proofs', {
      audience: 'wallet',
      challenge,
      proof: { factor: 'email_code', codeId: loginCode.codeId, code: worker.emailCode(email) },
    }),
  ).toMatchObject({ status: 401, body: { code: 'challenge_expired_or_invalid' } });
});

async function addDeviceKey(session: SignedIn) {
  const device = await createDeviceKey();
  const deviceKeyId = await deviceKeyIdOf(device.publicKeyB64u);
  const change = worker.requireOk<{ challengeId: string; challenge: string }>(
    await worker.call('/v1/methods/change', {}, { session: session.sessionToken }),
  );
  const added = await worker.call(
    '/v1/methods/device-key',
    {
      challengeId: change.challengeId,
      publicKeyB64u: device.publicKeyB64u,
      signatureB64u: await device.sign(
        deviceKeyProofBytes({
          audience: 'auth_add_method',
          challenge: change.challenge,
          methodId: deviceKeyId,
          deviceKeyId,
        }),
      ),
    },
    { session: session.sessionToken },
  );
  const { method } = worker.requireOk<{ method: PublicAuthMethod }>(added);
  async function proof(audience: string, challenge: string) {
    return {
      factor: 'device_key',
      methodId: method.id,
      signatureB64u: await device.sign(
        deviceKeyProofBytes({ audience, challenge, methodId: method.id, deviceKeyId }),
      ),
    };
  }
  return { method, proof };
}

test('a device key is added with a signature and then signs in', async () => {
  const { session } = await worker.signUpWithPasskey();
  const device = await addDeviceKey(session);
  expect(device.method).toMatchObject({ kind: 'voiceid' });

  const start = worker.requireOk<{ challengeId: string; challenge: string }>(
    await worker.call('/v1/sign-in/start'),
  );
  // A signature for another audience is refused, and it uses the challenge.
  expect(
    await worker.call('/v1/sign-in', {
      challengeId: start.challengeId,
      proof: await device.proof('checkout', start.challenge),
    }),
  ).toMatchObject({ status: 401, body: { code: 'invalid_proof' } });
  const again = worker.requireOk<{ challengeId: string; challenge: string }>(
    await worker.call('/v1/sign-in/start'),
  );
  const signedIn = worker.requireOk<SignedIn>(
    await worker.call('/v1/sign-in', {
      challengeId: again.challengeId,
      proof: await device.proof('login', again.challenge),
    }),
  );
  expect(signedIn.accountId).toBe(session.accountId);
  expect(
    await verifyLoginTokenWithJwks(signedIn.loginToken, { ...tokenCheck(), audience: PROJECT_ID }),
  ).toMatchObject({ ok: true, method: 'voiceid' });
});

async function removal(session: SignedIn, methodId: string) {
  return worker.requireOk<{ challengeId: string; challenge: string }>(
    await worker.call(
      '/v1/methods/change',
      { removeMethodId: methodId },
      { session: session.sessionToken },
    ),
  );
}

test('a method is removed after another method proves itself and the subscriber agrees', async () => {
  const { passkey, session } = await worker.signUpWithPasskey();
  const device = await addDeviceKey(session);
  const change = await removal(session, device.method.id);
  const removed = await worker.call(
    '/v1/methods/remove',
    {
      methodId: device.method.id,
      challengeId: change.challengeId,
      proof: await worker.passkeyProof(passkey, 'auth_remove_method', change.challenge),
    },
    { session: session.sessionToken },
  );
  expect(removed).toMatchObject({ status: 200 });
  expect((removed.body.methods as PublicAuthMethod[]).map((method) => method.kind)).toEqual([
    'passkey',
  ]);
  // The subscriber got one signed notice for this method, made for its own URL.
  expect(worker.notices).toHaveLength(1);
  expect(worker.notices[0]?.url).toBe(SUBSCRIBER_URL);
  expect(
    await verifyRemovalNotice(worker.notices[0]?.notice, {
      ...tokenCheck(),
      audience: SUBSCRIBER_URL,
    }),
  ).toMatchObject({
    ok: true,
    accountId: session.accountId,
    methodId: device.method.id,
    method: 'voiceid',
  });
  // The removed device key no longer signs in.
  const start = worker.requireOk<{ challengeId: string; challenge: string }>(
    await worker.call('/v1/sign-in/start'),
  );
  expect(
    await worker.call('/v1/sign-in', {
      challengeId: start.challengeId,
      proof: await device.proof('login', start.challenge),
    }),
  ).toMatchObject({ status: 401, body: { code: 'unknown_credential' } });
});

test('a removal is refused for the last method, for a proof by the same method and with no session', async () => {
  const { passkey, session } = await worker.signUpWithPasskey();
  const [only] = session.methods as PublicAuthMethod[];
  const last = await removal(session, only?.id ?? '');
  expect(
    await worker.call(
      '/v1/methods/remove',
      {
        methodId: only?.id,
        challengeId: last.challengeId,
        proof: await worker.passkeyProof(passkey, 'auth_remove_method', last.challenge),
      },
      { session: session.sessionToken },
    ),
  ).toMatchObject({ status: 409, body: { code: 'last_method' } });

  const device = await addDeviceKey(session);
  const same = await removal(session, device.method.id);
  expect(
    await worker.call(
      '/v1/methods/remove',
      {
        methodId: device.method.id,
        challengeId: same.challengeId,
        proof: await device.proof('auth_remove_method', same.challenge),
      },
      { session: session.sessionToken },
    ),
  ).toMatchObject({ status: 403, body: { code: 'forbidden' } });

  const other = await removal(session, device.method.id);
  expect(
    await worker.call('/v1/methods/remove', {
      methodId: device.method.id,
      challengeId: other.challengeId,
      proof: await worker.passkeyProof(passkey, 'auth_remove_method', other.challenge),
    }),
  ).toMatchObject({ status: 401, body: { code: 'unauthorized' } });
  expect(worker.notices).toEqual([]);
});

test('a removal fails when a subscriber refuses or does not answer, and the method stays', async () => {
  const { passkey, session } = await worker.signUpWithPasskey();
  const device = await addDeviceKey(session);
  async function remove() {
    const change = await removal(session, device.method.id);
    return await worker.call(
      '/v1/methods/remove',
      {
        methodId: device.method.id,
        challengeId: change.challengeId,
        proof: await worker.passkeyProof(passkey, 'auth_remove_method', change.challenge),
      },
      { session: session.sessionToken },
    );
  }
  worker.subscriber.answer = { status: 409, body: { ok: false, code: 'last_envelope' } };
  expect(await remove()).toMatchObject({ status: 409, body: { code: 'removal_refused' } });
  worker.subscriber.answer = 'unreachable';
  expect(await remove()).toMatchObject({ status: 503, body: { code: 'removal_unavailable' } });
  worker.subscriber.answer = { status: 500, body: { ok: false } };
  expect(await remove()).toMatchObject({ status: 503, body: { code: 'removal_unavailable' } });
  // An answer that is not an agreement is no agreement.
  worker.subscriber.answer = { status: 200, body: { ok: 'yes' } };
  expect(await remove()).toMatchObject({ status: 503, body: { code: 'removal_unavailable' } });

  const account = await worker.call('/v1/account', {}, { session: session.sessionToken });
  expect((account.body.methods as PublicAuthMethod[]).map((method) => method.kind)).toEqual([
    'passkey',
    'voiceid',
  ]);
});

test('a second passkey is added to the account of the session', async () => {
  const { session } = await worker.signUpWithPasskey();
  const { passkey: second } = await addPasskey(session);
  const signedIn = worker.requireOk<SignedIn>(await worker.signInWithPasskey(second));
  expect(signedIn.accountId).toBe(session.accountId);
  expect(signedIn.methods.map((method) => method.kind)).toEqual(['passkey', 'passkey']);
});

async function addPasskey(session: SignedIn) {
  const { createSoftwarePasskey, registrationResponse } = await import(
    '../conformance/ceremonies/passkeyCredentials'
  );
  const passkey = createSoftwarePasskey();
  const options = worker.requireOk<{ challengeId: string; challengeB64u: string }>(
    await worker.call('/v1/passkeys/options', {}, { session: session.sessionToken }),
  );
  const registration = registrationResponse(
    passkey,
    { rpId: 'account.example.test', origin: ACCOUNT_ORIGIN },
    options.challengeB64u,
  );
  // The registration needs the session that asked for its options.
  expect(
    await worker.call('/v1/passkeys', { challengeId: options.challengeId, registration }),
  ).toMatchObject({ status: 401 });
  const again = worker.requireOk<{ challengeId: string; challengeB64u: string }>(
    await worker.call('/v1/passkeys/options', {}, { session: session.sessionToken }),
  );
  worker.requireOk(
    await worker.call(
      '/v1/passkeys',
      {
        challengeId: again.challengeId,
        registration: registrationResponse(
          passkey,
          { rpId: 'account.example.test', origin: ACCOUNT_ORIGIN },
          again.challengeB64u,
        ),
      },
      { session: session.sessionToken },
    ),
  );
  return { passkey };
}

test('a sign-out ends the session, and the login token of a session can be made again', async () => {
  const { session } = await worker.signUpWithPasskey();
  const fresh = worker.requireOk<{ loginToken: string }>(
    await worker.call('/v1/session/token', {}, { session: session.sessionToken }),
  );
  expect(
    await verifyLoginTokenWithJwks(fresh.loginToken, { ...tokenCheck(), audience: PROJECT_ID }),
  ).toMatchObject({ ok: true, accountId: session.accountId });
  // A login token is for one project, and it expires after ten minutes.
  expect(
    await verifyLoginTokenWithJwks(fresh.loginToken, { ...tokenCheck(), audience: 'project-2' }),
  ).toMatchObject({ ok: false });
  expect(
    await verifyLoginTokenWithJwks(fresh.loginToken, {
      ...tokenCheck(worker.clock.nowMs + 11 * 60_000),
      audience: PROJECT_ID,
    }),
  ).toMatchObject({ ok: false });

  worker.requireOk(
    await worker.call('/v1/session/sign-out', {}, { session: session.sessionToken }),
  );
  expect(
    await worker.call('/v1/session/token', {}, { session: session.sessionToken }),
  ).toMatchObject({ status: 401, body: { code: 'unauthorized' } });
});

test('each route of the key plane checks the publishable key, both origins and the environment', async () => {
  const refusals = [
    [{ key: null }, 401, 'unauthorized'],
    [{ key: 'pk_test_other' }, 401, 'publishable_key_invalid'],
    [{ origin: null }, 403, 'forbidden'],
    [{ origin: 'https://evil.example.test' }, 403, 'publishable_key_origin_blocked'],
    [{ environmentId: null }, 403, 'forbidden'],
    [{ environmentId: 'project-1:staging' }, 403, 'publishable_key_environment_mismatch'],
    [{ appOrigin: null }, 403, 'forbidden'],
    [{ appOrigin: 'https://evil.example.test' }, 403, 'forbidden'],
  ] as const;
  for (const [options, status, code] of refusals) {
    expect(await worker.call('/v1/sign-in/start', {}, options)).toMatchObject({
      status,
      body: { ok: false, code },
    });
  }
  // Only the account origin can read an answer.
  const allowed = await worker.send('POST', '/v1/sign-in/start', {});
  expect(allowed.headers.get('access-control-allow-origin')).toBe(ACCOUNT_ORIGIN);
  const fromApp = await worker.send('POST', '/v1/sign-in/start', {}, { origin: APP_ORIGIN });
  expect(fromApp.headers.get('access-control-allow-origin')).toBeNull();
  expect((await worker.send('GET', '/v1/sign-in/start', undefined)).status).toBe(404);
});

import { expect, test, type Page } from '@playwright/test';
import {
  verifyLoginTokenWithJwks,
  verifyProofStatement,
} from '../../packages/auth/src/proofs/tokens';
import { ACCOUNT_ORIGIN, authBundle, openAuthApp, type AuthApp } from './browserHarness';
import { PROJECT_ID } from './harness';

// Seams Auth in a browser: the app page with `createSeamsAuth`, the account frame on its own
// origin, and the Auth Worker. The app page gets only results.

let app: AuthApp;

test.afterEach(async () => {
  await app?.close();
});

function checkOf(app: AuthApp) {
  return { jwks: app.worker.jwks, issuer: ACCOUNT_ORIGIN, nowMs: Date.now() };
}

/** Starts a sign-in on the app page and returns the promise of its result. */
function startSignIn(page: Page) {
  return page.evaluate(() => {
    const result = globalThis.auth.signIn();
    (globalThis as { pendingSignIn?: Promise<string | null> }).pendingSignIn = result;
  });
}

function signInResult(page: Page): Promise<string | null> {
  return page.evaluate(
    () => (globalThis as { pendingSignIn?: Promise<string | null> }).pendingSignIn ?? null,
  );
}

async function signUpWithPasskey(page: Page): Promise<string> {
  await startSignIn(page);
  await app.frame().getByRole('button', { name: 'Create an account with a passkey' }).click();
  const token = await signInResult(page);
  if (!token) throw new Error('The sign-in gave no token');
  return token;
}

test('a new passkey signs in through the account frame and the app page gets a login token', async ({
  page,
}) => {
  app = await openAuthApp(page);
  const token = await signUpWithPasskey(page);
  const user = await verifyLoginTokenWithJwks(token, { ...checkOf(app), audience: PROJECT_ID });
  expect(user).toMatchObject({ ok: true, method: 'passkey' });
  // The dialog closed, and the session answers with no dialog.
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  const session = await page.evaluate(() => globalThis.auth.session());
  expect(session).toMatchObject({ accountId: user.ok ? user.accountId : '' });
  // A reload keeps the session, because the account origin stores it.
  await page.reload();
  await page.evaluate(
    async ({ accountOrigin }) => {
      const clientPath = '/auth-client.js';
      const { createSeamsAuth, passkey } = await import(clientPath);
      globalThis.auth = createSeamsAuth({
        accountOrigin,
        publishableKey: 'pk_test_auth_1',
        environmentId: 'project-1:production',
        methods: [passkey()],
      });
    },
    { accountOrigin: ACCOUNT_ORIGIN },
  );
  expect(await page.evaluate(() => globalThis.auth.token())).toEqual(expect.any(String));
  // The app page holds no session secret: its storage has nothing of auth.
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});

test('an email code signs in, and a wrong code shows its text and reports the raw error to the page', async ({
  page,
}) => {
  app = await openAuthApp(page);
  await startSignIn(page);
  const frame = app.frame();
  await frame.getByLabel('Email address').fill('owner@example.test');
  await frame.getByRole('button', { name: 'Continue with email' }).click();
  await expect(frame.getByRole('heading', { name: 'Enter the code' })).toBeVisible();
  await expect(frame.getByText('We sent a 6-digit code to owner@example.test.')).toBeVisible();
  const code = app.worker.emailCode('owner@example.test');
  await frame.getByLabel('6-digit code').fill(code === '000000' ? '000001' : '000000');
  await frame.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(frame.getByRole('alert')).toHaveText('The code is not correct.');
  // The host event carries the code of the Auth Worker and the name of the view.
  expect(await page.evaluate(() => globalThis.authErrors)).toEqual([
    {
      kind: 'auth_error_v1',
      code: 'email_code_invalid',
      message: 'The code is not correct.',
      view: 'email_code',
    },
  ]);
  await frame.getByLabel('6-digit code').fill(code);
  await frame.getByRole('button', { name: 'Continue', exact: true }).click();
  const token = await signInResult(page);
  expect(
    await verifyLoginTokenWithJwks(token, { ...checkOf(app), audience: PROJECT_ID }),
  ).toMatchObject({ ok: true, method: 'email_otp', email: 'owner@example.test' });
});

test('Escape and the close button end a sign-in with null, and the next sign-in opens again', async ({
  page,
}) => {
  app = await openAuthApp(page);
  await startSignIn(page);
  await expect(app.frame().getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await signInResult(page)).toBeNull();
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  await startSignIn(page);
  await app.frame().getByRole('button', { name: 'Close' }).click();
  expect(await signInResult(page)).toBeNull();
  expect(await page.evaluate(() => globalThis.auth.token())).toBeNull();
});

test('a passkey of the account signs in again after a sign-out', async ({ page }) => {
  app = await openAuthApp(page);
  const first = await signUpWithPasskey(page);
  const changes = page.evaluate(
    () =>
      new Promise<string | null>((resolve) => {
        globalThis.auth.onSessionChange(resolve);
      }),
  );
  await page.evaluate(() => globalThis.auth.signOut());
  expect(await changes).toBeNull();
  expect(await page.evaluate(() => globalThis.auth.token())).toBeNull();

  await startSignIn(page);
  await app.frame().getByRole('button', { name: 'Continue with a passkey' }).click();
  const again = await signInResult(page);
  const check = { ...checkOf(app), audience: PROJECT_ID };
  const [before, after] = [
    await verifyLoginTokenWithJwks(first, check),
    await verifyLoginTokenWithJwks(again, check),
  ];
  expect(after.ok && before.ok && after.accountId === before.accountId).toBe(true);
});

test('a proof for the checkout shows the purpose and gives a statement that the checkout can check', async ({
  page,
}) => {
  app = await openAuthApp(page);
  // With no session there is nothing to prove.
  const challenge = 'order_1234567890:nonce-abcdef';
  expect(
    await page.evaluate(
      (value) => globalThis.auth.prove({ audience: 'checkout', challenge: value }),
      challenge,
    ),
  ).toEqual({ kind: 'unavailable', reason: 'not_signed_in' });
  await signUpWithPasskey(page);
  await page.evaluate((value) => {
    (globalThis as { pendingProof?: unknown }).pendingProof = globalThis.auth.prove({
      audience: 'checkout',
      challenge: value,
    });
  }, challenge);
  const frame = app.frame();
  await expect(frame.getByRole('heading', { name: 'Confirm it is you' })).toBeVisible();
  // The purpose is the operator's text for the audience, not text of the app page.
  await expect(frame.getByText('Approve a payment')).toBeVisible();
  await frame.getByRole('button', { name: 'Confirm with a passkey' }).click();
  const proof = (await page.evaluate(
    () => (globalThis as { pendingProof?: unknown }).pendingProof,
  )) as { kind: string; statement: string };
  expect(proof.kind).toBe('proved');
  expect(
    await verifyProofStatement(proof.statement, {
      ...checkOf(app),
      audience: 'checkout',
      challenge,
    }),
  ).toMatchObject({ ok: true, method: 'passkey', factor: 'webauthn' });
});

test('the app page cannot ask for the audience of a plugin, and only the plugin gets a factor secret', async ({
  page,
}) => {
  app = await openAuthApp(page, { config: { plugins: ['test-plugin'] } });
  await signUpWithPasskey(page);
  const challenge = 'wallet-challenge-0123456789';
  // The audience `wallet` belongs to the plugin. The app page gets no dialog for it.
  expect(
    await page.evaluate(
      (value) => globalThis.auth.prove({ audience: 'wallet', challenge: value }),
      challenge,
    ),
  ).toEqual({ kind: 'unavailable', reason: 'audience_not_allowed' });

  // The page half of the plugin asks through its channel. Auth does not read the messages.
  await page.evaluate(async (value) => {
    const port = await globalThis.auth.channel('test-plugin');
    (globalThis as { pluginAnswer?: Promise<unknown> }).pluginAnswer = new Promise((resolve) => {
      port.onmessage = (event) => resolve(event.data);
    });
    port.postMessage({ audience: 'wallet', challenge: value });
  }, challenge);
  await app.frame().getByRole('button', { name: 'Confirm with a passkey' }).click();
  const answer = (await page.evaluate(
    () => (globalThis as { pluginAnswer?: Promise<unknown> }).pluginAnswer,
  )) as Record<string, unknown>;
  // The plugin gets the raw assertion for its own server, and its sink gets the 32-byte PRF
  // result. The result that the plugin's page code sees has no secret.
  expect(answer).toMatchObject({
    kind: 'proved',
    factor: 'webauthn',
    method: 'passkey',
    secretBytes: 32,
    keys: ['kind', 'accountId', 'methodId', 'method', 'proof'],
  });
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  // A plugin proves only to its own audiences.
  await page.evaluate(async () => {
    const port = await globalThis.auth.channel('test-plugin');
    (globalThis as { pluginAnswer?: Promise<unknown> }).pluginAnswer = new Promise((resolve) => {
      port.onmessage = (event) => resolve(event.data);
    });
    port.postMessage({ audience: 'checkout', challenge: 'order_1234567890:nonce' });
  });
  expect(
    await page.evaluate(() => (globalThis as { pluginAnswer?: Promise<unknown> }).pluginAnswer),
  ).toMatchObject({ kind: 'unavailable', reason: 'audience_not_allowed' });
});

test('methods are listed, added and removed, and a plugin can refuse a removal', async ({
  page,
}) => {
  app = await openAuthApp(page, { config: { plugins: ['test-plugin'] } });
  await signUpWithPasskey(page);
  const frame = app.frame();
  const list = () =>
    page.evaluate(async () => {
      const result = await globalThis.auth.methods.list();
      return result.kind === 'methods'
        ? result.methods.map((method) => method.method).sort()
        : result;
    });
  expect(await list()).toEqual(['passkey']);

  // An email address is added after a code proves it.
  await page.evaluate(() => {
    (globalThis as { pendingChange?: unknown }).pendingChange = globalThis.auth.methods.add({
      method: 'email_code',
    });
  });
  await frame.getByLabel('Email address').fill('second@example.test');
  await frame.getByRole('button', { name: 'Continue with email' }).click();
  await expect(frame.getByRole('heading', { name: 'Enter the code' })).toBeVisible();
  await frame.getByLabel('6-digit code').fill(app.worker.emailCode('second@example.test'));
  await frame.getByRole('button', { name: 'Continue', exact: true }).click();
  const pendingChange = () =>
    page.evaluate(() => (globalThis as { pendingChange?: unknown }).pendingChange) as Promise<{
      kind: string;
      reason?: string;
      methods?: { id: string; method: string; label: string }[];
    }>;
  const added = await pendingChange();
  expect(added.methods?.map((method) => `${method.method} ${method.label}`).sort()).toEqual([
    'email_code s•••@example.test',
    'passkey ',
  ]);

  // VoiceID is a device key behind the voice gate.
  await page.evaluate(() => {
    (globalThis as { pendingChange?: unknown }).pendingChange = globalThis.auth.methods.add({
      method: 'voiceid',
    });
  });
  await frame.getByRole('button', { name: 'Add VoiceID' }).click();
  await frame.getByRole('button', { name: 'Record my voice' }).click();
  expect((await pendingChange()).methods?.map((method) => method.method).sort()).toEqual([
    'email_code',
    'passkey',
    'voiceid',
  ]);

  // The email method is removed after the passkey proves the owner.
  const emailId = added.methods?.find((method) => method.method === 'email_code')?.id ?? '';
  await page.evaluate((id) => {
    (globalThis as { pendingChange?: unknown }).pendingChange = globalThis.auth.methods.remove({
      id,
    });
  }, emailId);
  await expect(frame.getByRole('heading', { name: 'Remove this sign-in method' })).toBeVisible();
  await frame.getByRole('button', { name: 'Confirm with a passkey' }).click();
  expect((await pendingChange()).kind).toBe('done');
  expect(await list()).toEqual(['passkey', 'voiceid']);

  // A plugin that refuses stops the removal before any dialog.
  await page.evaluate(async () => {
    (await globalThis.auth.channel('test-plugin')).postMessage({ type: 'refuse_removal' });
  });
  const voiceId = (await page.evaluate(() => globalThis.auth.methods.list())) as unknown as {
    methods: { id: string; method: string }[];
  };
  const voiceMethodId = voiceId.methods.find((method) => method.method === 'voiceid')?.id ?? '';
  expect(
    await page.evaluate((id) => globalThis.auth.methods.remove({ id }), voiceMethodId),
  ).toEqual({ kind: 'unavailable', reason: 'removal_refused' });
  expect(await list()).toEqual(['passkey', 'voiceid']);
});

test('VoiceID signs in with the device key after the voice gate passes', async ({ page }) => {
  app = await openAuthApp(page);
  const first = await signUpWithPasskey(page);
  await page.evaluate(() => {
    (globalThis as { pendingChange?: unknown }).pendingChange = globalThis.auth.methods.add({
      method: 'voiceid',
    });
  });
  const frame = app.frame();
  await frame.getByRole('button', { name: 'Add VoiceID' }).click();
  await frame.getByRole('button', { name: 'Record my voice' }).click();
  await page.evaluate(() => (globalThis as { pendingChange?: unknown }).pendingChange);
  await page.evaluate(() => globalThis.auth.signOut());

  await startSignIn(page);
  await frame.getByRole('button', { name: 'Continue with VoiceID' }).click();
  await frame.getByRole('button', { name: 'Pass the voice check: sign_in' }).click();
  const token = await signInResult(page);
  const check = { ...checkOf(app), audience: PROJECT_ID };
  const [before, after] = [
    await verifyLoginTokenWithJwks(first, check),
    await verifyLoginTokenWithJwks(token, check),
  ];
  expect(after).toMatchObject({ ok: true, method: 'voiceid' });
  expect(after.ok && before.ok && after.accountId === before.accountId).toBe(true);
});

test("the app's copy and Japanese text render, and an unknown copy key is refused", async ({
  page,
}) => {
  app = await openAuthApp(page, {
    config: { locale: 'ja', copy: { title: 'ショップにサインイン', passkeyCta: 'パスキーを使う' } },
  });
  await startSignIn(page);
  const frame = app.frame();
  await expect(frame.getByRole('heading', { name: 'ショップにサインイン' })).toBeVisible();
  await expect(frame.getByRole('button', { name: 'パスキーを使う' })).toBeVisible();
  await expect(frame.getByRole('button', { name: 'メールで続ける' })).toBeVisible();
  await page.keyboard.press('Escape');
  await signInResult(page);

  const refused = await page.evaluate(async (accountOrigin) => {
    const { createSeamsAuth, passkey } = globalThis.seamsAuthClient;
    const auth = createSeamsAuth({
      accountOrigin,
      publishableKey: 'pk_test_auth_1',
      environmentId: 'project-1:production',
      methods: [passkey()],
      copy: { headline: 'Welcome' } as never,
    });
    return await auth.signIn().then(
      () => 'opened',
      (error: Error) => `${error.name}: ${error.message}`,
    );
  }, ACCOUNT_ORIGIN);
  expect(refused).toBe(
    'SeamsAuthError: The account frame refused the configuration: The configuration is not valid',
  );
});

test('the page SDK refuses an account origin of another protocol version', async ({ page }) => {
  app = await openAuthApp(page, {
    // An account frame of a later release: the same handshake, with another version.
    frameScript: `
      window.addEventListener('message', (event) => {
        if (event.data?.kind !== 'frame_kit_connect_v1') return;
        const [port] = event.ports;
        port.postMessage({
          kind: 'frame_kit_refused_v1', protocol: 'seams-auth', reason: 'version', version: '2',
        });
      });`,
  });
  const error = await page.evaluate(() =>
    globalThis.auth.signIn().then(
      () => 'opened',
      (failure: Error) => failure.message,
    ),
  );
  expect(error).toContain('1');
  expect(error).toContain('2');
});

test('a login-only app starts no worker and loads no wallet code', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  app = await openAuthApp(page);
  await signUpWithPasskey(page);
  expect(page.workers()).toEqual([]);
  expect(requests.filter((url) => /\.wasm|\/sdk\/|worker/i.test(url))).toEqual([]);
  // The two bundles hold auth, the frame kit and pure helpers only.
  for (const entry of ['client/index.ts', 'origin/main.ts'] as const) {
    const { inputs } = await authBundle(entry);
    const foreign = inputs.filter(
      (file) =>
        !file.startsWith('packages/auth/src/') &&
        !file.startsWith('packages/frame-kit/src/') &&
        !file.startsWith('packages/shared-ts/src/utils/'),
    );
    expect(foreign).toEqual([]);
    expect(inputs.filter((file) => file.includes('/worker/'))).toEqual([]);
  }
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { buildWorkerdCompatiblePhase1Bridge } from '../../packages/wallet-server/scripts/d1-local-migrate-signer.mjs';
import { seedExecutionGeneration } from './execution-generation.scenario.mjs';

const output = resolve('.artifacts/external-auth');
await mkdir(output, { recursive: true });
const bundle = await build({
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  tsconfig: 'packages/wallet-server/tsconfig.json',
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `
    export { createApplicationAuthAssertion } from './packages/wallet-server/src/auth/applicationAuth';
    export { CloudflareD1WebAuthnAuthService } from './packages/wallet-server/src/router/cloudflare/d1/webauthn/d1WebAuthnAuthService';
    export { CloudflareD1WebAuthnStore } from './packages/wallet-server/src/router/cloudflare/d1/webauthn/d1WebAuthnStore';
    export { D1WalletAuthorityStore } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletAuthorityStore';
    export { buildPasskeyWalletAuthAuthority } from './packages/shared-ts/src/utils/walletAuthAuthority';
    export { unknownWebAuthnAuthenticatorDeviceInfo } from './packages/shared-ts/src/utils/webauthnDeviceInfo';
    export { ExternalAuthStore } from './packages/wallet-server/src/auth/externalAuthStore';
    export { ExternalAuthService } from './packages/wallet-server/src/auth/externalAuthService';
    export { handleExternalAuth } from './packages/wallet-server/src/router/transport/fetch/routes/externalAuth';
    export { handleWebAuthnAuthenticators } from './packages/wallet-server/src/router/transport/fetch/routes/webauthnAuthenticators';
    export { createStaticWalletConsoleBindingV1 } from './packages/wallet-server/src/router/cloudflare/runtime/staticWalletConsoleBinding';
    export { createWalletConsoleOpsClient } from './packages/wallet-server/src/router/cloudflare/runtime/walletConsoleOpsClient';
    export { D1WalletStore } from './packages/wallet-server/src/core/d1WalletStore';
    export { D1WalletAuthMethodStore, prepareD1WalletAuthMethodV2PutStatement } from './packages/wallet-server/src/core/d1WalletAuthMethodStore';
    export { prepareD1WalletAuthorityPutStatement } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletAuthorityStore';
    export { CloudflareD1AuthorizationStore } from './packages/wallet-server/src/router/cloudflare/d1/authorization/d1AuthorizationStore';
    export { AuthorizationService } from './packages/wallet-server/src/authorization/service';
    export { capabilityPolicyPort } from './packages/wallet-server/src/authorization/capabilityPolicy';
    export { readActiveWalletSessionCredential } from './packages/wallet-server/src/router/cloudflare/d1/auth/walletSessionCredentialReaders';
    export { D1WalletExecutionAuthority } from './packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletExecutionAuthority';
    export { buildFullOwnerPermissionsV1 } from './packages/shared-ts/src/authorization/delegatedAuthority';
    export { buildLinkedDeviceManagementAuthorityFixture } from './tests/unit/helpers/linkedDeviceManagement.fixtures';
    export { buildWalletServiceHtml } from './packages/wallet/src/plugins/plugin-utils';
  `,
  },
});
await writeFile(`${output}/server.mjs`, bundle.outputFiles[0].text);
const api = await import(pathToFileURL(`${output}/server.mjs`).href);
const browserBundle = await build({
  bundle: true,
  platform: 'browser',
  format: 'esm',
  write: false,
  outfile: `${output}/probe.js`,
  tsconfig: 'packages/wallet/tsconfig.json',
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `
    import { HostedExternalAuth } from './packages/wallet/src/SeamsWeb/walletIframe/host/externalAuth';
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { SeamsWebProvider } from './packages/wallet/src/react/context/SeamsWebProvider';
    import { useSeams } from './packages/wallet/src/react/context';
    import { WalletSettingsPage } from './packages/wallet/src/react/components/AccountMenuButton';
    function Capture() {
      const context = useSeams();
      window.app = context.seams;
      return null;
    }
    window.mountSettings = function(origin) {
      const config = {
        iframeWallet: { walletOrigin: origin, servicePath: '/wallet-service', sdkBasePath: '/sdk' },
        relayer: { url: origin },
        registration: { publishableKey: 'pk_external_test', projectEnvironmentId: 'external-env' },
      };
      createRoot(document.getElementById('app')).render(React.createElement(SeamsWebProvider, { config },
        React.createElement(Capture), React.createElement(WalletSettingsPage)));
    };
    window.createWallet = function(walletOrigin) {
      window.wallet = new HostedExternalAuth({
        network: { relayer: { url: walletOrigin } },
        registration: { publishableKey: 'pk_external_test', projectEnvironmentId: 'external-env' },
      }, lockOwner, readOwnerUnavailable, window.location.origin);
    };
    async function lockOwner() {}
    async function readOwnerUnavailable() { throw new Error('Use the seeded owner session for association'); }
  `,
  },
});
const worker = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("fixture storage"); } };',
  compatibilityDate: '2026-07-10',
  d1Databases: { DB: 'external-auth' },
});
const database = await worker.getD1Database('DB');
const scope = {
  namespace: 'external',
  orgId: 'external-org',
  projectId: 'external-project',
  envId: 'external-env',
};
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKey = keys.publicKey.export({ format: 'jwk' });
const nativeFetch = globalThis.fetch;
globalThis.fetch = googleKeys;
const serverState = { origin: '', service: null, options: null };
const server = createServer(serve);
let browser;
const ownerKeys = new Map();
let authenticatorStore;

class RegisteredOwnerFactors {
  constructor(methods, authorities) { this.methods = methods; this.authorities = authorities; }
  async resolvePasskey(input) {
    for (const method of await this.methods.listForWalletV2({ walletId: input.walletId })) {
      if (method.kind !== 'passkey' || method.status !== 'active' || method.rpId !== input.rpId || method.credentialIdB64u !== input.credentialIdB64u) continue;
      const walletAuthority = await this.authorities.readById(method.walletAuthorityId);
      if (walletAuthority?.state !== 'active') continue;
      return { ok: true, authority: api.buildPasskeyWalletAuthAuthority(input), authMethod: method, walletAuthority };
    }
    return { ok: false, code: 'access_denied', message: 'Owner factor is not active' };
  }
}


class ExchangeGate {
  held = false;
  waiting = Promise.withResolvers();
  released = Promise.withResolvers();
  completed = Promise.withResolvers();
  ready = this.waiting.promise;

  async hold(route) {
    if (this.held) return route.continue();
    this.held = true;
    const response = await route.fetch();
    this.waiting.resolve();
    await this.released.promise;
    await route.fulfill({ response });
    this.completed.resolve();
  }

  release() {
    this.released.resolve();
    return this.completed.promise;
  }
}

try {
  await migrate();
  const ownerKey = createOwnerPasskey();
  const fixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'external-owner',
    identity: { walletId: 'wallet:external-owner', authorityId: 'authority:external-owner', walletAuthMethodId: 'auth-method:external-owner', rpId: '127.0.0.1' },
    credentialPublicKeyB64u: ownerKey.publicKeyB64u,
    tenantId: scope.orgId,
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    expiresAtMs: Date.now() + 3_600_000,
  });
  const walletId = fixture.authority.walletId;
  const store = new api.CloudflareD1AuthorizationStore({
    database,
    namespace: scope.namespace,
    walletSignerScope: scope,
  });
  const authorization = new api.AuthorizationService({
    policy: api.capabilityPolicyPort,
    sessions: store,
    grants: store,
    evidence: store,
    authorizedOperations: store,
    audit: {},
  });
  authenticatorStore = new api.CloudflareD1WebAuthnStore({ database, ...scope });
  await seedOwnerAuthority(fixture, ownerKey);
  const methodStore = new api.D1WalletAuthMethodStore({ database, ...scope, ensureSchema: false });
  const authorityStore = new api.D1WalletAuthorityStore({ database, scope });
  const factors = new RegisteredOwnerFactors(methodStore, authorityStore);
  const webAuthn = new api.CloudflareD1WebAuthnAuthService({
    webAuthnStore: authenticatorStore,
    walletAuthMethodStore: methodStore,
    walletManifestSource: { getEd25519KeyManifestBySlot: noKeyManifest },
  });
  serverState.service = {
    externalAuth: new api.ExternalAuthService(
      new api.ExternalAuthStore(database, scope),
      new api.D1WalletStore({ database, ...scope, ensureSchema: false }),
      new api.D1WalletAuthMethodStore({ database, ...scope, ensureSchema: false }),
    ),
    authorizedOperations: ownerOperationService(authorization, fixture.issuedSession.session.tenantId),
    walletAuthMethods: { resolveActivePasskeyAuthorityForVerifiedCredential: factors.resolvePasskey.bind(factors) },
    webAuthn,
    authorizationSessions: {
      tenantId: fixture.issuedSession.session.tenantId,
      readWalletSessionAuthorizationV2ByOperationCredential:
        api.readActiveWalletSessionCredential.bind(null, authorization),
    },
  };
  await new Promise(listen);
  serverState.origin = `http://127.0.0.1:${server.address().port}`;
  configure({ kind: 'google', revision: 1, clientId: 'external-client' });
  const token = googleToken();
  const associated = await associateGoogleIdentity(walletId, token, fixture);
  assert.equal(
    associated.body.ok,
    true,
    `Association returned ${associated.status}:${associated.body.code}`,
  );
  const before = await database
    .prepare('SELECT authority_digest_b64u FROM wallet_authorities')
    .all();

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(serverState.origin);
  await page.evaluate(createBrowserWallet, serverState.origin);
  const direct = await page.evaluate(authenticateGoogle, { walletId, token });
  assert.equal(direct.ok, true);
  assert.equal(direct.value.permission, 'wallet_settings_read');
  const session = await page.evaluate(readSession);
  assert.equal(session.authentication.kind, 'external_authenticated');
  assert.equal(session.capabilityProjection.kind, 'not_requested');
  assert.equal(session.externalSettings.methods.length, 1);
  assert.equal(session.externalSettings.devices.length, 1);
  await page.reload();
  await page.evaluate(createBrowserWallet, serverState.origin);
  assert.equal((await page.evaluate(readSession)).authentication.sessionId, direct.value.sessionId);

  const saved = await page.evaluate(readStoredSession);
  assert.equal(
    (await request('settings', { walletId: 'wallet:other', sessionToken: saved.sessionToken }))
      .status,
    403,
  );
  assert.equal(
    (
      await request(
        'settings',
        { walletId, sessionToken: saved.sessionToken },
        { environment: 'other' },
      )
    ).status,
    403,
  );
  const ownerAdmission = await nativeFetch(`${serverState.origin}/webauthn/authenticators`, {
    headers: { Authorization: `Bearer ${saved.sessionToken}` },
  });
  assert.equal(ownerAdmission.status, 401);

  await page.evaluate(lockWallet);
  assert.equal(await page.evaluate(readSession), null);
  assert.equal(
    (await request('settings', { walletId, sessionToken: saved.sessionToken })).status,
    403,
  );

  const prepared = await page.evaluate(prepareWallet, walletId);
  assert.equal(prepared.ok, true);
  assert.equal(await page.evaluate(readSession), null);
  const handoff = await request(
    'backend-exchange',
    { walletId, attemptId: prepared.value.attemptId, proof: { kind: 'google', idToken: token } },
    { credential: 'sk_external_test' },
  );
  assert.equal(handoff.body.ok, true);
  const redeemed = await page.evaluate(authenticateHandoff, {
    walletId,
    attemptId: prepared.value.attemptId,
    code: handoff.body.value.code,
  });
  assert.equal(redeemed.ok, true);
  const backendSession = await page.evaluate(readStoredSession);
  const retryBody = {
    walletId,
    attemptId: backendSession.attemptId,
    binding: backendSession.binding,
    sessionToken: backendSession.sessionToken,
    code: handoff.body.value.code,
  };
  const retries = await Promise.all([request('redeem', retryBody), request('redeem', retryBody)]);
  for (const retry of retries)
    assert.equal(retry.body.value.authentication.sessionId, redeemed.value.sessionId);
  assert.equal((await request('redeem', { ...retryBody, binding: randomSecret() })).status, 403);
  assert.equal(
    (await request('redeem', { ...retryBody, sessionToken: randomSecret() })).status,
    403,
  );
  const count = await database
    .prepare("SELECT COUNT(*) AS count FROM external_auth_attempts WHERE status = 'consumed' AND purpose = 'authenticate'")
    .first();
  assert.equal(count.count, 1);

  const raceBinding = randomSecret();
  const raceToken = randomSecret();
  const raceAttempt = await request('prepare', {
    walletId,
    binding: raceBinding,
    sessionToken: raceToken,
  });
  assert.equal(raceAttempt.body.ok, true);
  const raceExchange = await request(
    'backend-exchange',
    {
      walletId,
      attemptId: raceAttempt.body.value.attemptId,
      proof: { kind: 'google', idToken: token },
    },
    { credential: 'sk_external_test' },
  );
  const raceInput = {
    walletId,
    attemptId: raceAttempt.body.value.attemptId,
    binding: raceBinding,
    sessionToken: raceToken,
    code: raceExchange.body.value.code,
  };
  const raceResults = await Promise.all([
    request('redeem', raceInput),
    request('redeem', raceInput),
  ]);
  assert.equal(raceResults[0].body.ok, true);
  assert.deepEqual(raceResults[0].body, raceResults[1].body);
  await request('logout', { walletId, sessionToken: raceToken });

  const gate = new ExchangeGate();
  await page.route('**/wallet/external-auth/exchange', gate.hold.bind(gate));
  await page.evaluate(startPendingLogin, { walletId, token });
  await gate.ready;
  await page.evaluate(lockWallet);
  const switched = await page.evaluate(authenticateGoogle, {
    walletId: 'wallet:unassociated',
    token,
  });
  assert.equal(switched.ok, false);
  await gate.release();
  await page.unroute('**/wallet/external-auth/exchange');
  assert.equal((await page.evaluate(readPendingLogin)).code, 'superseded');
  assert.equal(await page.evaluate(readSession), null);

  configure({ kind: 'disabled', revision: 2 });
  assert.equal(
    (await request('settings', { walletId, sessionToken: backendSession.sessionToken })).status,
    403,
  );
  configure({ kind: 'google', revision: 3, clientId: 'external-client' });
  assert.equal(
    (await request('settings', { walletId, sessionToken: backendSession.sessionToken })).status,
    403,
  );
  await page.evaluate(lockWallet);
  const wrong = await page.evaluate(authenticateGoogle, {
    walletId,
    token: googleToken({ aud: 'different-client' }),
  });
  assert.equal(wrong.ok, false);
  const expired = await page.evaluate(authenticateGoogle, {
    walletId,
    token: googleToken({ exp: 1 }),
  });
  assert.equal(expired.ok, false);
  const differentUser = await page.evaluate(authenticateGoogle, {
    walletId,
    token: googleToken({ sub: 'different-user' }),
  });
  assert.equal(differentUser.ok, false);
  const wrongParty = await page.evaluate(authenticateGoogle, {
    walletId,
    token: googleToken({ azp: 'another-client' }),
  });
  assert.equal(wrongParty.code, 'invalid_credential');
  const missingParty = await page.evaluate(authenticateGoogle, {
    walletId,
    token: googleToken({ aud: ['external-client', 'another-client'] }),
  });
  assert.equal(missingParty.code, 'invalid_credential');
  const renewed = await page.evaluate(authenticateGoogle, { walletId, token });
  assert.equal(renewed.ok, true);
  await unlinkIdentity(walletId, renewed.value.associationId, fixture);
  assert.equal(await page.evaluate(readSession), null);
  const after = await database
    .prepare('SELECT authority_digest_b64u FROM wallet_authorities')
    .all();
  assert.deepEqual(after.results, before.results);
  assert.equal(
    (await associateGoogleIdentity(walletId, token, fixture)).body.ok,
    true,
  );
  const settingsPage = await browser.newPage();
  await settingsPage.goto(serverState.origin.replace('127.0.0.1', 'localhost'));
  await settingsPage.evaluate(mountSettings, serverState.origin);
  await settingsPage.waitForFunction(appReady);
  const sdkResult = await settingsPage.evaluate(authenticateSdk, { walletId, token });
  assert.equal(sdkResult.ok, true);
  await settingsPage.getByRole('button', { name: /^Authentication methods/ }).click();
  await settingsPage
    .getByText('Confirm with a wallet authentication method to make security changes.')
    .waitFor();
  await settingsPage.screenshot({ path: `${output}/settings.png` });
  const otherAppOrigin = serverState.origin.replace('127.0.0.1', 'app.localhost');
  const walletFrame = settingsPage.frames().find(isWalletFrame);
  assert.ok(walletFrame);
  const embeddedSession = await walletFrame.evaluate(readStoredSession);
  assert.equal(
    (
      await request('settings', {
        walletId,
        sessionToken: embeddedSession.sessionToken,
        appOrigin: otherAppOrigin,
      })
    ).status,
    403,
  );
  await settingsPage.goto(otherAppOrigin);
  await settingsPage.evaluate(mountSettings, serverState.origin);
  await settingsPage.waitForFunction(appReady);
  assert.equal((await settingsPage.evaluate(readSdkSession)).authentication.kind, 'signed_out');
  const additionalKey = createOwnerPasskey();
  const additionalOwner = await api.buildLinkedDeviceManagementAuthorityFixture({
    credentialPublicKeyB64u: additionalKey.publicKeyB64u,
    label: 'external-additional-owner',
    tenantId: scope.orgId,
    identity: {
      walletId,
      authorityId: 'authority:external-additional-owner',
      walletAuthMethodId: 'auth-method:external-additional-owner',
      rpId: fixture.authMethod.rpId,
      credentialIdB64u: randomSecret(),
    },
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'device_link',
    sourceAuthorityId: fixture.authority.authorityId,
    expiresAtMs: Date.now() + 3_600_000,
  });
  await seedOwnerAuthority(additionalOwner, additionalKey);
  assert.equal(
    (await associateGoogleIdentity(walletId, token, additionalOwner)).body.ok,
    true,
  );
  assert.equal(
    (
      await request('settings', {
        walletId,
        sessionToken: embeddedSession.sessionToken,
        appOrigin: serverState.origin.replace('127.0.0.1', 'localhost'),
      })
    ).status,
    403,
  );
  const reassociated = await settingsPage.evaluate(authenticateSdk, { walletId, token });
  assert.equal(reassociated.ok, true);
  assert.notEqual(reassociated.value.associationId, sdkResult.value.associationId);

  await verifyApplicationHandoff(page, walletId, additionalOwner.authority);

  const result = {
    kind: 'external-auth-e2e',
    passed: true,
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceDirty:
      execFileSync(
        'git',
        ['status', '--porcelain', '--', 'packages', 'tests/e2e/external-auth.e2e.mjs'],
        { encoding: 'utf8' },
      ).trim().length !== 0,
    packageManifestVersions: {
      wallet: JSON.parse(await readFile('packages/wallet/package.json', 'utf8')).version,
      server: JSON.parse(await readFile('packages/wallet-server/package.json', 'utf8')).version,
    },
    command: 'node tests/e2e/external-auth.e2e.mjs',
    coverage: [
      'direct Google evidence',
      'application issuer handoff with independent session expiry',
      'application assertion key, wallet, issuer, expiry and challenge validation',
      'backend handoff',
      'hosted browser reload',
      'logout',
      'idempotent concurrent redemption',
      'binding rejection',
      'tenant and wallet rejection',
      'owner admission rejection',
      'fresh WebAuthn owner proof for association and removal without issuing Wallet Sessions',
      'provider revision revocation',
      'association revocation',
      'audience, expiry, and subject rejection',
      'authority manifest preservation',
      'packaged wallet iframe and React settings',
      'lock and account switch defeat a delayed exchange response',
      'embedding-origin binding prevents cross-app restoration',
      'reassociation under current owner authority revokes earlier sessions',
    ],
    limitations: [
      'Uses a canonical registered-owner fixture and generated Google-shaped tokens with test-only JWKS interception.',
      'Does not perform Google SSO, wallet registration, MPC signing, or GetSignal integration.',
    ],
  };
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  globalThis.fetch = nativeFetch;
  await browser?.close();
  await new Promise(closeServer);
  await worker.dispose();
}

function randomSecret() {
  return randomBytes(32).toString('base64url');
}
function googleToken(overrides = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'external-test' })).toString(
    'base64url',
  );
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: 'external-client',
      sub: 'external-user',
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...overrides,
    }),
  ).toString('base64url');
  const data = `${header}.${payload}`;
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), keys.privateKey).toString('base64url')}`;
}
function googleKeys(input, init) {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('https://www.googleapis.com/')) {
    return Promise.resolve(
      Response.json({ keys: [{ ...publicKey, kid: 'external-test', alg: 'RS256', use: 'sig' }] }),
    );
  }
  return nativeFetch(input, init);
}
function configure(externalAuth) {
  const binding = api.createStaticWalletConsoleBindingV1({
    credential: {
      apiKeyId: 'test',
      publishableKey: 'pk_external_test',
      secretKey: 'sk_external_test',
      allowedOrigins: [
        serverState.origin,
        serverState.origin.replace('127.0.0.1', 'localhost'),
        serverState.origin.replace('127.0.0.1', 'app.localhost'),
      ],
      scopes: ['wallets.read', 'wallets.auth_methods.create'],
    },
    deployment: {
      orgId: scope.orgId,
      projectId: scope.projectId,
      environmentId: scope.envId,
      environmentKey: 'dev',
      signingRootVersion: 'default',
      externalAuth,
    },
    tenantRoot: { identityDigestB64u: 'test', custodyLineageB64u: 'test', signingRootId: 'test' },
  });
  const client = api.createWalletConsoleOpsClient(binding);
  serverState.options = {
    apiKeyAuth: client.apiKeyAuth,
    publishableKeyAuth: client.publishableKeyAuth,
    orgProjectEnv: client.projectEnvironments,
  };
}
async function request(action, body, options = {}) {
  const response = await nativeFetch(`${serverState.origin}/wallet/external-auth/${action}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: serverState.origin,
      Authorization: `Bearer ${options.credential || 'pk_external_test'}`,
      'x-seams-environment-id': options.environment || scope.envId,
    },
    body: JSON.stringify({ appOrigin: serverState.origin, ...body }),
  });
  return { status: response.status, body: await response.json() };
}
function listen(done) {
  server.listen(0, '127.0.0.1', done);
}
function closeServer(done) {
  server.close(done);
}
async function serve(incoming, outgoing) {
  try {
    if (incoming.url === '/') {
      outgoing.setHeader('Content-Type', 'text/html');
      outgoing.end(
        '<!doctype html><title>External wallet authentication</title><link rel="stylesheet" href="/probe.css"><div id="app"></div><script type="module" src="/probe.js"></script>',
      );
      return;
    }
    if (incoming.url.startsWith('/wallet-service')) {
      outgoing.setHeader('Content-Type', 'text/html');
      outgoing.end(api.buildWalletServiceHtml('/sdk'));
      return;
    }
    if (incoming.url.startsWith('/sdk/')) {
      const root = resolve('packages/wallet/dist/public/sdk');
      const pathname = new URL(incoming.url, 'http://localhost').pathname;
      const file = resolve(root, pathname.slice('/sdk/'.length));
      assert.ok(file.startsWith(`${root}/`));
      const contentType = file.endsWith('.js')
        ? 'text/javascript'
        : file.endsWith('.css')
          ? 'text/css'
          : file.endsWith('.wasm')
            ? 'application/wasm'
            : 'application/octet-stream';
      outgoing.setHeader('Content-Type', contentType);
      outgoing.end(await readFile(file));
      return;
    }
    if (incoming.url === '/probe.js') {
      outgoing.setHeader('Content-Type', 'text/javascript');
      outgoing.end(browserBundle.outputFiles.find(isBrowserJs).text);
      return;
    }
    if (incoming.url === '/probe.css') {
      outgoing.setHeader('Content-Type', 'text/css');
      outgoing.end(browserBundle.outputFiles.find(isBrowserCss).text);
      return;
    }
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const request = new Request(`${serverState.origin}${incoming.url}`, {
      method: incoming.method,
      headers: incoming.headers,
      ...(incoming.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
    });
    const context = {
      request,
      url: new URL(request.url),
      pathname: new URL(request.url).pathname,
      method: request.method,
      runtime: { kind: 'inline' },
      service: serverState.service,
      opts: serverState.options,
      logger: {},
      routeDefinitions: [],
    };
    const response =
      (await api.handleExternalAuth(context)) ||
      (await api.handleWebAuthnAuthenticators(context)) ||
      new Response('', { status: 404 });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500);
    outgoing.end('{"ok":false,"code":"test_server_failure"}');
  }
}
async function migrate() {
  const directory = 'packages/wallet-server/migrations/d1-signer';
  for (const name of (await readdir(directory)).filter(isSql).sort()) {
    let sql = await readFile(`${directory}/${name}`, 'utf8');
    if (name === '0028_r103f_phase1_additive_schema_bridge.sql')
      sql = buildWorkerdCompatiblePhase1Bridge(sql);
    const statements = [];
    for (const query of unstable_splitSqlQuery(sql)) statements.push(database.prepare(query));
    await database.batch(statements);
  }
}
function isSql(name) {
  return name.endsWith('.sql');
}
function isBrowserJs(file) {
  return file.path.endsWith('.js');
}
function isBrowserCss(file) {
  return file.path.endsWith('.css');
}
function createBrowserWallet(origin) {
  window.createWallet(origin);
}
function mountSettings(origin) {
  window.mountSettings(origin);
}
function appReady() {
  return Boolean(window.app);
}
function isWalletFrame(frame) {
  return frame.url().includes('/wallet-service');
}
function readSdkSession() {
  return window.app.auth.getSession();
}
function authenticateSdk(input) {
  return window.app.auth.authenticate({
    method: 'google',
    walletId: input.walletId,
    idToken: input.token,
  });
}
function authenticateGoogle(input) {
  return window.wallet.authenticate({
    method: 'google',
    walletId: input.walletId,
    idToken: input.token,
  });
}
function authenticateHandoff(input) {
  return window.wallet.authenticate({ method: 'handoff', ...input });
}
function prepareWallet(walletId) {
  return window.wallet.prepare(walletId);
}
function readSession() {
  return window.wallet.getSession();
}
function startPendingLogin(input) {
  window.pendingLogin = window.wallet.authenticate({
    method: 'google',
    walletId: input.walletId,
    idToken: input.token,
  });
}
function readPendingLogin() {
  return window.pendingLogin;
}
function lockWallet() {
  return window.wallet.lock();
}
function readStoredSession() {
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith('seams.external-auth:')) return JSON.parse(sessionStorage.getItem(key));
  }
  throw new Error('External session is missing');
}

async function seedOwnerAuthority(fixture, key) {
  const walletId = fixture.authority.walletId;
  await seedExecutionGeneration({ api, database, scope, walletId });
  await database.batch([
    api.prepareD1WalletAuthorityPutStatement({ database, scope, authority: fixture.authority }),
    api.prepareD1WalletAuthMethodV2PutStatement({ database, scope, record: fixture.authMethod }),
  ]);
  ownerKeys.set(fixture.authMethod.credentialIdB64u, key);
  await authenticatorStore.writeAuthenticator({
    userId: walletId,
    record: {
      credentialIdB64u: fixture.authMethod.credentialIdB64u,
      credentialPublicKeyB64u: key.publicKeyB64u,
      counter: 0, createdAtMs: Date.now(), updatedAtMs: Date.now(),
      deviceInfo: api.unknownWebAuthnAuthenticatorDeviceInfo(),
    },
  });
}

async function verifyApplicationHandoff(page, walletId, authority) {
  const issuer = 'https://getsignal.example';
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const publicKeyB64u = Buffer.from(await crypto.subtle.exportKey('raw', keys.publicKey)).toString('base64url');
  configure({ kind: 'application', revision: 10, issuer, publicKeyB64u });
  const associationBinding = ownerAttemptSecrets(walletId);
  const associationAttempt = await request('prepare-association', associationBinding);
  assert.equal(associationAttempt.body.ok, true);
  const associationAssertion = await api.createApplicationAuthAssertion({
    privateKey: keys.privateKey, issuer, subject: 'getsignal-user', environmentId: scope.envId,
    walletId, attemptId: associationAttempt.body.value.attemptId, purpose: 'associate',
    nowMs: Date.now(), sessionExpiresAtMs: Date.now() + 1_800_000,
  });
  const associationCode = await request('backend-exchange', {
    walletId, attemptId: associationAttempt.body.value.attemptId,
    proof: { kind: 'application', assertion: associationAssertion },
  }, { credential: 'sk_external_test' });
  assert.equal(associationCode.body.ok, true);
  const ownerFixture = { authority, authMethod: await readOwnerMethod(authority) };
  assert.equal((await completeIdentityAction('associate', {
    ...associationBinding, attemptId: associationAttempt.body.value.attemptId, code: associationCode.body.value.code,
  }, ownerFixture)).body.ok, true);
  const prepared = await page.evaluate(prepareWallet, walletId);
  assert.equal(prepared.ok, true);
  const nowMs = Date.now();
  const claims = {
    privateKey: keys.privateKey, issuer, subject: 'getsignal-user', environmentId: scope.envId, purpose: 'authenticate',
    walletId, attemptId: prepared.value.attemptId, nowMs, sessionExpiresAtMs: nowMs + 1_800_000,
  };
  const wrongKey = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const invalidClaims = [
    { ...claims, privateKey: wrongKey.privateKey },
    { ...claims, issuer: 'https://another-app.example' },
    { ...claims, walletId: 'wallet:other' },
    { ...claims, attemptId: 'another-attempt' },
    { ...claims, environmentId: 'another-environment' },
    { ...claims, nowMs: nowMs - 180_000 },
  ];
  for (const input of invalidClaims) {
    const assertion = await api.createApplicationAuthAssertion(input);
    const denied = await request('backend-exchange', {
      walletId, attemptId: prepared.value.attemptId, proof: { kind: 'application', assertion },
    }, { credential: 'sk_external_test' });
    assert.equal(denied.body.ok, false);
  }
  const assertion = await api.createApplicationAuthAssertion(claims);
  const handoff = await request('backend-exchange', {
    walletId, attemptId: prepared.value.attemptId, proof: { kind: 'application', assertion },
  }, { credential: 'sk_external_test' });
  assert.equal(handoff.body.ok, true);
  assert.equal((await request('backend-exchange', {
    walletId, attemptId: prepared.value.attemptId, proof: { kind: 'application', assertion },
  }, { credential: 'sk_external_test' })).body.ok, false);
  const authenticated = await page.evaluate(authenticateHandoff, {
    walletId, attemptId: prepared.value.attemptId, code: handoff.body.value.code,
  });
  assert.equal(authenticated.ok, true);
  assert.equal(authenticated.value.provider, 'application');
  assert.ok(authenticated.value.expiresAtMs > nowMs + 120_000);
  assert.equal((await page.evaluate(readSession)).capabilityProjection.kind, 'not_requested');
  await page.reload();
  await page.evaluate(createBrowserWallet, serverState.origin);
  assert.equal((await page.evaluate(readSession)).authentication.provider, 'application');
  configure({ kind: 'application', revision: 11, issuer, publicKeyB64u });
  assert.equal(await page.evaluate(readSession), null);
}

function noKeyManifest() { return Promise.resolve(null); }

function createOwnerPasskey() {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = keys.publicKey.export({ format: 'jwk' });
  const cose = isoCBOR.encode(new Map([
    [1, 2], [3, -7], [-1, 1],
    [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')],
  ]));
  return { privateKey: keys.privateKey, publicKeyB64u: Buffer.from(cose).toString('base64url'), counter: 0 };
}


async function readOwnerMethod(authority) {
  const methods = new api.D1WalletAuthMethodStore({ database, ...scope, ensureSchema: false });
  for (const method of await methods.listForWalletV2({ walletId: authority.walletId })) {
    if (method.walletAuthorityId === authority.authorityId && method.kind === 'passkey') return method;
  }
  throw new Error('Owner fixture method is missing');
}

function ownerAttemptSecrets(walletId) {
  return { walletId, binding: randomSecret(), sessionToken: randomSecret() };
}

async function associateGoogleIdentity(walletId, idToken, owner) {
  const binding = ownerAttemptSecrets(walletId);
  const prepared = await request('prepare-association', binding);
  assert.equal(prepared.body.ok, true);
  const exchange = await request('exchange', { walletId, attemptId: prepared.body.value.attemptId, idToken });
  assert.equal(exchange.body.ok, true, JSON.stringify(exchange));
  return completeIdentityAction('associate', {
    ...binding, attemptId: prepared.body.value.attemptId, code: exchange.body.value.code,
  }, owner);
}

async function unlinkIdentity(walletId, associationId, owner) {
  const binding = ownerAttemptSecrets(walletId);
  const prepared = await request('prepare-unlink', { ...binding, associationId });
  assert.equal(prepared.body.ok, true);
  return completeIdentityAction('unlink', {
    ...binding, attemptId: prepared.body.value.attemptId, code: prepared.body.value.code,
  }, owner);
}

async function completeIdentityAction(action, binding, owner) {
  const response = await request('owner-challenge', binding);
  assert.equal(response.body.ok, true);
  const challenge = response.body.value;
  const rpId = owner.authMethod.rpId;
  const credentialId = owner.authMethod.credentialIdB64u;
  const key = ownerKeys.get(credentialId);
  const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: challenge.challengeB64u, origin: serverState.origin }));
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(++key.counter);
  const authenticatorData = Buffer.concat([createHash('sha256').update(rpId).digest(), Buffer.from([5]), counter]);
  const signed = Buffer.concat([authenticatorData, createHash('sha256').update(clientData).digest()]);
  const factorProof = {
    kind: 'passkey', walletId: binding.walletId, rpId, credentialIdB64u: credentialId,
    challenge_digest: challenge.challengeB64u,
    webauthn_authentication: {
      id: credentialId, rawId: credentialId, type: 'public-key', authenticatorAttachment: 'platform',
      response: { clientDataJSON: clientData.toString('base64url'), authenticatorData: authenticatorData.toString('base64url'), signature: sign('sha256', signed, key.privateKey).toString('base64url') },
      clientExtensionResults: {},
    },
  };
  const result = await request(action, { ...binding, factorProof });
  assert.equal(result.body.ok, true, JSON.stringify(result));
  const replay = await request(action, { ...binding, factorProof });
  assert.deepEqual(replay.body, result.body);
  const sessions = await database.prepare('SELECT COUNT(*) AS count FROM wallet_session_authorizations_v2').first();
  assert.equal(sessions.count, 0);
  return result;
}

function ownerOperationService(authorization, tenantId) {
  return {
    tenantId,
    buildVerifiedOwnerProof: authorization.buildVerifiedOwnerProof.bind(authorization),
    readAuthorizedOperation: authorization.readAuthorizedOperation.bind(authorization),
    readAuthorizedOperationById: authorization.readAuthorizedOperationById.bind(authorization),
    recordVerifiedWalletOperationFactorEvidenceSet: authorization.recordVerifiedWalletOperationFactorEvidenceSet.bind(authorization),
    admitAuthorizedOperation: authorization.admitAuthorizedOperation.bind(authorization),
    completeAuthorizedOperation: authorization.completeAuthorizedOperation.bind(authorization),
  };
}

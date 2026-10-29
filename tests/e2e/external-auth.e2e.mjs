import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
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
  const fixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'external-owner',
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
  const issued = await issueOwnerSession(fixture, authorization);
  assert.equal(issued.kind, 'issued');
  serverState.service = {
    externalAuth: new api.ExternalAuthService(
      new api.ExternalAuthStore(database, scope),
      new api.D1WalletStore({ database, ...scope, ensureSchema: false }),
      new api.D1WalletAuthMethodStore({ database, ...scope, ensureSchema: false }),
    ),
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
  const associated = await request('associate', {
    walletId,
    idToken: token,
    ownerCredential: issued.operationCredential.token,
  });
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
    { walletId, attemptId: prepared.value.attemptId, idToken: token },
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
    .prepare("SELECT COUNT(*) AS count FROM external_auth_attempts WHERE status = 'consumed'")
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
      idToken: token,
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
  await request('unlink', {
    walletId,
    associationId: renewed.value.associationId,
    ownerCredential: issued.operationCredential.token,
  });
  assert.equal(await page.evaluate(readSession), null);
  const after = await database
    .prepare('SELECT authority_digest_b64u FROM wallet_authorities')
    .all();
  assert.deepEqual(after.results, before.results);
  assert.equal(
    (
      await request('associate', {
        walletId,
        idToken: token,
        ownerCredential: issued.operationCredential.token,
      })
    ).body.ok,
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
  const additionalOwner = await api.buildLinkedDeviceManagementAuthorityFixture({
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
  const additionalSession = await issueOwnerSession(additionalOwner, authorization);
  assert.equal(
    (
      await request('associate', {
        walletId,
        idToken: token,
        ownerCredential: additionalSession.operationCredential.token,
      })
    ).body.ok,
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
      'backend handoff',
      'hosted browser reload',
      'logout',
      'idempotent concurrent redemption',
      'binding rejection',
      'tenant and wallet rejection',
      'owner admission rejection',
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

async function issueOwnerSession(fixture, authorization) {
  const walletId = fixture.authority.walletId;
  await seedExecutionGeneration({ api, database, scope, walletId });
  await database.batch([
    api.prepareD1WalletAuthorityPutStatement({ database, scope, authority: fixture.authority }),
    api.prepareD1WalletAuthMethodV2PutStatement({ database, scope, record: fixture.authMethod }),
  ]);
  const issued = await authorization.issueDirectWalletSessionAuthorizationV2({
    tenantId: fixture.issuedSession.session.tenantId,
    principalId: fixture.issuedSession.session.principalId,
    walletId,
    authority: fixture.authority,
    walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
    mintId: fixture.issuedSession.session.mintId,
    remainingUses: 7,
    issuedAtMs: Date.now(),
    expiresAtMs: Date.now() + 3_600_000,
  });
  assert.equal(issued.kind, 'issued');
  return issued;
}

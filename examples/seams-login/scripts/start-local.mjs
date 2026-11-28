#!/usr/bin/env node
// Runs the example on this computer: the account origin (the account frame and the Auth Worker
// over a local D1 database) and the app (its page and its small backend). An email code is
// printed here in place of an email.
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const example = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(example, '../..');
const ACCOUNT_PORT = Number(process.env.ACCOUNT_PORT ?? 4701);
const APP_PORT = Number(process.env.APP_PORT ?? 4700);
const ACCOUNT_ORIGIN = `http://localhost:${ACCOUNT_PORT}`;
const APP_ORIGIN = `http://localhost:${APP_PORT}`;
const PROJECT = 'login-example';
const ENVIRONMENT_ID = `${PROJECT}:dev`;
const PUBLISHABLE_KEY = 'pk_local_login_example';

const outdir = await mkdtemp(path.join(tmpdir(), 'seams-login-'));
async function bundle(entry, platform) {
  const name = path.relative(repo, entry).replace(/[^a-z0-9]+/gi, '-');
  const outfile = path.join(outdir, `${name}-${platform}.mjs`);
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform,
    target: 'es2022',
    tsconfig: path.join(example, 'tsconfig.json'),
    external: platform === 'browser' ? ['/sdk/*'] : [],
  });
  return outfile;
}
const load = async (entry) =>
  import(pathToFileURL(await bundle(path.join(repo, entry), 'node')).href);
const text = async (entry) => readFile(await bundle(path.join(repo, entry), 'browser'), 'utf8');

const { createAuthWorker } = await load('packages/host/src/authWorkerEnv.ts');
const { accountFrameHtml, accountFrameCsp, ACCOUNT_FRAME_PATH, ACCOUNT_FRAME_SCRIPT } = await load(
  'packages/host/src/accountOrigin.ts',
);
const { generateTokenSigningJwk } = await load('packages/auth/src/proofs/tokens.ts');
const { me } = await load('examples/seams-login/src/backend.ts');
const frameScript = await text('packages/auth/src/origin/main.ts');
const appScript = await text('examples/seams-login/src/app.ts');

const runtime = new Miniflare({
  modules: true,
  script: 'export default {};',
  d1Databases: ['DB'],
  port: 0,
});
const database = await runtime.getD1Database('DB');
const migrations = path.join(repo, 'packages/auth/migrations/d1-auth');
for (const name of (await readdir(migrations)).sort()) {
  const sql = (await readFile(path.join(migrations, name), 'utf8')).replace(/^--.*$/gm, '');
  const statements = sql
    .split(/;\s*$/m)
    .map((statement) => statement.trim())
    .filter(Boolean);
  await database.batch(statements.map((statement) => database.prepare(statement)));
}

// Local credentials of the example. A real deployment gets them from the operator's key store.
const worker = await createAuthWorker(
  {
    AUTH_DB: database,
    WALLET_LOCAL_DEPLOYMENT_JSON: JSON.stringify({
      credential: {
        apiKeyId: 'key-local',
        publishableKey: PUBLISHABLE_KEY,
        allowedOrigins: [ACCOUNT_ORIGIN, APP_ORIGIN],
        scopes: ['accounts.create'],
      },
      deployment: {
        orgId: 'org-local',
        projectId: PROJECT,
        environmentId: ENVIRONMENT_ID,
        environmentKey: 'dev',
        signingRootVersion: 'v1',
      },
      tenantRoot: {
        identityDigestB64u: 'local',
        custodyLineageB64u: 'local',
        signingRootId: ENVIRONMENT_ID,
      },
    }),
    AUTH_ISSUER: ACCOUNT_ORIGIN,
    AUTH_APP_NAME: 'Example app',
    AUTH_RP_ID: 'localhost',
    AUTH_ACCOUNT_ORIGINS: ACCOUNT_ORIGIN,
    AUTH_TOKEN_SIGNING_JWK: JSON.stringify(await generateTokenSigningJwk()),
    AUTH_EMAIL_CODE_SECRET: randomBytes(32).toString('hex'),
  },
  {
    sendEmail: async (message) => console.log(`[email to ${message.to}] ${message.subject}`),
  },
);

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function send(response, status, type, body, headers = {}) {
  response.writeHead(status, { 'content-type': type, ...headers });
  response.end(body);
}

// The account origin: the document and the script of the account frame, and the Auth Worker.
const accountConfig = { authApiUrl: '', rpId: 'localhost', purposes: {} };
createServer(async (request, response) => {
  const url = new URL(request.url, ACCOUNT_ORIGIN);
  if (url.pathname === ACCOUNT_FRAME_PATH) {
    return send(response, 200, 'text/html', accountFrameHtml(accountConfig), {
      'content-security-policy': `${accountFrameCsp(accountConfig)}; frame-ancestors ${APP_ORIGIN}`,
    });
  }
  if (url.pathname === `${ACCOUNT_FRAME_PATH}${ACCOUNT_FRAME_SCRIPT}`) {
    return send(response, 200, 'text/javascript', frameScript);
  }
  const body = request.method === 'GET' ? undefined : await readBody(request);
  const answer = await worker(
    new Request(url, { method: request.method, headers: request.headers, body }),
  );
  send(
    response,
    answer.status,
    answer.headers.get('content-type') ?? 'application/json',
    await answer.text(),
  );
}).listen(ACCOUNT_PORT);

// The app: its page, and a backend that checks the login token.
const files = {
  '/': ['text/html', await readFile(path.join(example, 'index.html'))],
  '/app.css': ['text/css', await readFile(path.join(example, 'app.css'))],
  '/app.js': ['text/javascript', appScript],
};
createServer(async (request, response) => {
  const url = new URL(request.url, APP_ORIGIN);
  const file = files[url.pathname];
  if (file) return send(response, 200, file[0], file[1]);
  if (url.pathname === '/api/config') {
    return send(
      response,
      200,
      'application/json',
      JSON.stringify({
        accountOrigin: ACCOUNT_ORIGIN,
        publishableKey: PUBLISHABLE_KEY,
        environmentId: ENVIRONMENT_ID,
      }),
    );
  }
  if (url.pathname === '/api/me') {
    const answer = await me(request.headers.authorization, {
      projectId: PROJECT,
      issuer: ACCOUNT_ORIGIN,
    });
    return send(response, answer.status, 'application/json', JSON.stringify(answer.body));
  }
  send(response, 404, 'text/plain', 'not found');
}).listen(APP_PORT);

console.log(`App:            ${APP_ORIGIN}`);
console.log(`Account origin: ${ACCOUNT_ORIGIN}`);
console.log('An email code is printed here, in the subject of its email.');

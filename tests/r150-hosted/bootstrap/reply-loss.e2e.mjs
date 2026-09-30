#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const identityRoot = path.join(repoRoot, '.runtime', 'r150-hosted', 'identities', 'd1');
const artifactRoot = path.join(repoRoot, '.runtime', 'r150-hosted');
const bootstrapScript = path.join(
  repoRoot,
  'crates/router-ab-cloudflare/scripts/bootstrap-local-tenant-root.mjs',
);
const requests = [];
const server = http.createServer(handleRequest);
let scratchRoot;

try {
  process.umask(0o077);
  mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  scratchRoot = mkdtempSync(path.join(artifactRoot, 'bootstrap-reply-loss-'));
  copyIdentityInputs(scratchRoot);
  await listen(server);
  const address = server.address();
  const routerUrl = `http://127.0.0.1:${address.port}`;
  const first = await runBootstrap(scratchRoot, routerUrl);
  const second = await runBootstrap(scratchRoot, routerUrl);
  if (first.status === 0 || second.status !== 0 || requests.length !== 2) {
    throw new Error('Bootstrap response-loss replay did not reach the expected process outcomes');
  }
  if (requests[0] !== requests[1]) {
    throw new Error('Bootstrap retry signed a different tenant-root grant');
  }
  const grantFile = path.join(scratchRoot, 'creation-grant.json');
  if ((statSync(grantFile).mode & 0o077) !== 0) {
    throw new Error('Persisted tenant-root grant is exposed');
  }
  const artifact = {
    kind: 'r150_bootstrap_reply_loss_e2e_v1',
    firstProcessFailedAfterDispatch: true,
    secondProcessReplayedSameGrant: true,
    secondProcessReceivedReady: true,
    grantDigest: createHash('sha256').update(requests[0]).digest('hex'),
  };
  writeFileSync(
    path.join(artifactRoot, 'bootstrap-reply-loss.result.json'),
    `${JSON.stringify(artifact, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log('R150 bootstrap response-loss E2E passed; private result artifact written');
} finally {
  if (server.listening) server.close();
  if (scratchRoot) rmSync(scratchRoot, { recursive: true, force: true });
}

function copyIdentityInputs(targetRoot) {
  for (const fileName of [
    '.env.router-ab.router.local',
    '.env.router-ab.deriver-a.local',
    '.env.router-ab.deriver-b.local',
    'tenant-root-issuer.env',
  ]) {
    copyFileSync(path.join(identityRoot, fileName), path.join(targetRoot, fileName));
  }
}

function listen(worker) {
  return new Promise((resolve, reject) => {
    worker.once('error', reject);
    worker.listen(0, '127.0.0.1', resolve);
  });
}

async function handleRequest(request, response) {
  if (
    request.method !== 'POST' ||
    request.url !== '/router-ab/internal/tenant-root/creation/v1/create' ||
    !request.headers['x-router-ab-internal-service-auth']
  ) {
    response.writeHead(403).end();
    return;
  }
  let body = '';
  for await (const chunk of request) body += chunk;
  const grant = JSON.parse(body).creation_grant_b64u;
  if (typeof grant !== 'string' || !grant) {
    response.writeHead(400).end();
    return;
  }
  requests.push(grant);
  if (requests.length === 1) {
    request.socket.destroy();
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    identity_digest_b64u: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    custody_lineage_b64u: 'AAAAAAAAAAAAAAAAAAAAAA',
    revision: 1,
    status: {
      kind: 'ready',
      root_commitment_b64u: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    },
    replayed: true,
  }));
}

function runBootstrap(root, routerUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      bootstrapScript,
      '--root', root,
      '--issuer-env-path', path.join(root, 'tenant-root-issuer.env'),
      '--grant-file', path.join(root, 'creation-grant.json'),
      '--router-url', routerUrl,
      '--org-id', 'r150-bench-20260925-d1-org',
      '--project-id', 'r150-bench-20260925-d1-project',
      '--env-id', 'r150-bench-20260925-d1-env',
      '--signing-root-id', 'r150-bench-20260925-d1-project:bench',
      '--signing-root-version', 'default',
    ], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('close', (status) => resolve({ status }));
  });
}

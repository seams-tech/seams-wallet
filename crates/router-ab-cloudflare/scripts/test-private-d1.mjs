import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  createHash,
  randomBytes,
  createPrivateKey,
  generateKeyPairSync,
  sign as signEd25519,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import {
  finalize_ecdsa_client_bootstrap_v1,
  EcdsaRoleLocalPresignSessionV1,
  initSync as initEcdsaClientSync,
  RouterAbEcdsaClientCeremonyV1,
  prepare_ecdsa_client_bootstrap_v1,
} from '../../../wasm/router_ab_ecdsa_client/pkg/router_ab_ecdsa_client.js';

// Miniflare serves the harness's Node-function service bindings (the Router's
// SIGNING_WORKER interceptor among them) from a loopback HTTP server with
// Node's default 5 s keep-alive timeout. workerd pools those connections and
// notices a server-side idle close only when its event loop runs. The
// Derivers' Yao work in the same workerd process can hold that loop for
// seconds, so a delivery sent right after it could reuse a socket Node had
// just closed and fail with "Network connection lost". The harness's servers
// keep idle connections open instead; workerd closes them when it is done.
const createHttpServer = http.createServer;
http.createServer = (...args) => {
  const server = createHttpServer(...args);
  server.keepAliveTimeout = 0;
  return server;
};

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');
const internalAuthHeader = 'x-router-ab-internal-service-auth';
const internalAuthSecret = 'private-d1-integration-auth';
const gatewayToRouterAuthSecret = 'private-d1-gateway-router-auth';
const gatewayToSigningWorkerPresignAuthSecret = 'private-d1-gateway-signing-worker-presign-auth';
const routerToSigningWorkerEcdsaAuthSecret = 'private-d1-router-signing-worker-ecdsa-auth';
const roleD1Binding = 'DERIVER_ROLE_PRIVATE_DB';
const managedBackupR2Binding = 'TENANT_ROOT_MANAGED_BACKUP_BUCKET';
const signingWorkerD1Binding = 'SIGNING_WORKER_PRIVATE_DB';
const tenantRootCreationDoBinding = 'ROUTER_TENANT_ROOT_CREATION_DO';
const tenantRootCreationDoClass = 'RouterAbTenantRootCreationDurableObject';
const deriverAWalletDoBinding = 'DERIVER_A_WALLET_DO';
const deriverAWalletDoClass = 'RouterAbDeriverAWalletDurableObject';
const deriverAWalletDoPath = '/router-ab/internal/deriver-a/wallet-pair';
const deriverAWalletStatusPath = '/router-ab/deriver-a/ed25519-yao/read-pair-status';
const deriverAWalletBurnPath = '/router-ab/deriver-a/ed25519-yao/burn-pair';
const tenantRootCreationPath = '/router-ab/internal/tenant-root/creation/v1/create';
const tenantRootCreationSweepPath = '/router-ab/internal/tenant-root/creation/v1/sweep-abandoned';
const tenantRootRefreshPath = '/router-ab/internal/tenant-root/refresh/v1/execute';
const controlPlaneRefreshActivationPath = '/tenant-root-control-plane/refresh/v1/activate';
const creationStateRefreshActivationPath = '/router-ab/internal/tenant-root/refresh/v1/activation';
const deriverRefreshActivationPath = '/router-ab/internal/deriver/tenant-root/refresh/v1/activate';
const deriverAYaoPreparePath = '/router-ab/deriver-a/ed25519-yao/prepare-pair';
const deriverCleanupPath = '/router-ab/internal/deriver/tenant-root/cleanup/v1/execute';
const controlPlaneCleanupCommandPath = '/tenant-root-control-plane/creation/v1/cleanup-command';
const deriverBEcdsaRegistrationPath = '/router-ab/deriver-b/ecdsa-derivation/register';
const tenantRootStatusPath = '/router-ab/internal/tenant-root/status/v1/read';
const creationStateActiveStatePath = '/router-ab/internal/tenant-root/creation/v1/active-state';
const deriverCreateRoleSharePath =
  '/router-ab/internal/deriver/tenant-root/creation/v1/create-role-share';
const deriverInitialActivationPath = '/router-ab/internal/deriver/tenant-root/creation/v1/activate';
const controlPlaneInitialActivationPath = '/tenant-root-control-plane/creation/v1/activate';
const creationStateInitialActivationPath =
  '/router-ab/internal/tenant-root/creation/v1/initial-activation';
const creationStateProgressReadPath = '/router-ab/internal/tenant-root/creation/v1/progress/read';
const tenantRootRoleCreationPath =
  '/router-ab/internal/deriver/tenant-root/creation/v1/create-role-share';
const deriverAMigrationsPath = join(packageRoot, 'migrations/deriver-a');
const deriverBMigrationsPath = join(packageRoot, 'migrations/deriver-b');
const signingWorkerMigrationsPath = join(packageRoot, 'migrations/signing-worker');
const ecdsaRegistrationPath = '/router-ab/ecdsa-derivation/register';
const ecdsaActivationPath = '/router-ab/ecdsa-derivation/activate';
const ecdsaSigningPreparePath = '/router-ab/ecdsa-derivation/sign/prepare';
const ecdsaSigningWorkerPreparePath = '/router-ab/signing-worker/ecdsa-derivation/sign/prepare';
const ecdsaSigningWorkerFinalizePath = '/router-ab/signing-worker/ecdsa-derivation/sign';
const ecdsaSigningPath = '/router-ab/ecdsa-derivation/sign';
const ecdsaPresignSessionInitPath =
  '/router-ab/signing-worker/ecdsa-derivation/presignature-session/init';
const ecdsaPresignSessionStepPath =
  '/router-ab/signing-worker/ecdsa-derivation/presignature-session/step';
const tenantRootManagedRestorePath = '/router-ab/internal/tenant-root/restore/v1/execute';
const tenantRootManagedRestoreChallengePath =
  '/tenant-root-control-plane/restore/v1/challenge';
const tenantRootManagedRestoreAuthorizePath =
  '/tenant-root-control-plane/restore/v1/authorize';
const ed25519ExecutePath = '/router-ab/router/ed25519-yao/execute';
const gatewayOnlyRouterPaths = new Set([
  ed25519ExecutePath,
  '/router-ab/router/ed25519-yao/execute-source-preserving',
  '/router-ab/internal/ed25519-yao/lane/execute',
  '/router-ab/router/ed25519-yao/recovery/promote',
  '/router-ab/ed25519/sign/prepare',
  '/router-ab/ed25519/sign',
  ecdsaSigningPreparePath,
  ecdsaSigningPath,
]);
const gatewayOnlyPresignPaths = new Set([
  ecdsaPresignSessionInitPath,
  ecdsaPresignSessionStepPath,
]);
const routerOnlySigningWorkerEcdsaPaths = new Set([
  ecdsaSigningWorkerPreparePath,
  ecdsaSigningWorkerFinalizePath,
]);
const ed25519ActivationPackagesPath =
  '/router-ab/signing-worker/ed25519-yao/activation/packages';
const ed25519FinalizationLookupPath =
  '/router-ab/signing-worker/ed25519-yao/initial-registration/finalization';
const managedRestoreAuthenticationDomain =
  'tenant_root_managed_restore_incident_authorization_authentication_v1';
const ed25519Pkcs8SeedPrefix = Buffer.from('302e020100300506032b657004220420', 'hex');
const ecdsaClientWasmPath = resolve(
  repoRoot,
  'wasm/router_ab_ecdsa_client/pkg/router_ab_ecdsa_client_bg.wasm',
);
let capturedSigningWorkerDelivery;
let capturedEcdsaSigningWorkerPrepare;
let loseNextEcdsaSigningWorkerFinalizeReply = false;
let capturedDeriverAPreparation;
let capturedDeriverAExecution;
let capturedDeriverAExecutionRequest;
let competeDeriverAExecution = false;
let dropDeriverAExecutionResponse = false;
let holdDeriverAExecutionBeforeDispatch = false;
let deriverBOffline = false;
let blockedDeriverBCalls = 0;
let signingWorkerDeliveryTarget = 'fixture-signing-worker';
let signingWorkerActivationCalls = 0;
// The recovery Router's peers can each drop their next initial-activation
// request before the peer reads it; the control plane's is also recorded.
const recoveryDropNextActivation = {
  'deriver-a': false,
  'deriver-b': false,
  'tenant-root-control-plane': false,
};
let recoveryCapturedControlPlaneActivation;
// The recovery Router's peers can each drop their next request to one path,
// before the peer reads it; a drop can first wait until another peer has
// answered a request to that path.
const recoveryDropNextOnPath = {
  'deriver-a': null,
  'deriver-b': null,
  'tenant-root-control-plane': null,
};
// The body of the last request each recovery peer's drop discarded.
const recoveryDroppedBody = {};
// The recovery Router's peers can each hold their next request to one path
// before the peer reads it, until released, recording the request and the
// peer's answer; and can drop every request to one path, as an unreachable
// peer would.
const recoveryHoldNextOnPath = {
  'deriver-a': null,
  'deriver-b': null,
};
const recoveryDropEveryOnPath = {
  'deriver-a': null,
  'deriver-b': null,
};
function holdNextRecoveryRequest(workerName, path) {
  let markHeld;
  let release;
  const held = new Promise((resolve) => {
    markHeld = resolve;
  });
  const released = new Promise((resolve) => {
    release = resolve;
  });
  const hold = { path, markHeld, released, answer: null };
  recoveryHoldNextOnPath[workerName] = hold;
  return {
    held,
    release,
    answer: () => hold.answer,
  };
}
const recoveryAnswered = new Map();
function recoveryAnsweredSignal(workerName, path) {
  const key = `${workerName} ${path}`;
  if (!recoveryAnswered.has(key)) {
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    recoveryAnswered.set(key, { promise, resolve });
  }
  return recoveryAnswered.get(key);
}
// The worker the recovery Router reaches as Deriver A: normally Deriver A, or
// its late-writing variant, which shares its database and bucket.
let recoveryDeriverA = 'deriver-a';
// When set, the late-writing Deriver A's next creation call to B is answered
// only once released.
let pendingDeriverBAnswerHold = null;
let signingWorkerFinalizationLookups = 0;
let historicalReplayActivationCalls = 0;
let ecdsaClientWasmInitialized = false;

/// A fresh creation grant from the fixture's grant authority, valid for
/// `lifetimeMs`, for a recovery ceremony with its own identity.
function recoveryCreationGrant(label, lifetimeMs) {
  const output = execFileSync(
    'cargo',
    [
      'run',
      '--quiet',
      '--manifest-path',
      join(repoRoot, 'crates/router-ab-dev/Cargo.toml'),
      '--example',
      'cloudflare_private_d1_fixture',
      '--',
      '--creation-grant',
      label,
      String(lifetimeMs),
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return JSON.parse(output);
}

function loadFixture() {
  const output = execFileSync(
    'cargo',
    [
      'run',
      '--quiet',
      '--manifest-path',
      join(repoRoot, 'crates/router-ab-dev/Cargo.toml'),
      '--example',
      'cloudflare_private_d1_fixture',
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return JSON.parse(output);
}

function configureRouterJwt(fixture) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keyId = 'private-d1-router-jwt-v1';
  const publicJwk = publicKey.export({ format: 'jwk' });
  fixture.router_env.ROUTER_JWT_JWKS_JSON = JSON.stringify({
    keys: [
      {
        alg: 'EdDSA',
        crv: 'Ed25519',
        kid: keyId,
        kty: 'OKP',
        use: 'sig',
        x: publicJwk.x,
      },
    ],
  });
  return { keyId, privateKey };
}

function encodeJwtSegment(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signRouterJwt(jwtSigner, fixture, claims) {
  const header = encodeJwtSegment({ alg: 'EdDSA', kid: jwtSigner.keyId, typ: 'JWT' });
  const payload = encodeJwtSegment({
    iss: fixture.router_env.ROUTER_JWT_ISSUER,
    aud: fixture.router_env.ROUTER_JWT_AUDIENCE,
    ...claims,
  });
  const signingInput = `${header}.${payload}`;
  const signature = signEd25519(null, Buffer.from(signingInput, 'utf8'), jwtSigner.privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

function ensureEcdsaClientWasm() {
  if (ecdsaClientWasmInitialized) return;
  initEcdsaClientSync({ module: readFileSync(ecdsaClientWasmPath) });
  ecdsaClientWasmInitialized = true;
}

function strictWorker(name, role, bindings) {
  return {
    name,
    modules: true,
    scriptPath: join(
      packageRoot,
      process.env.ROUTER_AB_WORKER_BUILD_PROFILE === 'dev' ? 'build/dev' : 'build',
      role,
      'worker/shim.mjs',
    ),
    modulesRules: [
      { type: 'ESModule', include: ['**/*.js', '**/*.mjs'] },
      { type: 'CompiledWasm', include: ['**/*.wasm'] },
    ],
    compatibilityDate: '2026-06-12',
    bindings,
  };
}

// `W` for the Derivers of the wallet-object admission runs: one second, so
// recovery fences what it finds within the run.
const walletObjectAdmissionRun = process.argv.includes('--do-admission-settlement');
const walletObjectClaimedRecoveryRun = process.argv.includes('--do-claimed-recovery');
// The retirement-trigger run keeps its held work past `W`.
const retirementTriggerRun = process.argv.includes('--retirement-trigger');
const admissionRecoveryWindowBinding =
  walletObjectAdmissionRun || walletObjectClaimedRecoveryRun
    ? { TENANT_ROOT_ADMISSION_RECOVERY_WINDOW_MS: '1000' }
    : retirementTriggerRun
      ? { TENANT_ROOT_ADMISSION_RECOVERY_WINDOW_MS: '30000' }
      : {};

function deriverAWorker(fixture) {
  return {
    ...strictWorker('deriver-a', 'deriver-a', {
      ...fixture.deriver_a_env,
      ...admissionRecoveryWindowBinding,
      ROUTER_AB_TENANT_ROOT_ROLE_D1_INTEGRATION: 'enabled',
    }),
    d1Databases: { [roleD1Binding]: 'deriver-a-private-d1' },
    r2Buckets: { [managedBackupR2Binding]: 'deriver-a-managed-backup' },
    durableObjects: {
      [deriverAWalletDoBinding]: {
        className: deriverAWalletDoClass,
        useSQLite: true,
      },
      [tenantRootCreationDoBinding]: {
        className: tenantRootCreationDoClass,
        scriptName: 'router',
        useSQLite: true,
      },
    },
    serviceBindings: { DERIVER_B: 'deriver-b' },
  };
}

function deriverBWorker(fixture) {
  const bindings = {
    ...fixture.deriver_b_env,
    ...admissionRecoveryWindowBinding,
    ROUTER_AB_TENANT_ROOT_ROLE_D1_INTEGRATION: 'enabled',
  };
  if (
    process.argv.includes('--do-pair-b-burn-before-complete') ||
    walletObjectClaimedRecoveryRun
  ) {
    bindings.R150_TEST_B_BURN_BEFORE_COMPLETE = 'enabled';
  }
  return {
    ...strictWorker('deriver-b', 'deriver-b', bindings),
    d1Databases: { [roleD1Binding]: 'deriver-b-private-d1' },
    r2Buckets: { [managedBackupR2Binding]: 'deriver-b-managed-backup' },
    durableObjects: {
      [tenantRootCreationDoBinding]: {
        className: tenantRootCreationDoClass,
        scriptName: 'router',
        useSQLite: true,
      },
      // A wallet-object build keeps Deriver B's pairs in its own objects.
      ...(process.env.ROUTER_AB_WALLET_DO_HARNESS === 'enabled'
        ? {
            DERIVER_B_WALLET_DO: {
              className: 'RouterAbDeriverBWalletDurableObject',
              useSQLite: true,
            },
          }
        : {}),
    },
    serviceBindings: { DERIVER_A: 'deriver-a' },
  };
}

function signingWorker(name, databaseId, fixture) {
  return {
    ...strictWorker(name, 'signing-worker', {
      ...fixture.signing_worker_env,
      ...(name === 'fixture-signing-worker' &&
      process.argv.includes('--ecdsa-wallet-do-interruption')
        ? { R150_TEST_ECDSA_INTERRUPT_AFTER_CLAIM: 'enabled' }
        : {}),
      ROUTER_AB_GATEWAY_TO_SIGNING_WORKER_PRESIGN_AUTH_SECRET:
        gatewayToSigningWorkerPresignAuthSecret,
      ROUTER_AB_ROUTER_TO_SIGNING_WORKER_ECDSA_AUTH_SECRET:
        routerToSigningWorkerEcdsaAuthSecret,
    }),
    d1Databases: { [signingWorkerD1Binding]: databaseId },
    durableObjects: {
      SIGNING_WORKER_PRESIGN_SESSION_DO: {
        className: 'RouterAbSigningWorkerPresignSessionDurableObject',
        useSQLite: true,
      },
      ...(process.env.ROUTER_AB_WALLET_DO_HARNESS === 'enabled'
        ? {
            SIGNING_WORKER_WALLET_DO: {
              className: 'RouterAbSigningWorkerWalletDurableObject',
              useSQLite: true,
            },
          }
        : {}),
    },
  };
}

function routerWorker(fixture, capturePairPreparation = false, gateDeriverB = false) {
  return {
    ...strictWorker('router', 'router', {
      ...fixture.router_env,
      // The claimed-recovery run refreshes the same root twice; the next
      // refresh waits for the previous one's retirement, one second after
      // the swap.
      ...(walletObjectClaimedRecoveryRun
        ? {
            TENANT_ROOT_MANUAL_REFRESH_INTERVAL_MS: '60000',
            TENANT_ROOT_RETIREMENT_GRACE_MS: '1000',
          }
        : {}),
      ...(retirementTriggerRun || process.argv.includes('--refresh-after-managed-restore')
        ? { TENANT_ROOT_RETIREMENT_GRACE_MS: '1000' }
        : {}),
      ROUTER_AB_ROUTER_TO_SIGNING_WORKER_ECDSA_AUTH_SECRET:
        routerToSigningWorkerEcdsaAuthSecret,
    }),
    durableObjects: {
      [tenantRootCreationDoBinding]: {
        className: tenantRootCreationDoClass,
        useSQLite: true,
      },
    },
    serviceBindings: {
      DERIVER_A: capturePairPreparation ? captureDeriverAPreparation : 'deriver-a',
      DERIVER_B: gateDeriverB ? routeDeriverBWithOfflineGate : 'deriver-b',
      SIGNING_WORKER: captureSigningWorkerDelivery,
      TENANT_ROOT_CONTROL_PLANE: 'tenant-root-control-plane',
    },
  };
}

function recoveryPeer(workerName, faultPath) {
  return async (request, miniflare) => {
    const path = new URL(request.url).pathname;
    if (recoveryDropEveryOnPath[workerName] === path) {
      return new Response(`simulated unreachable ${workerName} for ${path}`, { status: 503 });
    }
    const hold = recoveryHoldNextOnPath[workerName];
    if (hold && hold.path === path) {
      recoveryHoldNextOnPath[workerName] = null;
      hold.markHeld(await request.clone().json());
      await hold.released;
      const worker = await miniflare.getWorker(
        workerName === 'deriver-a' ? recoveryDeriverA : workerName,
      );
      const response = await worker.fetch(request);
      const body = await response.text();
      hold.answer = { status: response.status, body };
      return new Response(body, { status: response.status, headers: response.headers });
    }
    const drop = recoveryDropNextOnPath[workerName];
    if (drop && drop.path === path) {
      recoveryDropNextOnPath[workerName] = null;
      recoveryDroppedBody[workerName] = await request.clone().text();
      if (drop.afterAnsweredBy) {
        await recoveryAnsweredSignal(drop.afterAnsweredBy, path).promise;
      }
      return new Response(`simulated lost ${workerName} request to ${path}`, { status: 503 });
    }
    if (path === faultPath) {
      if (workerName === 'tenant-root-control-plane') {
        recoveryCapturedControlPlaneActivation = await request.clone().text();
      }
      if (recoveryDropNextActivation[workerName]) {
        recoveryDropNextActivation[workerName] = false;
        return new Response(`simulated lost ${workerName} initial activation`, { status: 503 });
      }
    }
    const worker = await miniflare.getWorker(
      workerName === 'deriver-a' ? recoveryDeriverA : workerName,
    );
    const response = await worker.fetch(request);
    recoveryAnsweredSignal(workerName, path).resolve();
    return response;
  };
}

/// Deriver A again, on the same database and bucket, reaching B through a
/// binding that can hold B's answer: a command admitted before the window
/// closes then writes only after the Router has abandoned the creation.
function lateWritingDeriverAWorker(fixture) {
  return {
    ...deriverAWorker(fixture),
    name: 'deriver-a-late',
    serviceBindings: { DERIVER_B: routeDeriverBHoldingAnswer },
  };
}

/// Arms a hold on the late-writing Deriver A's next creation call to B.
/// `held` resolves once B has answered; `release` delivers the answer.
function holdNextDeriverBAnswer() {
  let markHeld;
  let release;
  const held = new Promise((resolve) => {
    markHeld = resolve;
  });
  const released = new Promise((resolve) => {
    release = resolve;
  });
  pendingDeriverBAnswerHold = { markHeld, released };
  return { held, release };
}

async function routeDeriverBHoldingAnswer(request, miniflare) {
  const worker = await miniflare.getWorker('deriver-b');
  const hold = pendingDeriverBAnswerHold;
  if (!hold || new URL(request.url).pathname !== deriverCreateRoleSharePath) {
    return worker.fetch(request);
  }
  pendingDeriverBAnswerHold = null;
  const response = await worker.fetch(request);
  const body = await response.arrayBuffer();
  hold.markHeld();
  await hold.released;
  return new Response(body, { status: response.status, headers: response.headers });
}

/// The Router again, sharing its creation Durable Object, with both Derivers
/// and the control plane reached through bindings that can lose one
/// initial-activation request: the same faults the VM recovery E2Es inject
/// with proxies.
function recoveryRouterWorker(fixture) {
  const worker = routerWorker(fixture);
  return {
    ...worker,
    name: 'router-recovery',
    durableObjects: {
      [tenantRootCreationDoBinding]: {
        className: tenantRootCreationDoClass,
        scriptName: 'router',
        useSQLite: true,
      },
    },
    serviceBindings: {
      ...worker.serviceBindings,
      DERIVER_A: recoveryPeer('deriver-a', deriverInitialActivationPath),
      DERIVER_B: recoveryPeer('deriver-b', deriverInitialActivationPath),
      TENANT_ROOT_CONTROL_PLANE: recoveryPeer(
        'tenant-root-control-plane',
        controlPlaneInitialActivationPath,
      ),
    },
  };
}

function historicalReplayRouterWorker(fixture, name, deriverAName = 'deriver-a') {
  const worker = routerWorker(fixture, false, true);
  return {
    ...worker,
    name,
    durableObjects: {},
    serviceBindings: {
      ...worker.serviceBindings,
      DERIVER_A: deriverAName,
      SIGNING_WORKER: captureSigningWorkerForHistoricalReplay,
    },
  };
}

function routerWithoutGatewayAuthWorker(fixture) {
  const worker = historicalReplayRouterWorker(fixture, 'router-missing-gateway-auth');
  const bindings = { ...worker.bindings };
  delete bindings.ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET;
  return { ...worker, bindings };
}

function routerWithSharedGatewayAuthWorker(fixture) {
  const worker = historicalReplayRouterWorker(fixture, 'router-shared-gateway-auth');
  return {
    ...worker,
    bindings: {
      ...worker.bindings,
      ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET: internalAuthSecret,
    },
  };
}

async function routeDeriverBWithOfflineGate(request, miniflare) {
  if (deriverBOffline) {
    blockedDeriverBCalls += 1;
    return new Response('simulated Deriver B outage', { status: 503 });
  }
  const worker = await miniflare.getWorker('deriver-b');
  return worker.fetch(request);
}

function tenantRootControlPlaneWorker(fixture) {
  return {
    ...strictWorker(
      'tenant-root-control-plane',
      'tenant-root-control-plane',
      fixture.tenant_root_control_plane_env,
    ),
    durableObjects: {
      [tenantRootCreationDoBinding]: {
        className: tenantRootCreationDoClass,
        scriptName: 'router',
        useSQLite: true,
      },
    },
  };
}

async function captureSigningWorkerDelivery(request, miniflare) {
  const path = new URL(request.url).pathname;
  if (path === ecdsaSigningWorkerPreparePath) {
    capturedEcdsaSigningWorkerPrepare = await request.clone().json();
  }
  if (path === ed25519ActivationPackagesPath) {
    signingWorkerActivationCalls += 1;
    capturedSigningWorkerDelivery = await request.clone().text();
  }
  if (path === ed25519FinalizationLookupPath) {
    signingWorkerFinalizationLookups += 1;
  }
  const worker = await miniflare.getWorker(signingWorkerDeliveryTarget);
  const response = await worker.fetch(request);
  if (path === ecdsaSigningWorkerFinalizePath && loseNextEcdsaSigningWorkerFinalizeReply) {
    loseNextEcdsaSigningWorkerFinalizeReply = false;
    assert.equal(response.ok, true, 'Simulated lost reply requires a committed signature');
    await response.arrayBuffer();
    return new Response('simulated lost SigningWorker finalize reply', { status: 503 });
  }
  return response;
}

async function captureSigningWorkerForHistoricalReplay(request, miniflare) {
  if (new URL(request.url).pathname === ed25519ActivationPackagesPath) {
    historicalReplayActivationCalls += 1;
  }
  return captureSigningWorkerDelivery(request, miniflare);
}

async function captureDeriverAPreparation(request, miniflare) {
  const path = new URL(request.url).pathname;
  const isPreparation = path.endsWith('/ed25519-yao/prepare-pair');
  const isExecution = path.endsWith('/ed25519-yao/execute-pair');
  const preparation = isPreparation ? await request.clone().json() : null;
  const execution = isExecution ? await request.clone().json() : null;
  if (execution) {
    capturedDeriverAExecutionRequest = execution;
    if (holdDeriverAExecutionBeforeDispatch) {
      return new Response('simulated held Deriver A execution', { status: 503 });
    }
  }
  const worker = await miniflare.getWorker('deriver-a');
  let response;
  if (execution && competeDeriverAExecution) {
    const attempts = await Promise.all([worker.fetch(request.clone()), worker.fetch(request)]);
    const outcomes = await Promise.all(attempts.map(async (attempt) => ({
      status: attempt.status,
      body: await attempt.clone().text(),
    })));
    assert.deepEqual(
      outcomes.map((outcome) => outcome.status),
      [200, 200],
      `identical concurrent A calls must replay the one outcome: ${JSON.stringify(outcomes)}`,
    );
    assert.deepEqual(JSON.parse(outcomes[0].body), JSON.parse(outcomes[1].body));
    response = attempts[0];
  } else {
    response = await worker.fetch(request);
  }
  if (preparation && response.ok) {
    capturedDeriverAPreparation = {
      request: preparation,
      receipt: await response.clone().json(),
    };
  }
  if (execution && response.ok) {
    capturedDeriverAExecution = {
      request: execution,
      response: await response.clone().json(),
    };
    if (dropDeriverAExecutionResponse) {
      return new Response('simulated lost Deriver A response', { status: 503 });
    }
  }
  return response;
}

async function applyMigrations(miniflare, binding, workerName, migrationsPath) {
  const database = await miniflare.getD1Database(binding, workerName);
  const migrationFiles = (await readdir(migrationsPath))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const migrationFile of migrationFiles) {
    const sql = await readFile(join(migrationsPath, migrationFile), 'utf8');
    // D1's exec() splits on newlines and treats each line as a statement, so a
    // multi-line CREATE TABLE arrives truncated. Split on statement boundaries
    // and collapse each one to a single line instead.
    for (const statement of splitSqlStatements(sql)) {
      await database.exec(statement);
    }
  }
  return database;
}

/// Splits a migration into single-line statements.
///
/// D1's exec() treats every newline as a statement boundary, so each statement
/// must be collapsed onto one line. Splitting on ";" alone is not enough: a
/// trigger body is itself a semicolon-terminated statement wrapped in
/// BEGIN ... END, and a semicolon inside a string literal is not a boundary
/// either.
function splitSqlStatements(sql) {
  const collapsed = sql
    .split('\n')
    .map((line) => line.replace(/--.*$/u, '').trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/\s+/gu, ' ');

  const statements = [];
  let current = '';
  let inString = false;
  let blockDepth = 0;
  for (let index = 0; index < collapsed.length; index += 1) {
    const char = collapsed[index];
    current += char;
    if (char === "'") {
      // Doubled quotes escape a quote inside a literal.
      if (inString && collapsed[index + 1] === "'") {
        current += collapsed[index + 1];
        index += 1;
        continue;
      }
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (/\bBEGIN$/iu.test(current) && /^[\s(]|^$/u.test(collapsed[index + 1] ?? ' ')) {
      blockDepth += 1;
      continue;
    }
    if (/\bEND$/iu.test(current) && blockDepth > 0) {
      blockDepth -= 1;
      continue;
    }
    if (char === ';' && blockDepth === 0) {
      const statement = current.trim();
      if (statement.length > 1) statements.push(statement);
      current = '';
    }
  }
  const tail = current.trim();
  if (tail.length > 0) statements.push(tail.endsWith(';') ? tail : `${tail};`);
  return statements;
}

function authenticatedJsonRequest(body, additionalHeaders = {}) {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [internalAuthHeader]: internalAuthSecret,
      ...additionalHeaders,
    },
    body: JSON.stringify(body),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function responseBytes(response) {
  return Buffer.from(await response.arrayBuffer());
}

async function expectOk(response, label) {
  const bytes = await responseBytes(response);
  assert.equal(response.status, 200, `${label}: ${bytes.toString('utf8')}`);
  return bytes;
}

// Each role's retirement of the epoch a refresh replaced: within the grace
// after the swap, both are pending.
const retirementKinds = (retirement) => [retirement.deriver_a.kind, retirement.deriver_b.kind];

async function postWorkerJson(worker, path, body, additionalHeaders = {}) {
  const authHeaders = gatewayOnlyRouterPaths.has(path)
    ? { [internalAuthHeader]: gatewayToRouterAuthSecret }
    : gatewayOnlyPresignPaths.has(path)
      ? { [internalAuthHeader]: gatewayToSigningWorkerPresignAuthSecret }
      : routerOnlySigningWorkerEcdsaPaths.has(path)
        ? { [internalAuthHeader]: routerToSigningWorkerEcdsaAuthSecret }
      : {};
  return worker.fetch(
    `https://private.test${path}`,
    authenticatedJsonRequest(body, { ...authHeaders, ...additionalHeaders }),
  );
}

function canonicalField(bytes) {
  const value = Buffer.from(bytes);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(value.length);
  return Buffer.concat([length, value]);
}

function ed25519PrivateKeyFromSeed(seedB64u) {
  const seed = Buffer.from(seedB64u, 'base64url');
  assert.equal(seed.length, 32, 'managed-restore signer seed must be 32 bytes');
  return createPrivateKey({
    key: Buffer.concat([ed25519Pkcs8SeedPrefix, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

function signManagedRestoreAuthorization(bindingB64u, managedRestore, unavailableRole) {
  const binding = Buffer.from(bindingB64u, 'base64url');
  const authenticationInput = Buffer.concat([
    canonicalField(Buffer.from(managedRestoreAuthenticationDomain, 'utf8')),
    canonicalField(binding),
  ]);
  const custody =
    unavailableRole === 'deriver_a'
      ? managedRestore.deriver_a_custody
      : managedRestore.deriver_b_custody;
  const operationsSignature = signEd25519(
    null,
    authenticationInput,
    ed25519PrivateKeyFromSeed(managedRestore.operations.signing_seed_b64u),
  );
  const custodySignature = signEd25519(
    null,
    authenticationInput,
    ed25519PrivateKeyFromSeed(custody.signing_seed_b64u),
  );
  assert.equal(operationsSignature.length, 64);
  assert.equal(custodySignature.length, 64);
  return Buffer.concat([
    binding,
    canonicalField(operationsSignature),
    canonicalField(custodySignature),
  ]).toString('base64url');
}

async function testTenantRootRoleSchema(database, expectedRole) {
  const tableInfo = await database.prepare('PRAGMA table_info(tenant_root_role_shares)').all();
  assert.deepEqual(
    tableInfo.results.map((column) => column.name),
    [
      'tenant_identity_digest_hex',
      'custody_lineage_b64u',
      'tenant_root_share_epoch',
      'role',
      'lifecycle',
      'ciphertext_json',
      'revision',
      'created_at_ms',
      'updated_at_ms',
    ],
    'role-private tenant-root D1 must expose metadata and one outer ciphertext only',
  );

  await assert.rejects(
    database
      .prepare(
        `INSERT INTO tenant_root_role_shares (
           tenant_identity_digest_hex, custody_lineage_b64u, tenant_root_share_epoch,
           role, lifecycle, ciphertext_json, revision, created_at_ms, updated_at_ms
         ) VALUES (?, ?, 1, ?, 'pending', '{}', 1, 10, 10)`,
      )
      .bind(
        'a'.repeat(64),
        'A'.repeat(22),
        expectedRole === 'deriver_a' ? 'deriver_b' : 'deriver_a',
      )
      .run(),
    'each Deriver database must reject the other role',
  );

  const replayTableInfo = await database
    .prepare('PRAGMA table_info(tenant_root_command_replays)')
    .all();
  assert.deepEqual(
    replayTableInfo.results.map((column) => column.name),
    [
      'replay_key_digest_hex',
      'tenant_identity_digest_hex',
      'custody_lineage_b64u',
      'session_id_hex',
      'nonce_hex',
      'role',
      'command_digest_hex',
      'status',
      'receipt_b64u',
      'receipt_digest_hex',
      'reserved_at_ms',
      'executed_at_ms',
      'terminal_at_ms',
      'admission_digest_hex',
      'refresh_state_b64u',
      'refresh_state_digest_hex',
    ],
    'role-private command replay D1 must expose only public binding and receipt fields',
  );
  await assert.rejects(
    database
      .prepare(
        `INSERT INTO tenant_root_command_replays (
           replay_key_digest_hex, tenant_identity_digest_hex, custody_lineage_b64u,
           session_id_hex, nonce_hex, role, command_digest_hex, status, reserved_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', 10)`,
      )
      .bind(
        'a'.repeat(64),
        'b'.repeat(64),
        'A'.repeat(22),
        'c'.repeat(32),
        'd'.repeat(64),
        expectedRole === 'deriver_a' ? 'deriver_b' : 'deriver_a',
        'e'.repeat(64),
      )
      .run(),
    'each Deriver command-replay table must reject the other role',
  );
}

async function testTenantRootCommandReplayCasGuard(database, expectedRole) {
  const replayKeyDigestHex = 'a'.repeat(64);
  await assert.rejects(
    database.prepare('DELETE FROM tenant_root_command_cas_guard').run(),
    'command-replay CAS guard row must be immutable',
  );
  const guard = await database
    .prepare('SELECT guard_id FROM tenant_root_command_cas_guard')
    .first();
  assert.equal(guard.guard_id, 1, 'command-replay CAS guard row must survive deletion attempts');

  await database
    .prepare(
      `INSERT INTO tenant_root_command_replays (
         replay_key_digest_hex, tenant_identity_digest_hex, custody_lineage_b64u,
         session_id_hex, nonce_hex, role, command_digest_hex, status, reserved_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'reserved', 10)`,
    )
    .bind(
      replayKeyDigestHex,
      'b'.repeat(64),
      'C'.repeat(22),
      'd'.repeat(32),
      'e'.repeat(64),
      expectedRole,
      'f'.repeat(64),
    )
    .run();
  const before = await database
    .prepare(
      `SELECT status, executed_at_ms
       FROM tenant_root_command_replays WHERE replay_key_digest_hex = ?`,
    )
    .bind(replayKeyDigestHex)
    .first();
  await assert.rejects(
    database.batch([
      database
        .prepare(
          `UPDATE tenant_root_command_replays
           SET status = 'executed', executed_at_ms = 11
           WHERE replay_key_digest_hex = ?`,
        )
        .bind(replayKeyDigestHex),
      database
        .prepare(
          `INSERT INTO tenant_root_command_cas_guard (guard_id)
           SELECT 1 WHERE changes() <> ?`,
        )
        .bind(2),
    ]),
    'wrong lifecycle/checkpoint change counts must roll back the mutation',
  );
  const after = await database
    .prepare(
      `SELECT status, executed_at_ms
       FROM tenant_root_command_replays WHERE replay_key_digest_hex = ?`,
    )
    .bind(replayKeyDigestHex)
    .first();
  assert.deepEqual(
    after,
    before,
    'wrong lifecycle/checkpoint change counts must not commit partial replay state',
  );
}

async function testTenantRootCreationOperatingPath(topology, fixture, databases) {
  const router = await topology.getWorker('router');
  const backupBucketA = await topology.getR2Bucket(managedBackupR2Binding, 'deriver-a');
  const backupBucketB = await topology.getR2Bucket(managedBackupR2Binding, 'deriver-b');

  const firstBytes = await expectOk(
    await postWorkerJson(router, tenantRootCreationPath, fixture.tenant_root_creation.fresh),
    'fresh-lineage tenant-root creation operating path',
  );
  const first = JSON.parse(firstBytes.toString('utf8'));
  assert.equal(first.revision, 1, 'tenant-root genesis must start at revision 1');
  assert.deepEqual(
    first.status.kind,
    'ready',
    'Router must not return before both role installations are checkpointed',
  );

  const [activeRowsA, activeRowsB] = await Promise.all([
    databases.deriverA
      .prepare(
        `SELECT tenant_identity_digest_hex, custody_lineage_b64u, ciphertext_json
         FROM tenant_root_role_shares
         WHERE tenant_root_share_epoch = 1 AND role = 'deriver_a' AND lifecycle = 'active'`,
      )
      .all(),
    databases.deriverB
      .prepare(
        `SELECT tenant_identity_digest_hex, custody_lineage_b64u, ciphertext_json
         FROM tenant_root_role_shares
         WHERE tenant_root_share_epoch = 1 AND role = 'deriver_b' AND lifecycle = 'active'`,
      )
      .all(),
  ]);
  assert.equal(
    activeRowsA.results.length,
    1,
    'Deriver A must persist exactly one active initial tenant-root row',
  );
  assert.equal(
    activeRowsB.results.length,
    1,
    'Deriver B must persist exactly one active initial tenant-root row',
  );
  const identityDigestHex = Buffer.from(first.identity_digest_b64u, 'base64url').toString('hex');
  const activeA = activeRowsA.results[0];
  const activeB = activeRowsB.results[0];
  assert.equal(activeA.tenant_identity_digest_hex, identityDigestHex);
  assert.equal(activeB.tenant_identity_digest_hex, identityDigestHex);
  assert.equal(activeA.custody_lineage_b64u, first.custody_lineage_b64u);
  assert.equal(activeB.custody_lineage_b64u, first.custody_lineage_b64u);
  assert.notEqual(
    activeA.ciphertext_json,
    activeB.ciphertext_json,
    'Deriver A and B must independently encrypt their active shares for the same tenant root',
  );

  const replayBytes = await expectOk(
    await postWorkerJson(router, tenantRootCreationPath, fixture.tenant_root_creation.fresh),
    'tenant-root creation exact retry',
  );
  assert.deepEqual(
    replayBytes,
    firstBytes,
    'the same signed grant must replay the exact completed response bytes',
  );

  // Each role keeps its managed backup and, beside it, the provider canary
  // receipt a resumed creation needs; both live under its own prefix.
  const [backupsA, backupsB] = await Promise.all([backupBucketA.list(), backupBucketB.list()]);
  for (const [role, objects] of [
    ['deriver-a', backupsA.objects],
    ['deriver-b', backupsB.objects],
  ]) {
    const keys = objects.map((object) => object.key).sort();
    assert.equal(keys.length, 2, `${role} must persist one managed backup and one provider canary`);
    for (const key of keys) {
      assert.ok(
        key.startsWith(`tenant-root-managed-backup/v1/${role}/`),
        `${role} must write only under its role-private prefix: ${key}`,
      );
    }
    assert.ok(keys[0].endsWith('/1.bin'), `${role} must persist its epoch-1 managed backup`);
    assert.ok(
      keys[1].endsWith('/1.provider-canary.bin'),
      `${role} must persist its epoch-1 provider canary`,
    );
  }

  const secondBytes = await expectOk(
    await postWorkerJson(
      router,
      tenantRootCreationPath,
      fixture.tenant_root_creation.second_tenant,
    ),
    'second-tenant tenant-root creation operating path',
  );
  const second = JSON.parse(secondBytes.toString('utf8'));
  assert.equal(second.revision, 1, 'second-tenant genesis must start at revision 1');
  assert.deepEqual(
    second.status.kind,
    'ready',
    'second-tenant Router creation must wait for both role installations',
  );
  assert.notEqual(
    second.identity_digest_b64u,
    first.identity_digest_b64u,
    'second-tenant creation must use a distinct tenant identity',
  );
  assert.notEqual(
    second.custody_lineage_b64u,
    first.custody_lineage_b64u,
    'second-tenant creation must use a distinct custody lineage',
  );
  const secondIdentityDigestHex = Buffer.from(second.identity_digest_b64u, 'base64url').toString(
    'hex',
  );
  const [secondRowsA, secondRowsB] = await Promise.all([
    databases.deriverA
      .prepare(
        `SELECT tenant_identity_digest_hex, custody_lineage_b64u, ciphertext_json
         FROM tenant_root_role_shares
         WHERE tenant_identity_digest_hex = ? AND tenant_root_share_epoch = 1
           AND role = 'deriver_a' AND lifecycle = 'active'`,
      )
      .bind(secondIdentityDigestHex)
      .all(),
    databases.deriverB
      .prepare(
        `SELECT tenant_identity_digest_hex, custody_lineage_b64u, ciphertext_json
         FROM tenant_root_role_shares
         WHERE tenant_identity_digest_hex = ? AND tenant_root_share_epoch = 1
           AND role = 'deriver_b' AND lifecycle = 'active'`,
      )
      .bind(secondIdentityDigestHex)
      .all(),
  ]);
  assert.equal(
    secondRowsA.results.length,
    1,
    'Deriver A must persist one active row for the second tenant',
  );
  assert.equal(
    secondRowsB.results.length,
    1,
    'Deriver B must persist one active row for the second tenant',
  );
  assert.equal(secondRowsA.results[0].custody_lineage_b64u, second.custody_lineage_b64u);
  assert.equal(secondRowsB.results[0].custody_lineage_b64u, second.custody_lineage_b64u);
  assert.notEqual(
    secondRowsA.results[0].ciphertext_json,
    activeA.ciphertext_json,
    'Deriver A must keep second-tenant ciphertext separate from the first tenant',
  );
  assert.notEqual(
    secondRowsB.results[0].ciphertext_json,
    activeB.ciphertext_json,
    'Deriver B must keep second-tenant ciphertext separate from the first tenant',
  );

  return {
    tenantRoot: {
      identity_digest_b64u: first.identity_digest_b64u,
      custody_lineage_b64u: first.custody_lineage_b64u,
    },
    secondTenantRoot: {
      identity_digest_b64u: second.identity_digest_b64u,
      custody_lineage_b64u: second.custody_lineage_b64u,
    },
  };
}

/// One ECDSA registration as the client builds it: the bootstrap, the
/// ceremony that must be freed, its request, binding and bearer token. Each
/// `label` names a distinct lifecycle, session and replay nonce; `identity`
/// names the tenant root's organisation, project and environment.
function buildEcdsaRegistration(fixture, jwtSigner, label = 'ecdsa-live', identity = null) {
  const accountId = `${label}-account`;
  const clientId = `${label}-client`;
  const sessionId = `${label}-session`;
  const lifecycleId = `${label}-lifecycle`;
  const signerSetId = 'signer-set-v1';
  const rootShareEpoch = 'epoch-1';
  const selectedServerId = 'signing-worker-local';
  const expiresAtMs = Date.now() + 120_000;
  const applicationBindingDigestB64u = Buffer.alloc(32, 0x42).toString('base64url');
  const prepared = JSON.parse(
    prepare_ecdsa_client_bootstrap_v1(
      JSON.stringify({
        kind: 'prepare_ecdsa_client_bootstrap_v1',
        algorithm: 'router_ab_ecdsa_derivation_secp256k1_role_local_v1',
        context: { applicationBindingDigestB64u },
        participants: {
          clientParticipantId: 1,
          relayerParticipantId: 2,
          participantIds: [1, 2],
        },
        secretSource: {
          kind: 'threshold_prf_x_client_base',
          xClientBaseB64u: Buffer.alloc(32, 0x11).toString('base64url'),
        },
      }),
    ),
  );
  const ceremony = new RouterAbEcdsaClientCeremonyV1();
  {
    const registrationRequest = JSON.parse(
      ceremony.build_registration_request(
        JSON.stringify({
          registration_purpose: 'wallet_registration',
          context: { application_binding_digest_b64u: applicationBindingDigestB64u },
          lifecycle: {
            lifecycle_id: lifecycleId,
            work_kind: 'registration_prepare',
            primitive_request_kind: 'registration',
            root_share_epoch: rootShareEpoch,
            account_id: accountId,
            session_id: sessionId,
            signer_set_id: signerSetId,
            selected_server_id: selectedServerId,
          },
          signer_set: {
            signer_set_id: signerSetId,
            policy: 'all_2',
            signer_a: { role: 'signer_a', signer_id: 'signer-a', key_epoch: rootShareEpoch },
            signer_b: { role: 'signer_b', signer_id: 'signer-b', key_epoch: rootShareEpoch },
            selected_server: {
              server_id: selectedServerId,
              key_epoch: rootShareEpoch,
              recipient_encryption_key:
                fixture.signing_worker_env.SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY,
            },
          },
          router_id: 'local-router',
          client_id: clientId,
          replay_nonce: `${label}-replay-nonce`,
          expires_at_ms: expiresAtMs,
          deriver_recipient_keys: {
            deriver_a: {
              role: 'signer_a',
              key_epoch: rootShareEpoch,
              public_key: fixture.router_env.DERIVER_A_ENVELOPE_HPKE_PUBLIC_KEY,
            },
            deriver_b: {
              role: 'signer_b',
              key_epoch: rootShareEpoch,
              public_key: fixture.router_env.DERIVER_B_ENVELOPE_HPKE_PUBLIC_KEY,
            },
          },
        }),
      ),
    );
    const binding = JSON.parse(ceremony.registration_binding());
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = signRouterJwt(jwtSigner, fixture, {
      sub: clientId,
      exp: Math.ceil(expiresAtMs / 1000),
      nbf: nowSeconds - 1,
      iat: nowSeconds - 1,
      sid: sessionId,
      org_id: identity?.orgId ?? 'org-miniflare',
      project_id: identity?.projectId ?? 'project-r120',
      environment: identity?.envId ?? 'test',
      project_environment_id: 'project-environment-miniflare',
      account_id: accountId,
      routerAbRequestPolicy: {
        policyVersion: 'router-ab-ecdsa-registration-v1',
        workKind: 'registration_prepare',
        requestDigest: {
          bytes: Array.from(Buffer.from(binding.requestDigestB64u, 'base64url')),
        },
      },
    });
    return {
      accountId,
      clientId,
      sessionId,
      lifecycleId,
      rootShareEpoch,
      selectedServerId,
      applicationBindingDigestB64u,
      prepared,
      ceremony,
      registrationRequest,
      binding,
      token,
    };
  }
}

async function testEcdsaRegistrationAndActivation(topology, fixture, tenantRoot, jwtSigner) {
  ensureEcdsaClientWasm();
  const router = await topology.getWorker('router');
  const {
    accountId,
    lifecycleId,
    rootShareEpoch,
    selectedServerId,
    applicationBindingDigestB64u,
    prepared,
    ceremony,
    registrationRequest,
    binding,
    token,
  } = buildEcdsaRegistration(fixture, jwtSigner);
  try {
    const registrationBytes = await expectOk(
      await postWorkerJson(
        router,
        ecdsaRegistrationPath,
        { registration_request: registrationRequest, tenant_root: tenantRoot },
        { authorization: `Bearer ${token}` },
      ),
      'live Router ECDSA registration',
    );
    const registration = JSON.parse(registrationBytes.toString('utf8'));
    assert.equal(registration.result, 'forwarded');
    assert.equal(
      registration.response.bundles.signerA.transcriptDigestB64u,
      binding.transcriptDigestB64u,
      'Deriver A client proof must bind the live registration transcript',
    );
    assert.equal(
      registration.response.bundles.signerB.transcriptDigestB64u,
      binding.transcriptDigestB64u,
      'Deriver B client proof must bind the live registration transcript',
    );
    ceremony.verify_encrypted_proof_bundles(
      JSON.stringify({
        kind: 'finalize_encrypted_client_proof_bundles_v2',
        bundles: registration.response.bundles,
      }),
    );

    const activationBody = {
      activation_correlation_id:
        registration.pending_activation.activation_context.lifecycle.lifecycle_id,
      pending: registration.pending_activation,
      client_activation: {
        registrationRequestDigestB64u: binding.requestDigestB64u,
        proofTranscriptDigestB64u: binding.transcriptDigestB64u,
        contextBinding32B64u: prepared.clientBootstrap.contextBinding32B64u,
        derivationClientSharePublicKey33B64u:
          prepared.clientBootstrap.derivationClientSharePublicKey33B64u,
        clientShareRetryCounter: prepared.clientBootstrap.clientShareRetryCounter,
        participantId: prepared.clientBootstrap.participantId,
      },
    };
    const activationBytes = await expectOk(
      await postWorkerJson(router, ecdsaActivationPath, activationBody, {
        authorization: `Bearer ${token}`,
      }),
      'live Router ECDSA activation',
    );
    const activation = JSON.parse(activationBytes.toString('utf8'));
    if (process.env.ROUTER_AB_WALLET_DO_HARNESS === 'enabled') {
      const changedOwner = JSON.parse(JSON.stringify(activationBody));
      changedOwner.pending.wallet_scope.project_environment_id = 'another-project-environment';
      const rejected = await postWorkerJson(router, ecdsaActivationPath, changedOwner, {
        authorization: `Bearer ${token}`,
      });
      const rejectedBody = Buffer.from(await rejected.arrayBuffer()).toString('utf8');
      assert.equal(rejected.status, 500, rejectedBody);
      assert.match(
        rejectedBody,
        /ECDSA activation owner differs from the verified ceremony session/,
      );
    }
    assert.equal(activation.activated, true);
    assert.equal(
      activation.lifecycle_id,
      lifecycleId,
      'live ECDSA activation must return the requested lifecycle id',
    );
    const identity = activation.ecdsa_activation.public_identity;
    assert.equal(
      activation.ecdsa_activation.context.application_binding_digest_b64u,
      applicationBindingDigestB64u,
      'live ECDSA activation must preserve the application binding context',
    );
    assert.equal(
      activation.ecdsa_activation.signing_worker.server_id,
      selectedServerId,
      'live ECDSA activation must identify the selected SigningWorker',
    );
    assert.equal(
      activation.ecdsa_activation.activation_epoch,
      rootShareEpoch,
      'live ECDSA activation must preserve the active root-share epoch',
    );
    assert.equal(
      identity.context_binding_b64u,
      prepared.clientBootstrap.contextBinding32B64u,
      'live ECDSA identity must bind the client bootstrap context',
    );
    assert.equal(
      identity.derivation_client_share_public_key33_b64u,
      prepared.clientBootstrap.derivationClientSharePublicKey33B64u,
      'live ECDSA identity must bind the client share public key',
    );
    const expectedEthereumAddress = `0x${Buffer.from(
      identity.ethereum_address20_b64u,
      'base64url',
    ).toString('hex')}`;
    const finalized = JSON.parse(
      finalize_ecdsa_client_bootstrap_v1(
        JSON.stringify({
          kind: 'finalize_ecdsa_client_bootstrap_v1',
          pendingStateBlob: prepared.pendingStateBlob,
          relayerPublicIdentity: {
            relayerKeyId: selectedServerId,
            relayerPublicKey33B64u: identity.server_public_key33_b64u,
            groupPublicKey33B64u: identity.threshold_public_key33_b64u,
            ethereumAddress: expectedEthereumAddress,
            relayerShareRetryCounter: identity.server_share_retry_counter,
          },
        }),
      ),
    );
    assert.equal(
      finalized.publicFacts.contextBinding32B64u,
      identity.context_binding_b64u,
      'live ECDSA identity must preserve the stable context binding',
    );
    assert.equal(
      finalized.publicFacts.derivationClientSharePublicKey33B64u,
      identity.derivation_client_share_public_key33_b64u,
      'live ECDSA identity must preserve the client share public key',
    );
    assert.equal(
      finalized.publicFacts.relayerPublicKey33B64u,
      identity.server_public_key33_b64u,
      'live ECDSA identity must preserve the server share public key',
    );
    assert.equal(
      finalized.publicFacts.groupPublicKey33B64u,
      identity.threshold_public_key33_b64u,
      'live ECDSA identity must equal the independently recomposed aggregate public key',
    );
    assert.equal(
      finalized.publicFacts.ethereumAddress,
      expectedEthereumAddress,
      'live ECDSA identity must equal the independently recomposed aggregate Ethereum address',
    );

    const replayBytes = await expectOk(
      await postWorkerJson(router, ecdsaActivationPath, activationBody, {
        authorization: `Bearer ${token}`,
      }),
      'live Router ECDSA activation exact retry',
    );
    assert.deepEqual(
      replayBytes,
      activationBytes,
      'exact live activation retry must replay byte-identical response bytes',
    );
    const replayIdentity = JSON.parse(replayBytes.toString('utf8')).ecdsa_activation
      .public_identity;
    assert.deepEqual(
      replayIdentity,
      identity,
      'exact live activation retry must preserve the complete public identity',
    );
    return {
      activation,
      activationBody,
      activationBytes,
      identity,
      identityBytes: Buffer.from(JSON.stringify(identity), 'utf8'),
      finalized,
      token,
      accountId,
      selectedServerId,
    };
  } finally {
    ceremony.free();
  }
}

function base64urlBytes(value) {
  return Buffer.from(value).toString('base64url');
}

function hashBase64url(value) {
  return createHash('sha256').update(value).digest('base64url');
}

function buildEcdsaNormalSigningScope(ecdsa) {
  const receipt = ecdsa.activation.ecdsa_activation;
  assert.equal(
    receipt.material_activation.material_owner,
    ecdsa.accountId,
    'ECDSA activation material must name the live signing account',
  );
  assert.equal(
    receipt.material_activation.signing_worker,
    ecdsa.selectedServerId,
    'ECDSA activation material must name the live SigningWorker',
  );
  return {
    wallet_id: ecdsa.accountId,
    ecdsa_threshold_key_id: 'ecdsa-live-threshold-key',
    signing_root_id: 'project:local',
    signing_root_version: 'v1',
    context: receipt.context,
    public_identity: receipt.public_identity,
    material_activation: receipt.material_activation,
    signing_worker: receipt.signing_worker,
    activation_epoch: receipt.activation_epoch,
  };
}

function parseEcdsaPresignProgress(bytes, sessionId, label) {
  const progress = JSON.parse(bytes.toString('utf8'));
  assert.equal(progress.presign_session_id, sessionId, `${label} must preserve the session id`);
  return progress;
}

async function runEcdsaPresignSession(topology, ecdsa, mode = 'pool', checkRejections = true) {
  const signingWorker = await topology.getWorker('fixture-signing-worker');
  const scope = buildEcdsaNormalSigningScope(ecdsa);
  const authority = {
    kind: 'owner_wallet_session',
    wallet_scope: {
      org_id: 'org-miniflare',
      project_id: 'project-r120',
      project_environment_id: 'project-environment-miniflare',
      wallet_id: ecdsa.accountId,
    },
  };
  const groupPublicKey = Buffer.from(
    scope.public_identity.threshold_public_key33_b64u,
    'base64url',
  );
  assert.equal(groupPublicKey.length, 33, 'ECDSA aggregate public key must be compressed secp256k1');
  const expiresAtMs = Date.now() + 120_000;
  const presignSessionId = `ecdsa-presign-v2:${expiresAtMs}:${randomBytes(32).toString("base64url")}`;
  const client = new EcdsaRoleLocalPresignSessionV1(
    ecdsa.finalized.stateBlob.stateBlobB64u,
    groupPublicKey,
    presignSessionId,
  );
  try {
    let clientProgress = client.poll();
    assert.equal(clientProgress.stage, 'triples');
    assert.equal(clientProgress.outgoing.length, 1, 'ECDSA client triples must start with one message');
    const initRequest = {
      scope,
      authority,
      presign_session_id: presignSessionId,
      first_message_b64u: base64urlBytes(clientProgress.outgoing[0]),
      ceremony_expires_at_ms: expiresAtMs,
      material_expires_at_ms: expiresAtMs,
    };
    if (checkRejections) {
      const wrongWallet = await postWorkerJson(signingWorker, ecdsaPresignSessionInitPath, {
        ...initRequest,
        authority: {
          kind: 'owner_wallet_session',
          wallet_scope: { ...authority.wallet_scope, wallet_id: 'another-wallet' },
        },
      });
      assert.equal(wrongWallet.status, 400, 'Owner presign init must match the signing wallet');
      const sharedBearer = await postWorkerJson(signingWorker, ecdsaPresignSessionInitPath, initRequest, {
        [internalAuthHeader]: internalAuthSecret,
      });
      assert.equal(sharedBearer.status, 403, 'Peer-shared bearer must not admit owner presign init');
      const routerBearer = await postWorkerJson(signingWorker, ecdsaPresignSessionInitPath, initRequest, {
        [internalAuthHeader]: gatewayToRouterAuthSecret,
      });
      assert.equal(routerBearer.status, 403, 'Gateway-to-Router bearer must not admit owner presign init');
    }
    const initResponse = await postWorkerJson(signingWorker, ecdsaPresignSessionInitPath, initRequest);
    let progress = parseEcdsaPresignProgress(
      await expectOk(initResponse, 'SigningWorker ECDSA presign session init'),
      presignSessionId,
      'ECDSA presign session init',
    );
    assert.equal(progress.outgoing_messages_b64u.length, 2);
    let exchanges = 1;
    while (progress.kind !== 'complete' && exchanges < 8) {
      for (const message of progress.outgoing_messages_b64u) {
        client.message(Buffer.from(message, 'base64url'));
        if (client.stage() === 'triples_done') client.start_presign();
      }
      clientProgress = client.poll();
      if (mode === 'prepare' && clientProgress.event === 'final_batch_ready') {
        const clientBigR = Buffer.from(client.candidate_big_r_33());
        assert.throws(() => client.presignature_big_r_33());
        return {
          client, scope, groupPublicKey, clientBigR,
          serverPresignatureId: `presig-${hashBase64url(clientBigR)}`,
          expiresAtMs,
          presignSource: {
            kind: 'final_presign_batch',
            batch: {
              scope, authority, presign_session_id: presignSessionId, requested_stage: 'presign',
              outgoing_messages_b64u: clientProgress.outgoing.map(base64urlBytes),
              ceremony_expires_at_ms: expiresAtMs, material_expires_at_ms: expiresAtMs,
            },
          },
        };
      }
      const stepRequest = {
        scope,
        authority,
        presign_session_id: presignSessionId,
        requested_stage: progress.stage,
        outgoing_messages_b64u: clientProgress.outgoing.map(base64urlBytes),
        ceremony_expires_at_ms: expiresAtMs,
        material_expires_at_ms: expiresAtMs,
      };
      if (checkRejections && exchanges === 1) {
        const changedAuthority = await postWorkerJson(signingWorker, ecdsaPresignSessionStepPath, {
          ...stepRequest,
          authority: { kind: 'operation_step_up', wallet_scope: authority.wallet_scope },
        });
        assert.equal(changedAuthority.ok, false, 'A changed authority must not advance presigning');
        assert.match(await changedAuthority.text(), /authority does not match initialized session/);
        const changedTenant = await postWorkerJson(signingWorker, ecdsaPresignSessionStepPath, {
          ...stepRequest,
          authority: {
            kind: 'owner_wallet_session',
            wallet_scope: { ...authority.wallet_scope, org_id: 'another-org' },
          },
        });
        assert.equal(changedTenant.ok, false, 'A changed tenant must not advance presigning');
        assert.match(await changedTenant.text(), /authority does not match initialized session/);
        const peerBearer = await postWorkerJson(signingWorker, ecdsaPresignSessionStepPath, stepRequest, {
          [internalAuthHeader]: internalAuthSecret,
        });
        assert.equal(peerBearer.status, 403, 'Peer-shared bearer must not advance owner presigning');
      }
      const stepResponse = await postWorkerJson(signingWorker, ecdsaPresignSessionStepPath, stepRequest);
      exchanges += 1;
      progress = parseEcdsaPresignProgress(
        await expectOk(stepResponse, 'SigningWorker ECDSA presign step'),
        presignSessionId,
        'ECDSA presign step',
      );
    }
    const complete = progress;
    assert.equal(exchanges, 6, 'Owner presigning must use one init plus five steps');
    assert.equal(complete.kind, 'complete');
    for (const message of complete.outgoing_messages_b64u) client.message(Buffer.from(message, 'base64url'));
    assert.equal(client.stage(), 'done');
    if (checkRejections) {
    const objectIds = await topology.listDurableObjectIds(
      'SIGNING_WORKER_PRESIGN_SESSION_DO', 'fixture-signing-worker',
    );
    assert.ok(objectIds.length > 0);
    for (const id of objectIds) {
      await topology.unsafeEvictDurableObject(
        'fixture-signing-worker', 'RouterAbSigningWorkerPresignSessionDurableObject', { id },
      );
    }
    const replay = await postWorkerJson(signingWorker, ecdsaPresignSessionInitPath, initRequest);
    assert.equal(replay.ok, false, 'Completed identities must remain burned');
    assert.match(await replay.text(), /ReplayedLocalRequest/);
    const changedExpiry = await postWorkerJson(signingWorker, ecdsaPresignSessionInitPath, {
      ...initRequest,
      ceremony_expires_at_ms: expiresAtMs + 1,
      material_expires_at_ms: expiresAtMs + 1,
    });
    assert.equal(changedExpiry.ok, false, 'A burned identity cannot be revived by extending its deadline');
    assert.match(await changedExpiry.text(), /Invalid presign session identity or bound expiry/);
    }
    const clientBigR = Buffer.from(client.presignature_big_r_33());
    assert.equal(clientBigR.length, 33, 'ECDSA client presignature must expose a compressed R point');
    assert.equal(
      complete.server_big_r33_b64u,
      base64urlBytes(clientBigR),
      'ECDSA client and SigningWorker presignatures must bind the same R point',
    );
    assert.equal(
      complete.server_presignature_id,
      `presig-${hashBase64url(clientBigR)}`,
      'ECDSA presignature id must be derived from the shared R point',
    );
    return {
      client,
      scope,
      groupPublicKey,
      clientBigR,
      serverPresignatureId: complete.server_presignature_id,
      expiresAtMs,
    };
  } catch (error) {
    client.free();
    throw error;
  }
}

function buildEcdsaAuthorizedOperation(operationId, operationDigests) {
  return {
    kind: 'reusable_wallet_session_authorized_operation_v1',
    authorized_operation_id: operationId,
    operation_id: operationId,
    capability_kind: 'evm_ecdsa_mpc_signing',
    operation_kind: 'evm.sign_transaction',
    lane_digest_b64u: operationDigests.lane_digest_b64u,
    intent_digest_b64u: operationDigests.intent_digest_b64u,
    display_digest_b64u: operationDigests.display_digest_b64u,
    operation_fingerprint_digest: hashBase64url(`ecdsa-live-fingerprint:${operationId}`),
  };
}

async function testEcdsaNormalSigning(
  topology,
  ecdsa,
  mode = 'pool',
  checkRejections = true,
  interruptAfterClaim = false,
) {
  const router = await topology.getWorker('router');
  const presign = await runEcdsaPresignSession(topology, ecdsa, mode, checkRejections);
  try {
    const operationId = `ecdsa-live-normal-sign-operation-${randomBytes(16).toString('hex')}`;
    const signingDigestBytes = createHash('sha256')
      .update('ecdsa-live-normal-signing-digest')
      .digest();
    const operationDigests = {
      lane_digest_b64u: hashBase64url('ecdsa-live-lane-digest'),
      intent_digest_b64u: base64urlBytes(signingDigestBytes),
      display_digest_b64u: hashBase64url('ecdsa-live-display-digest'),
    };
    const expiresAtMs = Math.min(presign.expiresAtMs, Date.now() + 120_000);
    const materialActivation = presign.scope.material_activation;
    const authorization = {
      kind: 'reusable_wallet_session',
      wallet_session_id: 'ecdsa-live-normal-wallet-session',
    };
    const acceptedBinding = {
      kind: 'gateway_owner_wallet_session',
      subject_id: ecdsa.accountId,
      account_id: ecdsa.accountId,
      authorization_id: 'ecdsa-live-normal-authorization',
      wallet_session_id: authorization.wallet_session_id,
      quota_id: 'ecdsa-live-normal-quota',
      threshold_session_id: 'ecdsa-live-normal-threshold-session',
      org_id: 'org-miniflare',
      project_id: 'project-r120',
      environment: 'test',
      project_environment_id: 'project-environment-miniflare',
      signing_worker_id: ecdsa.selectedServerId,
      expires_at_ms: expiresAtMs,
    };
    const authorizedOperation = buildEcdsaAuthorizedOperation(operationId, operationDigests);
    const clientContribution = Buffer.alloc(32, 0x44);
    const clientCommitment = createHash('sha256')
      .update('router-ab-ecdsa-derivation/client-rerandomization-commitment/v1')
      .update(clientContribution)
      .digest('base64url');
    const prepareRequest = {
      scope: presign.scope,
      request_id: `ecdsa-live-normal-sign-request-${randomBytes(16).toString('hex')}`,
      operation_id: operationId,
      operation_digests: operationDigests,
      authorization,
      material_activation: materialActivation,
      client_presignature_id: presign.serverPresignatureId,
      expires_at_ms: expiresAtMs,
      signing_digest_b64u: operationDigests.intent_digest_b64u,
      client_rerandomization_commitment32_b64u: clientCommitment,
      authorized_operation: {
        binding: acceptedBinding,
        authorized_operation: authorizedOperation,
      },
    };
    if (mode === 'prepare') {
      prepareRequest.presign_source = presign.presignSource;
    }
    if (checkRejections) {
      const sharedBearer = await postWorkerJson(router, ecdsaSigningPreparePath, prepareRequest, {
        [internalAuthHeader]: internalAuthSecret,
      });
      assert.equal(
        sharedBearer.status,
        403,
        'Gateway-admitted signing must reject the role-shared bearer',
      );
    }
    if (mode === 'prepare') {
      const bundled = await postWorkerJson(router, ecdsaSigningPreparePath, prepareRequest);
      assert.equal(bundled.ok, false, 'Bundled final batch must be gated before signing admission');
      assert.match(await bundled.text(), /Bundled final presign batch is gated/);

      const signingWorker = await topology.getWorker('fixture-signing-worker');
      if (checkRejections) {
        assert.ok(capturedEcdsaSigningWorkerPrepare, 'A prior Router admission must be available');
        const forgedWorkerPrepare = await postWorkerJson(
          signingWorker,
          ecdsaSigningWorkerPreparePath,
          {
            ...capturedEcdsaSigningWorkerPrepare,
            presign_source: presign.presignSource,
          },
          { [internalAuthHeader]: internalAuthSecret },
        );
        assert.equal(
          forgedWorkerPrepare.ok,
          false,
          'The role-shared SigningWorker route must not advance a live owner presign session',
        );
        assert.equal(forgedWorkerPrepare.status, 403);
        const admittedForgedWorkerPrepare = await postWorkerJson(
          signingWorker,
          ecdsaSigningWorkerPreparePath,
          {
            ...capturedEcdsaSigningWorkerPrepare,
            presign_source: presign.presignSource,
          },
        );
        assert.equal(admittedForgedWorkerPrepare.ok, false);
        assert.match(await admittedForgedWorkerPrepare.text(), /Bundled final presign batch is gated/);
      }
      const directStep = await postWorkerJson(
        signingWorker,
        ecdsaPresignSessionStepPath,
        presign.presignSource.batch,
      );
      const completed = parseEcdsaPresignProgress(
        await expectOk(directStep, 'dedicated owner presign final step'),
        presign.presignSource.batch.presign_session_id,
        'dedicated owner presign final step',
      );
      assert.equal(completed.kind, 'complete');
      assert.equal(completed.server_presignature_id, presign.serverPresignatureId);
      for (const message of completed.outgoing_messages_b64u) {
        presign.client.message(Buffer.from(message, 'base64url'));
      }
      assert.equal(presign.client.stage(), 'done');
      assert.deepEqual(Buffer.from(presign.client.presignature_big_r_33()), presign.clientBigR);
      delete prepareRequest.presign_source;
    }
    const prepareResponse = await postWorkerJson(
      router,
      ecdsaSigningPreparePath,
      prepareRequest,
    );
    const prepareBytes = await expectOk(prepareResponse, 'live ECDSA normal-signing prepare');
    const response = JSON.parse(prepareBytes.toString('utf8'));
    const prepared = response;
    assert.equal(prepared.request_id, prepareRequest.request_id);
    assert.deepEqual(
      prepared.scope.public_identity,
      ecdsa.identity,
      'ECDSA normal-signing prepare must preserve the activated public identity',
    );
    assert.equal(
      prepared.server_presignature_id,
      presign.serverPresignatureId,
      'ECDSA normal-signing prepare must consume the exact presignature selected by the client',
    );
    assert.equal(
      prepared.server_big_r33_b64u,
      base64urlBytes(presign.clientBigR),
      'ECDSA normal-signing prepare must return the client presignature R point',
    );
    const serverContribution = Buffer.from(
      prepared.signing_worker_rerandomization_contribution32_b64u,
      'base64url',
    );
    assert.equal(serverContribution.length, 32);
    const clientSignatureShare = presign.client.compute_signature_share(
      presign.groupPublicKey,
      presign.clientBigR,
      signingDigestBytes,
      clientContribution,
      serverContribution,
    );
    assert.equal(clientSignatureShare.length, 32, 'ECDSA client signature share must be 32 bytes');
    const finalizeRequest = {
      scope: presign.scope,
      request_id: prepareRequest.request_id,
      operation_id: operationId,
      operation_digests: operationDigests,
      authorization,
      material_activation: materialActivation,
      expires_at_ms: expiresAtMs,
      signing_digest_b64u: prepareRequest.signing_digest_b64u,
      server_presignature_id: prepared.server_presignature_id,
      client_signature_share32_b64u: base64urlBytes(clientSignatureShare),
      client_rerandomization_contribution32_b64u: base64urlBytes(clientContribution),
      authorized_operation: {
        binding: acceptedBinding,
        authorized_operation: authorizedOperation,
      },
    };
    if (interruptAfterClaim) {
      const interrupted = await postWorkerJson(router, ecdsaSigningPath, finalizeRequest);
      const interruptedBody = await interrupted.text();
      assert.equal(interrupted.status, 500, `interrupted signing response: ${interruptedBody}`);
      assert.match(interruptedBody, /R150 test interrupted after ECDSA claim/);
      const objectIds = await topology.listDurableObjectIds(
        'RouterAbSigningWorkerWalletDurableObject',
        'fixture-signing-worker',
      );
      assert.equal(objectIds.length, 1);
      await topology.unsafeEvictDurableObject(
        'fixture-signing-worker',
        'RouterAbSigningWorkerWalletDurableObject',
        { id: objectIds[0] },
      );
      // The Router keeps the SigningWorker's refusal as a retryable 409,
      // which the Gateway treats as an operation still in progress.
      const retry = await postWorkerJson(router, ecdsaSigningPath, finalizeRequest);
      const retryBody = await retry.text();
      assert.equal(retry.status, 409, `interrupted retry response: ${retryBody}`);
      assert.match(retryBody, /^ReplayedLocalRequest: /);
      assert.match(retryBody, /SigningWorker ECDSA effect is already in progress/);
      const signingWorker = await topology.getWorker('fixture-signing-worker');
      const consumedPrepare = await postWorkerJson(
        signingWorker,
        ecdsaSigningWorkerPreparePath,
        capturedEcdsaSigningWorkerPrepare,
      );
      assert.equal(consumedPrepare.ok, false, 'interrupted presignature must stay consumed');
      return { finalizeRequest, pendingAfterEviction: true, materialConsumed: true };
    }
    if (mode === 'prepare' && process.env.ROUTER_AB_WALLET_DO_HARNESS === 'enabled') {
      loseNextEcdsaSigningWorkerFinalizeReply = true;
      const lostReply = await postWorkerJson(router, ecdsaSigningPath, finalizeRequest);
      assert.equal(lostReply.ok, false, 'Simulated lost SigningWorker reply must reach Router');
      assert.equal(loseNextEcdsaSigningWorkerFinalizeReply, false);
    }
    const finalizeResponse = await postWorkerJson(router, ecdsaSigningPath, finalizeRequest);
    const finalizeBytes = await expectOk(finalizeResponse, 'live ECDSA normal-signing finalize');
    const signed = JSON.parse(finalizeBytes.toString('utf8'));
    assert.equal(signed.request_id, finalizeRequest.request_id);
    assert.deepEqual(
      signed.scope.public_identity,
      ecdsa.identity,
      'ECDSA normal-signing finalize must preserve the activated public identity',
    );
    const signature = Buffer.from(signed.signature65_b64u, 'base64url');
    assert.equal(signature.length, 65, 'ECDSA normal-signing must return a recoverable signature');
    assert.ok(
      signature[64] === 0 || signature[64] === 1,
      'ECDSA normal-signing recovery id must be a canonical parity byte',
    );
    assert.equal(
      secp256k1.verify(signature.subarray(0, 64), signingDigestBytes, presign.groupPublicKey),
      true,
      'ECDSA normal-signing signature must verify against the activated aggregate public key',
    );
    if (mode === 'prepare' && checkRejections) {
      const duplicate = await postWorkerJson(router, ecdsaSigningPath, finalizeRequest);
      const replayBytes = await expectOk(duplicate, 'exact completed operation replay');
      assert.deepEqual(JSON.parse(replayBytes.toString('utf8')), signed, 'Replay returns the durable first result');
      const substituted = await postWorkerJson(router, ecdsaSigningPath, {
        ...finalizeRequest, client_signature_share32_b64u: base64urlBytes(Buffer.alloc(32, 0x66)),
      });
      assert.equal(substituted.ok, false, 'Consumed material cannot be rebound to different finalization input');
      if (process.env.ROUTER_AB_WALLET_DO_HARNESS === 'enabled') {
        const signingWorker = await topology.getWorker('fixture-signing-worker');
        const consumedPrepare = await postWorkerJson(
          signingWorker,
          ecdsaSigningWorkerPreparePath,
          capturedEcdsaSigningWorkerPrepare,
        );
        assert.equal(
          consumedPrepare.ok,
          false,
          'Consumed wallet-DO material cannot be prepared again',
        );
      }
    }
    return { prepare: prepared, response: signed, finalizeRequest };
  } finally {
    presign.client.free();
  }
}

function buildEd25519ExecuteRequest(fixture, fixtureKey, tenantRoot, source = fixture[fixtureKey]) {
  const identity = tenantRoot.identity ?? (fixtureKey.startsWith('second_tenant')
    ? fixture.tenant_root_creation.second_tenant_identity
    : fixture.tenant_root_creation.identity);
  assert.ok(source && typeof source === 'object', `${fixtureKey} fixture is required`);
  assert.ok(source.gateway_request, `${fixtureKey} gateway request is required`);
  assert.ok(
    source.application && typeof source.application === 'object',
    `${fixtureKey} server-resolved application facts are required`,
  );
  assert.ok(
    Array.isArray(source.participant_ids),
    `${fixtureKey} server-resolved participant ids are required`,
  );
  assert.equal(
    source.participant_ids.length,
    2,
    `${fixtureKey} must resolve exactly two Ed25519 participants`,
  );
  return {
    tenant_root: {
      identity,
      custody_lineage_b64u: tenantRoot.custody_lineage_b64u,
    },
    application: source.application,
    participant_ids: source.participant_ids,
    target: source.gateway_request,
  };
}

function parseEd25519ActivationResult(bytes, label) {
  const result = JSON.parse(bytes.toString('utf8'));
  assert.equal(
    result.status,
    'succeeded',
    `${label} must succeed: ${JSON.stringify(result.error ?? result)}`,
  );
  assert.equal(result.result.operation, 'registration', `${label} must register a key`);
  const activation = result.result.result;
  assert.ok(activation && activation.public_receipt, `${label} must return a public receipt`);
  const publicReceipt = activation.public_receipt;
  assert.ok(
    Array.isArray(publicReceipt.registered_public_key) &&
      publicReceipt.registered_public_key.length === 32,
    `${label} must return a 32-byte Ed25519 public key`,
  );
  assert.ok(
    publicReceipt.registered_public_key.some((byte) => byte !== 0),
    `${label} Ed25519 public key must be nonzero`,
  );
  return { result, publicReceipt };
}

async function captureValidActivationDelivery(
  topology,
  fixture,
  tenantRoot,
  fixtureKey = 'activation',
  requireDelivery = true,
) {
  capturedSigningWorkerDelivery = undefined;
  const router = await topology.getWorker('router');
  const envelope = buildEd25519ExecuteRequest(fixture, fixtureKey, tenantRoot);
  const response = await postWorkerJson(
    router,
    ed25519ExecutePath,
    envelope,
  );
  const bytes = await expectOk(response, 'Router activation fixture execution');
  const { publicReceipt, result } = parseEd25519ActivationResult(
    bytes,
    'Router activation fixture execution',
  );
  if (requireDelivery) {
    assert.ok(capturedSigningWorkerDelivery, 'Router must deliver the activation package pair');
  }
  return {
    envelope,
    responseBytes: bytes,
    publicReceipt,
    result,
    delivery: capturedSigningWorkerDelivery,
  };
}

/// Creation recovery on Workers, with the faults the VM recovery E2Es inject:
/// resume before the commit, delivery of a committed receipt after the
/// ceremony expires, refusal of a signed but uncommitted receipt, and
/// abandonment behind the fence, which then refuses the commit. Also a write
/// admitted before the window closes that lands after the abandonment has
/// cleaned its role: the tombstone refuses the row, and the role removes the
/// backup and canary it wrote.
async function testTenantRootCreationRecoveryPaths(topology, databases) {
  const router = await topology.getWorker('router-recovery');
  const controlPlane = await topology.getWorker('tenant-root-control-plane');
  const deriverB = await topology.getWorker('deriver-b');
  const [backupBucketA, backupBucketB] = await Promise.all([
    topology.getR2Bucket(managedBackupR2Binding, 'deriver-a'),
    topology.getR2Bucket(managedBackupR2Binding, 'deriver-b'),
  ]);
  const creationNamespace = await topology.getDurableObjectNamespace(
    tenantRootCreationDoBinding,
    'router',
  );
  const create = async (ceremony) => {
    const response = await postWorkerJson(router, tenantRootCreationPath, {
      creation_grant_b64u: ceremony.creation_grant_b64u,
    });
    return { status: response.status, body: await response.text() };
  };
  const lifecycle = async (database, ceremony) =>
    (
      await database
        .prepare('SELECT lifecycle FROM tenant_root_role_shares WHERE custody_lineage_b64u = ?1')
        .bind(ceremony.custody_lineage_b64u)
        .first()
    )?.lifecycle ?? null;
  const lifecycles = async (ceremony) => [
    await lifecycle(databases.deriverA, ceremony),
    await lifecycle(databases.deriverB, ceremony),
  ];
  const backupObjects = async (ceremony) => {
    const [a, b] = await Promise.all([backupBucketA.list(), backupBucketB.list()]);
    const own = (listing) =>
      listing.objects
        .map((object) => object.key)
        .filter((key) => key.includes(`/${ceremony.custody_lineage_b64u}/`)).length;
    return [own(a), own(b)];
  };
  const deliverToB = async (receipt) => {
    const response = await postWorkerJson(deriverB, deriverInitialActivationPath, {
      activation_receipt_b64u: receipt,
    });
    return { status: response.status, body: await response.text() };
  };
  // Replays the recorded activation request, so the control plane signs a
  // second receipt for the same evidence that no Router has committed.
  const reissueActivation = async () => {
    assert.ok(recoveryCapturedControlPlaneActivation, 'control-plane activation must be recorded');
    await sleep(20);
    const response = await controlPlane.fetch(`https://private.test${controlPlaneInitialActivationPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [internalAuthHeader]: internalAuthSecret },
      body: recoveryCapturedControlPlaneActivation,
    });
    const body = await response.text();
    assert.equal(response.status, 200, body);
    return JSON.parse(body).activation_receipt_b64u;
  };
  // The creation object redacts error details at its boundary; a refusal's
  // status carries its code (409 for the fence's conflict).
  const creationState = async (ceremony, path, body) => {
    const stub = creationNamespace.get(creationNamespace.idFromName(ceremony.creation_object_name));
    const response = await stub.fetch(
      `https://router-ab-do.internal${path}`,
      authenticatedJsonRequest(body),
    );
    return { status: response.status, body: await response.text() };
  };
  const waitUntilExpired = async (ceremony) => {
    const remaining = ceremony.expires_at_ms + 1_000 - Date.now();
    if (remaining > 0) {
      await sleep(remaining);
    }
  };

  // Before the commit: the activation request never reaches the control
  // plane, and the retry resumes from each role's stored evidence.
  const resumed = recoveryCreationGrant('resume', 60_000);
  recoveryDropNextActivation['tenant-root-control-plane'] = true;
  let result = await create(resumed);
  assert.notEqual(result.status, 200, result.body);
  assert.equal(recoveryDropNextActivation['tenant-root-control-plane'], false);
  assert.deepEqual(await lifecycles(resumed), ['pending', 'pending']);
  assert.deepEqual(await backupObjects(resumed), [2, 2], 'each role holds its backup and canary');
  result = await create(resumed);
  assert.equal(result.status, 200, result.body);
  assert.equal(JSON.parse(result.body).status.kind, 'ready');
  assert.deepEqual(await lifecycles(resumed), ['active', 'active']);

  // A manual refresh of that root, through the Router's own bindings: the
  // admission, attempt, checkpoints and activation all go through the
  // Router's creation state.
  const manualRefresh = await testTenantRootManualRefresh(
    await topology.getWorker('router'),
    resumed,
    databases,
    creationState,
  );

  // A refresh whose delivery to B is lost after A swapped, then retried.
  const splitRefresh = recoveryCreationGrant('refresh-split-delivery', 60_000);
  result = await create(splitRefresh);
  assert.equal(result.status, 200, result.body);
  assert.deepEqual(await lifecycles(splitRefresh), ['active', 'active']);
  const refreshDelivery = await testTenantRootRefreshDeliveryAfterLoss(
    router,
    splitRefresh,
    databases,
    creationState,
  );

  // Three short-lived ceremonies that the window closes on.
  const lifetimeMs = 20_000;
  const committed = recoveryCreationGrant('committed-then-expired', lifetimeMs);
  const abandoned = recoveryCreationGrant('uncommitted-then-expired', lifetimeMs);
  const lateWrite = recoveryCreationGrant('late-write-refused', lifetimeMs);

  // B installs and checkpoints; A, admitted inside the window, waits for B's
  // answer until after the abandonment.
  const hold = holdNextDeriverBAnswer();
  recoveryDeriverA = 'deriver-a-late';
  const lateCreation = create(lateWrite);
  await hold.held;
  recoveryDeriverA = 'deriver-a';
  assert.deepEqual(await lifecycles(lateWrite), [null, 'pending']);
  // B's backup and canary, kept to reproduce objects left behind after a
  // cleanup was checkpointed.
  const leftBehind = await Promise.all(
    (await backupBucketB.list()).objects
      .filter((object) => object.key.includes(`/${lateWrite.custody_lineage_b64u}/`))
      .map(async (object) => ({
        key: object.key,
        body: await (await backupBucketB.get(object.key)).arrayBuffer(),
      })),
  );
  assert.equal(leftBehind.length, 2, 'B holds its backup and canary');

  // After the commit: the delivery to B is lost, leaving A active.
  recoveryDropNextActivation['deriver-b'] = true;
  result = await create(committed);
  assert.notEqual(result.status, 200, result.body);
  assert.deepEqual(await lifecycles(committed), ['active', 'pending']);
  const uncommittedReceipt = await reissueActivation();
  const refusedInWindow = await deliverToB(uncommittedReceipt);
  assert.notEqual(refusedInWindow.status, 200, refusedInWindow.body);
  assert.ok(
    refusedInWindow.body.includes('is not the activation the Router committed'),
    refusedInWindow.body,
  );

  // Before the commit, then past the window: nothing commits.
  recoveryDropNextActivation['tenant-root-control-plane'] = true;
  result = await create(abandoned);
  assert.notEqual(result.status, 200, result.body);
  assert.deepEqual(await lifecycles(abandoned), ['pending', 'pending']);
  const abandonedReceipt = await reissueActivation();

  await waitUntilExpired(committed);
  await waitUntilExpired(abandoned);
  await waitUntilExpired(lateWrite);

  const refusedAfterExpiry = await deliverToB(uncommittedReceipt);
  assert.notEqual(refusedAfterExpiry.status, 200, refusedAfterExpiry.body);
  assert.ok(
    refusedAfterExpiry.body.includes('is not the activation the Router committed'),
    refusedAfterExpiry.body,
  );
  result = await create(committed);
  assert.equal(result.status, 200, result.body);
  assert.equal(JSON.parse(result.body).status.kind, 'ready');
  assert.deepEqual(await lifecycles(committed), ['active', 'active']);

  result = await create(abandoned);
  assert.notEqual(result.status, 200, result.body);
  assert.ok(
    result.body.includes('expired before activation and was abandoned; a fresh grant is required'),
    result.body,
  );
  assert.deepEqual(await lifecycles(abandoned), [null, null], 'both pending rows are removed');
  assert.deepEqual(await backupObjects(abandoned), [0, 0], 'backups and canaries are removed');
  const commitAfterFence = await creationState(abandoned, creationStateInitialActivationPath, {
    activation_receipt_b64u: abandonedReceipt,
  });
  assert.equal(commitAfterFence.status, 409, commitAfterFence.body);
  const progress = await creationState(abandoned, creationStateProgressReadPath, {
    identity_digest_b64u: abandoned.identity_digest_b64u,
    custody_lineage_b64u: abandoned.custody_lineage_b64u,
  });
  assert.equal(progress.status, 200, progress.body);
  const progressState = JSON.parse(progress.body);
  assert.equal(progressState.kind, 'started');
  assert.equal(progressState.committed_activation_receipt_b64u, null, 'nothing is committed');
  assert.deepEqual(progressState.state.abandonment.installed_roles, ['deriver_a', 'deriver_b']);
  assert.deepEqual(progressState.state.abandonment.cleaned_roles, ['deriver_a', 'deriver_b']);
  result = await create(abandoned);
  assert.ok(result.body.includes('abandoned; a fresh grant is required'), result.body);

  // The abandonment cleans A, which holds nothing yet, by the ceremony, and B
  // by its recorded evidence; each tombstones the lineage.
  const tombstones = async (database, ceremony) =>
    (
      await database
        .prepare(
          'SELECT count(*) AS count FROM tenant_root_creation_tombstones WHERE custody_lineage_b64u = ?1',
        )
        .bind(ceremony.custody_lineage_b64u)
        .first()
    ).count;
  const commandStatuses = async (database, ceremony) =>
    (
      await database
        .prepare(
          'SELECT status FROM tenant_root_command_replays WHERE custody_lineage_b64u = ?1 ORDER BY status',
        )
        .bind(ceremony.custody_lineage_b64u)
        .all()
    ).results.map((row) => row.status);
  result = await create(lateWrite);
  assert.notEqual(result.status, 200, result.body);
  assert.ok(
    result.body.includes('expired before activation and was abandoned; a fresh grant is required'),
    result.body,
  );
  assert.deepEqual(await lifecycles(lateWrite), [null, null]);
  assert.deepEqual(await backupObjects(lateWrite), [0, 0]);
  assert.equal(await tombstones(databases.deriverA, lateWrite), 1);
  assert.equal(await tombstones(databases.deriverB, lateWrite), 1);
  assert.deepEqual(await commandStatuses(databases.deriverA, lateWrite), ['completed']);

  // A's answer arrives: it writes its backup and canary, the tombstone
  // refuses its row, and it removes what it wrote. Its creation command was
  // reserved in the shared database and never executed.
  hold.release();
  const late = await lateCreation;
  assert.notEqual(late.status, 200, late.body);
  assert.deepEqual(await lifecycles(lateWrite), [null, null], 'the late row is refused');
  assert.deepEqual(await backupObjects(lateWrite), [0, 0], 'the late backup and canary are removed');
  assert.deepEqual(await commandStatuses(databases.deriverA, lateWrite), ['completed', 'reserved']);
  const lateProgress = await creationState(lateWrite, creationStateProgressReadPath, {
    identity_digest_b64u: lateWrite.identity_digest_b64u,
    custody_lineage_b64u: lateWrite.custody_lineage_b64u,
  });
  assert.equal(lateProgress.status, 200, lateProgress.body);
  const lateAbandonment = JSON.parse(lateProgress.body).state.abandonment;
  assert.deepEqual(lateAbandonment.installed_roles, ['deriver_b']);
  assert.deepEqual(lateAbandonment.cleaned_roles, ['deriver_a', 'deriver_b']);

  // Objects left after the cleanup was checkpointed: an ordinary retry skips
  // cleaned roles, and an operator sweep removes them by replaying both
  // cleanups, B's by its recorded evidence. It records nothing new.
  const sweep = async (ceremony) => {
    const response = await postWorkerJson(router, tenantRootCreationSweepPath, {
      identity_digest_b64u: ceremony.identity_digest_b64u,
      custody_lineage_b64u: ceremony.custody_lineage_b64u,
    });
    return { status: response.status, body: await response.text() };
  };
  for (const object of leftBehind) {
    await backupBucketB.put(object.key, object.body);
  }
  result = await create(lateWrite);
  assert.ok(result.body.includes('abandoned; a fresh grant is required'), result.body);
  assert.deepEqual(await backupObjects(lateWrite), [0, 2], 'a retry skips cleaned roles');
  const swept = await sweep(lateWrite);
  assert.equal(swept.status, 200, swept.body);
  assert.deepEqual(JSON.parse(swept.body).swept_roles, ['deriver_a', 'deriver_b']);
  assert.deepEqual(await backupObjects(lateWrite), [0, 0], 'the sweep removes what was left');
  assert.deepEqual(await commandStatuses(databases.deriverA, lateWrite), ['completed', 'reserved']);
  assert.deepEqual(await commandStatuses(databases.deriverB, lateWrite), ['completed', 'completed']);
  const sweptAgain = await sweep(lateWrite);
  assert.deepEqual([sweptAgain.status, sweptAgain.body], [200, swept.body]);
  const committedSweep = await sweep(committed);
  assert.notEqual(committedSweep.status, 200, committedSweep.body);
  assert.deepEqual(await lifecycles(committed), ['active', 'active']);

  console.log(
    JSON.stringify({
      kind: 'tenant_root_creation_recovery_workers_e2e_v1',
      resumedBeforeCommit: true,
      committedDeliveredAfterExpiry: true,
      uncommittedReceiptRefused: [refusedInWindow.status, refusedAfterExpiry.status],
      abandonedAfterExpiry: true,
      commitRefusedAfterFence: commitAfterFence.status,
      manualRefresh,
      refreshDelivery,
      lateWriteAfterCleanup: {
        fenceInstalledRoles: lateAbandonment.installed_roles,
        lateCreationStatus: late.status,
        rowsBackupsCanariesAfter: 0,
        deriverACommands: ['cleanup completed', 'creation reserved, never executed'],
      },
      operatorSweep: {
        residueRestored: leftBehind.length,
        status: swept.status,
        residueAfter: 0,
        secondSweepIdentical: true,
        committedCreationSweepStatus: committedSweep.status,
      },
    }),
  );
}

/// One manual refresh of an active root. Admission, attempt reservation, the
/// commitment, contribution and installation checkpoints and the activation
/// run in the Router's creation state. Both roles end on the next epoch with
/// the previous one retired and kept, retirement pending; an exact retry
/// returns the recorded outcome, and a second operation inside the manual
/// interval is throttled.
async function testTenantRootManualRefresh(router, ceremony, databases, creationState) {
  const scope = {
    identity_digest_b64u: ceremony.identity_digest_b64u,
    custody_lineage_b64u: ceremony.custody_lineage_b64u,
  };
  const activeState = async () => {
    const read = await creationState(ceremony, creationStateActiveStatePath, {
      kind: 'read',
      ...scope,
    });
    assert.equal(read.status, 200, read.body);
    return JSON.parse(read.body);
  };
  const epochs = async (database) =>
    (
      await database
        .prepare(
          `SELECT tenant_root_share_epoch AS epoch, lifecycle FROM tenant_root_role_shares
           WHERE custody_lineage_b64u = ?1 ORDER BY tenant_root_share_epoch`,
        )
        .bind(ceremony.custody_lineage_b64u)
        .all()
    ).results.map((row) => [row.epoch, row.lifecycle]);
  const refresh = async (operationId, expectedRevision) => {
    const response = await postWorkerJson(router, tenantRootRefreshPath, {
      operation_id: operationId,
      ...scope,
      expected_lifecycle_revision: expectedRevision,
      expires_at_ms: Date.now() + 60_000,
      trigger: 'manual',
    });
    return { status: response.status, body: await response.text() };
  };

  const before = await activeState();
  assert.equal(before.fence.kind, 'open', JSON.stringify(before.fence));
  assert.deepEqual(await epochs(databases.deriverA), [[1, 'active']]);
  assert.deepEqual(await epochs(databases.deriverB), [[1, 'active']]);

  const refreshed = await refresh('harness-manual-refresh-1', before.lifecycle_revision);
  assert.equal(refreshed.status, 200, refreshed.body);
  const response = JSON.parse(refreshed.body);
  assert.ok(response.lifecycle_revision > before.lifecycle_revision, refreshed.body);
  assert.deepEqual(retirementKinds(response.retirement), ['pending', 'pending'], refreshed.body);
  const retiredThenActive = [[1, 'retired'], [2, 'active']];
  assert.deepEqual(await epochs(databases.deriverA), retiredThenActive, 'epoch 1 is kept retired');
  assert.deepEqual(await epochs(databases.deriverB), retiredThenActive, 'epoch 1 is kept retired');
  const after = await activeState();
  assert.equal(after.lifecycle_revision, response.lifecycle_revision);
  assert.equal(after.fence.kind, 'terminal', JSON.stringify(after.fence));

  const replayed = await refresh('harness-manual-refresh-1', before.lifecycle_revision);
  assert.equal(replayed.status, 200, replayed.body);
  const replay = JSON.parse(replayed.body);
  assert.equal(replay.activation_receipt_digest_b64u, response.activation_receipt_digest_b64u);
  assert.equal(replay.lifecycle_revision, response.lifecycle_revision);
  assert.deepEqual(retirementKinds(replay.retirement), ['pending', 'pending'], replayed.body);

  const throttled = await refresh('harness-manual-refresh-2', response.lifecycle_revision);
  assert.equal(throttled.status, 429, throttled.body);
  assert.equal(JSON.parse(throttled.body).code, 'tenant_root_refresh_throttled');
  assert.deepEqual(await epochs(databases.deriverA), retiredThenActive);

  return {
    revisions: [before.lifecycle_revision, response.lifecycle_revision],
    retirement: retirementKinds(response.retirement),
    epochsAfter: [[1, 'retired'], [2, 'active']],
    exactRetryStatus: replayed.status,
    secondOperationStatus: throttled.status,
  };
}

/// A refresh whose activation is lost on its way to Deriver B after Deriver A
/// swapped. The Router commits the refresh decision before any Deriver
/// swaps, so the first attempt leaves the Router committed, A delivered and B
/// pending. The retry delivers the exact committed receipt to B; nothing
/// issues a second receipt.
async function testTenantRootRefreshDeliveryAfterLoss(
  router,
  ceremony,
  databases,
  creationState,
  retryAfterMs = 0,
) {
  const scope = {
    identity_digest_b64u: ceremony.identity_digest_b64u,
    custody_lineage_b64u: ceremony.custody_lineage_b64u,
  };
  const activeState = async () => {
    const read = await creationState(ceremony, creationStateActiveStatePath, {
      kind: 'read',
      ...scope,
    });
    assert.equal(read.status, 200, read.body);
    return JSON.parse(read.body);
  };
  const epochs = async (database) =>
    (
      await database
        .prepare(
          `SELECT tenant_root_share_epoch AS epoch, lifecycle FROM tenant_root_role_shares
           WHERE custody_lineage_b64u = ?1 ORDER BY tenant_root_share_epoch`,
        )
        .bind(ceremony.custody_lineage_b64u)
        .all()
    ).results.map((row) => [row.epoch, row.lifecycle]);
  const refresh = async (expectedRevision) => {
    const response = await postWorkerJson(router, tenantRootRefreshPath, {
      operation_id: 'harness-refresh-delivery-after-loss',
      ...scope,
      expected_lifecycle_revision: expectedRevision,
      expires_at_ms: Date.now() + 60_000,
      trigger: 'manual',
    });
    return { status: response.status, body: await response.text() };
  };
  const observe = async (label, attempt) => {
    const state = await activeState();
    const observation = {
      label,
      status: attempt.status,
      body: attempt.body.slice(0, 400),
      router: {
        lifecycle_revision: state.lifecycle_revision,
        fence: state.fence.kind,
        activation_receipt_digest_b64u: state.activation_receipt_digest_b64u,
      },
      deriverA: await epochs(databases.deriverA),
      deriverB: await epochs(databases.deriverB),
    };
    console.log(`R150_WORKERS_REFRESH_DELIVERY_OBSERVATION ${JSON.stringify(observation)}`);
    return { state, observation };
  };

  const before = await activeState();
  recoveryAnswered.delete(`deriver-a ${deriverRefreshActivationPath}`);
  recoveryDropNextOnPath['deriver-b'] = {
    path: deriverRefreshActivationPath,
    afterAnsweredBy: 'deriver-a',
  };
  const lost = await refresh(before.lifecycle_revision);
  assert.equal(recoveryDropNextOnPath['deriver-b'], null, 'B activation must have been dropped');
  const afterLoss = await observe('b_activation_lost', lost);
  if (retryAfterMs > 0) {
    await sleep(retryAfterMs);
  }
  const retried = await refresh(before.lifecycle_revision);
  const afterRetry = await observe('retry', retried);

  // The first attempt committed at the Router before delivering: A holds the
  // new epoch, B is still pending.
  assert.notEqual(lost.status, 200, lost.body);
  assert.equal(afterLoss.state.lifecycle_revision, before.lifecycle_revision + 1);
  assert.deepEqual(afterLoss.observation.deriverA, [[1, 'retired'], [2, 'active']]);
  assert.deepEqual(afterLoss.observation.deriverB, [[1, 'active'], [2, 'pending']]);
  // The retry delivers the committed receipt to B.
  assert.equal(retried.status, 200, retried.body);
  const response = JSON.parse(retried.body);
  assert.equal(
    response.activation_receipt_digest_b64u,
    afterLoss.state.activation_receipt_digest_b64u,
    'the retry delivers the receipt committed by the first attempt',
  );
  assert.deepEqual(retirementKinds(response.retirement), ['pending', 'pending'], retried.body);
  assert.equal(afterRetry.state.activation_receipt_digest_b64u, response.activation_receipt_digest_b64u);
  assert.deepEqual(afterRetry.observation.deriverA, [[1, 'retired'], [2, 'active']]);
  assert.deepEqual(afterRetry.observation.deriverB, [[1, 'retired'], [2, 'active']]);
  return {
    fault: 'deriver_b_refresh_activation_lost_after_router_commit',
    lostStatus: lost.status,
    committedBeforeDelivery: true,
    retryStatus: retried.status,
    retryDeliveredCommittedReceipt: true,
    retryAfterMs,
    retirement: retirementKinds(response.retirement),
  };
}

/// Root-use admission against refresh, on Workers, with the schedules the VM
/// admission E2Es run:
/// - a registration admitted and prepared at B on epoch 1, whose preparation
///   at A is held while a refresh swaps both roles: A refuses it, having not
///   admitted it before epoch 1 closed there, and a fresh registration is
///   admitted on epoch 2;
/// - a refresh whose delivery to B cannot complete: new work is refused
///   retryably until the Router can deliver the committed receipt to B, then
///   admitted on epoch 2.
async function testTenantRootAdmissionRaces(topology, fixture, databases) {
  const router = await topology.getWorker('router-recovery');
  const controlPlane = await topology.getWorker('tenant-root-control-plane');
  const derivers = {
    deriver_a: { worker: await topology.getWorker('deriver-a'), database: databases.deriverA },
    deriver_b: { worker: await topology.getWorker('deriver-b'), database: databases.deriverB },
  };
  const creationNamespace = await topology.getDurableObjectNamespace(
    tenantRootCreationDoBinding,
    'router',
  );
  const creationState = async (ceremony, path, body) => {
    const stub = creationNamespace.get(creationNamespace.idFromName(ceremony.creation_object_name));
    const response = await stub.fetch(
      `https://router-ab-do.internal${path}`,
      authenticatedJsonRequest(body),
    );
    return { status: response.status, body: await response.text() };
  };
  const activeState = async (ceremony) => {
    const read = await creationState(ceremony, creationStateActiveStatePath, {
      kind: 'read',
      identity_digest_b64u: ceremony.identity_digest_b64u,
      custody_lineage_b64u: ceremony.custody_lineage_b64u,
    });
    assert.equal(read.status, 200, read.body);
    return JSON.parse(read.body);
  };
  const create = async (ceremony) => {
    const response = await postWorkerJson(router, tenantRootCreationPath, {
      creation_grant_b64u: ceremony.creation_grant_b64u,
    });
    return { status: response.status, body: await response.text() };
  };
  const refresh = async (ceremony, operationId) => {
    const state = await activeState(ceremony);
    const response = await postWorkerJson(router, tenantRootRefreshPath, {
      operation_id: operationId,
      identity_digest_b64u: ceremony.identity_digest_b64u,
      custody_lineage_b64u: ceremony.custody_lineage_b64u,
      expected_lifecycle_revision: state.lifecycle_revision,
      expires_at_ms: Date.now() + 60_000,
      trigger: 'manual',
    });
    return { status: response.status, body: await response.text() };
  };
  const register = async (ceremony, source) => {
    const response = await postWorkerJson(
      router,
      ed25519ExecutePath,
      buildEd25519ExecuteRequest(fixture, 'admission_race', ceremony, source),
    );
    return { status: response.status, body: await response.text() };
  };
  const succeeded = (attempt) =>
    attempt.status === 200 && JSON.parse(attempt.body).status === 'succeeded';
  const epochs = async (database, ceremony) =>
    (
      await database
        .prepare(
          `SELECT tenant_root_share_epoch AS epoch, lifecycle FROM tenant_root_role_shares
           WHERE custody_lineage_b64u = ?1 ORDER BY tenant_root_share_epoch`,
        )
        .bind(ceremony.custody_lineage_b64u)
        .all()
    ).results.map((row) => [row.epoch, row.lifecycle]);
  const admissions = async (ceremony) =>
    Promise.all(
      [databases.deriverA, databases.deriverB].map(async (database) =>
        (
          await database
            .prepare(
              `SELECT tenant_root_share_epoch AS epoch FROM tenant_root_root_use_admissions
               WHERE custody_lineage_b64u = ?1 ORDER BY tenant_root_share_epoch`,
            )
            .bind(ceremony.custody_lineage_b64u)
            .all()
        ).results.map((row) => row.epoch),
      ),
    );
  const bothEpochs = async (ceremony) => [
    await epochs(databases.deriverA, ceremony),
    await epochs(databases.deriverB, ceremony),
  ];
  const admissionStatuses = async (ceremony) =>
    Promise.all(
      [databases.deriverA, databases.deriverB].map(async (database) =>
        (
          await database
            .prepare(
              `SELECT tenant_root_share_epoch AS epoch, status FROM tenant_root_root_use_admissions
               WHERE custody_lineage_b64u = ?1 ORDER BY tenant_root_share_epoch, admitted_at_ms`,
            )
            .bind(ceremony.custody_lineage_b64u)
            .all()
        ).results.map((row) => [row.epoch, row.status]),
      ),
    );
  const revision = async (database, ceremony, epoch) =>
    (
      await database
        .prepare(
          `SELECT revision FROM tenant_root_role_shares
           WHERE custody_lineage_b64u = ?1 AND tenant_root_share_epoch = ?2`,
        )
        .bind(ceremony.custody_lineage_b64u, epoch)
        .first()
    ).revision;
  // The operator's retirement of epoch 1 at one role: the control plane signs
  // the command, and the Deriver executes it.
  const retire = async (ceremony, role) => {
    const { worker, database } = derivers[role];
    const command = await postWorkerJson(controlPlane, controlPlaneCleanupCommandPath, {
      kind: 'retired_after_refresh',
      identity_digest_b64u: ceremony.identity_digest_b64u,
      custody_lineage_b64u: ceremony.custody_lineage_b64u,
      role,
      expected_retired_revision: await revision(database, ceremony, 1),
      expected_active_revision: await revision(database, ceremony, 2),
    });
    const commandBody = await command.text();
    assert.equal(command.status, 200, commandBody);
    const response = await postWorkerJson(worker, deriverCleanupPath, {
      cleanup_command_b64u: JSON.parse(commandBody).cleanup_command_b64u,
    });
    return { status: response.status, body: await response.text() };
  };
  const retiredThenActive = [[1, 'retired'], [2, 'active']];
  const races = fixture.admission_race;

  // 1. A binding unused before its epoch closes starts nothing.
  const unused = recoveryCreationGrant('admission-race-unused', 60_000);
  let result = await create(unused);
  assert.equal(result.status, 200, result.body);
  const epochOneReceipt = (await activeState(unused)).activation_receipt_b64u;
  const hold = holdNextRecoveryRequest('deriver-a', deriverAYaoPreparePath);
  const heldRegistration = register(unused, races.held_preparation);
  const heldPreparation = await hold.held;
  assert.equal(
    heldPreparation.tenant_root.custody_binding.activation_receipt_b64u,
    epochOneReceipt,
    'the held preparation is bound to epoch 1',
  );
  for (let attempt = 0; (await admissions(unused))[1].length === 0; attempt += 1) {
    assert.ok(attempt < 500, 'Deriver B must admit the registration');
    await sleep(10);
  }
  assert.deepEqual(await admissions(unused), [[], [1]]);
  const unusedRefresh = await refresh(unused, 'harness-admission-race-unused');
  assert.equal(unusedRefresh.status, 200, unusedRefresh.body);
  assert.deepEqual(await bothEpochs(unused), [retiredThenActive, retiredThenActive]);
  hold.release();
  const refused = await heldRegistration;
  // A refuses the preparation, "retired here before the operation was
  // admitted" in Deriver A's log, and holds no admission for it. The caller
  // is told to retry.
  const preparationAnswer = hold.answer();
  assert.notEqual(preparationAnswer.status, 200, preparationAnswer.body);
  assert.equal(JSON.parse(refused.body).status, 'recoverable_failure', refused.body);
  assert.deepEqual(await admissions(unused), [[], [1]]);
  const fresh = await register(unused, races.after_refresh);
  assert.ok(succeeded(fresh), fresh.body);
  assert.deepEqual(await admissions(unused), [[2], [1, 2]]);
  // The completed registration settled its admission at each role, in the D1
  // batch that made that role's pair record terminal. B's epoch-1 admission,
  // from the preparation A refused, is still unsettled.
  const statusesAfterFresh = await admissionStatuses(unused);
  assert.deepEqual(statusesAfterFresh, [
    [[2, 'settled']],
    [[1, 'admitted'], [2, 'settled']],
  ]);
  // Erasing epoch 1: A holds no admission on it and erases it. B answers
  // that retirement is pending and keeps its retired row.
  const aRetired = await retire(unused, 'deriver_a');
  assert.equal(aRetired.status, 200, aRetired.body);
  const aRetiredBody = JSON.parse(aRetired.body);
  assert.equal(aRetiredBody.kind, 'retired_deleted', aRetired.body);
  assert.equal(aRetiredBody.cancelled_admissions, 0, aRetired.body);
  const bPending = await retire(unused, 'deriver_b');
  assert.equal(bPending.status, 503, bPending.body);
  assert.ok(
    bPending.body.includes(
      'retirement of epoch 1 is pending here: 1 admitted operation(s) are not settled',
    ),
    bPending.body,
  );
  assert.deepEqual(await bothEpochs(unused), [[[2, 'active']], retiredThenActive]);

  // 2. New work waits for the committed epoch's delivery.
  const gated = recoveryCreationGrant('admission-race-delivery', 60_000);
  result = await create(gated);
  assert.equal(result.status, 200, result.body);
  assert.deepEqual((await activeState(gated)).delivery, {
    activation_receipt_digest_b64u: (await activeState(gated)).activation_receipt_digest_b64u,
    deriver_a: 'delivered',
    deriver_b: 'delivered',
  });
  recoveryDropEveryOnPath['deriver-b'] = deriverRefreshActivationPath;
  const gatedRefresh = await refresh(gated, 'harness-admission-race-delivery');
  assert.notEqual(gatedRefresh.status, 200, gatedRefresh.body);
  assert.deepEqual(await bothEpochs(gated), [
    retiredThenActive,
    [[1, 'active'], [2, 'pending']],
  ]);
  const pendingDelivery = (await activeState(gated)).delivery;
  assert.equal(pendingDelivery.deriver_a, 'delivered');
  assert.equal(pendingDelivery.deriver_b, 'pending');
  const blocked = await register(gated, races.while_delivery_pending);
  assert.equal(blocked.status, 503, blocked.body);
  assert.ok(blocked.body.startsWith('LifecycleTransitionInProgress:'), blocked.body);
  assert.deepEqual(await admissions(gated), [[], []]);
  recoveryDropEveryOnPath['deriver-b'] = null;
  const delivered = await register(gated, races.after_delivery);
  assert.ok(succeeded(delivered), delivered.body);
  const deliveredState = (await activeState(gated)).delivery;
  assert.equal(deliveredState.deriver_a, 'delivered');
  assert.equal(deliveredState.deriver_b, 'delivered');
  assert.deepEqual(await bothEpochs(gated), [retiredThenActive, retiredThenActive]);
  assert.deepEqual(await admissions(gated), [[2], [2]]);
  assert.deepEqual(await admissionStatuses(gated), [[[2, 'settled']], [[2, 'settled']]]);

  return {
    unusedBinding: {
      heldBefore: 'deriver_a_prepare_pair',
      refreshStatus: unusedRefresh.status,
      deriverAPreparationStatus: preparationAnswer.status,
      deriverAPreparationBody: preparationAnswer.body.slice(0, 200),
      registrationStatus: refused.status,
      registrationBody: refused.body.slice(0, 200),
      admissionsAfterRefusal: { deriverA: [], deriverB: [1] },
      freshRegistration: 'succeeded',
      admissionsAfterFresh: { deriverA: [2], deriverB: [1, 2] },
      statusesAfterFresh: { deriverA: statusesAfterFresh[0], deriverB: statusesAfterFresh[1] },
      deriverAEpochOneRetirement: [aRetired.status, aRetiredBody.kind],
      deriverBEpochOneRetirement: [bPending.status, bPending.body.slice(0, 200)],
    },
    deliveryGate: {
      fault: 'deriver_b_unreachable_for_refresh_activation',
      refreshStatus: gatedRefresh.status,
      deliveryAfterRefresh: { deriverA: 'delivered', deriverB: 'pending' },
      registrationWhilePendingStatus: blocked.status,
      admissionsWhilePending: { deriverA: [], deriverB: [] },
      registrationAfterReachable: 'succeeded',
      deliveryAfter: { deriverA: 'delivered', deriverB: 'delivered' },
      admissionsAfter: { deriverA: [2], deriverB: [2] },
      statusesAfter: { deriverA: [[2, 'settled']], deriverB: [[2, 'settled']] },
    },
  };
}

/// Opt-in (`--do-admission-settlement`, wallet-object builds). An admission
/// whose pair a wallet object holds is settled or cancelled only on that
/// object's word.
/// - Root R: a registration's execute is held, and the root refreshes.
///   Retiring epoch 1 at B fences B's pair in its object, and cancels B's
///   admission. Released, B refuses to start the pair, and the registration
///   fails. Retiring at A then fences A's burned, never-claimed pair. A fresh
///   registration on epoch 2 settles through both objects.
/// - Root S: a completed registration's admissions are set back to
///   `admitted`, as if both settlement acknowledgements were lost.
///   Retirement reconciles them with the objects, which report the same
///   completion, and the epoch is erased with nothing cancelled.
/// Helpers shared by the admission and retirement runs, on either build.
/// `objectReport` needs a wallet-object build.
async function rootLifecycleHelpers(topology, fixture, databases) {
  const router = await topology.getWorker('router-recovery');
  const controlPlane = await topology.getWorker('tenant-root-control-plane');
  const derivers = {
    deriver_a: { worker: await topology.getWorker('deriver-a'), database: databases.deriverA },
    deriver_b: { worker: await topology.getWorker('deriver-b'), database: databases.deriverB },
  };
  const creationNamespace = await topology.getDurableObjectNamespace(
    tenantRootCreationDoBinding,
    'router',
  );
  const activeState = async (ceremony) => {
    const stub = creationNamespace.get(creationNamespace.idFromName(ceremony.creation_object_name));
    const response = await stub.fetch(
      `https://router-ab-do.internal${creationStateActiveStatePath}`,
      authenticatedJsonRequest({
        kind: 'read',
        identity_digest_b64u: ceremony.identity_digest_b64u,
        custody_lineage_b64u: ceremony.custody_lineage_b64u,
      }),
    );
    const body = await response.text();
    assert.equal(response.status, 200, body);
    return JSON.parse(body);
  };
  const create = async (ceremony) => {
    const response = await postWorkerJson(router, tenantRootCreationPath, {
      creation_grant_b64u: ceremony.creation_grant_b64u,
    });
    const body = await response.text();
    assert.equal(response.status, 200, body);
  };
  const refresh = async (ceremony, operationId) => {
    const state = await activeState(ceremony);
    const response = await postWorkerJson(router, tenantRootRefreshPath, {
      operation_id: operationId,
      identity_digest_b64u: ceremony.identity_digest_b64u,
      custody_lineage_b64u: ceremony.custody_lineage_b64u,
      expected_lifecycle_revision: state.lifecycle_revision,
      expires_at_ms: Date.now() + 60_000,
      trigger: 'manual',
    });
    const body = await response.text();
    assert.equal(response.status, 200, body);
  };
  const register = async (ceremony, source) => {
    const response = await postWorkerJson(
      router,
      ed25519ExecutePath,
      buildEd25519ExecuteRequest(fixture, 'admission_race', ceremony, source),
    );
    return { status: response.status, body: await response.text() };
  };
  const succeeded = (attempt) =>
    attempt.status === 200 && JSON.parse(attempt.body).status === 'succeeded';
  // Each role's admissions for the root: epoch, status, and whether a
  // wallet object holds the pair.
  const admissions = async (ceremony) =>
    Promise.all(
      [databases.deriverA, databases.deriverB].map(async (database) =>
        (
          await database
            .prepare(
              `SELECT tenant_root_share_epoch AS epoch, status, pair_object_name
               FROM tenant_root_root_use_admissions
               WHERE custody_lineage_b64u = ?1 ORDER BY tenant_root_share_epoch, admitted_at_ms`,
            )
            .bind(ceremony.custody_lineage_b64u)
            .all()
        ).results.map((row) => [row.epoch, row.status, row.pair_object_name !== null]),
      ),
    );
  const revision = async (database, ceremony, epoch) =>
    (
      await database
        .prepare(
          `SELECT revision FROM tenant_root_role_shares
           WHERE custody_lineage_b64u = ?1 AND tenant_root_share_epoch = ?2`,
        )
        .bind(ceremony.custody_lineage_b64u, epoch)
        .first()
    ).revision;
  // The operator's retirement of one retired epoch at one role.
  const retire = async (ceremony, role, retiredEpoch = 1, activeEpoch = 2) => {
    const { worker, database } = derivers[role];
    const command = await postWorkerJson(controlPlane, controlPlaneCleanupCommandPath, {
      kind: 'retired_after_refresh',
      identity_digest_b64u: ceremony.identity_digest_b64u,
      custody_lineage_b64u: ceremony.custody_lineage_b64u,
      role,
      expected_retired_revision: await revision(database, ceremony, retiredEpoch),
      expected_active_revision: await revision(database, ceremony, activeEpoch),
    });
    const commandBody = await command.text();
    assert.equal(command.status, 200, commandBody);
    const response = await postWorkerJson(worker, deriverCleanupPath, {
      cleanup_command_b64u: JSON.parse(commandBody).cleanup_command_b64u,
    });
    const body = await response.text();
    assert.equal(response.status, 200, `${role}: ${body}`);
    return JSON.parse(body);
  };
  // Asks the wallet object behind one admission for its report, without
  // fencing: what it holds for that pair session.
  const objectReport = async (ceremony, role, epoch) => {
    const database = role === 'deriver_a' ? databases.deriverA : databases.deriverB;
    const row = await database
      .prepare(
        `SELECT attempt_key_hex, pair_object_name FROM tenant_root_root_use_admissions
         WHERE custody_lineage_b64u = ?1 AND tenant_root_share_epoch = ?2`,
      )
      .bind(ceremony.custody_lineage_b64u, epoch)
      .first();
    const binding = role === 'deriver_a' ? deriverAWalletDoBinding : 'DERIVER_B_WALLET_DO';
    const worker = role === 'deriver_a' ? 'deriver-a' : 'deriver-b';
    const namespace = await topology.getDurableObjectNamespace(binding, worker);
    const object = namespace.get(namespace.idFromName(row.pair_object_name));
    const response = await object.fetch(
      `https://router-ab-do.internal/router-ab/internal/${worker}/wallet-pair/reconcile`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          session_hex: row.attempt_key_hex,
          fence: false,
          peer_settled: false,
          now_ms: Date.now(),
        }),
      },
    );
    const body = await response.text();
    assert.equal(response.status, 200, body);
    return JSON.parse(body);
  };
  return {
    activeState,
    create,
    refresh,
    register,
    succeeded,
    admissions,
    retire,
    objectReport,
    races: fixture.admission_race,
  };
}

async function testWalletObjectAdmissionSettlement(topology, fixture, databases) {
  assert.equal(process.env.ROUTER_AB_WALLET_DO_HARNESS, 'enabled');
  const { create, refresh, register, succeeded, admissions, retire, objectReport } =
    await rootLifecycleHelpers(topology, fixture, databases);
  const races = fixture.admission_race;

  // Root R: a held registration is fenced in both objects.
  const fenced = recoveryCreationGrant('do-admission-fence', 60_000);
  await create(fenced);
  const hold = holdNextRecoveryRequest('deriver-a', '/router-ab/deriver-a/ed25519-yao/execute-pair');
  const heldRegistration = register(fenced, races.held_preparation);
  await hold.held;
  const whileHeld = await admissions(fenced);
  assert.deepEqual(whileHeld, [[[1, 'admitted', true]], [[1, 'admitted', true]]]);
  await refresh(fenced, 'harness-do-admission-fence');
  await sleep(1_100);
  const bFenced = await retire(fenced, 'deriver_b');
  assert.equal(bFenced.cancelled_admissions, 1, JSON.stringify(bFenced));
  assert.equal(await objectReport(fenced, 'deriver_b', 1), 'fenced');
  hold.release();
  const refused = await heldRegistration;
  assert.ok(!succeeded(refused), refused.body);
  const aFenced = await retire(fenced, 'deriver_a');
  assert.equal(aFenced.cancelled_admissions, 1, JSON.stringify(aFenced));
  assert.equal(await objectReport(fenced, 'deriver_a', 1), 'fenced');
  assert.deepEqual(await admissions(fenced), [[[1, 'cancelled', true]], [[1, 'cancelled', true]]]);
  const fresh = await register(fenced, races.after_refresh);
  assert.ok(succeeded(fresh), fresh.body);
  const afterFresh = await admissions(fenced);
  assert.deepEqual(afterFresh, [
    [[1, 'cancelled', true], [2, 'settled', true]],
    [[1, 'cancelled', true], [2, 'settled', true]],
  ]);

  // Root S: both settlement acknowledgements lost, then reconciled.
  const lost = recoveryCreationGrant('do-admission-lost-ack', 60_000);
  await create(lost);
  const completed = await register(lost, races.after_delivery);
  assert.ok(succeeded(completed), completed.body);
  assert.deepEqual(await admissions(lost), [[[1, 'settled', true]], [[1, 'settled', true]]]);
  for (const database of [databases.deriverA, databases.deriverB]) {
    await database
      .prepare(
        `UPDATE tenant_root_root_use_admissions SET status = 'admitted'
         WHERE custody_lineage_b64u = ?1`,
      )
      .bind(lost.custody_lineage_b64u)
      .run();
  }
  const unacknowledged = await admissions(lost);
  assert.deepEqual(unacknowledged, [[[1, 'admitted', true]], [[1, 'admitted', true]]]);
  await refresh(lost, 'harness-do-admission-lost-ack');
  const aReconciled = await retire(lost, 'deriver_a');
  const bReconciled = await retire(lost, 'deriver_b');
  assert.equal(aReconciled.cancelled_admissions, 0, JSON.stringify(aReconciled));
  assert.equal(bReconciled.cancelled_admissions, 0, JSON.stringify(bReconciled));
  const reconciled = await admissions(lost);
  assert.deepEqual(reconciled, [[[1, 'settled', true]], [[1, 'settled', true]]]);
  const objectReports = [
    await objectReport(lost, 'deriver_a', 1),
    await objectReport(lost, 'deriver_b', 1),
  ];
  assert.deepEqual(objectReports, ['completed', 'completed']);

  return {
    kind: 'tenant_root_wallet_object_admission_workers_e2e_v1',
    fence: {
      admissionsWhileHeld: whileHeld,
      deriverBRetired: [bFenced.kind, bFenced.cancelled_admissions],
      objectsAfterRetirement: { deriverA: 'fenced', deriverB: 'fenced' },
      heldRegistration: [refused.status, refused.body.slice(0, 160)],
      deriverARetired: [aFenced.kind, aFenced.cancelled_admissions],
      freshRegistration: 'succeeded',
      admissionsAfter: afterFresh,
    },
    lostAcknowledgement: {
      admissionsAfterRevert: unacknowledged,
      retired: [
        [aReconciled.kind, aReconciled.cancelled_admissions],
        [bReconciled.kind, bReconciled.cancelled_admissions],
      ],
      admissionsAfterReconciliation: reconciled,
      objectReports,
    },
  };
}

/// Opt-in (`--retirement-trigger`, either build). The Router erases a
/// refresh's retired epoch on a later pass, once the grace after the swap has
/// passed and each role's work on it has settled. The grace is one second
/// here, and `W` thirty.
/// 1. A registration is admitted at both Derivers and its execute is held. A
///    refresh moves the root to epoch 2, and reports both roles keeping
///    epoch 1: the grace.
/// 2. After the grace, an exact retry of the refresh is a pass. Both roles
///    keep epoch 1, since the held work on it has not settled.
/// 3. Released, the work completes on epoch 1 and settles.
/// 4. The next pass erases epoch 1 at both roles. A retry replays the
///    recorded erasures exactly.
async function testRetirementTrigger(topology, fixture, databases) {
  const { activeState, create, register, succeeded, admissions, races } =
    await rootLifecycleHelpers(topology, fixture, databases);
  const router = await topology.getWorker('router-recovery');
  const statuses = async (ceremony) =>
    (await admissions(ceremony)).map((role) => role.map(([epoch, status]) => [epoch, status]));
  const root = recoveryCreationGrant('retirement-trigger', 60_000);
  await create(root);
  const created = await activeState(root);
  const refresh = async () => {
    const response = await postWorkerJson(router, tenantRootRefreshPath, {
      operation_id: 'harness-retirement-trigger',
      identity_digest_b64u: root.identity_digest_b64u,
      custody_lineage_b64u: root.custody_lineage_b64u,
      expected_lifecycle_revision: created.lifecycle_revision,
      expires_at_ms: Date.now() + 60_000,
      trigger: 'manual',
    });
    const body = await response.text();
    assert.equal(response.status, 200, body);
    return JSON.parse(body);
  };
  const epochOneShares = async () =>
    Promise.all(
      [databases.deriverA, databases.deriverB].map(async (database) =>
        (
          await database
            .prepare(
              `SELECT COUNT(*) AS count FROM tenant_root_role_shares
               WHERE custody_lineage_b64u = ?1 AND tenant_root_share_epoch = 1`,
            )
            .bind(root.custody_lineage_b64u)
            .first()
        ).count,
      ),
    );

  // 1. Work admitted on epoch 1 is held over the refresh.
  const hold = holdNextRecoveryRequest('deriver-a', '/router-ab/deriver-a/ed25519-yao/execute-pair');
  const registering = register(root, races.after_delivery);
  await hold.held;
  assert.deepEqual(await statuses(root), [[[1, 'admitted']], [[1, 'admitted']]]);
  const first = await refresh();
  const refreshedAt = Date.now();
  assert.deepEqual(retirementKinds(first.retirement), ['pending', 'pending'], JSON.stringify(first));
  assert.match(first.retirement.deriver_a.reason, /the grace after the swap/);

  // 2. After the grace, the unsettled work keeps epoch 1 at both roles.
  await sleep(Math.max(0, refreshedAt + 1_100 - Date.now()));
  const whileHeld = await refresh();
  assert.deepEqual(retirementKinds(whileHeld.retirement), ['pending', 'pending']);
  for (const role of ['deriver_a', 'deriver_b']) {
    assert.match(whileHeld.retirement[role].reason, /1 admitted operation\(s\) are not settled/);
  }
  assert.deepEqual(await epochOneShares(), [1, 1]);

  // 3. The work completes on its epoch.
  hold.release();
  const registered = await registering;
  assert.ok(succeeded(registered), registered.body);
  assert.deepEqual(await statuses(root), [[[1, 'settled']], [[1, 'settled']]]);

  // 4. The next pass erases epoch 1; a retry replays the recorded erasures.
  const erased = await refresh();
  assert.deepEqual(retirementKinds(erased.retirement), ['erased', 'erased'], JSON.stringify(erased));
  for (const role of ['deriver_a', 'deriver_b']) {
    assert.equal(erased.retirement[role].cancelled_admissions, 0);
  }
  assert.deepEqual(await epochOneShares(), [0, 0]);
  const replayed = await refresh();
  assert.deepEqual(replayed.retirement, erased.retirement);
  return {
    kind: 'tenant_root_retirement_trigger_workers_e2e_v1',
    build: process.env.ROUTER_AB_WALLET_DO_HARNESS === 'enabled' ? 'wallet_objects' : 'role_store',
    graceMs: 1000,
    firstRefresh: retirementKinds(first.retirement),
    afterGraceWhileWorkHeld: [retirementKinds(whileHeld.retirement), whileHeld.retirement.deriver_b.reason],
    heldWork: 'succeeded on epoch 1',
    afterSettlement: retirementKinds(erased.retirement),
    epochOneSharesAfter: [0, 0],
    recordedErasuresReplayExactly: true,
    admissionsAfter: await statuses(root),
  };
}

/// Opt-in (`--replay-after-erasure`, either build). A completed registration
/// is answered again after its epoch is erased at both Derivers.
/// 1. A wallet registers on epoch 1. Deriver A's execute request is kept as
///    the Router sent it, with A's response.
/// 2. A refresh moves the root to epoch 2, and epoch 1 is retired at both
///    Derivers. Its admissions are settled, so both shares are erased.
/// 3. The Router's replay of the registration returns the original result.
/// 4. Deriver A's execute, retried exactly, returns its stored response. A
///    changed request is refused. No share is left on epoch 1 to read.
/// 5. No admission changed.
async function testReplayAfterErasure(topology, fixture, databases) {
  const { create, refresh, admissions, retire, races } = await rootLifecycleHelpers(
    topology,
    fixture,
    databases,
  );
  const router = await topology.getWorker('router-recovery');
  const deriverA = await topology.getWorker('deriver-a');
  const executePairPath = '/router-ab/deriver-a/ed25519-yao/execute-pair';
  const statuses = async (ceremony) =>
    (await admissions(ceremony)).map((role) => role.map(([epoch, status]) => [epoch, status]));
  const root = recoveryCreationGrant('replay-after-erasure', 60_000);
  await create(root);

  // 1. The wallet registers on epoch 1; A's execute request is kept.
  const registration = buildEd25519ExecuteRequest(
    fixture,
    'admission_race',
    root,
    races.after_delivery,
  );
  const hold = holdNextRecoveryRequest('deriver-a', executePairPath);
  const registering = postWorkerJson(router, ed25519ExecutePath, registration);
  const aExecute = await hold.held;
  hold.release();
  const registered = await registering;
  const original = await registered.text();
  assert.equal(registered.status, 200, original);
  assert.equal(JSON.parse(original).status, 'succeeded', original);
  const aAnswer = hold.answer();
  assert.equal(aAnswer.status, 200, aAnswer.body);
  const settled = [[[1, 'settled']], [[1, 'settled']]];
  assert.deepEqual(await statuses(root), settled);

  // 2. A refresh, then epoch 1 is retired and erased at both Derivers.
  await refresh(root, 'harness-replay-after-erasure');
  const retired = [await retire(root, 'deriver_a'), await retire(root, 'deriver_b')];
  for (const cleanup of retired) {
    assert.equal(cleanup.kind, 'retired_deleted', JSON.stringify(cleanup));
    assert.equal(cleanup.cancelled_admissions, 0, JSON.stringify(cleanup));
  }
  const epochOneShares = await Promise.all(
    [databases.deriverA, databases.deriverB].map(async (database) =>
      (
        await database
          .prepare(
            `SELECT COUNT(*) AS count FROM tenant_root_role_shares
             WHERE custody_lineage_b64u = ?1 AND tenant_root_share_epoch = 1`,
          )
          .bind(root.custody_lineage_b64u)
          .first()
      ).count,
    ),
  );
  assert.deepEqual(epochOneShares, [0, 0]);

  // 3. The Router's replay returns the original result.
  const replay = await postWorkerJson(router, ed25519ExecutePath, registration, {
    'x-seams-yao-replay': '1',
  });
  const replayed = await replay.text();
  assert.equal(replay.status, 200, replayed);
  assert.deepEqual(JSON.parse(replayed), JSON.parse(original));

  // 4. A's execute, retried exactly, returns its stored response; a changed
  // request is refused.
  const aReplay = await postWorkerJson(deriverA, executePairPath, aExecute);
  const aReplayed = await aReplay.text();
  assert.equal(aReplay.status, 200, aReplayed);
  assert.deepEqual(JSON.parse(aReplayed), JSON.parse(aAnswer.body));
  const changed = structuredClone(aExecute);
  changed.tenant_root.custody_binding.issued_at_ms += 1;
  const changedResponse = await postWorkerJson(deriverA, executePairPath, changed);
  const changedBody = await changedResponse.text();
  assert.notEqual(changedResponse.status, 200, changedBody);

  // 5. No admission changed.
  assert.deepEqual(await statuses(root), settled);
  return {
    kind: 'tenant_root_replay_after_erasure_workers_e2e_v1',
    build: process.env.ROUTER_AB_WALLET_DO_HARNESS === 'enabled' ? 'wallet_objects' : 'role_store',
    registration: 'succeeded on epoch 1',
    retired: retired.map((cleanup) => [cleanup.kind, cleanup.cancelled_admissions]),
    epochOneShares,
    routerReplay: [replay.status, 'original result'],
    deriverAExecuteReplay: [aReplay.status, 'stored response'],
    changedExecute: [changedResponse.status, changedBody.slice(0, 160)],
    admissionsAfter: settled,
  };
}

/// Opt-in (`--do-claimed-recovery`, wallet-object builds). Deriver B is set
/// to burn a pair just before completing it. A claimed execution that fails
/// is recovered, and retirement completes.
/// 1. A registration: Deriver A claims its pair in its object, then B burns
///    its side. A's pair burns too, still marked claimed, and can never
///    complete.
/// 2. A refresh moves the root to epoch 2.
/// 3. Retiring epoch 1 at A: A's object reports the pair claimed, so A's
///    recovery first has B fence it. B's object fences its pair, and B's
///    admission is cancelled. Only then does A's object fence the claimed
///    pair, and A's admission is cancelled. Both epochs are erased.
/// 4. The old registration, retried, completes nothing.
/// 5. A second refresh of the root succeeds.
async function testWalletObjectClaimedRecovery(topology, fixture, databases) {
  const { activeState, create, refresh, register, succeeded, admissions, retire, objectReport, races } =
    await rootLifecycleHelpers(topology, fixture, databases);
  const root = recoveryCreationGrant('do-claimed-recovery', 60_000);
  await create(root);
  const failed = await register(root, races.held_preparation);
  assert.ok(!succeeded(failed), failed.body);
  const afterFailure = await admissions(root);
  assert.deepEqual(afterFailure, [[[1, 'admitted', true]], [[1, 'admitted', true]]]);
  const objectsAfterFailure = [
    await objectReport(root, 'deriver_a', 1),
    await objectReport(root, 'deriver_b', 1),
  ];
  assert.deepEqual(objectsAfterFailure, ['claimed', 'open']);

  await refresh(root, 'harness-do-claimed-recovery');
  const refreshedAt = Date.now();
  await sleep(1_100);
  const aRetired = await retire(root, 'deriver_a');
  assert.equal(aRetired.cancelled_admissions, 1, JSON.stringify(aRetired));
  const afterRecovery = await admissions(root);
  assert.deepEqual(afterRecovery, [[[1, 'cancelled', true]], [[1, 'cancelled', true]]]);
  const bRetired = await retire(root, 'deriver_b');
  assert.equal(bRetired.cancelled_admissions, 1, JSON.stringify(bRetired));
  const objectsAfterRetirement = [
    await objectReport(root, 'deriver_a', 1),
    await objectReport(root, 'deriver_b', 1),
  ];
  assert.deepEqual(objectsAfterRetirement, ['fenced', 'fenced']);

  const retried = await register(root, races.held_preparation);
  assert.ok(!succeeded(retried), retried.body);
  assert.deepEqual(await admissions(root), afterRecovery);

  await sleep(Math.max(0, refreshedAt + 61_000 - Date.now()));
  await refresh(root, 'harness-do-claimed-recovery-next');
  const after = await activeState(root);
  return {
    kind: 'tenant_root_wallet_object_claimed_recovery_workers_e2e_v1',
    failedRegistration: [failed.status, failed.body.slice(0, 160)],
    admissionsAfterFailure: afterFailure,
    objectsAfterFailure,
    deriverARetired: [aRetired.kind, aRetired.cancelled_admissions],
    admissionsAfterRecovery: afterRecovery,
    deriverBRetired: [bRetired.kind, bRetired.cancelled_admissions],
    objectsAfterRetirement,
    retriedRegistration: [retried.status, retried.body.slice(0, 160)],
    secondRefreshRevision: after.lifecycle_revision,
  };
}

/// ECDSA work across a refresh. Each Deriver is called once per ECDSA
/// operation and admits it at its root read. A registration's call to
/// Deriver B is held while a manual refresh of the root commits and both
/// roles swap: A has admitted and answered on the old epoch, B has not. On
/// release B refuses, and the Router answers 503 so the client retries. The
/// same registration, retried, is admitted on the new epoch and forwarded.
async function testEcdsaWorkAcrossRefresh(topology, fixture, jwtSigner, databases) {
  ensureEcdsaClientWasm();
  const router = await topology.getWorker('router-recovery');
  // A root of its own, so nothing earlier in the run shapes its state.
  const root = recoveryCreationGrant('ecdsa-across-refresh', 60_000);
  const created = await postWorkerJson(router, tenantRootCreationPath, {
    creation_grant_b64u: root.creation_grant_b64u,
  });
  assert.equal(created.status, 200, await created.text());
  const tenantRoot = {
    identity_digest_b64u: root.identity_digest_b64u,
    custody_lineage_b64u: root.custody_lineage_b64u,
  };
  const scope = {
    identity_digest_b64u: tenantRoot.identity_digest_b64u,
    custody_lineage_b64u: tenantRoot.custody_lineage_b64u,
  };
  const status = async () => {
    const response = await postWorkerJson(router, tenantRootStatusPath, scope);
    const body = await response.text();
    assert.equal(response.status, 200, body);
    return JSON.parse(body);
  };
  const admissions = async () =>
    Promise.all(
      [databases.deriverA, databases.deriverB].map(async (database) =>
        (
          await database
            .prepare(
              `SELECT tenant_root_share_epoch AS epoch FROM tenant_root_root_use_admissions
               WHERE custody_lineage_b64u = ?1 ORDER BY tenant_root_share_epoch`,
            )
            .bind(tenantRoot.custody_lineage_b64u)
            .all()
        ).results.map((row) => row.epoch),
      ),
    );
  const count = (epochs, epoch) => epochs.filter((value) => value === epoch).length;
  const admissionStatuses = async () =>
    Promise.all(
      [databases.deriverA, databases.deriverB].map(async (database) =>
        (
          await database
            .prepare(
              `SELECT tenant_root_share_epoch AS epoch, status FROM tenant_root_root_use_admissions
               WHERE custody_lineage_b64u = ?1 ORDER BY tenant_root_share_epoch, admitted_at_ms`,
            )
            .bind(tenantRoot.custody_lineage_b64u)
            .all()
        ).results.map((row) => [row.epoch, row.status]),
      ),
    );
  const attempt = buildEcdsaRegistration(
    fixture,
    jwtSigner,
    'ecdsa-across-refresh',
    root.identity,
  );
  try {
    const register = async () => {
      const response = await postWorkerJson(
        router,
        ecdsaRegistrationPath,
        { registration_request: attempt.registrationRequest, tenant_root: tenantRoot },
        { authorization: `Bearer ${attempt.token}` },
      );
      return { status: response.status, body: await response.text() };
    };

    const before = await status();
    const oldEpoch = before.active_epoch;
    const [aBefore, bBefore] = await admissions();
    const hold = holdNextRecoveryRequest('deriver-b', deriverBEcdsaRegistrationPath);
    const registration = register();
    const reached = await Promise.race([
      hold.held.then(() => 'held'),
      registration.then((result) => ({ finished: result.status, body: result.body.slice(0, 400) })),
      sleep(60_000).then(() => 'timeout'),
    ]);
    assert.equal(reached, 'held', `the registration must reach Deriver B: ${JSON.stringify(reached)}`);
    for (
      let poll = 0;
      count((await admissions())[0], oldEpoch) === count(aBefore, oldEpoch);
      poll += 1
    ) {
      assert.ok(poll < 500, 'Deriver A must admit the ECDSA registration on the old epoch');
      await sleep(10);
    }
    const refreshed = await postWorkerJson(router, tenantRootRefreshPath, {
      operation_id: 'harness-ecdsa-across-refresh',
      ...scope,
      expected_lifecycle_revision: before.lifecycle_revision,
      expires_at_ms: Date.now() + 60_000,
      trigger: 'manual',
    });
    const refreshBody = await refreshed.text();
    assert.equal(refreshed.status, 200, refreshBody);
    assert.equal((await status()).active_epoch, oldEpoch + 1);
    hold.release();
    const refused = await registration;
    const deriverBAnswer = hold.answer();
    assert.notEqual(deriverBAnswer.status, 200, deriverBAnswer.body);
    assert.ok(
      deriverBAnswer.body.includes('was retired here before the operation was admitted'),
      deriverBAnswer.body,
    );
    assert.equal(refused.status, 503, refused.body);
    assert.ok(refused.body.includes('LifecycleTransitionInProgress'), refused.body);
    const [aRefused, bRefused] = await admissions();
    assert.equal(count(aRefused, oldEpoch), count(aBefore, oldEpoch) + 1, 'A admitted on the old epoch');
    assert.equal(count(bRefused, oldEpoch), count(bBefore, oldEpoch), 'B admitted nothing on the old epoch');

    const retried = await register();
    assert.equal(retried.status, 200, retried.body);
    const forwarded = JSON.parse(retried.body);
    assert.equal(forwarded.result, 'forwarded', retried.body);
    assert.equal(
      forwarded.response.bundles.signerB.transcriptDigestB64u,
      attempt.binding.transcriptDigestB64u,
      'Deriver B must bind the retried registration transcript',
    );
    const [aAfter, bAfter] = await admissions();
    assert.equal(count(aAfter, oldEpoch + 1), count(aBefore, oldEpoch + 1) + 1);
    assert.equal(count(bAfter, oldEpoch + 1), count(bBefore, oldEpoch + 1) + 1);
    // Each Deriver settles an ECDSA admission right after its single root
    // read, A's old-epoch one included: it read before the refresh.
    const statuses = await admissionStatuses();
    for (const roleStatuses of statuses) {
      assert.ok(roleStatuses.length > 0, JSON.stringify(statuses));
      assert.ok(
        roleStatuses.every(([, status]) => status === 'settled'),
        JSON.stringify(statuses),
      );
    }
    return {
      work: 'ecdsa_registration',
      heldBefore: 'deriver_b_ecdsa_registration',
      epochs: [oldEpoch, oldEpoch + 1],
      refreshStatus: refreshed.status,
      deriverBStatus: deriverBAnswer.status,
      registrationStatus: refused.status,
      admittedOnOldEpoch: { deriverA: true, deriverB: false },
      retryStatus: retried.status,
      retryResult: forwarded.result,
      admittedOnNewEpoch: { deriverA: true, deriverB: true },
      admissionStatuses: { deriverA: statuses[0], deriverB: statuses[1] },
    };
  } finally {
    attempt.ceremony.free();
  }
}

/// Opt-in (`--refresh-delivery-after-expiry`): the lost-delivery fault, with
/// the retry held until the committed receipt's window and the refresh
/// context have both expired. The committed decision is still delivered.
async function testTenantRootRefreshDeliveryAfterExpiry(topology, databases) {
  const router = await topology.getWorker('router-recovery');
  const creationNamespace = await topology.getDurableObjectNamespace(
    tenantRootCreationDoBinding,
    'router',
  );
  const creationState = async (ceremony, path, body) => {
    const stub = creationNamespace.get(creationNamespace.idFromName(ceremony.creation_object_name));
    const response = await stub.fetch(
      `https://router-ab-do.internal${path}`,
      authenticatedJsonRequest(body),
    );
    return { status: response.status, body: await response.text() };
  };
  const ceremony = recoveryCreationGrant('refresh-delivery-after-expiry', 60_000);
  const created = await postWorkerJson(router, tenantRootCreationPath, {
    creation_grant_b64u: ceremony.creation_grant_b64u,
  });
  assert.equal(created.status, 200, await created.text());
  // Past the five-minute receipt window and context lifetime.
  const summary = await testTenantRootRefreshDeliveryAfterLoss(
    router,
    ceremony,
    databases,
    creationState,
    300_000 + 10_000,
  );
  console.log(
    JSON.stringify({ kind: 'tenant_root_refresh_delivery_after_expiry_workers_e2e_v1', ...summary }),
  );
}

/// Opt-in (`--refresh-abandonment-after-expiry`): the VM refresh-abandonment
/// E2E on Workers. Both roles install a refresh and the Router's request for
/// its receipt is lost. Inside the window another operation waits. After it,
/// the stranded operation is refused as abandoned; the attempt's signed receipt
/// can neither be committed nor activate a Deriver; and a new operation
/// refreshes the root, each Deriver superseding the abandoned attempt's pending
/// row, backup and canary.
async function testTenantRootRefreshAbandonmentAfterExpiry(topology, databases) {
  const router = await topology.getWorker('router-recovery');
  const controlPlane = await topology.getWorker('tenant-root-control-plane');
  const deriverA = await topology.getWorker('deriver-a');
  const creationNamespace = await topology.getDurableObjectNamespace(
    tenantRootCreationDoBinding,
    'router',
  );
  const buckets = {
    deriverA: await topology.getR2Bucket(managedBackupR2Binding, 'deriver-a'),
    deriverB: await topology.getR2Bucket(managedBackupR2Binding, 'deriver-b'),
  };
  const ceremony = recoveryCreationGrant('refresh-abandonment-after-expiry', 60_000);
  const created = await postWorkerJson(router, tenantRootCreationPath, {
    creation_grant_b64u: ceremony.creation_grant_b64u,
  });
  assert.equal(created.status, 200, await created.text());
  const scope = {
    identity_digest_b64u: ceremony.identity_digest_b64u,
    custody_lineage_b64u: ceremony.custody_lineage_b64u,
  };
  const creationState = async (path, body) => {
    const stub = creationNamespace.get(creationNamespace.idFromName(ceremony.creation_object_name));
    const response = await stub.fetch(
      `https://router-ab-do.internal${path}`,
      authenticatedJsonRequest(body),
    );
    return { status: response.status, body: await response.text() };
  };
  const activeState = async () => {
    const read = await creationState(creationStateActiveStatePath, { kind: 'read', ...scope });
    assert.equal(read.status, 200, read.body);
    return JSON.parse(read.body);
  };
  const epochs = async (database) =>
    (
      await database
        .prepare(
          `SELECT tenant_root_share_epoch AS epoch, lifecycle FROM tenant_root_role_shares
           WHERE custody_lineage_b64u = ?1 ORDER BY tenant_root_share_epoch`,
        )
        .bind(ceremony.custody_lineage_b64u)
        .all()
    ).results.map((row) => [row.epoch, row.lifecycle]);
  const bothEpochs = async () => [await epochs(databases.deriverA), await epochs(databases.deriverB)];
  const supersessions = async (database) =>
    (
      await database
        .prepare(
          `SELECT count(*) AS count FROM tenant_root_refresh_supersessions
           WHERE custody_lineage_b64u = ?1`,
        )
        .bind(ceremony.custody_lineage_b64u)
        .first()
    ).count;
  const identityDigestHex = Buffer.from(ceremony.identity_digest_b64u, 'base64url').toString('hex');
  // Each role's epoch-2 managed backup and provider canary, as their bytes.
  const epochTwoObjects = async (bucket, role) => {
    const prefix = `tenant-root-managed-backup/v1/${role}/${identityDigestHex}/${ceremony.custody_lineage_b64u}/2`;
    const objects = [];
    for (const key of [`${prefix}.bin`, `${prefix}.provider-canary.bin`]) {
      const object = await bucket.get(key);
      assert.ok(object, `${key} must exist`);
      objects.push(Buffer.from(await object.arrayBuffer()).toString('base64url'));
    }
    return objects;
  };
  const allObjects = async () => [
    ...(await epochTwoObjects(buckets.deriverA, 'deriver-a')),
    ...(await epochTwoObjects(buckets.deriverB, 'deriver-b')),
  ];
  const refresh = async (operationId, expectedRevision) => {
    const response = await postWorkerJson(router, tenantRootRefreshPath, {
      operation_id: operationId,
      ...scope,
      expected_lifecycle_revision: expectedRevision,
      expires_at_ms: Date.now() + 60_000,
      trigger: 'manual',
    });
    const body = await response.text();
    let code = '';
    try {
      code = JSON.parse(body).code ?? '';
    } catch {}
    return { status: response.status, body, code };
  };

  // Both roles install the refresh; the Router's request for its receipt is lost.
  const before = await activeState();
  recoveryDropNextOnPath['tenant-root-control-plane'] = { path: controlPlaneRefreshActivationPath };
  const started = Date.now();
  const lost = await refresh('harness-refresh-stranded', before.lifecycle_revision);
  assert.equal(
    recoveryDropNextOnPath['tenant-root-control-plane'],
    null,
    'the control-plane refresh activation must have been dropped',
  );
  assert.notEqual(lost.status, 200, lost.body);
  const stranded = await activeState();
  assert.equal(stranded.fence.kind, 'executed', JSON.stringify(stranded.fence));
  assert.equal(stranded.lifecycle_revision, before.lifecycle_revision);
  const installed = [
    [1, 'active'],
    [2, 'pending'],
  ];
  assert.deepEqual(await bothEpochs(), [installed, installed]);
  const strandedObjects = await allObjects();
  // A correctly signed receipt for the stranded attempt, never committed.
  const reissued = await controlPlane.fetch(
    `https://private.test${controlPlaneRefreshActivationPath}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', [internalAuthHeader]: internalAuthSecret },
      body: recoveryDroppedBody['tenant-root-control-plane'],
    },
  );
  const reissuedBody = await reissued.text();
  assert.equal(reissued.status, 200, reissuedBody);
  const uncommittedReceipt = JSON.parse(reissuedBody).activation_receipt_b64u;

  // Inside the window the attempt is live: another operation must wait.
  const busy = await refresh('harness-refresh-next', before.lifecycle_revision);
  assert.equal(busy.status, 409, busy.body);
  assert.equal(busy.code, 'tenant_root_refresh_in_progress', busy.body);

  // The refresh context's window is five minutes from its issue; wait past it.
  await sleep(Math.max(0, started + 300_000 + 5_000 - Date.now()));

  // After it, the stranded operation is abandoned with its attempt.
  const abandoned = await refresh('harness-refresh-stranded', before.lifecycle_revision);
  assert.equal(abandoned.status, 409, abandoned.body);
  assert.equal(abandoned.code, 'tenant_root_refresh_abandoned', abandoned.body);
  assert.equal((await activeState()).fence.kind, 'abandoned');

  // Abandonment won: the receipt can no longer be committed (the creation
  // object answers the fence's conflict as 409), and no Deriver activates on it.
  const commit = await creationState(creationStateRefreshActivationPath, {
    activation_receipt_b64u: uncommittedReceipt,
  });
  assert.equal(commit.status, 409, commit.body);
  assert.equal(
    (await activeState()).activation_receipt_digest_b64u,
    before.activation_receipt_digest_b64u,
  );
  const delivered = await deriverA.fetch(
    `https://private.test${deriverRefreshActivationPath}`,
    authenticatedJsonRequest({ activation_receipt_b64u: uncommittedReceipt }),
  );
  const deliveredBody = await delivered.text();
  assert.notEqual(delivered.status, 200, deliveredBody);
  assert.deepEqual(await bothEpochs(), [installed, installed]);

  // A new operation refreshes the root. Each Deriver supersedes the abandoned
  // attempt: its pending row, backup and canary are replaced by the new ones.
  const next = await refresh('harness-refresh-next', before.lifecycle_revision);
  assert.equal(next.status, 200, next.body);
  const after = await activeState();
  assert.equal(after.lifecycle_revision, before.lifecycle_revision + 1);
  assert.equal(after.fence.kind, 'terminal');
  const nextResponse = JSON.parse(next.body);
  assert.equal(nextResponse.activation_receipt_digest_b64u, after.activation_receipt_digest_b64u);
  assert.deepEqual(retirementKinds(nextResponse.retirement), ['pending', 'pending']);
  const retiredThenActive = [
    [1, 'retired'],
    [2, 'active'],
  ];
  assert.deepEqual(await bothEpochs(), [retiredThenActive, retiredThenActive]);
  const replacedObjects = await allObjects();
  strandedObjects.forEach((object, index) =>
    assert.notEqual(object, replacedObjects[index], 'the abandoned attempt objects must be replaced'),
  );
  assert.deepEqual(
    [await supersessions(databases.deriverA), await supersessions(databases.deriverB)],
    [1, 1],
  );

  // An exact replay returns the durable outcome; the abandoned operation stays
  // abandoned.
  const replay = await refresh('harness-refresh-next', before.lifecycle_revision);
  assert.equal(replay.status, 200, replay.body);
  assert.deepEqual(JSON.parse(replay.body), nextResponse);
  const still = await refresh('harness-refresh-stranded', before.lifecycle_revision);
  assert.equal(still.status, 409, still.body);
  assert.equal(still.code, 'tenant_root_refresh_abandoned', still.body);
  return {
    kind: 'tenant_root_refresh_abandonment_workers_e2e_v1',
    fault: 'control_plane_refresh_activation_request_lost_then_window_closed',
    afterLoss: { routerFence: stranded.fence.kind, deriverA: installed, deriverB: installed },
    otherOperationInsideWindow: [busy.status, busy.code],
    strandedOperationAfterWindow: [abandoned.status, abandoned.code],
    signedUncommittedReceiptCommitAfterAbandonment: commit.status,
    signedUncommittedReceiptDeliveryAfterAbandonment: delivered.status,
    newOperationStatus: next.status,
    revisions: [before.lifecycle_revision, after.lifecycle_revision],
    epochsAfter: retiredThenActive,
    epochTwoBackupAndCanaryReplacedPerRole: true,
    supersessionsPerRole: [1, 1],
    exactReplayStatus: replay.status,
    strandedOperationLater: [still.status, still.code],
  };
}

async function testDeriverAWalletDoPreparation(topology, rootIdentity) {
  assert.ok(capturedDeriverAPreparation, 'Deriver A preparation fixture is required');
  const { request, receipt } = capturedDeriverAPreparation;
  const walletId = request.pair_binding.ceremony.binding.lifecycle.account_id;
  const owner = {
    org_id: rootIdentity.orgId,
    project_id: rootIdentity.projectId,
    env_id: rootIdentity.envId,
    wallet_id: walletId,
  };
  const objectName = deriverAWalletDoObjectName(owner);
  const namespace = await topology.getDurableObjectNamespace(deriverAWalletDoBinding, 'deriver-a');
  const objectId = namespace.idFromName(objectName);
  const object = namespace.get(objectId);
  const record = {
    status: 'prepared',
    pair_binding: request.pair_binding,
    root_metadata_digest: receipt.root_metadata_digest.bytes,
    expires_at_ms: receipt.expires_at_ms,
    receipt,
    payload: {
      tenant_root: request.tenant_root,
      work: request.work,
      input: request.input,
    },
  };
  const prepare = {
    operation: 'prepare',
    owner,
    root_identity: rootIdentity,
    record,
    now_ms: receipt.prepared_at_ms,
  };
  const first = await callDeriverAWalletDo(object, prepare);
  assert.equal(first.status, 200, `Deriver A wallet DO prepare: ${JSON.stringify(first.body)}`);
  assert.equal(first.body.result.kind, 'applied');
  assert.equal(first.body.result.revision, 1);
  const duplicate = await callDeriverAWalletDo(object, prepare);
  assert.equal(duplicate.body.result.kind, 'duplicate');
  assert.equal(duplicate.body.result.revision, 1);
  const changedExpiry = await callDeriverAWalletDo(object, {
    ...prepare,
    record: { ...record, expires_at_ms: receipt.expires_at_ms + 1 },
  });
  assert.equal(changedExpiry.body.result.kind, 'rejected');

  await topology.unsafeEvictDurableObject('deriver-a', deriverAWalletDoClass, {
    id: objectId.toString(),
  });
  const lookup = { operation: 'read', owner, pair_binding: request.pair_binding };
  const recovered = await callDeriverAWalletDo(object, lookup);
  assert.equal(recovered.body.kind, 'read');
  assert.equal(recovered.body.revision, 1);
  assert.deepEqual(recovered.body.record, record);

  const expired = await callDeriverAWalletDo(object, {
    operation: 'expire',
    owner,
    pair_binding: request.pair_binding,
    now_ms: receipt.expires_at_ms + 1,
  });
  assert.equal(expired.body.result.kind, 'applied');
  assert.equal(expired.body.result.record.status, 'expired');
  const late = await callDeriverAWalletDo(object, { ...prepare, now_ms: receipt.expires_at_ms + 1 });
  assert.equal(late.body.result.kind, 'rejected');
  const wrongOwner = await callDeriverAWalletDo(object, {
    ...lookup,
    owner: { ...owner, org_id: `${owner.org_id}-other` },
  });
  assert.notEqual(wrongOwner.status, 200);
  const wrongWallet = await callDeriverAWalletDo(object, {
    ...lookup,
    owner: { ...owner, wallet_id: `${owner.wallet_id}-other` },
  });
  assert.notEqual(wrongWallet.status, 200);
  const wrongRole = await callDeriverAWalletDo(object, {
    ...lookup,
    owner: { ...owner, role: 'deriver_b' },
  });
  assert.notEqual(wrongRole.status, 200);
}

function deriverAWalletDoObjectName(owner) {
  return `deriver-a-wallet-${createHash('sha256')
    .update('seams/deriver-a/wallet-do/v1')
    .update(JSON.stringify(owner))
    .digest('hex')}`;
}

async function testDeriverAWalletDoExecution(
  topology,
  fixture,
  tenantRoot,
  secondTenantRoot,
  databases,
) {
  competeDeriverAExecution = true;
  const activation = await captureValidActivationDelivery(topology, fixture, tenantRoot);
  competeDeriverAExecution = false;
  assert.ok(capturedDeriverAExecution, 'Deriver A execute request must be captured');
  const aRows = await databases.deriverA
    .prepare('SELECT COUNT(*) AS count FROM yao_pair_sessions')
    .first();
  assert.equal(aRows.count, 0, 'A pair execution must leave the legacy D1 pair table empty');
  const bBefore = await databases.deriverB
    .prepare('SELECT lifecycle, revision FROM yao_pair_sessions')
    .first();
  assert.equal(bBefore.lifecycle, 'completed', 'B must finish before A replay');

  const firstResponse = capturedDeriverAExecution.response;
  const rootIdentity = fixture.tenant_root_creation.identity;
  assert.deepEqual(capturedDeriverAExecution.request.tenant_root.identity, rootIdentity);
  const owner = {
    org_id: rootIdentity.orgId,
    project_id: rootIdentity.projectId,
    env_id: rootIdentity.envId,
    wallet_id:
      capturedDeriverAExecution.request.pair_binding.ceremony.binding.lifecycle.account_id,
  };
  const namespace = await topology.getDurableObjectNamespace(deriverAWalletDoBinding, 'deriver-a');
  const objectId = namespace.idFromName(deriverAWalletDoObjectName(owner));
  const rotatedIdentity = {
    ...rootIdentity,
    signingRootVersion: `${rootIdentity.signingRootVersion}-rotated`,
  };
  assert.equal(
    deriverAWalletDoObjectName(owner),
    deriverAWalletDoObjectName({
      org_id: rotatedIdentity.orgId,
      project_id: rotatedIdentity.projectId,
      env_id: rotatedIdentity.envId,
      wallet_id: owner.wallet_id,
    }),
    'wallet DO owner must be stable across signing-root versions',
  );
  await topology.unsafeEvictDurableObject('deriver-a', deriverAWalletDoClass, {
    id: objectId.toString(),
  });
  const object = namespace.get(objectId);
  const recovered = await callDeriverAWalletDo(object, {
    operation: 'read',
    owner,
    pair_binding: capturedDeriverAExecution.request.pair_binding,
  });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.kind, 'read');
  assert.equal(recovered.body.revision, 4, 'one A execution must make four lifecycle writes');
  assert.equal(recovered.body.record.status, 'completed');
  assert.deepEqual(recovered.body.record.outcome, firstResponse);
  const wrongTenant = await callDeriverAWalletDo(object, {
    operation: 'read',
    owner: { ...owner, org_id: `${owner.org_id}-other` },
    pair_binding: capturedDeriverAExecution.request.pair_binding,
  });
  assert.notEqual(wrongTenant.status, 200, 'another tenant cannot read this wallet DO');
  const wrongWallet = await callDeriverAWalletDo(object, {
    operation: 'read',
    owner: { ...owner, wallet_id: `${owner.wallet_id}-other` },
    pair_binding: capturedDeriverAExecution.request.pair_binding,
  });
  assert.notEqual(wrongWallet.status, 200, 'another wallet cannot read this wallet DO');
  const deriverA = await topology.getWorker('deriver-a');
  const replay = await postWorkerJson(
    deriverA,
    '/router-ab/deriver-a/ed25519-yao/execute-pair',
    capturedDeriverAExecution.request,
  );
  const replayBytes = await expectOk(replay, 'Deriver A wallet DO replay after B completed');
  assert.deepEqual(JSON.parse(replayBytes.toString('utf8')), firstResponse);
  const bAfter = await databases.deriverB
    .prepare('SELECT lifecycle, revision FROM yao_pair_sessions')
    .first();
  assert.deepEqual(bAfter, bBefore, 'A replay must not request a new B execution');
  const changedRequest = structuredClone(capturedDeriverAExecution.request);
  changedRequest.tenant_root.custody_binding.issued_at_ms += 1;
  const changed = await postWorkerJson(
    deriverA,
    '/router-ab/deriver-a/ed25519-yao/execute-pair',
    changedRequest,
  );
  assert.notEqual(changed.status, 200, 'changed request identity must not replay the outcome');
  const mismatchedRoot = structuredClone(capturedDeriverAExecution.request);
  mismatchedRoot.tenant_root.identity = rotatedIdentity;
  const mismatched = await postWorkerJson(
    deriverA,
    '/router-ab/deriver-a/ed25519-yao/execute-pair',
    mismatchedRoot,
  );
  assert.notEqual(mismatched.status, 200, 'root identity must match its signed receipt');
  const afterMismatch = await callDeriverAWalletDo(object, {
    operation: 'read',
    owner,
    pair_binding: capturedDeriverAExecution.request.pair_binding,
  });
  assert.equal(afterMismatch.body.revision, recovered.body.revision);
  const secondActivation = await captureValidActivationDelivery(
    topology,
    fixture,
    secondTenantRoot,
    'second_tenant_activation',
  );
  assert.ok(secondActivation.publicReceipt);
  const secondIdentity = fixture.tenant_root_creation.second_tenant_identity;
  const secondOwner = {
    org_id: secondIdentity.orgId,
    project_id: secondIdentity.projectId,
    env_id: secondIdentity.envId,
    wallet_id:
      capturedDeriverAExecution.request.pair_binding.ceremony.binding.lifecycle.account_id,
  };
  const secondObjectId = namespace.idFromName(deriverAWalletDoObjectName(secondOwner));
  assert.notEqual(secondObjectId.toString(), objectId.toString());
  const secondRecord = await callDeriverAWalletDo(namespace.get(secondObjectId), {
    operation: 'read',
    owner: secondOwner,
    pair_binding: capturedDeriverAExecution.request.pair_binding,
  });
  assert.equal(secondRecord.body.record.status, 'completed');
  const aRowsAfterSecondTenant = await databases.deriverA
    .prepare('SELECT COUNT(*) AS count FROM yao_pair_sessions')
    .first();
  assert.equal(aRowsAfterSecondTenant.count, 0);
  assert.ok(activation.publicReceipt, 'Router registration must complete through A wallet DO');
  const artifact = {
    kind: 'deriver_a_wallet_do_execution_e2e_v1',
    reproduce: 'ROUTER_AB_WORKER_BUILD_PROFILE=dev node ./scripts/test-private-d1.mjs --do-pair-execution',
    registeredPublicKey: activation.publicReceipt.registered_public_key,
    outcomeSha256Hex: createHash('sha256').update(JSON.stringify(firstResponse)).digest('hex'),
    aD1PairRows: aRows.count,
    bPairLifecycle: bBefore.lifecycle,
    bRevisionUnchangedOnReplay: true,
    aPairRevisionAfterConcurrentCalls: recovered.body.revision,
    replayAfterObjectEviction: true,
    exactReplayAfterBCompleted: true,
    stableOwnerDerivationAcrossRootVersions: true,
    crossTenantAndWalletReadsRejected: true,
    secondTenantRegistrationUsedSeparateWalletObject: true,
    mismatchedRootReceiptRejectedWithoutWrite: true,
  };
  const artifactPath = join(repoRoot, '.artifacts/r150/deriver-a-wallet-do-execution.json');
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({ ...artifact, artifactPath }));
}

async function testHistoricalRegistrationReplay(topology, fixture, tenantRoot, databases) {
  await assertGatewayOnlyRouterAuth(topology, fixture, tenantRoot, databases);
  const activation = await captureValidActivationDelivery(topology, fixture, tenantRoot);
  assert.ok(capturedDeriverAExecution, 'historical replay requires a completed A outcome');
  const rootIdentity = fixture.tenant_root_creation.identity;
  const pair = capturedDeriverAExecution.request.pair_binding;
  const owner = {
    org_id: rootIdentity.orgId,
    project_id: rootIdentity.projectId,
    env_id: rootIdentity.envId,
    wallet_id: pair.ceremony.binding.lifecycle.account_id,
  };
  const namespace = await topology.getDurableObjectNamespace(deriverAWalletDoBinding, 'deriver-a');
  const objectId = namespace.idFromName(deriverAWalletDoObjectName(owner));
  await topology.unsafeEvictDurableObject('deriver-a', deriverAWalletDoClass, {
    id: objectId.toString(),
  });
  const object = namespace.get(objectId);
  const aBefore = await callDeriverAWalletDo(object, {
    operation: 'read',
    owner,
    pair_binding: pair,
  });
  assert.equal(aBefore.body.record.status, 'completed');
  const bBefore = await databases.deriverB
    .prepare('SELECT lifecycle, revision FROM yao_pair_sessions')
    .first();
  assert.equal(bBefore.lifecycle, 'completed');
  const signingWorkerDatabase = await topology.getD1Database(
    signingWorkerD1Binding,
    'fixture-signing-worker',
  );
  const signingWorkerBefore = await signingWorkerFinalizationRows(signingWorkerDatabase);
  assert.equal(signingWorkerBefore.activations, 1);
  const activationCallsBefore = signingWorkerActivationCalls;
  const lookupCallsBefore = signingWorkerFinalizationLookups;
  deriverBOffline = true;
  blockedDeriverBCalls = 0;

  const replayRouter = await topology.getWorker('router-replay');
  const ordinaryRequestWithoutRoot = await postWorkerJson(
    replayRouter,
    ed25519ExecutePath,
    activation.envelope,
  );
  assert.notEqual(
    ordinaryRequestWithoutRoot.status,
    200,
    'the replay Router must have no active-root read binding',
  );
  const replayBytes = await expectOk(
    await postWorkerJson(replayRouter, ed25519ExecutePath, activation.envelope, {
      'x-seams-yao-replay': '1',
    }),
    'historical registration replay',
  );
  assert.deepEqual(replayBytes, activation.responseBytes);
  assert.equal(signingWorkerActivationCalls, activationCallsBefore);
  assert.equal(historicalReplayActivationCalls, 0);
  assert.equal(signingWorkerFinalizationLookups, lookupCallsBefore + 1);
  assert.equal(blockedDeriverBCalls, 0);
  assert.deepEqual(await signingWorkerFinalizationRows(signingWorkerDatabase), signingWorkerBefore);
  const aAfter = await callDeriverAWalletDo(object, {
    operation: 'read',
    owner,
    pair_binding: pair,
  });
  assert.equal(aAfter.body.revision, aBefore.body.revision);
  assert.deepEqual(
    await databases.deriverB.prepare('SELECT lifecycle, revision FROM yao_pair_sessions').first(),
    bBefore,
  );

  const missingARouter = await topology.getWorker('router-replay-missing-a');
  const missingABytes = await expectOk(
    await postWorkerJson(missingARouter, ed25519ExecutePath, activation.envelope, {
      'x-seams-yao-replay': '1',
    }),
    'historical replay with missing A and completed B',
  );
  assert.deepEqual(JSON.parse(missingABytes.toString('utf8')), {
    status: 'recoverable_failure',
    code: 'service_unavailable',
    retry_after_ms: 1000,
  });
  assert.equal(signingWorkerFinalizationLookups, lookupCallsBefore + 1);

  const wrongLineage = structuredClone(activation.envelope);
  const lineageBytes = Buffer.from(wrongLineage.tenant_root.custody_lineage_b64u, 'base64url');
  lineageBytes[0] ^= 1;
  wrongLineage.tenant_root.custody_lineage_b64u = lineageBytes.toString('base64url');
  const mismatched = await postWorkerJson(replayRouter, ed25519ExecutePath, wrongLineage, {
    'x-seams-yao-replay': '1',
  });
  assert.notEqual(mismatched.status, 200, 'changed custody lineage cannot read committed result');
  assert.equal(signingWorkerFinalizationLookups, lookupCallsBefore + 1);

  const material = pair.ceremony.binding.material_activation;
  const activeKey = [
    'active-signing-worker',
    material.material_owner,
    material.activation_id,
    material.signing_worker,
  ].join('/');
  await signingWorkerDatabase
    .prepare('DELETE FROM signing_worker_activations WHERE active_key = ?1')
    .bind(activeKey)
    .run();
  const conflictBytes = await expectOk(
    await postWorkerJson(replayRouter, ed25519ExecutePath, activation.envelope, {
      'x-seams-yao-replay': '1',
    }),
    'historical replay with inconsistent finalization',
  );
  assert.deepEqual(JSON.parse(conflictBytes.toString('utf8')), {
    status: 'rejected',
    code: 'conflicting_pair',
  });
  await signingWorkerDatabase
    .prepare('INSERT INTO signing_worker_activation_revocation_fences (active_key) VALUES (?1)')
    .bind(activeKey)
    .run();
  const revokedBytes = await expectOk(
    await postWorkerJson(replayRouter, ed25519ExecutePath, activation.envelope, {
      'x-seams-yao-replay': '1',
    }),
    'historical replay after output revocation',
  );
  assert.deepEqual(JSON.parse(revokedBytes.toString('utf8')), {
    status: 'rejected',
    code: 'authorization_rejected',
  });
  assert.equal(signingWorkerActivationCalls, activationCallsBefore);
  assert.equal(historicalReplayActivationCalls, 0);
  assert.equal(blockedDeriverBCalls, 0);
  assert.deepEqual(await signingWorkerFinalizationRows(signingWorkerDatabase), {
    lifecycles: signingWorkerBefore.lifecycles,
    activations: 0,
    fences: 1,
  });

  const artifact = {
    kind: 'yao_historical_registration_replay_e2e_v1',
    reproduce:
      'ROUTER_AB_WORKER_BUILD_PROFILE=dev node ./scripts/test-private-d1.mjs --do-historical-replay',
    exactResponseSha256Hex: createHash('sha256').update(replayBytes).digest('hex'),
    replayWithEvictedAAndUnavailableRoot: true,
    bUnavailableAndUnchanged: true,
    missingAWithCompletedBStayedPending: true,
    changedCustodyLineageRejected: true,
    missingOutputRejectedWithoutReactivation: true,
    fencedOutputRejectedWithoutReactivation: true,
    sharedRoleBearerRejectedBeforePairEffects: true,
    missingGatewayBindingFailedClosed: true,
    sharedGatewayBindingFailedClosed: true,
  };
  const artifactPath = join(repoRoot, '.artifacts/r150/yao-historical-registration-replay.json');
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({ ...artifact, artifactPath }));
}

async function assertGatewayOnlyRouterAuth(topology, fixture, tenantRoot, databases) {
  const router = await topology.getWorker('router');
  const envelope = buildEd25519ExecuteRequest(fixture, 'activation', tenantRoot);
  for (const roleEnv of [
    fixture.deriver_a_env,
    fixture.deriver_b_env,
    fixture.signing_worker_env,
  ]) {
    assert.equal(roleEnv.ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET, internalAuthSecret);
    assert.equal(roleEnv.ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET, undefined);
  }
  for (const path of gatewayOnlyRouterPaths) {
    const body = path === ed25519ExecutePath ? envelope : {};
    const sharedBearer = await postWorkerJson(router, path, body, {
      [internalAuthHeader]: internalAuthSecret,
    });
    assert.equal(sharedBearer.status, 403, `${path} must reject the role-shared bearer`);
    const missingBearer = await postWorkerJson(router, path, body, {
      [internalAuthHeader]: '',
    });
    assert.equal(missingBearer.status, 403, `${path} must reject a missing bearer`);
  }
  assert.equal(capturedDeriverAPreparation, undefined);
  const bRows = await databases.deriverB
    .prepare('SELECT COUNT(*) AS count FROM yao_pair_sessions')
    .first();
  assert.equal(bRows.count, 0, 'rejected requests cannot prepare B');
  const dedicatedBearer = await postWorkerJson(router, ed25519ExecutePath, {});
  assert.notEqual(dedicatedBearer.status, 403, 'the dedicated bearer must reach request parsing');
  const unconfiguredRouter = await topology.getWorker('router-missing-gateway-auth');
  const unconfiguredResponse = await postWorkerJson(
    unconfiguredRouter,
    ed25519ExecutePath,
    envelope,
  );
  assert.ok(unconfiguredResponse.status >= 500, 'missing Router credential must fail closed');
  const collidingRouter = await topology.getWorker('router-shared-gateway-auth');
  const collidingResponse = await postWorkerJson(
    collidingRouter,
    ed25519ExecutePath,
    envelope,
    { [internalAuthHeader]: internalAuthSecret },
  );
  assert.ok(collidingResponse.status >= 500, 'shared Gateway credential must fail closed');
}

async function testHistoricalReplayAfterAStartClaim(topology, fixture, tenantRoot, databases) {
  capturedDeriverAExecutionRequest = undefined;
  holdDeriverAExecutionBeforeDispatch = true;
  const envelope = buildEd25519ExecuteRequest(fixture, 'activation', tenantRoot);
  const router = await topology.getWorker('router');
  const initialResponse = await postWorkerJson(router, ed25519ExecutePath, envelope);
  holdDeriverAExecutionBeforeDispatch = false;
  const initialBody = (await responseBytes(initialResponse)).toString('utf8');
  if (initialResponse.status === 200) {
    assert.notEqual(JSON.parse(initialBody).status, 'succeeded');
  }
  assert.ok(capturedDeriverAExecutionRequest, 'Router must reach A execution after preparation');
  const pair = capturedDeriverAExecutionRequest.pair_binding;
  const rootIdentity = fixture.tenant_root_creation.identity;
  const owner = {
    org_id: rootIdentity.orgId,
    project_id: rootIdentity.projectId,
    env_id: rootIdentity.envId,
    wallet_id: pair.ceremony.binding.lifecycle.account_id,
  };
  const namespace = await topology.getDurableObjectNamespace(deriverAWalletDoBinding, 'deriver-a');
  const object = namespace.get(namespace.idFromName(deriverAWalletDoObjectName(owner)));
  const prepared = await callDeriverAWalletDo(object, {
    operation: 'read',
    owner,
    pair_binding: pair,
  });
  assert.equal(prepared.body.record.status, 'prepared');
  const started = await callDeriverAWalletDo(object, {
    operation: 'reserve',
    owner,
    pair_binding: pair,
    local_receipt: capturedDeriverAExecutionRequest.local_receipt,
    peer_receipt: capturedDeriverAExecutionRequest.peer_receipt,
    execution_id: pair.pair_digest.bytes,
    now_ms: Date.now(),
  });
  assert.equal(started.status, 200, `A start claim: ${JSON.stringify(started.body)}`);
  assert.equal(started.body.result.kind, 'applied');
  assert.equal(started.body.result.record.status, 'starting');
  deriverBOffline = true;
  blockedDeriverBCalls = 0;
  const replayRouter = await topology.getWorker('router-replay');
  const pendingBytes = await expectOk(
    await postWorkerJson(replayRouter, ed25519ExecutePath, envelope, {
      'x-seams-yao-replay': '1',
    }),
    'historical replay after A start claim',
  );
  assert.deepEqual(JSON.parse(pendingBytes.toString('utf8')), {
    status: 'recoverable_failure',
    code: 'service_unavailable',
    retry_after_ms: 1000,
  });
  assert.equal(historicalReplayActivationCalls, 0);
  assert.equal(blockedDeriverBCalls, 0);
  const stillStarting = await callDeriverAWalletDo(object, {
    operation: 'read',
    owner,
    pair_binding: pair,
  });
  assert.equal(stillStarting.body.record.status, 'starting');
  assert.equal(stillStarting.body.revision, started.body.result.revision);
  const bAfter = await databases.deriverB
    .prepare('SELECT lifecycle, revision FROM yao_pair_sessions')
    .first();
  assert.equal(bAfter.lifecycle, 'prepared');

  const artifact = {
    kind: 'yao_historical_replay_after_a_start_claim_e2e_v1',
    reproduce:
      'ROUTER_AB_WORKER_BUILD_PROFILE=dev node ./scripts/test-private-d1.mjs --do-historical-starting-replay',
    startingARevision: started.body.result.revision,
    replayStayedPendingAfterAStartClaim: true,
    noReplayActivationOrBCall: true,
  };
  const artifactPath = join(repoRoot, '.artifacts/r150/yao-historical-starting-replay.json');
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({ ...artifact, artifactPath }));
}

async function testDeriverAWalletDoLostReply(topology, fixture, tenantRoot, databases) {
  dropDeriverAExecutionResponse = true;
  capturedDeriverAExecution = undefined;
  const router = await topology.getWorker('router');
  const envelope = buildEd25519ExecuteRequest(fixture, 'activation', tenantRoot);
  const routerResponse = await postWorkerJson(router, ed25519ExecutePath, envelope);
  const routerBody = (await responseBytes(routerResponse)).toString('utf8');
  if (routerResponse.status === 200) {
    assert.notEqual(
      JSON.parse(routerBody).status,
      'succeeded',
      'Router must observe the simulated lost A response',
    );
  }
  dropDeriverAExecutionResponse = false;
  assert.ok(capturedDeriverAExecution, 'A must commit before the harness drops its response');
  const aRows = await databases.deriverA
    .prepare('SELECT COUNT(*) AS count FROM yao_pair_sessions')
    .first();
  assert.equal(aRows.count, 0);
  const bTerminal = await databases.deriverB
    .prepare('SELECT lifecycle, revision FROM yao_pair_sessions')
    .first();
  assert.equal(bTerminal.lifecycle, 'completed');

  const rootIdentity = fixture.tenant_root_creation.identity;
  const owner = {
    org_id: rootIdentity.orgId,
    project_id: rootIdentity.projectId,
    env_id: rootIdentity.envId,
    wallet_id:
      capturedDeriverAExecution.request.pair_binding.ceremony.binding.lifecycle.account_id,
  };
  const namespace = await topology.getDurableObjectNamespace(deriverAWalletDoBinding, 'deriver-a');
  const objectId = namespace.idFromName(deriverAWalletDoObjectName(owner));
  await topology.unsafeEvictDurableObject('deriver-a', deriverAWalletDoClass, {
    id: objectId.toString(),
  });
  const deriverA = await topology.getWorker('deriver-a');
  const object = namespace.get(objectId);
  const stored = await callDeriverAWalletDo(object, {
    operation: 'read',
    owner,
    pair_binding: capturedDeriverAExecution.request.pair_binding,
  });
  assert.equal(stored.body.record.status, 'completed');
  const scopedLookup = {
    root_identity: rootIdentity,
    pair_binding: capturedDeriverAExecution.request.pair_binding,
  };
  const scopedStatus = await postWorkerJson(deriverA, deriverAWalletStatusPath, scopedLookup);
  const scopedStatusBytes = await expectOk(scopedStatus, 'scoped Deriver A wallet status');
  const scopedOutcome = JSON.parse(scopedStatusBytes.toString('utf8'));
  assert.equal(scopedOutcome.status, 'completed');
  assert.deepEqual(scopedOutcome.outcome, capturedDeriverAExecution.response);
  const wrongTenant = await postWorkerJson(deriverA, deriverAWalletStatusPath, {
    ...scopedLookup,
    root_identity: { ...rootIdentity, orgId: `${rootIdentity.orgId}-other` },
  });
  const wrongTenantBytes = await expectOk(wrongTenant, 'wrong-tenant wallet status');
  assert.equal(JSON.parse(wrongTenantBytes.toString('utf8')).status, 'missing');
  const changedRoot = await postWorkerJson(deriverA, deriverAWalletStatusPath, {
    ...scopedLookup,
    root_identity: {
      ...rootIdentity,
      signingRootVersion: `${rootIdentity.signingRootVersion}-changed`,
    },
  });
  assert.notEqual(changedRoot.status, 200, 'another root version cannot read the admitted pair');
  const wrongExecution = stored.body.record.execution_id.slice();
  wrongExecution[0] ^= 1;
  const wrongBurn = await postWorkerJson(deriverA, deriverAWalletBurnPath, {
    ...scopedLookup,
    execution_id: wrongExecution,
  });
  assert.notEqual(wrongBurn.status, 200, 'wrong execution cannot cancel A custody');
  const wrongTenantBurn = await postWorkerJson(deriverA, deriverAWalletBurnPath, {
    ...scopedLookup,
    root_identity: { ...rootIdentity, orgId: `${rootIdentity.orgId}-other` },
    execution_id: stored.body.record.execution_id,
  });
  const wrongTenantBurnBytes = await expectOk(wrongTenantBurn, 'wrong-tenant cancellation');
  assert.equal(JSON.parse(wrongTenantBurnBytes.toString('utf8')).status, 'missing');
  const completedBurn = await postWorkerJson(deriverA, deriverAWalletBurnPath, {
    ...scopedLookup,
    execution_id: stored.body.record.execution_id,
  });
  assert.notEqual(completedBurn.status, 200, 'completed A custody cannot be cancelled');
  deriverBOffline = true;
  blockedDeriverBCalls = 0;
  const routerReplay = await postWorkerJson(router, ed25519ExecutePath, envelope, {
    'x-seams-yao-replay': '1',
  });
  const routerReplayBytes = await expectOk(routerReplay, 'Router scoped replay after lost reply');
  assert.deepEqual(JSON.parse(routerReplayBytes.toString('utf8')), {
    status: 'recoverable_failure',
    code: 'signing_worker_uncertain',
    retry_after_ms: 1000,
  });
  assert.equal(blockedDeriverBCalls, 0, 'completed A replay must not call unavailable B');
  assert.equal(capturedSigningWorkerDelivery, undefined);
  assert.equal(signingWorkerActivationCalls, 0);
  const replay = await postWorkerJson(
    deriverA,
    '/router-ab/deriver-a/ed25519-yao/execute-pair',
    capturedDeriverAExecution.request,
  );
  const replayBytes = await expectOk(replay, 'Deriver A replay after lost reply and eviction');
  assert.deepEqual(
    JSON.parse(replayBytes.toString('utf8')),
    capturedDeriverAExecution.response,
  );
  const bAfter = await databases.deriverB
    .prepare('SELECT lifecycle, revision FROM yao_pair_sessions')
    .first();
  assert.deepEqual(bAfter, bTerminal);
  const afterReplay = await callDeriverAWalletDo(object, {
    operation: 'read',
    owner,
    pair_binding: capturedDeriverAExecution.request.pair_binding,
  });
  assert.equal(afterReplay.body.revision, stored.body.revision);
  const artifact = {
    kind: 'deriver_a_wallet_do_lost_reply_e2e_v1',
    reproduce: 'ROUTER_AB_WORKER_BUILD_PROFILE=dev node ./scripts/test-private-d1.mjs --do-pair-lost-reply',
    outcomeSha256Hex: createHash('sha256')
      .update(JSON.stringify(capturedDeriverAExecution.response))
      .digest('hex'),
    aD1PairRows: aRows.count,
    bPairLifecycle: bTerminal.lifecycle,
    bRevisionUnchangedOnReplay: true,
    bOfflineDuringRouterReplay: true,
    routerScopedReplayStayedPendingWithoutActivation: true,
    wrongTenantRootAndExecutionCancellationLeftStateUnchanged: true,
    exactReplayAfterLostReplyAndEviction: true,
  };
  const artifactPath = join(repoRoot, '.artifacts/r150/deriver-a-wallet-do-lost-reply.json');
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({ ...artifact, artifactPath }));
}

async function testDeriverBBurnBeforeCompletion(topology, fixture, tenantRoot, databases) {
  capturedSigningWorkerDelivery = undefined;
  capturedDeriverAPreparation = undefined;
  const router = await topology.getWorker('router');
  const envelope = buildEd25519ExecuteRequest(fixture, 'activation', tenantRoot);
  const response = await postWorkerJson(router, ed25519ExecutePath, envelope);
  const responseBody = (await responseBytes(response)).toString('utf8');
  if (response.status === 200) {
    assert.notEqual(JSON.parse(responseBody).status, 'succeeded');
  }
  assert.ok(capturedDeriverAPreparation, 'A pair preparation must reach the wallet DO');
  assert.equal(capturedSigningWorkerDelivery, undefined);

  const bTerminal = await databases.deriverB
    .prepare('SELECT lifecycle, revision FROM yao_pair_sessions')
    .first();
  assert.equal(bTerminal.lifecycle, 'burned', 'B must persist the injected burn');
  const aRows = await databases.deriverA
    .prepare('SELECT COUNT(*) AS count FROM yao_pair_sessions')
    .first();
  assert.equal(aRows.count, 0);
  const pair = capturedDeriverAPreparation.request.pair_binding;
  const rootIdentity = fixture.tenant_root_creation.identity;
  const owner = {
    org_id: rootIdentity.orgId,
    project_id: rootIdentity.projectId,
    env_id: rootIdentity.envId,
    wallet_id: pair.ceremony.binding.lifecycle.account_id,
  };
  const namespace = await topology.getDurableObjectNamespace(deriverAWalletDoBinding, 'deriver-a');
  const objectId = namespace.idFromName(deriverAWalletDoObjectName(owner));
  const object = namespace.get(objectId);
  const aTerminal = await callDeriverAWalletDo(object, {
    operation: 'read',
    owner,
    pair_binding: pair,
  });
  assert.equal(aTerminal.status, 200);
  assert.equal(aTerminal.body.record.status, 'burned', 'A cannot complete from B burn');
  const replay = await postWorkerJson(router, ed25519ExecutePath, envelope, {
    'x-seams-yao-replay': '1',
  });
  const replayBody = (await responseBytes(replay)).toString('utf8');
  if (replay.status === 200) {
    assert.notEqual(JSON.parse(replayBody).status, 'succeeded');
  }
  const bAfter = await databases.deriverB
    .prepare('SELECT lifecycle, revision FROM yao_pair_sessions')
    .first();
  assert.deepEqual(bAfter, bTerminal);
  assert.equal(capturedSigningWorkerDelivery, undefined);
  const artifact = {
    kind: 'deriver_b_completion_burn_race_e2e_v1',
    reproduce: 'ROUTER_AB_WORKER_BUILD_PROFILE=dev node ./scripts/test-private-d1.mjs --do-pair-b-burn-before-complete',
    bPairLifecycle: bTerminal.lifecycle,
    aPairLifecycle: aTerminal.body.record.status,
    aD1PairRows: aRows.count,
    noSigningWorkerDelivery: true,
    noFreshBExecutionOnReplay: true,
  };
  const artifactPath = join(repoRoot, '.artifacts/r150/deriver-b-completion-burn-race.json');
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({ ...artifact, artifactPath }));
}

async function callDeriverAWalletDo(object, body) {
  try {
    const response = await object.fetch(`https://router-ab-do.internal${deriverAWalletDoPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const responseBody = await response.text();
    if (!response.ok) return { status: response.status, body: responseBody };
    return { status: response.status, body: JSON.parse(responseBody) };
  } catch (error) {
    return { status: 500, body: String(error) };
  }
}

async function testTenantRootManagedRestoreOperatingPath(
  topology,
  fixture,
  tenantRoot,
  databases,
) {
  const router = await topology.getWorker('router');
  const controlPlane = await topology.getWorker('tenant-root-control-plane');
  const identityDigestHex = Buffer.from(tenantRoot.identity_digest_b64u, 'base64url').toString(
    'hex',
  );
  const deleted = await databases.deriverA
    .prepare(
      `DELETE FROM tenant_root_role_shares
       WHERE tenant_identity_digest_hex = ? AND custody_lineage_b64u = ?
         AND role = 'deriver_a' AND lifecycle = 'active'`,
    )
    .bind(identityDigestHex, tenantRoot.custody_lineage_b64u)
    .run();
  assert.equal(
    deleted.meta.changes,
    1,
    'managed-restore proof must begin with exactly one unavailable Deriver A active share',
  );

  const issuedAtMs = Date.now();
  const challengeRequest = {
    ...tenantRoot,
    incident_id: 'private-d1-managed-restore-deriver-a-v1',
    outage_observation_digest_b64u: createHash('sha256')
      .update('private-d1-managed-restore-outage-v1')
      .update(Buffer.from(tenantRoot.identity_digest_b64u, 'base64url'))
      .digest('base64url'),
    issued_at_ms: issuedAtMs,
    expires_at_ms: issuedAtMs + 60_000,
    nonce_b64u: createHash('sha256')
      .update('private-d1-managed-restore-nonce-v1')
      .update(Buffer.from(tenantRoot.identity_digest_b64u, 'base64url'))
      .digest('base64url'),
    unavailable_role: 'deriver_a',
  };
  const challengeBytes = await expectOk(
    await postWorkerJson(
      controlPlane,
      tenantRootManagedRestoreChallengePath,
      challengeRequest,
    ),
    'managed-restore dual-authorization challenge',
  );
  const challengeRetryBytes = await expectOk(
    await postWorkerJson(
      controlPlane,
      tenantRootManagedRestoreChallengePath,
      challengeRequest,
    ),
    'managed-restore challenge exact retry',
  );
  assert.deepEqual(
    challengeRetryBytes,
    challengeBytes,
    'managed-restore challenge retry must replay the exact persisted binding',
  );
  const challenge = JSON.parse(challengeBytes.toString('utf8'));
  assert.equal(challenge.identity_digest_b64u, tenantRoot.identity_digest_b64u);
  assert.equal(challenge.custody_lineage_b64u, tenantRoot.custody_lineage_b64u);
  assert.equal(challenge.unavailable_role, 'deriver_a');
  assert.equal(typeof challenge.authorization_binding_b64u, 'string');

  const incidentAuthorizationB64u = signManagedRestoreAuthorization(
    challenge.authorization_binding_b64u,
    fixture.managed_restore,
    challenge.unavailable_role,
  );
  const authorizeRequest = {
    identity_digest_b64u: tenantRoot.identity_digest_b64u,
    custody_lineage_b64u: tenantRoot.custody_lineage_b64u,
    incident_authorization_b64u: incidentAuthorizationB64u,
  };
  const authorizationBytes = await expectOk(
    await postWorkerJson(
      controlPlane,
      tenantRootManagedRestoreAuthorizePath,
      authorizeRequest,
    ),
    'managed-restore dual authorization',
  );
  const authorizationRetryBytes = await expectOk(
    await postWorkerJson(
      controlPlane,
      tenantRootManagedRestoreAuthorizePath,
      authorizeRequest,
    ),
    'managed-restore authorization exact retry',
  );
  assert.deepEqual(
    authorizationRetryBytes,
    authorizationBytes,
    'managed-restore authorization retry must replay exact issuer artifacts',
  );
  const authorization = JSON.parse(authorizationBytes.toString('utf8'));
  assert.equal(authorization.incident_authorization_b64u, incidentAuthorizationB64u);

  const restoreRequest = {
    public_state_b64u: authorization.public_state_b64u,
    restore_capability_b64u: authorization.capability_b64u,
  };
  const response = await postWorkerJson(router, tenantRootManagedRestorePath, restoreRequest);
  const bytes = await expectOk(response, 'live managed restore and mandatory forward refresh');
  const refresh = JSON.parse(bytes.toString('utf8'));
  assert.equal(
    typeof refresh.activation_receipt_digest_b64u,
    'string',
    'managed restore must return its forward-refresh activation receipt digest',
  );
  assert.ok(
    Number.isInteger(refresh.lifecycle_revision) && refresh.lifecycle_revision > 0,
    'managed restore must advance the lifecycle revision',
  );
  const retryBytes = await expectOk(
    await postWorkerJson(router, tenantRootManagedRestorePath, {
      public_state_b64u: authorization.public_state_b64u,
      restore_capability_b64u: authorization.capability_b64u,
    }),
    'live managed-restore exact retry',
  );
  // The durable outcome replays exactly; its retirement is a live report.
  const retry = JSON.parse(retryBytes.toString('utf8'));
  assert.deepEqual(
    [retry.activation_receipt_digest_b64u, retry.lifecycle_revision],
    [refresh.activation_receipt_digest_b64u, refresh.lifecycle_revision],
    'the same managed-restore request must replay its exact completed refresh',
  );
  const [activeA, activeB] = await Promise.all([
    databases.deriverA
      .prepare(
        `SELECT tenant_root_share_epoch, lifecycle FROM tenant_root_role_shares
         WHERE tenant_identity_digest_hex = ? AND custody_lineage_b64u = ?
         ORDER BY tenant_root_share_epoch`,
      )
      .bind(identityDigestHex, tenantRoot.custody_lineage_b64u)
      .all(),
    databases.deriverB
      .prepare(
        `SELECT tenant_root_share_epoch, lifecycle FROM tenant_root_role_shares
         WHERE tenant_identity_digest_hex = ? AND custody_lineage_b64u = ?
         ORDER BY tenant_root_share_epoch`,
      )
      .bind(identityDigestHex, tenantRoot.custody_lineage_b64u)
      .all(),
  ]);
  // B's previous epoch is retired and kept: erasure waits for the
  // safe-retirement rule, so the refresh reports its retirement pending. A
  // had lost its epoch-1 share, so it holds only the restored-and-refreshed
  // epoch 2.
  assert.deepEqual(retirementKinds(refresh.retirement), ['pending', 'pending'], JSON.stringify(refresh));
  assert.deepEqual(activeA.results, [{ tenant_root_share_epoch: 2, lifecycle: 'active' }]);
  assert.deepEqual(activeB.results, [
    { tenant_root_share_epoch: 1, lifecycle: 'retired' },
    { tenant_root_share_epoch: 2, lifecycle: 'active' },
  ]);
  const [backupBucketA, backupBucketB] = await Promise.all([
    topology.getR2Bucket(managedBackupR2Binding, 'deriver-a'),
    topology.getR2Bucket(managedBackupR2Binding, 'deriver-b'),
  ]);
  const [backupsA, backupsB] = await Promise.all([backupBucketA.list(), backupBucketB.list()]);
  const backupPrefix = `tenant-root-managed-backup/v1`;
  const backupCoordinates = `${identityDigestHex}/${tenantRoot.custody_lineage_b64u}`;
  const backupKeysA = backupsA.objects.map((object) => object.key);
  const backupKeysB = backupsB.objects.map((object) => object.key);
  assert.ok(
    backupKeysA.includes(`${backupPrefix}/deriver-a/${backupCoordinates}/1.bin`),
    'Deriver A retired backup is kept while its retirement is pending',
  );
  assert.ok(
    backupKeysB.includes(`${backupPrefix}/deriver-b/${backupCoordinates}/1.bin`),
    'Deriver B retired backup is kept while its retirement is pending',
  );
  assert.ok(
    backupKeysA.includes(`${backupPrefix}/deriver-a/${backupCoordinates}/2.bin`),
    'Deriver A active backup must remain available',
  );
  assert.ok(
    backupKeysB.includes(`${backupPrefix}/deriver-b/${backupCoordinates}/2.bin`),
    'Deriver B active backup must remain available',
  );
  return { refresh, bytes, restoreRequest };
}

/// A root refreshes again after an availability restore, and an exact retry
/// of the restore still returns its durable outcome.
async function testTenantRootRefreshAfterManagedRestore(topology, tenantRoot, databases, restore) {
  const router = await topology.getWorker('router');
  const identityDigestHex = Buffer.from(tenantRoot.identity_digest_b64u, 'base64url').toString(
    'hex',
  );
  const epochs = async (database) =>
    (
      await database
        .prepare(
          `SELECT tenant_root_share_epoch AS epoch, lifecycle FROM tenant_root_role_shares
           WHERE tenant_identity_digest_hex = ? AND custody_lineage_b64u = ?
           ORDER BY tenant_root_share_epoch`,
        )
        .bind(identityDigestHex, tenantRoot.custody_lineage_b64u)
        .all()
    ).results.map((row) => [row.epoch, row.lifecycle]);
  // The refresh first erases the epoch the restore's swap retired, once the
  // grace after that swap has passed.
  await sleep(1_100);
  const refreshed = await postWorkerJson(router, tenantRootRefreshPath, {
    operation_id: 'harness-refresh-after-managed-restore',
    identity_digest_b64u: tenantRoot.identity_digest_b64u,
    custody_lineage_b64u: tenantRoot.custody_lineage_b64u,
    expected_lifecycle_revision: restore.refresh.lifecycle_revision,
    expires_at_ms: Date.now() + 60_000,
    trigger: 'manual',
  });
  const refreshedBody = await refreshed.text();
  assert.equal(refreshed.status, 200, `refresh after a managed restore: ${refreshedBody}`);
  const response = JSON.parse(refreshedBody);
  assert.equal(response.lifecycle_revision, restore.refresh.lifecycle_revision + 1);
  const deriverA = await epochs(databases.deriverA);
  const deriverB = await epochs(databases.deriverB);
  assert.deepEqual(deriverA, [
    [2, 'retired'],
    [3, 'active'],
  ]);
  assert.deepEqual(deriverB, [
    [2, 'retired'],
    [3, 'active'],
  ]);
  const retried = JSON.parse(
    (
      await expectOk(
        await postWorkerJson(router, tenantRootManagedRestorePath, restore.restoreRequest),
        'managed-restore exact retry after a later refresh',
      )
    ).toString('utf8'),
  );
  const original = JSON.parse(restore.bytes.toString('utf8'));
  assert.deepEqual(
    [retried.activation_receipt_digest_b64u, retried.lifecycle_revision],
    [original.activation_receipt_digest_b64u, original.lifecycle_revision],
    'a managed restore retried after a later refresh must return its durable outcome',
  );
  // Its retirement is reported live: a later refresh has replaced its epoch.
  assert.deepEqual(retirementKinds(retried.retirement), ['superseded', 'superseded']);
  return {
    kind: 'tenant_root_refresh_after_managed_restore_workers_e2e_v1',
    restoreRevision: restore.refresh.lifecycle_revision,
    refreshStatus: refreshed.status,
    refreshRevision: response.lifecycle_revision,
    deriverA,
    deriverB,
    restoreRetryReturnsDurableOutcome: true,
  };
}

async function captureEcdsaActivationAfterRefresh(topology, ecdsa) {
  const router = await topology.getWorker('router');
  const response = await postWorkerJson(router, ecdsaActivationPath, ecdsa.activationBody, {
    authorization: `Bearer ${ecdsa.token}`,
  });
  const bytes = await expectOk(response, 'ECDSA activation after tenant-root refresh');
  const activation = JSON.parse(bytes.toString('utf8'));
  assert.equal(activation.activated, true);
  return {
    bytes,
    activation,
    identityBytes: Buffer.from(
      JSON.stringify(activation.ecdsa_activation.public_identity),
      'utf8',
    ),
  };
}

async function testTenantRootSelectorIsolation(
  topology,
  fixture,
  tenantRoot,
  secondTenantRoot,
  firstTenantActivation,
  secondTenantActivation,
) {
  const router = await topology.getWorker('router');
  const envelope = buildEd25519ExecuteRequest(fixture, 'activation', tenantRoot);
  assert.notEqual(
    secondTenantRoot.identity_digest_b64u,
    tenantRoot.identity_digest_b64u,
    'second-tenant isolation proof must use a distinct tenant identity',
  );
  assert.notEqual(
    secondTenantRoot.custody_lineage_b64u,
    tenantRoot.custody_lineage_b64u,
    'second-tenant isolation proof must use a distinct custody lineage',
  );
  assert.notDeepEqual(
    secondTenantActivation.publicReceipt.registered_public_key,
    firstTenantActivation.publicReceipt.registered_public_key,
    'independent tenant roots must produce independent Ed25519 activation keys',
  );

  const alternateTenantRoot = {
    identity: fixture.tenant_root_creation.identity,
    custody_lineage_b64u: Buffer.alloc(16, 0x9c).toString('base64url'),
  };
  capturedSigningWorkerDelivery = undefined;
  const rejected = await postWorkerJson(router, ed25519ExecutePath, {
    ...envelope,
    tenant_root: alternateTenantRoot,
  });
  const rejectedBody = await responseBytes(rejected);
  assert.notEqual(
    rejected.status,
    200,
    `an alternate tenant-root selector must not replay the first tenant: ${rejectedBody.toString(
      'utf8',
    )}`,
  );
  assert.equal(
    capturedSigningWorkerDelivery,
    undefined,
    'a rejected tenant-root selector must not reach SigningWorker activation',
  );
}

async function postSigningWorkerDelivery(worker, delivery) {
  return worker.fetch(
    'https://private.test/router-ab/signing-worker/ed25519-yao/activation/packages',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [internalAuthHeader]: internalAuthSecret,
      },
      body: delivery,
    },
  );
}

async function readSigningWorkerFinalization(worker, lookup) {
  const response = await postWorkerJson(worker, ed25519FinalizationLookupPath, lookup);
  const bytes = await expectOk(response, 'SigningWorker finalization lookup');
  return JSON.parse(bytes.toString('utf8'));
}

async function signingWorkerFinalizationRows(database) {
  return database
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM signing_worker_secret_states
          WHERE purpose = 'ed25519_yao_lifecycle') AS lifecycles,
         (SELECT COUNT(*) FROM signing_worker_activations) AS activations,
         (SELECT COUNT(*) FROM signing_worker_activation_revocation_fences) AS fences`,
    )
    .first();
}

async function testSigningWorkerFinalizationLookup(topology, fixture, tenantRoot) {
  const activation = await captureValidActivationDelivery(topology, fixture, tenantRoot);
  const delivery = JSON.parse(activation.delivery);
  const clientResult = activation.result.result.result;
  const lookup = {
    delivery,
    deriver_a_client_package: clientResult.deriver_a_client_package,
    deriver_b_client_package: clientResult.deriver_b_client_package,
  };
  const committedWorker = await topology.getWorker('fixture-signing-worker');
  const missingWorker = await topology.getWorker('fixture-signing-worker-after-refresh');
  const committedDatabase = await topology.getD1Database(
    signingWorkerD1Binding,
    'fixture-signing-worker',
  );
  const missingDatabase = await topology.getD1Database(
    signingWorkerD1Binding,
    'fixture-signing-worker-after-refresh',
  );

  const before = await signingWorkerFinalizationRows(committedDatabase);
  assert.equal(before.lifecycles, 1);
  assert.equal(before.activations, 1);
  assert.deepEqual(await readSigningWorkerFinalization(missingWorker, lookup), {
    status: 'missing',
  });
  assert.deepEqual(await signingWorkerFinalizationRows(missingDatabase), {
    lifecycles: 0,
    activations: 0,
    fences: 0,
  });
  const committed = await readSigningWorkerFinalization(committedWorker, lookup);
  assert.equal(committed.status, 'committed');
  assert.deepEqual(
    committed.receipt.registered_public_key,
    activation.publicReceipt.registered_public_key,
  );
  assert.deepEqual(await signingWorkerFinalizationRows(committedDatabase), before);

  const activeKey = [
    'active-signing-worker',
    delivery.deriver_a.binding.material_activation.material_owner,
    delivery.deriver_a.binding.material_activation.activation_id,
    delivery.deriver_a.binding.material_activation.signing_worker,
  ].join('/');
  await committedDatabase
    .prepare('DELETE FROM signing_worker_activations WHERE active_key = ?1')
    .bind(activeKey)
    .run();
  assert.deepEqual(await readSigningWorkerFinalization(committedWorker, lookup), {
    status: 'conflict',
  });
  const beforeFence = await signingWorkerFinalizationRows(committedDatabase);
  assert.equal(beforeFence.activations, 0, 'lookup must not restore missing active material');

  await committedDatabase
    .prepare('INSERT INTO signing_worker_activation_revocation_fences (active_key) VALUES (?1)')
    .bind(activeKey)
    .run();
  assert.deepEqual(await readSigningWorkerFinalization(committedWorker, lookup), {
    status: 'revoked',
  });
  assert.deepEqual(await signingWorkerFinalizationRows(committedDatabase), {
    lifecycles: beforeFence.lifecycles,
    activations: 0,
    fences: 1,
  });

  const artifact = {
    kind: 'signing_worker_initial_registration_finalization_lookup_e2e_v1',
    reproduce:
      'ROUTER_AB_WORKER_BUILD_PROFILE=dev node ./scripts/test-private-d1.mjs --signing-worker-finalization-lookup',
    committedReceiptMatchesRouter: true,
    missingAuthorityStayedEmpty: true,
    committedLookupLeftRowsUnchanged: true,
    missingOutputWasConflictWithoutReactivation: true,
    fencedOutputWasRevokedWithoutReactivation: true,
  };
  const artifactPath = join(repoRoot, '.artifacts/r150/signing-worker-finalization-lookup.json');
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({ ...artifact, artifactPath }));
}

async function testConcurrentActivationAndLostResponse(fixture, delivery) {
  const miniflare = new Miniflare({
    workers: [signingWorker('concurrent-signing-worker', 'concurrent-signing-worker-d1', fixture)],
  });
  try {
    await miniflare.ready;
    const database = await applyMigrations(
      miniflare,
      signingWorkerD1Binding,
      'concurrent-signing-worker',
      signingWorkerMigrationsPath,
    );
    const worker = await miniflare.getWorker('concurrent-signing-worker');
    const [firstResponse, concurrentResponse] = await Promise.all([
      postSigningWorkerDelivery(worker, delivery),
      postSigningWorkerDelivery(worker, delivery),
    ]);
    const first = await expectOk(firstResponse, 'first concurrent activation');
    const concurrent = await expectOk(concurrentResponse, 'second concurrent activation');
    assert.deepEqual(
      concurrent,
      first,
      'concurrent identical activation must return the exact committed response bytes',
    );

    const lostResponseReplay = await expectOk(
      await postSigningWorkerDelivery(worker, delivery),
      'lost-response activation replay',
    );
    assert.deepEqual(
      lostResponseReplay,
      first,
      'retry after a lost response must replay the exact committed response bytes',
    );
    const activationRows = await database
      .prepare('SELECT COUNT(*) AS count FROM signing_worker_activations')
      .first();
    assert.equal(activationRows.count, 1, 'concurrent activation must commit one material row');
  } finally {
    await miniflare.dispose();
  }
}

async function main() {
  const fixture = loadFixture();
  const jwtSigner = configureRouterJwt(fixture);
  const testWalletDo = process.argv.includes('--do-pair-store');
  const testWalletDoExecution = process.argv.includes('--do-pair-execution');
  const testWalletDoLostReply = process.argv.includes('--do-pair-lost-reply');
  const testHistoricalReplay = process.argv.includes('--do-historical-replay');
  const testHistoricalStartingReplay = process.argv.includes('--do-historical-starting-replay');
  const testDeriverBCompletionBurn = process.argv.includes('--do-pair-b-burn-before-complete');
  const topology = new Miniflare({
    workers: [
      routerWorker(
        fixture,
        testWalletDo || testWalletDoExecution || testWalletDoLostReply ||
          testHistoricalReplay || testHistoricalStartingReplay || testDeriverBCompletionBurn,
        testWalletDoLostReply,
      ),
      deriverAWorker(fixture),
      deriverBWorker(fixture),
      tenantRootControlPlaneWorker(fixture),
      signingWorker('fixture-signing-worker', 'fixture-signing-worker-d1', fixture),
      signingWorker(
        'fixture-signing-worker-after-refresh',
        'fixture-signing-worker-after-refresh-d1',
        fixture,
      ),
      recoveryRouterWorker(fixture),
      lateWritingDeriverAWorker(fixture),
      ...(testHistoricalReplay || testHistoricalStartingReplay
        ? [
            historicalReplayRouterWorker(fixture, 'router-replay'),
            historicalReplayRouterWorker(fixture, 'router-replay-missing-a', 'deriver-a-empty'),
            routerWithoutGatewayAuthWorker(fixture),
            routerWithSharedGatewayAuthWorker(fixture),
            {
              ...deriverAWorker(fixture),
              name: 'deriver-a-empty',
              d1Databases: { [roleD1Binding]: 'deriver-a-empty-private-d1' },
            },
          ]
        : []),
    ],
  });
  try {
    await topology.ready;
    const databases = {
      deriverA: await applyMigrations(topology, roleD1Binding, 'deriver-a', deriverAMigrationsPath),
      deriverB: await applyMigrations(topology, roleD1Binding, 'deriver-b', deriverBMigrationsPath),
    };
    await testTenantRootRoleSchema(databases.deriverA, 'deriver_a');
    await testTenantRootRoleSchema(databases.deriverB, 'deriver_b');
    await testTenantRootCommandReplayCasGuard(databases.deriverA, 'deriver_a');
    await testTenantRootCommandReplayCasGuard(databases.deriverB, 'deriver_b');
    const tenantRoots = await testTenantRootCreationOperatingPath(topology, fixture, databases);
    const tenantRoot = tenantRoots.tenantRoot;
    const signingWorkerDatabase = await applyMigrations(
      topology,
      signingWorkerD1Binding,
      'fixture-signing-worker',
      signingWorkerMigrationsPath,
    );
    await applyMigrations(
      topology,
      signingWorkerD1Binding,
      'fixture-signing-worker-after-refresh',
      signingWorkerMigrationsPath,
    );
    if (testWalletDo) {
      await captureValidActivationDelivery(topology, fixture, tenantRoot);
      await testDeriverAWalletDoPreparation(
        topology,
        fixture.tenant_root_creation.identity,
      );
      console.log('Deriver A wallet DO preparation, exact retry, restart, and expiry passed');
      return;
    }
    if (testWalletDoExecution) {
      await testDeriverAWalletDoExecution(
        topology,
        fixture,
        tenantRoot,
        tenantRoots.secondTenantRoot,
        databases,
      );
      return;
    }
    if (testWalletDoLostReply) {
      await testDeriverAWalletDoLostReply(topology, fixture, tenantRoot, databases);
      return;
    }
    if (testHistoricalReplay) {
      await testHistoricalRegistrationReplay(topology, fixture, tenantRoot, databases);
      return;
    }
    if (testHistoricalStartingReplay) {
      await testHistoricalReplayAfterAStartClaim(topology, fixture, tenantRoot, databases);
      return;
    }
    if (testDeriverBCompletionBurn) {
      await testDeriverBBurnBeforeCompletion(topology, fixture, tenantRoot, databases);
      return;
    }
    if (process.argv.includes('--admission-races')) {
      const admissionRaces = await testTenantRootAdmissionRaces(topology, fixture, databases);
      console.log(
        `R150_WORKERS_TENANT_ROOT_ADMISSION_RACES ${JSON.stringify({
          kind: 'tenant_root_admission_race_workers_e2e_v1',
          ...admissionRaces,
        })}`,
      );
      return;
    }
    if (retirementTriggerRun) {
      const summary = await testRetirementTrigger(topology, fixture, databases);
      console.log(`R150_WORKERS_RETIREMENT_TRIGGER ${JSON.stringify(summary)}`);
      return;
    }
    if (process.argv.includes('--replay-after-erasure')) {
      const summary = await testReplayAfterErasure(topology, fixture, databases);
      console.log(`R150_WORKERS_REPLAY_AFTER_ERASURE ${JSON.stringify(summary)}`);
      return;
    }
    if (walletObjectClaimedRecoveryRun) {
      assert.equal(process.env.ROUTER_AB_WALLET_DO_HARNESS, 'enabled');
      const summary = await testWalletObjectClaimedRecovery(topology, fixture, databases);
      console.log(`R150_WORKERS_WALLET_OBJECT_CLAIMED_RECOVERY ${JSON.stringify(summary)}`);
      return;
    }
    if (walletObjectAdmissionRun) {
      const summary = await testWalletObjectAdmissionSettlement(topology, fixture, databases);
      console.log(`R150_WORKERS_WALLET_OBJECT_ADMISSIONS ${JSON.stringify(summary)}`);
      return;
    }
    if (process.argv.includes('--refresh-delivery-after-expiry')) {
      await testTenantRootRefreshDeliveryAfterExpiry(topology, databases);
      return;
    }
    if (process.argv.includes('--refresh-after-managed-restore')) {
      const managedRestore = await testTenantRootManagedRestoreOperatingPath(
        topology,
        fixture,
        tenantRoot,
        databases,
      );
      const summary = await testTenantRootRefreshAfterManagedRestore(
        topology,
        tenantRoot,
        databases,
        managedRestore,
      );
      console.log(`R150_WORKERS_REFRESH_AFTER_MANAGED_RESTORE ${JSON.stringify(summary)}`);
      return;
    }
    if (process.argv.includes('--refresh-abandonment-after-expiry')) {
      const summary = await testTenantRootRefreshAbandonmentAfterExpiry(topology, databases);
      console.log(`R150_WORKERS_TENANT_ROOT_REFRESH_ABANDONMENT ${JSON.stringify(summary)}`);
      return;
    }
    if (process.argv.includes('--signing-worker-finalization-lookup')) {
      await testSigningWorkerFinalizationLookup(topology, fixture, tenantRoot);
      return;
    }
    const ecdsa = await testEcdsaRegistrationAndActivation(topology, fixture, tenantRoot, jwtSigner);
    if (process.argv.includes('--ecdsa-across-refresh')) {
      const summary = await testEcdsaWorkAcrossRefresh(topology, fixture, jwtSigner, databases);
      console.log(`R150_WORKERS_ECDSA_ACROSS_REFRESH ${JSON.stringify(summary)}`);
      return;
    }
    if (process.argv.includes('--ecdsa-presign-handoff-benchmark')) {
      const timings = { pool: [], prepare: [] };
      for (let sample = 0; sample < 5; sample += 1) {
        for (const mode of ['pool', 'prepare']) {
          const started = performance.now();
          await testEcdsaNormalSigning(topology, ecdsa, mode, false);
          timings[mode].push(performance.now() - started);
        }
      }
      console.log(JSON.stringify({ kind: 'presign_handoff_local_benchmark', timingsMs: timings }));
      return;
    }
    if (process.argv.includes('--ecdsa-wallet-do-interruption')) {
      assert.equal(process.env.ROUTER_AB_WALLET_DO_HARNESS, 'enabled');
      const interrupted = await testEcdsaNormalSigning(topology, ecdsa, 'prepare', false, true);
      const poolRows = await signingWorkerDatabase
        .prepare('SELECT COUNT(*) AS count FROM signing_worker_ecdsa_pool')
        .first();
      const effectRows = await signingWorkerDatabase
        .prepare("SELECT COUNT(*) AS count FROM signing_worker_effect_claims WHERE operation_key LIKE 'evm-ecdsa/%'")
        .first();
      const terminalRows = await signingWorkerDatabase
        .prepare("SELECT COUNT(*) AS count FROM signing_worker_terminal_responses WHERE operation_key LIKE 'evm-ecdsa/%'")
        .first();
      assert.equal(poolRows.count, 0);
      assert.equal(effectRows.count, 0);
      assert.equal(terminalRows.count, 0);
      const artifact = {
        kind: 'signing_worker_wallet_do_ecdsa_interruption_e2e_v1',
        reproduce:
          'ROUTER_AB_WALLET_DO_HARNESS=enabled ROUTER_AB_WORKER_BUILD_PROFILE=dev node ./scripts/test-private-d1.mjs --ecdsa-wallet-do-interruption',
        operationId: interrupted.finalizeRequest.operation_id,
        noSignatureReply: true,
        pendingAfterEviction: interrupted.pendingAfterEviction,
        materialConsumed: interrupted.materialConsumed,
        noD1PoolEffectOrTerminal: true,
      };
      const artifactPath = join(
        repoRoot,
        '.artifacts/r150/signing-worker-wallet-do-ecdsa-interruption.json',
      );
      await mkdir(dirname(artifactPath), { recursive: true });
      await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
      console.log(JSON.stringify({ ...artifact, artifactPath }));
      return;
    }
    if (
      process.argv.includes('--ecdsa-presign-handoff') ||
      process.argv.includes('--ecdsa-wallet-do-pool')
    ) {
      const walletDoPool = process.argv.includes('--ecdsa-wallet-do-pool');
      if (walletDoPool) {
        assert.equal(process.env.ROUTER_AB_WALLET_DO_HARNESS, 'enabled');
      }
      const priorSigning = await testEcdsaNormalSigning(topology, ecdsa, 'pool', false);
      assert.ok(priorSigning.response.signature65_b64u);
      const signing = await testEcdsaNormalSigning(topology, ecdsa, 'prepare');
      if (walletDoPool) {
        const activationRows = await signingWorkerDatabase
          .prepare('SELECT COUNT(*) AS count FROM signing_worker_activations')
          .first();
        assert.equal(activationRows.count, 0, 'Wallet-DO ECDSA activation must not write D1 material');
        const objectIds = await topology.listDurableObjectIds(
          'RouterAbSigningWorkerWalletDurableObject',
          'fixture-signing-worker',
        );
        assert.equal(objectIds.length, 1, 'ECDSA owner material must live in one wallet object');
        await topology.unsafeEvictDurableObject(
          'fixture-signing-worker',
          'RouterAbSigningWorkerWalletDurableObject',
          { id: objectIds[0] },
        );
        const replayAfterEviction = await postWorkerJson(
          await topology.getWorker('router'),
          ecdsaSigningPath,
          signing.finalizeRequest,
        );
        assert.deepEqual(
          JSON.parse((await expectOk(replayAfterEviction, 'ECDSA wallet-DO replay after eviction')).toString('utf8')),
          signing.response,
        );
        const poolRows = await signingWorkerDatabase
          .prepare('SELECT COUNT(*) AS count FROM signing_worker_ecdsa_pool')
          .first();
        assert.equal(poolRows.count, 0, 'Wallet-DO ECDSA signing must not write D1 pool rows');
        const effectRows = await signingWorkerDatabase
          .prepare("SELECT COUNT(*) AS count FROM signing_worker_effect_claims WHERE operation_key LIKE 'evm-ecdsa/%'")
          .first();
        assert.equal(effectRows.count, 0, 'Wallet-DO ECDSA signing must not claim D1 effects');
        const terminalRows = await signingWorkerDatabase
          .prepare("SELECT COUNT(*) AS count FROM signing_worker_terminal_responses WHERE operation_key LIKE 'evm-ecdsa/%'")
          .first();
        assert.equal(terminalRows.count, 0, 'Wallet-DO ECDSA signing must not commit D1 terminals');
      }
      const artifact = {
        kind: walletDoPool
          ? 'signing_worker_wallet_do_ecdsa_pool_e2e_v1'
          : 'gateway_router_normal_signing_auth_e2e_v1',
        reproduce: walletDoPool
          ? 'ROUTER_AB_WALLET_DO_HARNESS=enabled ROUTER_AB_WORKER_BUILD_PROFILE=dev node ./scripts/test-private-d1.mjs --ecdsa-wallet-do-pool'
          : 'ROUTER_AB_WORKER_BUILD_PROFILE=dev node ./scripts/test-private-d1.mjs --ecdsa-presign-handoff',
        sharedRoleBearerRejected: true,
        dedicatedGatewayBearerSigned: true,
        wrongScopeRejected: true,
        changedTenantRejected: true,
        bundledFinalBatchGated: true,
        directCompletionBeforePoolPrepareSigned: true,
        terminalReplayVerified: true,
        ...(walletDoPool
          ? {
              walletDoPoolWithoutD1Writes: true,
              walletDoActivationWithoutD1Writes: true,
              walletDoEffectAndTerminalWithoutD1Writes: true,
              consumedWalletDoMaterialRejected: true,
              terminalReplayAfterWalletDoEviction: true,
              lostReplyAfterCommitReplayed: true,
            }
          : {}),
        signatureSha256Hex: createHash('sha256')
          .update(Buffer.from(signing.response.signature65_b64u, 'base64url'))
          .digest('hex'),
      };
      const artifactPath = join(
        repoRoot,
        walletDoPool
          ? '.artifacts/r150/signing-worker-wallet-do-ecdsa-pool.json'
          : '.artifacts/r150/gateway-router-normal-signing-auth.json',
      );
      await mkdir(dirname(artifactPath), { recursive: true });
      await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
      console.log(JSON.stringify({ ...artifact, artifactPath }));
      return;
    }
    if (process.argv.includes('--ecdsa-presign')) {
      const presign = await runEcdsaPresignSession(topology, ecdsa);
      presign.client.free();
      console.log('six-exchange presigning, Durable Object eviction replay rejection, and immutable expiry passed');
      return;
    }
    const edBeforeRefresh = await captureValidActivationDelivery(topology, fixture, tenantRoot);
    const edSecondTenant = await captureValidActivationDelivery(
      topology,
      fixture,
      tenantRoots.secondTenantRoot,
      'second_tenant_activation',
    );
    const managedRestore = await testTenantRootManagedRestoreOperatingPath(
      topology,
      fixture,
      tenantRoot,
      databases,
    );

    const ecdsaAfterRefresh = await captureEcdsaActivationAfterRefresh(topology, ecdsa);
    assert.deepEqual(
      ecdsaAfterRefresh.bytes,
      ecdsa.activationBytes,
      'ECDSA activation output must remain byte-identical after tenant-root refresh',
    );
    assert.deepEqual(
      ecdsaAfterRefresh.identityBytes,
      ecdsa.identityBytes,
      'ECDSA public identity bytes must remain identical after tenant-root refresh',
    );
    assert.deepEqual(
      ecdsaAfterRefresh.activation.ecdsa_activation.public_identity,
      ecdsa.identity,
      'ECDSA address and public keys must remain identical after tenant-root refresh',
    );

    signingWorkerDeliveryTarget = 'fixture-signing-worker-after-refresh';
    const edAfterRefresh = await captureValidActivationDelivery(
      topology,
      fixture,
      tenantRoot,
      'activation_after_refresh',
    );
    assert.deepEqual(
      edAfterRefresh.publicReceipt.registered_public_key,
      edBeforeRefresh.publicReceipt.registered_public_key,
      'Ed25519 public key must remain identical after tenant-root refresh',
    );
    const edSecondTenantAfterRefresh = await captureValidActivationDelivery(
      topology,
      fixture,
      tenantRoots.secondTenantRoot,
      'second_tenant_activation_after_refresh',
    );
    assert.deepEqual(
      edSecondTenantAfterRefresh.publicReceipt.registered_public_key,
      edSecondTenant.publicReceipt.registered_public_key,
      'tenant B must retain its Ed25519 key and remain operational after tenant A refresh',
    );
    signingWorkerDeliveryTarget = 'fixture-signing-worker';
    await testEcdsaNormalSigning(topology, ecdsa);
    await testTenantRootSelectorIsolation(
      topology,
      fixture,
      tenantRoot,
      tenantRoots.secondTenantRoot,
      edBeforeRefresh,
      edSecondTenant,
    );
    await testConcurrentActivationAndLostResponse(fixture, edBeforeRefresh.delivery);
    await testTenantRootCreationRecoveryPaths(topology, databases);
    const admissionRaces = await testTenantRootAdmissionRaces(topology, fixture, databases);
    console.log(
      `R150_WORKERS_TENANT_ROOT_ADMISSION_RACES ${JSON.stringify({
        kind: 'tenant_root_admission_race_workers_e2e_v1',
        ...admissionRaces,
      })}`,
    );
    const ecdsaAcrossRefresh = await testEcdsaWorkAcrossRefresh(
      topology,
      fixture,
      jwtSigner,
      databases,
    );
    console.log(`R150_WORKERS_ECDSA_ACROSS_REFRESH ${JSON.stringify(ecdsaAcrossRefresh)}`);
    const refreshAfterRestore = await testTenantRootRefreshAfterManagedRestore(
      topology,
      tenantRoot,
      databases,
      managedRestore,
    );
    console.log(`R150_WORKERS_REFRESH_AFTER_MANAGED_RESTORE ${JSON.stringify(refreshAfterRestore)}`);
  } finally {
    await topology.dispose();
  }
  console.log('real workerd D1 managed restore and signing continuity tests passed');
}

await main();

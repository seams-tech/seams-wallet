import {
  seedWalletOtpCounters,
  verifyInactiveWalletOtp,
  verifyActivatedWalletOtp,
  verifyCleanedWalletOtp,
} from './regional-wallet-otp.scenario.mjs';
import { verifyPlacementClient, verifyRetiredMoveClient, verifyMoveSubmissionClient } from './wallet-placement-client.scenario.mjs';
import {
  seedExecutionGeneration,
  prepareExecutionGeneration,
  verifyExecutionDestination,
} from './execution-generation.scenario.mjs';
import {
  seedOperationHistory,
  verifyDestinationOperationGeneration,
  verifyImportedOperationHistory,
  verifyOperationHistoryCleanup,
} from './operation-history-transfer.scenario.mjs';
import {
  activateAuthorizationThroughCommand,
  cleanupAuthorizationThroughCommand,
  verifyPendingCeremonyFreeze,
  verifyPendingSessionOperationFreeze,
} from './authorization-transfer-command.scenario.mjs';
import { verifyCeremonyWriteFence } from './ceremony-write-fence.scenario.mjs';
import assert from 'node:assert/strict';
import { verifyAuthorizationHistoryCopy } from './authorization-transfer-restore.scenario.mjs';
import {
  verifyAuthorizationSnapshot,
  verifySnapshotIntegerPrecision,
} from './authorization-transfer-snapshot.scenario.mjs';
import { verifyAuthorizationFreeze } from './authorization-transfer-freeze.scenario.mjs';
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import { buildWorkerdCompatiblePhase1Bridge } from '../../packages/wallet-server/scripts/d1-local-migrate-signer.mjs';

const output = resolve('.artifacts/r153/authorization-storage-transfer');
const scope = {
  namespace: 'transfer-probe',
  orgId: 'transfer-org',
  projectId: 'transfer-project',
  envId: 'production',
};
const tables = [
  'wallet_email_otp_rate_limits',
  'wallet_authorities',
  'wallet_auth_methods',
  'authorization_wallet_session_quotas',
  'wallet_session_authorizations_v2',
  'wallet_session_hosted_credentials_v2',
  'wallet_session_hosted_exchange_codes_v2',
  'verified_wallet_operation_evidence_sets',
  'authorized_operations',
  'authorized_operation_audit_events',
];
class RecordingOtpDelivery {
  failNext = false;
  attempts = [];

  async deliver(input) {
    this.attempts.push({ challengeId: input.challengeId, otpCode: input.otpCode });
    if (this.failNext) {
      this.failNext = false;
      return { ok: false, code: 'provider_unavailable', message: 'Injected delivery failure' };
    }
    return { ok: true };
  }
}

class PlacementDirectoryRecorder {
  constructor(resolution) {
    this.resolution = resolution;
  }

  requests = [];

  async fetch(request) {
    assert.equal(request.headers.get('authorization'), null);
    this.requests.push({ path: new URL(request.url).pathname, body: await request.json() });
    if (new URL(request.url).pathname.endsWith('/relocation-request') && this.resolution)
      return Response.json(this.resolution);
    return Response.json({ state: 'unavailable', code: 'not_found' }, { status: 404 });
  }
}

await mkdir(output, { recursive: true });
const bundle = await build({
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  tsconfig: 'packages/wallet-server/tsconfig.json',
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `
      export { buildSessionSigningOperationInputFixture, buildStepUpSigningOperationFixture, buildAdditionalStepUpOperationInputFixture } from './tests/unit/helpers/authorizedOperation.fixtures';
      export { D1WalletOperationStore } from './packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletOperationStore';
      export { runRouterAbEd25519YaoRegistrationSideEffectV2, parseRouterAbEd25519YaoRegistrationSideEffectRecordV2 } from './packages/wallet-server/src/router/domains/ed25519Yao/registration/routerAbEd25519YaoRegistrationSideEffectBoundary';
      export { parseRouterAbEd25519YaoRegistrationAdmissionRequestV1 } from './packages/shared-ts/src/utils/routerAbEd25519Yao';
      export { RouterAbEd25519YaoHttpRegistrationBackend } from './packages/wallet-server/src/router/domains/ed25519Yao/registration/routerAbEd25519YaoHttpRegistrationBackend';
      export { InMemoryRouterAbEd25519YaoRegistrationService } from './packages/wallet-server/src/router/domains/ed25519Yao/registration/routerAbEd25519YaoRegistration';
      export { buildNearRecoveryCacheFixture } from './tests/unit/helpers/nearRecovery.fixtures';
      export { D1WalletAuthorizationSnapshot } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletAuthorizationSnapshot';
      export { D1WalletAuthorizationFreeze } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletAuthorizationFreeze';
      export { D1WalletAuthorizationIntake } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletAuthorizationIntake';
      export { D1WalletAuthorizationHistory } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletAuthorizationHistory';
      export { D1WalletExecutionAuthority, admitD1EstablishedWalletHome } from './packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletExecutionAuthority';
      export { D1WalletRelocationSessions, WalletRelocationSessionSource } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletRelocationSessions';
      export { CloudflareD1WebAuthnStore } from './packages/wallet-server/src/router/cloudflare/d1/webauthn/d1WebAuthnStore';
      export { walletRelocationEmailOtpBinding, verifyWalletRelocationEmailOtp } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletRelocationEmailOtp';
      export { CloudflareD1EmailOtpChallengeStore } from './packages/wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpChallengeStore';
      export { CloudflareD1EmailOtpDeliveryRuntime } from './packages/wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpDeliveryRuntime';
      export { CloudflareD1EmailOtpChallengeIssuer } from './packages/wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpChallengeIssuer';
      export { CloudflareD1EmailOtpChallengeVerifier } from './packages/wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpChallengeVerifier';
      export { CloudflareD1EmailOtpEnrollmentStore } from './packages/wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpEnrollmentStore';
      export { CloudflareD1EmailOtpRateLimitStore } from './packages/wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpRateLimitStore';
      export { emailOtpChallengeRecord } from './packages/wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpRecords';
      export { prepareD1TenantStatement } from './packages/wallet-server/src/core/d1TenantStore';
      export { buildEmailOtpEnrollmentFixture } from './tests/unit/helpers/emailOtpAuthMethod.fixtures';
      export { WalletAuthorizationRelocationRoutes } from './packages/wallet-server/src/router/cloudflare/runtime/walletAuthorizationRelocationRoutes';
      export { WalletPlacementRoutes } from './packages/wallet-server/src/router/cloudflare/runtime/walletPlacementRoutes';
      export { WalletRelocationReadAccess } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletRelocationReadAccess';
      export { WalletRelocationOwnerRequest } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletRelocationOwnerRequest';
      export { D1WalletRelocationApprovals } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletRelocationApprovals';
      export { verifyWalletRelocationPasskey } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletRelocationPasskey';
      export { AuthorizationService } from './packages/wallet-server/src/authorization/service';
      export { D1WalletRelocationChallenges, WalletRelocationChallengeBinding } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletRelocationChallenges';
      export { capabilityPolicyPort } from './packages/wallet-server/src/authorization/capabilityPolicy';
      export { parseSessionOrigin } from './packages/wallet-server/src/authorization/domain';
      export { CloudflareD1AuthorizationStore } from './packages/wallet-server/src/router/cloudflare/d1/authorization/d1AuthorizationStore';
      export { D1WalletAuthorityStore, prepareD1WalletAuthorityPutStatement } from './packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletAuthorityStore';
      export { prepareD1WalletAuthMethodV2PutStatement } from './packages/wallet-server/src/core/d1WalletAuthMethodStore';
      export { buildLinkedDeviceManagementAuthorityFixture, buildEmailOtpEcdsaWalletSessionFixture } from './tests/unit/helpers/linkedDeviceManagement.fixtures';
      export { buildFullOwnerPermissionsV1, buildSigningOnlyDelegatedWalletAuthorityV1 } from './packages/shared-ts/src/authorization/delegatedAuthority';
      export { routerAbMpcMaterialActivationRefToWire } from './packages/shared-ts/src/utils/routerAbNormalSigningIdentity';
      export { readWalletSessionSigningCandidate } from './packages/wallet-server/src/router/cloudflare/d1/auth/walletSessionCredentialReaders';
      export { parseTenantId } from './packages/shared-ts/src/authorization/capabilityKinds';
      export { createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreFromD1V1 } from './packages/wallet-server/src/router/cloudflare/d1/ed25519Yao/d1Ed25519YaoProductRegistrationPartitionedStateStore';
      export { buildNearRegistrationAuthorityFixture, buildNearRecoveryAdmissionFixture } from './tests/unit/helpers/nearRegistration.fixtures';
    `,
  },
});
const bundlePath = resolve(output, 'production-api.mjs');
await writeFile(bundlePath, bundle.outputFiles[0].text);
const api = await import(pathToFileURL(bundlePath));
const worker = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("local authorization probe"); } };',
  d1Databases: { SOURCE: 'authorization-source', DESTINATION: 'authorization-destination' },
  compatibilityDate: '2026-06-12',
  port: 0,
});

try {
  const source = await worker.getD1Database('SOURCE');
  const destination = await worker.getD1Database('DESTINATION');
  const migrations = await migrate(source);
  assert.deepEqual(await migrate(destination), migrations);
  const sourceService = service(source, scope);
  const issuedAtMs = Date.now();
  const fixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'storage-transfer-owner',
    keyFamily: 'ecdsa_secp256k1',
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    expiresAtMs: issuedAtMs + 3_600_000,
  });
  const executionSetup = await prepareExecutionGeneration({
    api,
    database: source,
    scope,
    walletId: fixture.authority.walletId,
  });
  const issued = await issueDeviceSession(source, sourceService, fixture, issuedAtMs);
  assert.equal(issued.operationCredential.ownershipGeneration, 1);
  const relocationChallenges = await verifyRelocationChallenges(source, fixture, issued, issuedAtMs);
  const offlineFixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'storage-transfer-offline-device',
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'device_link',
    sourceAuthorityId: fixture.authority.authorityId,
    expiresAtMs: issuedAtMs + 3_600_000,
    identity: {
      walletId: fixture.authority.walletId,
      authorityId: 'authority:offline-transfer-device',
      walletAuthMethodId: 'auth-method:offline-transfer-device',
      rpId: fixture.authMethod.rpId,
      credentialIdB64u: Buffer.alloc(32, 55).toString('base64url'),
    },
  });
  const offlineIssued = await issueDeviceSession(source, sourceService, offlineFixture, issuedAtMs);
  const operationHistory = await seedOperationHistory({
    api,
    database: source,
    scope,
    session: offlineIssued.session,
    authMethod: offlineFixture.authMethod,
    nowMs: issuedAtMs,
  });
  const offlineInput = {
    tenantId: offlineIssued.session.tenantId,
    token: offlineIssued.operationCredential.token,
    nowMs: issuedAtMs + 2,
  };
  const offlineBefore =
    await sourceService.readWalletSessionAdmissionSnapshotByOperationCredential(offlineInput);
  assert.equal(offlineBefore.kind, 'active');
  const appOrigin = api.parseSessionOrigin('https://app.example.test');
  const walletOrigin = api.parseSessionOrigin('https://wallet.example.test');
  const exchange = await sourceService.mintHostedWalletSeamsSessionExchange({
    authorization: issued,
    appOrigin,
    walletOrigin,
    issuedAtMs,
    expiresAtMs: issued.session.expiresAtMs,
  });
  const redeemInput = {
    exchangeCode: exchange.exchangeCode,
    nonce: exchange.nonce,
    appOrigin,
    walletOrigin,
    redeemedAtMs: issuedAtMs + 1,
  };
  const hosted = await sourceService.redeemHostedWalletSeamsSessionExchange(redeemInput);
  assert.equal(hosted.kind, 'redeemed');
  const primaryInput = {
    tenantId: issued.session.tenantId,
    token: issued.operationCredential.token,
    nowMs: issuedAtMs + 2,
  };
  const hostedInput = {
    tenantId: issued.session.tenantId,
    token: hosted.operationCredential.token,
    requestOrigin: walletOrigin,
    nowMs: issuedAtMs + 2,
  };
  const before =
    await sourceService.readWalletSessionAdmissionSnapshotByOperationCredential(primaryInput);
  assert.equal(before.kind, 'active');
  assert.equal(before.authorization.quota.remainingUses, 7);
  const activation = fixture.authority.signerActivations.ecdsa?.materialActivation;
  assert.ok(activation);
  const signingInput = {
    tenantId: primaryInput.tenantId,
    token: primaryInput.token,
    nowMs: primaryInput.nowMs,
    materialActivation: api.routerAbMpcMaterialActivationRefToWire(activation),
  };
  assert.equal(
    (await api.readWalletSessionSigningCandidate(sourceService, signingInput)).kind,
    'active',
  );
  const hostedBefore =
    await sourceService.readHostedWalletSessionOperationCredentialV2(hostedInput);
  assert.ok(hostedBefore);

  assert.equal(
    await sourceService.readHostedWalletSessionOperationCredentialV2({
      tenantId: hostedInput.tenantId,
      token: hostedInput.token,
      requestOrigin: api.parseSessionOrigin('https://changed-wallet.example.test'),
      nowMs: hostedInput.nowMs,
    }),
    null,
  );
  const sessionSource = api.WalletRelocationSessionSource.parse({
    walletId: issued.session.walletId,
    moveId: `wmove_${'s'.repeat(43)}`,
    requestDigestHex: 'cd'.repeat(32),
    sourceGeneration: 1,
  });
  const destinationPreparation = await verifyDestinationPreparation({
    source, destination, scope, identity: sessionSource, fixture,
  });
  assert.equal((await api.readWalletSessionSigningCandidate(sourceService, signingInput)).kind, 'active');
  await assert.rejects(
    new api.D1WalletAuthorizationFreeze(source, scope).freeze(sessionSource, issuedAtMs + 3),
    /wallet_authorization_freeze_requires_retirement/u,
  );
  const sessionRetirement = await verifyWalletSessionRetirement({
    identity: sessionSource,
    source,
    sourceService,
    fixture,
    issued,
    offlineIssued,
    primaryInput,
    offlineInput,
    hostedInput,
    hostedBefore,
    before,
    offlineBefore,
    redeemInput,
    issuedAtMs,
  });
  await source
    .prepare('UPDATE wallet_authorities SET record_json = record_json || ? WHERE wallet_id = ?')
    .bind(' '.repeat(1_200_000), sessionSource.walletId)
    .run();
  const walletOtpBefore = await seedWalletOtpCounters(api, source, scope, sessionSource.walletId);
  const authorizationFreeze = await verifyAuthorizationFreeze({
    api,
    source,
    sourceService,
    scope,
    identity: sessionSource,
    nowMs: issuedAtMs + 20,
    tables,
    issueDeviceSession,
  });
  const sessionOperationSettlement = await verifyPendingSessionOperationFreeze({
    api,
    database: source,
    scope,
    service,
    issueDeviceSession,
  });
  const ceremonySettlement = await verifyPendingCeremonyFreeze({ api, database: source, scope });
  const ceremonyWriteFence = await verifyCeremonyWriteFence({
    api,
    source,
    scope,
    nowMs: issuedAtMs + 10,
  });
  const snapshot = await verifyAuthorizationSnapshot({
    api,
    source,
    scope,
    identity: sessionSource,
  });
  const snapshotPrecision = await verifySnapshotIntegerPrecision({
    api,
    source,
    destination,
    sourceService,
    scope,
    issueDeviceSession,
  });
  const copied = await verifyAuthorizationHistoryCopy({
    api, source, destination, scope, identity: sessionSource, snapshot, service, issueDeviceSession,
  });

  await verifyInactiveWalletOtp(api, source, destination, scope, sessionSource.walletId, walletOtpBefore);
  const executionBeforeActivation = await verifyExecutionDestination({
    api,
    source,
    destination,
    scope,
    setup: executionSetup,
    active: false,
  });
  const operationHistoryBeforeActivation = await verifyImportedOperationHistory({
    api,
    database: destination,
    scope,
    history: operationHistory,
  });
  const destinationService = service(destination, scope);
  for (const credential of [primaryInput, offlineInput]) {
    assert.equal(
      await destinationService.readWalletSessionAdmissionSnapshotByOperationCredential(credential),
      null,
    );
  }
  assert.equal(
    await destinationService.readHostedWalletSessionOperationCredentialV2(hostedInput),
    null,
  );
  assert.equal(await api.readWalletSessionSigningCandidate(destinationService, signingInput), null);
  assert.equal(
    (await destinationService.redeemHostedWalletSeamsSessionExchange(redeemInput)).kind,
    'already_consumed',
  );
  const otherTenant = api.parseTenantId('tenant:other');
  assert.equal(otherTenant.ok, true);
  assert.equal(
    await destinationService.readWalletSessionAdmissionSnapshotByOperationCredential({
      tenantId: otherTenant.value,
      token: primaryInput.token,
      nowMs: primaryInput.nowMs,
    }),
    null,
  );
  const otherScopeService = service(destination, {
    namespace: scope.namespace,
    orgId: 'another-org',
    projectId: scope.projectId,
    envId: scope.envId,
  });
  assert.equal(
    await otherScopeService.readWalletSessionAdmissionSnapshotByOperationCredential(primaryInput),
    null,
  );
  await assert.rejects(
    destinationService.issueDirectWalletSessionAuthorizationV2({
      tenantId: issued.session.tenantId,
      principalId: issued.session.principalId,
      walletId: fixture.authority.walletId,
      authority: fixture.authority,
      walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
      mintId: 'wallet-mint:inactive-import-issuance',
      remainingUses: 7,
      issuedAtMs: issuedAtMs + 20,
      expiresAtMs: issued.session.expiresAtMs,
    }),
    /Wallet session issuance requires an open execution generation/u,
  );

  const relocationPasskey = await verifyRelocationPasskey(source);
  const authorizationActivation = await activateAuthorizationThroughCommand({
    api, database: destination, scope, identity: sessionSource,
    manifest: snapshot.evidence.manifest,
  });
  await verifyActivatedWalletOtp(api, source, destination, scope, sessionSource.walletId, walletOtpBefore);
  const operationHistoryAfterActivation = await verifyImportedOperationHistory({
    api,
    database: destination,
    scope,
    history: operationHistory,
  });
  const resumedSession = await destinationService.issueDirectWalletSessionAuthorizationV2({
    tenantId: issued.session.tenantId,
    principalId: issued.session.principalId,
    walletId: fixture.authority.walletId,
    authority: fixture.authority,
    walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
    mintId: 'wallet-mint:activated-destination',
    remainingUses: 7,
    issuedAtMs: issuedAtMs + 30,
    expiresAtMs: issued.session.expiresAtMs,
  });
  assert.equal(resumedSession.session.walletId, fixture.authority.walletId);
  assert.equal(resumedSession.operationCredential.ownershipGeneration, 2);
  const authorizationCleanup = await cleanupAuthorizationThroughCommand({
    api, database: source, scope, identity: sessionSource,
    manifest: snapshot.evidence.manifest, tables,
  });
  const walletOtpRelocation = await verifyCleanedWalletOtp(api, source, scope, sessionSource.walletId);
  const operationHistoryCleanup = await verifyOperationHistoryCleanup({
    database: source,
    scope,
    history: operationHistory,
  });
  const executionAfterCleanup = await verifyExecutionDestination({
    api,
    source,
    destination,
    scope,
    setup: executionSetup,
    active: true,
  });
  const destinationOperationGeneration = await verifyDestinationOperationGeneration({
    api,
    database: destination,
    scope,
    service: destinationService,
    fixture: offlineFixture,
    nowMs: issuedAtMs + 31,
  });
  const operationHistoryAfterCleanup = await verifyImportedOperationHistory({
    api,
    database: destination,
    scope,
    history: operationHistory,
  });
  assert.equal(
    (
      await destinationService.readWalletSessionAdmissionSnapshotByOperationCredential({
        tenantId: resumedSession.session.tenantId,
        token: resumedSession.operationCredential.token,
        nowMs: issuedAtMs + 31,
      })
    ).kind,
    'active',
  );
  await assert.rejects(
    sourceService.issueDirectWalletSessionAuthorizationV2({
      tenantId: issued.session.tenantId,
      principalId: issued.session.principalId,
      walletId: fixture.authority.walletId,
      authority: fixture.authority,
      walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
      mintId: 'wallet-mint:cleaned-source',
      remainingUses: 7,
      issuedAtMs: issuedAtMs + 32,
      expiresAtMs: issued.session.expiresAtMs,
    }),
  );
  assert.equal(
    await destinationService.readWalletSessionAdmissionSnapshotByOperationCredential(primaryInput),
    null,
  );
  const relocationEmailOtp = await verifyRelocationEmailOtp(source);
  const relocationOwnerRequest = await verifyRelocationOwnerRequest(source);
  const artifact = {
    kind: 'wallet_authorization_storage_transfer_evidence_v1',
    recordedAt: new Date().toISOString(),
    walletRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    runnerSha256: digest(await readFile(new URL(import.meta.url))),
    productionBundleSha256: digest(bundle.outputFiles[0].text),
    nodeVersion: process.version,
    miniflareVersion: JSON.parse(await readFile('node_modules/miniflare/package.json', 'utf8'))
      .version,
    migrations,
    copied,
    authorizationId: issued.session.authorizationId,
    observations: {
      walletOtpRelocation,
      destinationPreparation,
      relocationChallenges,
      relocationPasskey,
      relocationEmailOtp,
      relocationOwnerRequest,
      sessionRetirement,
      authorizationFreeze,
      authorizationActivation,
      executionBeforeActivation,
      executionAfterCleanup,
      destinationOperationGeneration,
      sourceCredentialGeneration: issued.operationCredential.ownershipGeneration,
      destinationCredentialGeneration: resumedSession.operationCredential.ownershipGeneration,
      operationHistoryBeforeActivation,
      operationHistoryAfterActivation,
      operationHistoryCleanup,
      operationHistoryAfterCleanup,
      authorizationCleanup,
      ceremonyWriteFence,
      ceremonySettlement,
      sessionOperationSettlement,
      authorizationSnapshot: snapshot.evidence,
      snapshotPrecision,
      retiredPrimaryCredentialRejectedAtIndependentDatabase: true,
      secondDeviceAuthorityAndRetiredSessionPreserved: true,
      directConsumedExchangeImportRejected: true,
      scopedHistoricalRestoreKeptOrdinaryGuardsInstalled: true,
      exactAuthorityCapabilityAndQuotaPreserved: true,
      retiredHostedCredentialRejectedAtIndependentDatabase: true,
      consumedExchangeRemainedConsumed: true,
      changedTenantAndOrganizationRejected: true,
      changedWalletOriginRejected: true,
      retiredSigningCredentialReturnsInvalid: true,
      bothDevicesRemainRetiredAtDestination: true,
      inactiveDestinationRejectsFreshSessionIssuance: true,
    },
    scope:
      'Production authorization service and D1 stores with canonical fixture authority; no signing execution, cryptographic material copy, browser, physical geography, complete writer fencing, or coordinator integration.',
    reproduce: 'node tests/e2e/authorization-storage-transfer.e2e.mjs',
  };
  await writeFile(resolve(output, 'evidence.json'), `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Authorization transfer passed. Evidence: ${resolve(output, 'evidence.json')}`);
} finally {
  await worker.dispose();
}

async function verifyDestinationPreparation({ source, destination, scope, identity, fixture }) {
  const directory = new PlacementDirectoryRecorder(null);
  const sourceRoutes = new api.WalletAuthorizationRelocationRoutes({ database: source, scope, directory });
  const destinationRoutes = new api.WalletAuthorizationRelocationRoutes({ database: destination, scope, directory });
  const base = 'https://wallet-relocation.internal/internal/wallet-relocation/v1/authorization';
  const schemaResponse = await sourceRoutes.handle(new Request(`${base}/schema`, {
    method: 'POST', body: '{}',
  }));
  assert.equal(schemaResponse.status, 200);
  const schema = await schemaResponse.json();
  assert.equal(schema.kind, 'authorization_schema');
  const mismatch = await destinationRoutes.handle(new Request(`${base}/reserve`, {
    method: 'POST', body: JSON.stringify({ source: identity, schemaDigestHex: '0'.repeat(64) }),
  }));
  assert.equal(mismatch.status, 409);
  const before = await destination.prepare('SELECT COUNT(*) AS count FROM wallet_relocation_authorization_imports').first();
  assert.equal(before.count, 0);
  const request = new Request(`${base}/reserve`, {
    method: 'POST', body: JSON.stringify({ source: identity, schemaDigestHex: schema.schemaDigestHex }),
  });
  const reserved = await destinationRoutes.handle(request.clone());
  assert.equal(reserved.status, 200);
  const receipt = await reserved.json();
  assert.deepEqual(receipt, { kind: 'authorization_reserved', source: JSON.parse(JSON.stringify(identity)), schemaDigestHex: schema.schemaDigestHex });
  assert.deepEqual(await (await destinationRoutes.handle(request.clone())).json(), receipt);
  await assert.rejects(destination.batch([
    api.prepareD1WalletAuthorityPutStatement({ database: destination, scope, authority: fixture.authority }),
  ]));
  const changed = await destinationRoutes.handle(new Request(`${base}/reserve`, {
    method: 'POST', body: JSON.stringify({
      source: { ...identity, moveId: `wmove_${'z'.repeat(43)}` }, schemaDigestHex: schema.schemaDigestHex,
    }),
  }));
  assert.equal(changed.status, 503);
  assert.equal(directory.requests.length, 0);
  return {
    schemaMismatchLeavesDestinationUnreserved: true,
    reservationBeforeSourceRetirement: true,
    exactReservationReplay: true,
    ordinaryDestinationAuthorityWriteRejected: true,
    changedMoveRejected: true,
    noAdmittedJournalRequired: true,
  };
}

function service(database, walletScope) {
  const store = new api.CloudflareD1AuthorizationStore({
    database,
    namespace: walletScope.namespace,
    walletSignerScope: walletScope,
  });
  return new api.AuthorizationService({
    policy: api.capabilityPolicyPort,
    sessions: store,
    grants: store,
    evidence: store,
    authorizedOperations: store,
    audit: {},
  });
}

async function issueDeviceSession(database, authorizationService, fixture, issuedAtMs) {
  await seedExecutionGeneration({ api, database, scope, walletId: fixture.authority.walletId });
  await database.batch([
    api.prepareD1WalletAuthorityPutStatement({ database, scope, authority: fixture.authority }),
    api.prepareD1WalletAuthMethodV2PutStatement({ database, scope, record: fixture.authMethod }),
  ]);
  const issued = await authorizationService.issueDirectWalletSessionAuthorizationV2({
    tenantId: fixture.issuedSession.session.tenantId,
    principalId: fixture.issuedSession.session.principalId,
    walletId: fixture.authority.walletId,
    authority: fixture.authority,
    walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
    mintId: fixture.issuedSession.session.mintId,
    remainingUses: 7,
    issuedAtMs,
    expiresAtMs: fixture.issuedSession.session.expiresAtMs,
  });
  assert.equal(issued.kind, 'issued');
  return issued;
}

async function migrate(database) {
  const directory = 'packages/wallet-server/migrations/d1-signer';
  const migrations = [];
  for (const name of (await readdir(directory)).filter(isSql).sort()) {
    const preservedChallenge = name === '0051_wallet_relocation_email_otp.sql'
      ? api.emailOtpChallengeRecord({
          challengeId: 'otp:migration', challengeSubjectId: 'google:migration',
          walletId: 'wallet:migration', orgId: scope.orgId, email: 'migration@example.test',
          otpCode: '135790', ownerProofBindingDigest: 'migration-binding',
          action: 'wallet_email_otp_login', operation: 'wallet_unlock',
          createdAtMs: 100, expiresAtMs: 200, maxAttempts: 5,
        })
      : null;
    const challengeStore = new api.CloudflareD1EmailOtpChallengeStore({ database, ...scope });
    if (preservedChallenge) await challengeStore.put(preservedChallenge);
    const original = await readFile(`${directory}/${name}`, 'utf8');
    let sql = original;
    if (name === '0028_r103f_phase1_additive_schema_bridge.sql') {
      sql = buildWorkerdCompatiblePhase1Bridge(sql);
    }
    const statements = [];
    for (const query of unstable_splitSqlQuery(sql)) {
      statements.push(database.prepare(query));
    }
    await database.batch(statements);
    if (preservedChallenge) assert.deepEqual(await challengeStore.read(preservedChallenge.challengeId), preservedChallenge);
    migrations.push({ name, sha256: digest(original), ...(preservedChallenge ? { existingOtpChallengePreserved: true } : {}) });
  }
  return migrations;
}

function isSql(name) {
  return name.endsWith('.sql');
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function verifyRelocationChallenges(database, fixture, session, nowMs) {
  const store = new api.D1WalletRelocationChallenges(database, scope);
  const input = {
    walletId: fixture.authority.walletId,
    moveId: `wmove_${Buffer.alloc(32, 93).toString('base64url')}`,
    requestDigestHex: 'ab'.repeat(32),
    sourceGeneration: 1,
    destinationRegion: 'APAC',
    authorityId: fixture.authority.authorityId,
    walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
    credentialDigestHex: digest(Buffer.from(session.operationCredential.token)),
    credentialExpiresAtMs: session.session.expiresAtMs,
    origin: 'https://wallet.example.test',
  };
  const binding = api.WalletRelocationChallengeBinding.parse(input);
  const [issued, concurrent] = await Promise.all([
    store.issue(binding, nowMs, nowMs + 600_000),
    store.issue(binding, nowMs + 1, nowMs + 600_000),
  ]);
  assert.deepEqual(concurrent, issued);
  assert.equal(issued.state, 'issued');
  assert.equal(issued.expiresAtMs, issued.createdAtMs + 300_000);
  assert.equal(Buffer.from(issued.challengeB64u, 'base64url').length, 32);
  assert.deepEqual(await store.issue(binding, nowMs + 1, nowMs + 900_000), issued);
  await assert.rejects(store.issue(api.WalletRelocationChallengeBinding.parse({ ...input, destinationRegion: 'US' }), nowMs + 1, nowMs + 600_000), /binding changed/);
  assert.equal(await new api.D1WalletRelocationChallenges(database, { ...scope, envId: 'other' }).read(binding), null);
  assert.throws(() => store.prepareConsume(issued, nowMs - 1), /invalid or expired/);
  assert.throws(() => store.prepareConsume(issued, issued.expiresAtMs), /invalid or expired/);
  await assert.rejects(database.batch([
    ...store.prepareConsume(issued, nowMs + 2),
    database.prepare('INSERT INTO router_ab_yao_versioned_json_cas_guard (guard_id) VALUES (1)'),
  ]));
  assert.deepEqual(await store.read(binding), issued);
  await database.batch(store.prepareConsume(issued, nowMs + 3));
  const consumed = await store.read(binding);
  assert.equal(consumed.state, 'consumed');
  assert.equal(consumed.consumedAtMs, nowMs + 3);
  await assert.rejects(database.batch(store.prepareConsume(issued, nowMs + 4)));
  assert.deepEqual(await store.issue(binding, nowMs + 1_000_000, nowMs), consumed);
  const factorBound = api.WalletRelocationChallengeBinding.parse({ ...input, moveId: `wmove_${Buffer.alloc(32, 94).toString('base64url')}` });
  const shorter = await store.issue(factorBound, nowMs, nowMs + 30_000);
  assert.equal(shorter.expiresAtMs, nowMs + 30_000);
  const credentialBound = api.WalletRelocationChallengeBinding.parse({ ...input, moveId: `wmove_${Buffer.alloc(32, 95).toString('base64url')}`, credentialExpiresAtMs: nowMs + 10_000 });
  assert.equal((await store.issue(credentialBound, nowMs, nowMs + 30_000)).expiresAtMs, nowMs + 10_000);
  return {
    scope: 'Challenge persistence only; excludes factor verification, full-owner approval, and Console admission',
    fiveMinuteMaximum: true,
    factorExpiryCapsChallenge: true,
    credentialExpiryCapsChallenge: true,
    concurrentIssueReturnsOneChallenge: true,
    exactIssueRetryPreservesChallengeAndExpiry: true,
    changedDestinationRejected: true,
    tenantScopeIsolated: true,
    failedBatchPreservesUnspentChallenge: true,
    exactConsumptionRequiredAndSingleUse: true,
    consumedChallengeNeverReissued: true,
  };
}

function relocationPostRequest(
  binding,
  token,
  destinationRegion = binding.destinationRegion,
  expectedGeneration = binding.sourceGeneration,
) {
  return new Request('https://gateway.example.test/wallet/placement/v1/relocations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: binding.origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      walletId: binding.walletId,
      moveId: binding.moveId,
      destinationRegion,
      expectedGeneration,
      sourceProof: null,
    }),
  });
}

function placementReadRequest(binding, token, path) {
  return new Request(
    `https://gateway.example.test/wallet/placement/v1${path}?walletId=${encodeURIComponent(binding.walletId)}`,
    {
      headers: { Authorization: `Bearer ${token}`, Origin: binding.origin },
    },
  );
}

function relocationEmailOtpServices(database) {
  const prepare = api.prepareD1TenantStatement.bind(null, database, scope);
  const emailOtpEnrollments = new api.CloudflareD1EmailOtpEnrollmentStore({ prepare });
  const emailOtpChallenges = new api.CloudflareD1EmailOtpChallengeStore({ database, ...scope });
  const policy = { limit: 100, windowMs: 60_000 };
  const emailOtpRateLimits = new api.CloudflareD1EmailOtpRateLimitStore({
    prepare,
    rateLimits: {
      challenge: policy,
      verify: policy,
      grant: policy,
      googleRegistrationAttempt: policy,
    },
  });
  const verifier = new api.CloudflareD1EmailOtpChallengeVerifier({
    emailOtpChallenges,
    emailOtpEnrollments,
    emailOtpRateLimits,
    lockoutTtlMs: 60_000,
  });
  const deliveryProvider = new RecordingOtpDelivery();
  const issuer = new api.CloudflareD1EmailOtpChallengeIssuer({
    config: {
      challengeTtlMs: 30_000,
      codeLength: 6,
      maxActiveChallengesPerContext: 5,
      maxAttempts: 5,
    },
    emailOtpChallenges,
    emailOtpEnrollments,
    emailOtpRateLimits,
    emailOtpDelivery: new api.CloudflareD1EmailOtpDeliveryRuntime({
      production: true,
      deliveryMode: 'email_provider',
      deliveryProvider,
    }),
  });
  return { verifier, emailOtpChallenges, issuer, deliveryProvider };
}

async function authenticateRelocationOwner(authorizationSessions, issued, nowMs) {
  const origin = api.parseSessionOrigin('https://wallet.example.test');
  const owner = await api.WalletRelocationOwnerRequest.authenticate({
    request: relocationOwnerHttpRequest(issued.operationCredential.token, origin),
    walletId: issued.session.walletId,
    tenantId: issued.session.tenantId,
    scope,
    allowedOrigins: [origin],
    authorizationSessions,
    nowMs,
  });
  assert.ok(owner);
  return owner;
}

async function verifyRelocationPasskey(database) {
  const keys = generateKeyPairSync('ed25519');
  const publicKey = Buffer.from(keys.publicKey.export({ format: 'jwk' }).x, 'base64url');
  // COSE OKP key: kty=1, alg=-8, crv=6, x=32-byte Ed25519 public key.
  const cose = Buffer.concat([Buffer.from('a4010103272006215820', 'hex'), publicKey]);
  let nowMs = Date.now();
  const fixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'relocation-passkey',
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    credentialPublicKeyB64u: cose.toString('base64url'),
    expiresAtMs: nowMs + 60_000,
    identity: {
      walletId: 'wallet:relocation-passkey',
      authorityId: 'authority:relocation-passkey',
      walletAuthMethodId: 'auth-method:relocation-passkey',
      rpId: 'wallet.example.test',
    },
  });
  const authorizationSessions = service(database, scope);
  const issued = await issueDeviceSession(database, authorizationSessions, fixture, nowMs);
  const owner = await authenticateRelocationOwner(authorizationSessions, issued, nowMs);
  const authenticators = new api.CloudflareD1WebAuthnStore({ database, ...scope });
  await authenticators.writeAuthenticator({
    userId: fixture.authority.walletId,
    record: {
      credentialIdB64u: fixture.authMethod.credentialIdB64u,
      credentialPublicKeyB64u: fixture.authMethod.credentialPublicKeyB64u,
      counter: 0,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      deviceInfo: {
        label: 'Test authenticator',
        browser: 'other',
        os: 'other',
        synced: false,
        transports: [],
      },
    },
  });
  const bindingInput = {
    walletId: fixture.authority.walletId,
    moveId: `wmove_${Buffer.alloc(32, 96).toString('base64url')}`,
    requestDigestHex: 'cd'.repeat(32),
    sourceGeneration: 1,
    destinationRegion: 'APAC',
    authorityId: fixture.authority.authorityId,
    walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
    credentialDigestHex: digest(Buffer.from(issued.operationCredential.token)),
    credentialExpiresAtMs: nowMs + 60_000,
    origin: 'https://wallet.example.test',
  };
  const binding = api.WalletRelocationChallengeBinding.parse(bindingInput);
  const store = new api.D1WalletRelocationChallenges(database, scope);
  const challenge = await store.issue(binding, nowMs, nowMs + 60_000);
  const input = { database, scope, binding, nowMs: nowMs + 1 };
  const credential = relocationAssertion(
    keys.privateKey,
    fixture.authMethod,
    challenge.challengeB64u,
    binding.origin,
    5,
  );
  assert.equal(
    (
      await api.verifyWalletRelocationPasskey({
        ...input,
        credential: relocationAssertion(
          keys.privateKey,
          fixture.authMethod,
          challenge.challengeB64u,
          binding.origin,
          1,
        ),
      })
    ).kind,
    'denied',
  );
  assert.equal(
    (
      await api.verifyWalletRelocationPasskey({
        ...input,
        credential: relocationAssertion(
          keys.privateKey,
          fixture.authMethod,
          'different-purpose',
          binding.origin,
          5,
        ),
      })
    ).kind,
    'denied',
  );
  assert.equal(
    (
      await api.verifyWalletRelocationPasskey({
        ...input,
        credential: relocationAssertion(
          keys.privateKey,
          fixture.authMethod,
          challenge.challengeB64u,
          'https://other.example.test',
          5,
        ),
      })
    ).kind,
    'denied',
  );
  assert.equal(
    (
      await api.verifyWalletRelocationPasskey({
        ...input,
        credential,
        nowMs: challenge.expiresAtMs,
      })
    ).kind,
    'denied',
  );
  const verified = await api.verifyWalletRelocationPasskey({ ...input, credential });
  assert.equal(verified.kind, 'verified');
  assert.equal((await store.read(binding)).state, 'issued');
  const approvals = new api.D1WalletRelocationApprovals(database, scope);
  await database.exec(
    "CREATE TRIGGER fail_relocation_approval BEFORE INSERT ON wallet_relocation_approvals BEGIN SELECT RAISE(ABORT, 'injected approval failure'); END;",
  );
  await assert.rejects(
    approvals.approvePasskey({ owner, binding, credential, nowMs: input.nowMs }),
    /injected approval failure/,
  );
  assert.equal((await store.read(binding)).state, 'issued');
  assert.equal(await approvals.read(binding), null);
  assert.equal(
    (
      await authenticators.readAuthenticator({
        userId: binding.walletId,
        credentialIdB64u: fixture.authMethod.credentialIdB64u,
      })
    ).counter,
    0,
  );
  await database.exec('DROP TRIGGER fail_relocation_approval;');
  const submissionDirectory = new PlacementDirectoryRecorder(null);
  const submissionRoutes = new api.WalletPlacementRoutes({
    emailOtp: relocationEmailOtpServices(database),
    database,
    scope,
    tenantId: issued.session.tenantId,
    allowedOrigins: [binding.origin],
    authorizationSessions,
    directory: submissionDirectory,
  });
  const placementClient = await verifyPlacementClient({
    output,
    binding,
    token: issued.operationCredential.token,
    routeOptions: {
      emailOtp: relocationEmailOtpServices(database),
      database,
      scope,
      tenantId: issued.session.tenantId,
      allowedOrigins: [binding.origin],
      authorizationSessions,
    },
    WalletPlacementRoutes: api.WalletPlacementRoutes,
  });
  const sourceSubmission = new Request(
    'https://gateway.example.test/wallet/placement/v1/relocations',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${issued.operationCredential.token}`,
        Origin: binding.origin,
      },
      body: JSON.stringify({
        walletId: binding.walletId,
        moveId: binding.moveId,
        destinationRegion: binding.destinationRegion,
        expectedGeneration: binding.sourceGeneration,
        sourceProof: { kind: 'passkey', credential },
      }),
    },
  );
  const [submitted, repeatedSubmission] = await Promise.all([
    submissionRoutes.handle(sourceSubmission.clone()),
    submissionRoutes.handle(sourceSubmission.clone()),
  ]);
  assert.equal(submitted.status, 404);
  assert.equal(repeatedSubmission.status, 404);
  assert.ok(await approvals.read(binding));
  assert.equal(
    submissionDirectory.requests[0].path,
    '/internal/wallet-placement/v1/relocation-admit',
  );
  assert.equal(submissionDirectory.requests[0].body.requestDigest, binding.requestDigestHex);
  nowMs = Date.now();

  const [approved, concurrent] = await Promise.all([
    approvals.approvePasskey({ owner, binding, credential, nowMs: input.nowMs }),
    approvals.approvePasskey({ owner, binding, credential, nowMs: input.nowMs + 1 }),
  ]);
  assert.equal(approved.kind, 'approved');
  assert.deepEqual(concurrent, approved);
  assert.equal(approved.approval.expiresAtMs, challenge.expiresAtMs);
  assert.equal(approved.approval.authorityDigestB64u, fixture.authority.authorityDigestB64u);
  assert.equal(approved.approval.authorityRevocationEpoch, fixture.authority.revocationEpoch);
  assert.deepEqual(await approvals.readForAdmission(binding, approved.approval.approvedAtMs), approved.approval);
  assert.equal(await approvals.readForAdmission(binding, challenge.expiresAtMs), null);
  const admissionRoutes = new api.WalletAuthorizationRelocationRoutes({
    database,
    scope,
    directory: submissionDirectory,
  });
  const admissionBody = {
    walletId: binding.walletId,
    moveId: binding.moveId,
    requestDigest: binding.requestDigestHex,
    authorityId: binding.authorityId,
    sourceGeneration: binding.sourceGeneration,
  };
  const admissionUrl = 'https://wallet-relocation.internal/internal/wallet-relocation/v1/authorization/owner-approval';
  const admissionResponse = await admissionRoutes.handle(new Request(admissionUrl, {
    method: 'POST',
    body: JSON.stringify(admissionBody),
  }));
  assert.equal(admissionResponse.status, 200);
  assert.equal(admissionResponse.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await admissionResponse.json(), {
    kind: 'approved',
    requestDigest: binding.requestDigestHex,
    authorityId: binding.authorityId,
    sourceGeneration: binding.sourceGeneration,
    approvedAtMs: approved.approval.approvedAtMs,
    expiresAtMs: approved.approval.expiresAtMs,
  });
  const changedAdmission = await admissionRoutes.handle(new Request(admissionUrl, {
    method: 'POST',
    body: JSON.stringify({ ...admissionBody, requestDigest: '0'.repeat(64) }),
  }));
  assert.deepEqual(await changedAdmission.json(), { kind: 'denied' });
  assert.equal((await admissionRoutes.handle(new Request(
    admissionUrl.replace('wallet-relocation.internal', 'wallet.example.test'),
    { method: 'POST', body: JSON.stringify(admissionBody) },
  ))).status, 404);
  const reopenedApprovals = new api.D1WalletRelocationApprovals(database, scope);
  assert.deepEqual(
    await reopenedApprovals.approvePasskey({
      owner,
      binding,
      credential: null,
      nowMs: challenge.expiresAtMs + 1,
    }),
    approved,
  );
  await assert.rejects(
    reopenedApprovals.approvePasskey({
      owner,
      binding: api.WalletRelocationChallengeBinding.parse({
        ...bindingInput,
        destinationRegion: 'US',
      }),
      credential,
      nowMs: input.nowMs,
    }),
    /binding changed/,
  );
  assert.equal(
    await new api.D1WalletRelocationApprovals(database, { ...scope, envId: 'foreign' }).read(
      binding,
    ),
    null,
  );
  assert.equal(
    (
      await authenticators.readAuthenticator({
        userId: binding.walletId,
        credentialIdB64u: fixture.authMethod.credentialIdB64u,
      })
    ).counter,
    1,
  );
  assert.equal((await store.read(binding)).state, 'consumed');
  assert.equal((await api.verifyWalletRelocationPasskey({ ...input, credential })).kind, 'denied');
  const expiredBinding = api.WalletRelocationChallengeBinding.parse({
    ...bindingInput,
    moveId: `wmove_${Buffer.alloc(32, 99).toString('base64url')}`,
  });
  const expired = await store.issue(expiredBinding, nowMs - 120_000, nowMs - 60_000);
  await assert.rejects(
    approvals.approvePasskey({
      owner,
      binding: expiredBinding,
      credential: relocationAssertion(
        keys.privateKey,
        fixture.authMethod,
        expired.challengeB64u,
        binding.origin,
        5,
        2,
      ),
      nowMs: nowMs - 90_000,
    }),
  );
  assert.equal(await approvals.read(expiredBinding), null);
  assert.equal((await store.read(expiredBinding)).state, 'issued');
  const retiredBinding = owner.bindMove({
    moveId: `wmove_${Buffer.alloc(32, 104).toString('base64url')}`,
    requestDigestHex: 'fa'.repeat(32),
    sourceGeneration: 1,
    destinationRegion: 'APAC',
  });
  const retiredChallenge = await store.issue(retiredBinding, nowMs, nowMs + 60_000);
  await authorizationSessions.retireWalletSessionAuthorizationsForAuthMethod({
    tenantId: issued.session.tenantId,
    walletId: issued.session.walletId,
    walletAuthMethodId: issued.session.walletAuthMethodId,
    nowMs: nowMs + 3,
  });
  await assert.rejects(
    approvals.approvePasskey({
      owner,
      binding: retiredBinding,
      credential: relocationAssertion(
        keys.privateKey,
        fixture.authMethod,
        retiredChallenge.challengeB64u,
        binding.origin,
        5,
        2,
      ),
      nowMs: nowMs + 4,
    }),
  );
  assert.equal(await approvals.read(retiredBinding), null);
  assert.equal((await store.read(retiredBinding)).state, 'issued');
  assert.equal(
    (
      await authenticators.readAuthenticator({
        userId: binding.walletId,
        credentialIdB64u: fixture.authMethod.credentialIdB64u,
      })
    ).counter,
    1,
  );
  assert.deepEqual(await approvals.read(binding), approved.approval);
  const readInput = {
    database,
    scope,
    binding,
    request: relocationOwnerHttpRequest(issued.operationCredential.token, binding.origin),
    allowedOrigins: [binding.origin],
    nowMs: nowMs + 5,
  };
  const retiredMoveClient = await verifyRetiredMoveClient({
    output, binding, token: issued.operationCredential.token,
    routeOptions: {
      emailOtp: relocationEmailOtpServices(database), database, scope,
      tenantId: issued.session.tenantId, allowedOrigins: [binding.origin], authorizationSessions,
    },
    WalletPlacementRoutes: api.WalletPlacementRoutes,
  });
  const readAccess = await api.WalletRelocationReadAccess.authenticate(readInput);
  assert.ok(readAccess);
  assert.equal(readAccess.binding.encoded(), binding.encoded());
  const directory = new PlacementDirectoryRecorder(null);
  const routes = new api.WalletPlacementRoutes({
    emailOtp: relocationEmailOtpServices(database),
    database,
    scope,
    tenantId: issued.session.tenantId,
    allowedOrigins: [binding.origin],
    authorizationSessions,
    directory,
  });
  const statusRequest = placementReadRequest(
    binding,
    issued.operationCredential.token,
    `/relocations/${binding.moveId}`,
  );
  const status = await routes.handle(statusRequest);
  assert.equal(status.status, 404);
  assert.equal(status.headers.get('cache-control'), 'no-store');
  assert.deepEqual(directory.requests, [
    {
      path: '/internal/wallet-placement/v1/relocation-status',
      body: {
        wallet: {
          namespace: scope.namespace,
          organizationId: scope.orgId,
          projectId: scope.projectId,
          environmentId: scope.envId,
          walletId: binding.walletId,
        },
        moveId: binding.moveId,
      },
    },
  ]);
  assert.equal(
    (await routes.handle(placementReadRequest(binding, issued.operationCredential.token, '')))
      .status,
    401,
  );
  assert.equal(
    (
      await routes.handle(
        placementReadRequest(binding, 'wrong-token', `/relocations/${binding.moveId}`),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await routes.handle(
        placementReadRequest(
          binding,
          issued.operationCredential.token,
          `/relocations/${retiredBinding.moveId}`,
        ),
      )
    ).status,
    401,
  );
  assert.equal(directory.requests.length, 1);
  assert.equal((await routes.handle(relocationPostRequest(binding, 'wrong-token'))).status, 401);
  assert.equal(
    (await routes.handle(relocationPostRequest(binding, issued.operationCredential.token, 'US')))
      .status,
    409,
  );
  assert.equal(
    (
      await routes.handle(
        relocationPostRequest(
          binding,
          issued.operationCredential.token,
          binding.destinationRegion,
          2,
        ),
      )
    ).status,
    409,
  );
  assert.equal(
    (await routes.handle(relocationPostRequest(retiredBinding, issued.operationCredential.token)))
      .status,
    401,
  );
  assert.equal(directory.requests.length, 1);
  const replay = await routes.handle(
    relocationPostRequest(binding, issued.operationCredential.token),
  );
  assert.equal(replay.status, 404);
  assert.equal(replay.headers.get('cache-control'), 'no-store');
  assert.equal(directory.requests.length, 2);
  assert.deepEqual(directory.requests[1], {
    path: '/internal/wallet-placement/v1/relocation-admit',
    body: {
      wallet: directory.requests[0].body.wallet,
      moveId: binding.moveId,
      requestDigest: binding.requestDigestHex,
      authorityId: binding.authorityId,
      expectedGeneration: binding.sourceGeneration,
      destinationRegion: binding.destinationRegion,
    },
  });

  assert.equal(
    await authorizationSessions.readWalletSessionExactOperationContextByCredential({
      tenantId: issued.session.tenantId,
      token: issued.operationCredential.token,
      nowMs: nowMs + 5,
    }),
    null,
  );
  assert.equal(
    await api.WalletRelocationReadAccess.authenticate({
      ...readInput,
      binding: retiredBinding,
    }),
    null,
  );
  assert.equal(
    await api.WalletRelocationReadAccess.authenticate({
      ...readInput,
      nowMs: issued.session.expiresAtMs,
    }),
    null,
  );
  assert.equal(
    await api.WalletRelocationReadAccess.authenticate({
      ...readInput,
      request: relocationOwnerHttpRequest('wrong-token', binding.origin),
    }),
    null,
  );
  assert.equal(
    await api.WalletRelocationReadAccess.authenticate({
      ...readInput,
      request: relocationOwnerHttpRequest(
        issued.operationCredential.token,
        'https://foreign.example.test',
      ),
    }),
    null,
  );
  assert.equal(
    await api.WalletRelocationReadAccess.authenticate({
      ...readInput,
      scope: { ...scope, envId: 'foreign' },
    }),
    null,
  );

  assert.equal(
    (
      await authenticators.readAuthenticator({
        userId: binding.walletId,
        credentialIdB64u: fixture.authMethod.credentialIdB64u,
      })
    ).counter,
    1,
  );
  const secondBinding = api.WalletRelocationChallengeBinding.parse({
    walletId: binding.walletId,
    moveId: `wmove_${Buffer.alloc(32, 97).toString('base64url')}`,
    requestDigestHex: binding.requestDigestHex,
    sourceGeneration: binding.sourceGeneration,
    destinationRegion: binding.destinationRegion,
    authorityId: binding.authorityId,
    walletAuthMethodId: binding.walletAuthMethodId,
    credentialDigestHex: binding.credentialDigestHex,
    credentialExpiresAtMs: binding.credentialExpiresAtMs,
    origin: binding.origin,
  });
  const second = await store.issue(secondBinding, nowMs, nowMs + 60_000);
  const secondInput = {
    database,
    scope,
    binding: secondBinding,
    nowMs: nowMs + 2,
    credential: relocationAssertion(
      keys.privateKey,
      fixture.authMethod,
      second.challengeB64u,
      binding.origin,
      5,
      2,
    ),
  };
  const beforeCounterChange = await api.verifyWalletRelocationPasskey(secondInput);
  assert.equal(beforeCounterChange.kind, 'verified');
  await authenticators.updateAuthenticatorCounter({
    userId: binding.walletId,
    credentialIdB64u: fixture.authMethod.credentialIdB64u,
    newCounter: 2,
    updatedAtMs: nowMs + 2,
  });
  await assert.rejects(database.batch(beforeCounterChange.commitPrerequisites));
  assert.equal((await store.read(secondBinding)).state, 'issued');
  assert.equal((await api.verifyWalletRelocationPasskey(secondInput)).kind, 'denied');
  const freshInput = {
    ...secondInput,
    credential: relocationAssertion(
      keys.privateKey,
      fixture.authMethod,
      second.challengeB64u,
      binding.origin,
      5,
      3,
    ),
  };
  const beforeRevocation = await api.verifyWalletRelocationPasskey(freshInput);
  assert.equal(beforeRevocation.kind, 'verified');
  const backup = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'relocation-backup',
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'device_link',
    sourceAuthorityId: fixture.authority.authorityId,
    identity: {
      walletId: binding.walletId,
      authorityId: 'authority:relocation-backup',
      walletAuthMethodId: 'auth-method:relocation-backup',
      credentialIdB64u: Buffer.alloc(32, 98).toString('base64url'),
      rpId: 'wallet.example.test',
    },
  });
  await database.batch([
    api.prepareD1WalletAuthorityPutStatement({ database, scope, authority: backup.authority }),
    api.prepareD1WalletAuthMethodV2PutStatement({ database, scope, record: backup.authMethod }),
  ]);
  const revoked = await new api.D1WalletAuthorityStore({ database, scope }).revokeWalletAuthMethod({
    walletId: binding.walletId,
    authorityId: binding.authorityId,
    walletAuthMethodId: binding.walletAuthMethodId,
    expectedAuthorityRevocationEpoch: fixture.authority.revocationEpoch,
    requestedAtMs: nowMs + 3,
  });
  assert.equal(revoked.kind, 'revoked_method');
  assert.equal(await approvals.readForAdmission(binding, approved.approval.approvedAtMs), null);
  assert.deepEqual(await approvals.read(binding), approved.approval);
  const revokedAdmission = await admissionRoutes.handle(new Request(admissionUrl, {
    method: 'POST',
    body: JSON.stringify(admissionBody),
  }));
  assert.deepEqual(await revokedAdmission.json(), { kind: 'denied' });
  assert.equal(await api.WalletRelocationReadAccess.authenticate(readInput), null);
  assert.equal((await routes.handle(statusRequest)).status, 401);
  assert.equal(
    (await routes.handle(relocationPostRequest(binding, issued.operationCredential.token))).status,
    401,
  );
  assert.equal(directory.requests.length, 2);

  await assert.rejects(database.batch(beforeRevocation.commitPrerequisites));
  assert.equal((await store.read(secondBinding)).state, 'issued');
  assert.equal((await api.verifyWalletRelocationPasskey(freshInput)).kind, 'denied');
  return {
    placementClient,
    retiredMoveClient,
    retiredInitiatingSessionRejectsApprovalWithoutConsumingProof: true,
    moveReadSurvivesSessionRetirementButRejectsRevocation: true,
    httpMoveReadDispatchIsAuthenticatedAndNeverStartsWork: true,
    httpReplayUsesPinnedDigestAndRejectsChangedRequest: true,
    httpPasskeySubmissionPersistsApprovalBeforeJournalDispatch: true,
    moveReadRejectsWrongCredentialOriginScopeMoveAndExpiry: true,
    scope:
      'Real initiating-session authentication, passkey approval persistence and transactional guards; excludes HTTP admission and transfer',
    expiryCheckedAtTransactionCommit: true,
    admissionRejectsExpiredOrRevokedApprovalAndPreservesHistoricalReplay: true,
    admissionReadBindsRequestAndRequiresPrivateOrigin: true,
    exactApprovalRecordedWithProofConsumption: true,
    concurrentApprovalReturnsOriginalOutcome: true,
    lostReplyReplayAfterExpiryPreservesOutcome: true,
    changedApprovalBindingRejected: true,
    approvalTenantScopeIsolated: true,
    signedAssertionVerified: true,
    userVerificationRequired: true,
    wrongPurposeOriginAndExpiryRejected: true,
    verificationDoesNotConsumeChallenge: true,
    authenticatorCounterCommitsWithChallenge: true,
    competingCounterChangeRejectsStaleCommit: true,
    failedApprovalBatchPreservesChallenge: true,
    revocationAfterVerificationRejectsCommit: true,
    committedChallengeCannotReplayAsFreshProof: true,
  };
}

function relocationAssertion(privateKey, method, challenge, origin, flags, counter = 1) {
  const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
  const authenticatorFlags = Buffer.alloc(5);
  authenticatorFlags[0] = flags;
  authenticatorFlags.writeUInt32BE(counter, 1);
  const authenticatorData = Buffer.concat([
    createHash('sha256').update(method.rpId).digest(),
    authenticatorFlags,
  ]);
  const signed = Buffer.concat([
    authenticatorData,
    createHash('sha256').update(clientData).digest(),
  ]);
  return {
    id: method.credentialIdB64u,
    rawId: method.credentialIdB64u,
    type: 'public-key',
    response: {
      clientDataJSON: clientData.toString('base64url'),
      authenticatorData: authenticatorData.toString('base64url'),
      signature: sign(null, signed, privateKey).toString('base64url'),
      userHandle: null,
    },
  };
}

async function verifyRelocationEmailOtp(database) {
  let nowMs = Date.now();
  const email = 'relocation@example.test';
  const providerUserId = 'google:relocation-otp';
  const fixture = await api.buildEmailOtpEcdsaWalletSessionFixture({
    label: 'relocation-otp',
    walletId: 'wallet:relocation-otp',
    providerUserId,
    emailHashHex: digest(Buffer.from(email)),
    expiresAtMs: nowMs + 60_000,
  });
  const authorizationSessions = service(database, scope);
  const issued = await issueDeviceSession(database, authorizationSessions, fixture, nowMs);
  const owner = await authenticateRelocationOwner(authorizationSessions, issued, nowMs);
  const prepare = api.prepareD1TenantStatement.bind(null, database, scope);
  const emailOtpEnrollments = new api.CloudflareD1EmailOtpEnrollmentStore({ prepare });
  const enrollment = api.buildEmailOtpEnrollmentFixture({
    walletId: fixture.authority.walletId,
    orgId: scope.orgId,
    providerUserId,
    email,
    nowMs,
  });
  await emailOtpEnrollments.putEnrollment(enrollment);
  const { verifier, emailOtpChallenges, issuer, deliveryProvider } =
    relocationEmailOtpServices(database);
  const binding = api.WalletRelocationChallengeBinding.parse({
    walletId: fixture.authority.walletId,
    moveId: `wmove_${Buffer.alloc(32, 100).toString('base64url')}`,
    requestDigestHex: 'de'.repeat(32),
    sourceGeneration: 1,
    destinationRegion: 'APAC',
    authorityId: fixture.authority.authorityId,
    walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
    credentialDigestHex: digest(Buffer.from(issued.operationCredential.token)),
    credentialExpiresAtMs: nowMs + 60_000,
    origin: 'https://wallet.example.test',
  });
  const challenges = new api.D1WalletRelocationChallenges(database, scope);
  const challenge = await challenges.issue(binding, nowMs, nowMs + 30_000);
  const ownerProofBindingDigest = await api.walletRelocationEmailOtpBinding(
    scope,
    binding,
    challenge.challengeB64u,
  );
  const challengeDirectory = new PlacementDirectoryRecorder({
    kind: 'resolved',
    requestDigest: binding.requestDigestHex,
    sourceGeneration: binding.sourceGeneration,
    destinationRegion: binding.destinationRegion,
  });
  const challengeRoutes = new api.WalletPlacementRoutes({
    database,
    scope,
    emailOtp: { verifier, emailOtpChallenges, issuer },
    tenantId: issued.session.tenantId,
    allowedOrigins: [binding.origin],
    authorizationSessions,
    directory: challengeDirectory,
  });
  const challengeRequest = new Request(
    'https://gateway.example.test/wallet/placement/v1/relocations/challenge',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${issued.operationCredential.token}`,
        Origin: binding.origin,
      },
      body: JSON.stringify({
        walletId: binding.walletId,
        moveId: binding.moveId,
        destinationRegion: binding.destinationRegion,
        expectedGeneration: binding.sourceGeneration,
      }),
    },
  );
  deliveryProvider.failNext = true;
  assert.equal((await challengeRoutes.handle(challengeRequest.clone())).status, 503);
  const retained = await emailOtpChallenges.read(deliveryProvider.attempts[0].challengeId);
  assert.ok(retained);
  const [retry, concurrentRetry] = await Promise.all([
    challengeRoutes.handle(challengeRequest.clone()),
    challengeRoutes.handle(challengeRequest.clone()),
  ]);
  assert.equal(retry.status, 200);
  assert.equal(concurrentRetry.status, 200);
  const delivered = await retry.json();
  assert.deepEqual(await concurrentRetry.json(), delivered);
  assert.equal(delivered.factor.kind, 'email_otp');
  assert.equal(delivered.factor.challengeId, retained.challengeId);
  assert.equal(delivered.expiresAtMs, challenge.expiresAtMs);
  assert.equal(deliveryProvider.attempts.length, 3);
  for (const attempt of deliveryProvider.attempts)
    assert.deepEqual(attempt, deliveryProvider.attempts[0]);
  const otpInput = await emailOtpChallenges.read(delivered.factor.challengeId);
  assert.ok(otpInput);
  assert.equal(otpInput.ownerProofBindingDigest, ownerProofBindingDigest);
  assert.equal(otpInput.expiresAtMs, challenge.expiresAtMs);
  nowMs = Date.now();
  await emailOtpChallenges.put(
    api.emailOtpChallengeRecord({
      ...otpInput,
      challengeId: 'otp:signing',
      action: 'wallet_email_otp_login',
      operation: 'transaction_sign',
    }),
  );
  const approvals = new api.D1WalletRelocationApprovals(database, scope);
  const input = {
    owner,
    binding,
    challengeId: otpInput.challengeId,
    otpCode: otpInput.otpCode,
    nowMs: nowMs + 1,
    verifier,
    emailOtpChallenges,
  };
  assert.equal(
    (await approvals.approveEmailOtp({ ...input, challengeId: 'otp:signing' })).kind,
    'denied',
  );
  assert.ok(await emailOtpChallenges.read('otp:signing'));
  assert.equal((await approvals.approveEmailOtp({ ...input, otpCode: '000000' })).kind, 'denied');
  assert.equal((await emailOtpChallenges.read(otpInput.challengeId)).attemptCount, 1);
  const beforeEnrollmentRemoval = await api.verifyWalletRelocationEmailOtp({
    database,
    scope,
    ...input,
  });
  assert.equal(beforeEnrollmentRemoval.kind, 'verified');
  await emailOtpEnrollments.deleteEnrollment(binding.walletId);
  await assert.rejects(database.batch(beforeEnrollmentRemoval.commitPrerequisites));
  assert.ok(await emailOtpChallenges.read(otpInput.challengeId));
  assert.equal((await challenges.read(binding)).state, 'issued');
  await emailOtpEnrollments.putEnrollment(enrollment);
  await database.exec(
    "CREATE TRIGGER fail_relocation_approval BEFORE INSERT ON wallet_relocation_approvals BEGIN SELECT RAISE(ABORT, 'injected OTP approval failure'); END;",
  );
  await assert.rejects(approvals.approveEmailOtp(input), /injected OTP approval failure/);
  assert.ok(await emailOtpChallenges.read(otpInput.challengeId));
  assert.equal((await challenges.read(binding)).state, 'issued');
  assert.equal(await approvals.read(binding), null);
  await database.exec('DROP TRIGGER fail_relocation_approval;');
  const submissionDirectory = new PlacementDirectoryRecorder(null);
  const routes = new api.WalletPlacementRoutes({
    database,
    scope,
    emailOtp: { verifier, emailOtpChallenges, issuer },
    tenantId: issued.session.tenantId,
    allowedOrigins: [binding.origin],
    authorizationSessions,
    directory: submissionDirectory,
  });
  const submitted = await routes.handle(
    new Request('https://gateway.example.test/wallet/placement/v1/relocations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${issued.operationCredential.token}`,
        Origin: binding.origin,
      },
      body: JSON.stringify({
        walletId: binding.walletId,
        moveId: binding.moveId,
        destinationRegion: binding.destinationRegion,
        expectedGeneration: binding.sourceGeneration,
        sourceProof: {
          kind: 'email_otp',
          challengeId: otpInput.challengeId,
          otpCode: otpInput.otpCode,
        },
      }),
    }),
  );
  assert.equal(submitted.status, 404);
  assert.ok(await approvals.read(binding));
  assert.equal(
    submissionDirectory.requests[0].path,
    '/internal/wallet-placement/v1/relocation-admit',
  );

  const approved = await approvals.approveEmailOtp(input);
  assert.equal(approved.kind, 'approved');
  assert.equal(approved.approval.expiresAtMs, challenge.expiresAtMs);
  assert.equal(await emailOtpChallenges.read(otpInput.challengeId), null);
  assert.equal((await challenges.read(binding)).state, 'consumed');
  assert.equal((await challengeRoutes.handle(challengeRequest.clone())).status, 409);
  assert.equal(deliveryProvider.attempts.length, 3);
  assert.deepEqual(
    await approvals.approveEmailOtp({ ...input, otpCode: '000000', nowMs: nowMs + 90_000 }),
    approved,
  );
  assert.ok(await emailOtpChallenges.read('otp:signing'));
  assert.ok(
    await api.WalletRelocationReadAccess.authenticate({
      database,
      scope,
      binding,
      request: relocationOwnerHttpRequest(issued.operationCredential.token, binding.origin),
      allowedOrigins: [binding.origin],
      nowMs: nowMs + 40_000,
    }),
  );
  const clientMoveSubmission = await verifyMoveSubmissionClient({
    output,
    binding: { ...binding, moveId: `wmove_${Buffer.alloc(32, 102).toString('base64url')}` },
    token: issued.operationCredential.token,
    routeOptions: {
      database,
      scope,
      emailOtp: { verifier, emailOtpChallenges, issuer },
      tenantId: issued.session.tenantId,
      allowedOrigins: [binding.origin],
      authorizationSessions,
    },
    WalletPlacementRoutes: api.WalletPlacementRoutes,
  });
  return {
    clientMoveSubmission,
    scope:
      'OTP verification and atomic approval through production stores; excludes email delivery, factor unsealing, owner HTTP authentication and Console admission',
    initiatingSessionGuardUsesIssuedCredential: true,
    failedDeliveryAndConcurrentRetriesPreserveOriginalOtpAndExpiry: true,
    consumedChallengeCannotIssueAnotherOtp: true,
    httpOtpSubmissionUsesSharedVerifierAndPersistsApprovalBeforeDispatch: true,
    enrollmentRemovalRejectsStaleCommit: true,
    distinctRelocationPurpose: true,
    signingChallengeRejectedAndPreserved: true,
    wrongCodeUsesExistingAttemptLimit: true,
    failedApprovalPreservesBothChallenges: true,
    approvalConsumesOtpAndRelocationChallengeTogether: true,
    approvalExpiryCappedByOtp: true,
    exactReplayRequiresNoSecondOtp: true,
  };
}

async function verifyRelocationOwnerRequest(database) {
  const nowMs = Date.now();
  const authorizationSessions = service(database, scope);
  const fixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'relocation-owner-request',
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    expiresAtMs: nowMs + 60_000,
    identity: {
      walletId: 'wallet:owner-request',
      authorityId: 'authority:owner-request',
      walletAuthMethodId: 'auth-method:owner-request',
      rpId: 'wallet.example.test',
      credentialIdB64u: Buffer.alloc(32, 101).toString('base64url'),
    },
  });
  const issued = await issueDeviceSession(database, authorizationSessions, fixture, nowMs);
  const origin = api.parseSessionOrigin('https://wallet.example.test');
  const request = relocationOwnerHttpRequest(issued.operationCredential.token, origin);
  const input = {
    request,
    walletId: fixture.authority.walletId,
    tenantId: issued.session.tenantId,
    scope,
    allowedOrigins: [origin],
    authorizationSessions,
    nowMs: nowMs + 1,
  };
  const owner = await api.WalletRelocationOwnerRequest.authenticate(input);
  assert.ok(owner);
  const move = {
    moveId: `wmove_${Buffer.alloc(32, 102).toString('base64url')}`,
    requestDigestHex: 'be'.repeat(32),
    sourceGeneration: 1,
    destinationRegion: 'APAC',
  };
  const binding = owner.bindMove(move);
  assert.equal(binding.walletId, issued.session.walletId);
  assert.equal(binding.authorityId, issued.session.authorityId);
  assert.equal(binding.walletAuthMethodId, issued.session.walletAuthMethodId);
  assert.equal(binding.credentialExpiresAtMs, issued.session.expiresAtMs);
  assert.equal(binding.credentialDigestHex, digest(Buffer.from(issued.operationCredential.token)));
  assert.equal(binding.origin, origin);
  const directory = new PlacementDirectoryRecorder({
    kind: 'resolved',
    requestDigest: move.requestDigestHex,
    sourceGeneration: move.sourceGeneration,
    destinationRegion: move.destinationRegion,
  });
  const routes = new api.WalletPlacementRoutes({
    emailOtp: relocationEmailOtpServices(database),
    database,
    scope,
    tenantId: issued.session.tenantId,
    allowedOrigins: [origin],
    authorizationSessions,
    directory,
  });
  const challengeBody = {
    walletId: fixture.authority.walletId,
    moveId: move.moveId,
    destinationRegion: move.destinationRegion,
    expectedGeneration: move.sourceGeneration,
  };
  const challengeRequest = new Request(
    'https://gateway.example.test/wallet/placement/v1/relocations/challenge',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${issued.operationCredential.token}`, Origin: origin },
      body: JSON.stringify(challengeBody),
    },
  );
  const firstChallenge = await routes.handle(challengeRequest.clone());
  assert.equal(firstChallenge.status, 200);
  const issuedChallenge = await firstChallenge.json();
  assert.equal(issuedChallenge.kind, 'challenge');
  assert.equal(issuedChallenge.expiresAtMs, issued.session.expiresAtMs);
  assert.deepEqual(await (await routes.handle(challengeRequest.clone())).json(), issuedChallenge);
  assert.equal(
    (await new api.D1WalletRelocationChallenges(database, scope).read(binding)).challengeB64u,
    issuedChallenge.challengeB64u,
  );
  assert.equal(directory.requests[0].body.authorityId, fixture.authority.authorityId);

  assert.equal(
    await api.WalletRelocationOwnerRequest.authenticate({ ...input, allowedOrigins: [] }),
    null,
  );
  assert.equal(
    await api.WalletRelocationOwnerRequest.authenticate({
      ...input,
      request: relocationOwnerHttpRequest(
        issued.operationCredential.token,
        'https://foreign.example.test',
      ),
    }),
    null,
  );
  assert.equal(
    await api.WalletRelocationOwnerRequest.authenticate({
      ...input,
      request: relocationOwnerHttpRequest('', origin),
    }),
    null,
  );
  assert.equal(
    await api.WalletRelocationOwnerRequest.authenticate({ ...input, walletId: 'wallet:foreign' }),
    null,
  );
  assert.equal(
    await api.WalletRelocationOwnerRequest.authenticate({
      ...input,
      scope: { ...scope, envId: 'foreign' },
    }),
    null,
  );
  assert.equal(
    await api.WalletRelocationOwnerRequest.authenticate({
      ...input,
      nowMs: issued.session.expiresAtMs,
    }),
    null,
  );
  await database
    .prepare(
      `UPDATE authorization_wallet_session_quotas SET remaining_uses = 0, lifecycle_kind = 'exhausted'
    WHERE namespace = ? AND tenant_id = ? AND quota_id = ?`,
    )
    .bind(scope.namespace, issued.session.tenantId, issued.session.quotaId)
    .run();
  const exhausted = await api.WalletRelocationOwnerRequest.authenticate(input);
  assert.ok(exhausted);
  assert.equal(exhausted.bindMove(move).encoded(), binding.encoded());
  await authorizationSessions.retireWalletSessionAuthorizationsForAuthMethod({
    tenantId: issued.session.tenantId,
    walletId: issued.session.walletId,
    walletAuthMethodId: issued.session.walletAuthMethodId,
    nowMs: nowMs + 2,
  });
  assert.equal(await api.WalletRelocationOwnerRequest.authenticate(input), null);
  const resolutionCount = directory.requests.length;
  assert.equal((await routes.handle(challengeRequest.clone())).status, 401);
  assert.equal(directory.requests.length, resolutionCount);

  const delegated = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'relocation-delegated-request',
    permissions: api.buildSigningOnlyDelegatedWalletAuthorityV1().permissions,
    provenance: 'device_link',
    sourceAuthorityId: fixture.authority.authorityId,
    expiresAtMs: nowMs + 60_000,
    identity: {
      walletId: fixture.authority.walletId,
      authorityId: 'authority:delegated-request',
      walletAuthMethodId: 'auth-method:delegated-request',
      rpId: 'wallet.example.test',
      credentialIdB64u: Buffer.alloc(32, 103).toString('base64url'),
    },
  });
  const delegatedIssued = await issueDeviceSession(
    database,
    authorizationSessions,
    delegated,
    nowMs,
  );
  assert.equal(
    await api.WalletRelocationOwnerRequest.authenticate({
      ...input,
      request: relocationOwnerHttpRequest(delegatedIssued.operationCredential.token, origin),
    }),
    null,
  );
  return {
    httpChallengeBindsResolvedDigestAndPreservesExactNonce: true,
    scope:
      'Initiating primary credential and move binding only; excludes move-only status, owner routes and Console admission',
    credentialAndAuthorityBoundToMove: true,
    originAllowlistRequired: true,
    foreignWalletAndDeploymentRejected: true,
    expiredAndRetiredCredentialsRejected: true,
    exhaustedSigningQuotaAllowsOwnerAuthentication: true,
    delegatedAuthorityRejected: true,
  };
}

function relocationOwnerHttpRequest(token, origin) {
  return new Request('https://gateway.example.test/wallet/placement/v1/relocations', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, origin },
    body: '{}',
  });
}

async function verifyWalletSessionRetirement(input) {
  const {
    source,
    sourceService,
    fixture,
    issued,
    offlineIssued,
    primaryInput,
    offlineInput,
    hostedInput,
    hostedBefore,
    before,
    offlineBefore,
    redeemInput,
    issuedAtMs,
  } = input;
  const identity = input.identity;
  const store = new api.D1WalletRelocationSessions(source, scope);
  const pending = await sourceService.mintHostedWalletSeamsSessionExchange({
    authorization: issued,
    appOrigin: api.parseSessionOrigin('https://app.example.test'),
    walletOrigin: api.parseSessionOrigin('https://wallet.example.test'),
    issuedAtMs: issuedAtMs + 4,
    expiresAtMs: issued.session.expiresAtMs,
  });
  const exchangesBefore = await source
    .prepare(
      'SELECT * FROM wallet_session_hosted_exchange_codes_v2 WHERE wallet_id = ? ORDER BY code_hash',
    )
    .bind(issued.session.walletId)
    .all();
  await source
    .prepare(
      `CREATE TRIGGER injected_relocation_retirement_failure
    BEFORE UPDATE ON wallet_session_authorizations_v2
    WHEN NEW.retired_at_ms IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'injected_retirement_failure'); END`,
    )
    .run();
  await assert.rejects(store.retire(identity, issuedAtMs + 5), /injected_retirement_failure/u);
  await source.prepare('DROP TRIGGER injected_relocation_retirement_failure').run();
  assert.deepEqual(
    await sourceService.readWalletSessionAdmissionSnapshotByOperationCredential(primaryInput),
    before,
  );
  assert.deepEqual(
    await sourceService.readWalletSessionAdmissionSnapshotByOperationCredential(offlineInput),
    offlineBefore,
  );
  assert.deepEqual(
    await sourceService.readHostedWalletSessionOperationCredentialV2(hostedInput),
    hostedBefore,
  );
  assert.equal(
    await source
      .prepare('SELECT COUNT(*) AS count FROM wallet_relocation_session_fences')
      .first('count'),
    0,
  );

  const [first, concurrent] = await Promise.all([
    store.retire(identity, issuedAtMs + 5),
    store.retire(identity, issuedAtMs + 6),
  ]);
  assert.equal(first, concurrent);
  assert.equal(
    await new api.D1WalletRelocationSessions(source, scope).retire(identity, issuedAtMs + 7),
    first,
  );
  for (const credential of [primaryInput, offlineInput]) {
    assert.equal(
      await sourceService.readWalletSessionAdmissionSnapshotByOperationCredential(credential),
      null,
    );
  }
  assert.equal(await sourceService.readHostedWalletSessionOperationCredentialV2(hostedInput), null);
  assert.equal(
    (await sourceService.redeemHostedWalletSeamsSessionExchange(redeemInput)).kind,
    'already_consumed',
  );
  const pendingResult = await sourceService.redeemHostedWalletSeamsSessionExchange({
    exchangeCode: pending.exchangeCode,
    nonce: pending.nonce,
    appOrigin: api.parseSessionOrigin('https://app.example.test'),
    walletOrigin: api.parseSessionOrigin('https://wallet.example.test'),
    redeemedAtMs: issuedAtMs + 8,
  });
  assert.notEqual(pendingResult.kind, 'redeemed');
  assert.deepEqual(
    (
      await source
        .prepare(
          'SELECT * FROM wallet_session_hosted_exchange_codes_v2 WHERE wallet_id = ? ORDER BY code_hash',
        )
        .bind(issued.session.walletId)
        .all()
    ).results,
    exchangesBefore.results,
  );
  await assert.rejects(
    store.retire(
      api.WalletRelocationSessionSource.parse({
        walletId: identity.walletId,
        moveId: `wmove_${'t'.repeat(43)}`,
        requestDigestHex: identity.requestDigestHex,
        sourceGeneration: 1,
      }),
      issuedAtMs + 9,
    ),
    /identity conflicts/u,
  );
  await assert.rejects(
    source
      .prepare(
        `UPDATE wallet_session_authorizations_v2 SET retired_at_ms = NULL
    WHERE authorization_id = ?`,
      )
      .bind(issued.session.authorizationId)
      .run(),
    /wallet_relocation_session_admission_closed/u,
  );
  const lateFixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'late-relocation-issuance',
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'device_link',
    sourceAuthorityId: fixture.authority.authorityId,
    expiresAtMs: issuedAtMs + 3_600_000,
    identity: {
      walletId: issued.session.walletId,
      authorityId: 'authority:late-relocation-device',
      walletAuthMethodId: 'auth-method:late-relocation-device',
      rpId: fixture.authMethod.rpId,
      credentialIdB64u: Buffer.alloc(32, 66).toString('base64url'),
    },
  });
  await assert.rejects(
    issueDeviceSession(source, sourceService, lateFixture, issuedAtMs + 10),
    /Wallet session issuance requires an open execution generation/u,
  );
  const unrelated = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'unrelated-relocation-session',
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    expiresAtMs: issuedAtMs + 3_600_000,
    identity: {
      walletId: 'wallet:unrelated-relocation-session',
      authorityId: 'authority:unrelated-relocation-session',
      walletAuthMethodId: 'auth-method:unrelated-relocation-session',
      rpId: fixture.authMethod.rpId,
      credentialIdB64u: Buffer.alloc(32, 67).toString('base64url'),
    },
  });
  const unaffected = await issueDeviceSession(source, sourceService, unrelated, issuedAtMs + 11);
  assert.equal(
    (
      await sourceService.readWalletSessionAdmissionSnapshotByOperationCredential({
        tenantId: unaffected.session.tenantId,
        token: unaffected.operationCredential.token,
        nowMs: issuedAtMs + 12,
      })
    ).kind,
    'active',
  );
  const methods = await source
    .prepare('SELECT status FROM wallet_auth_methods WHERE wallet_id = ?')
    .bind(issued.session.walletId)
    .all();
  assert.ok(methods.results.length >= 2);
  assert.ok(methods.results.every(methodIsActive));
  return {
    allDevicesRetired: [issued.session.authorizationId, offlineIssued.session.authorizationId],
    originalRetirementTime: first,
    partialFailureRolledBack: true,
    concurrentRetriesExact: true,
    delayedIssuanceRejected: true,
    sourceReactivationRejected: true,
    issuedAndConsumedExchangeHistoryPreserved: true,
    enrolledMethodsRemainActive: true,
    unrelatedWalletRemainsUsable: true,
  };
}

function methodIsActive(method) {
  return method.status === 'active';
}

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type TestInfo } from '@playwright/test';
import { buildFullOwnerPermissionsV1 } from '@shared/authorization/delegatedAuthority';
import { parseTenantId } from '@shared/authorization/capabilityKinds';
import {
  parseVoiceIdDevicePublicKeyB64u,
  parseVoiceIdWalletSessionChallenge,
  voiceIdWalletSessionChallengeBytes,
} from '@shared/authorization/voiceIdDeviceAssertion';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { sha256DigestB64u } from '@shared/utils/canonicalPrimitives';
import { allocateWalletAuthMethodId, parsePasskeyEnvelopeId } from '@shared/utils/domainIds';
import { custodyEnvelopeBindingJsonV1 } from '@shared/passkey-custody/custodyEnvelope';
import { parseWalletSessionOperationCredentialV1 } from '@shared/device-linking/activeWalletSession';
import { requireRecord } from '@shared/utils/validation';
import { D1WalletAuthMethodStore, prepareD1WalletAuthMethodV2PutStatement } from '@server/core/d1WalletAuthMethodStore';
import { AuthorizationService } from '@server/authorization/service';
import { capabilityPolicyPort } from '@server/authorization/capabilityPolicy';
import { CloudflareD1AuthorizationStore } from '@server/router/cloudflare/d1/authorization/d1AuthorizationStore';
import { CloudflareD1PasskeyCustodyEnvelopeStore } from '@server/router/cloudflare/d1/passkeyCustody/d1PasskeyCustodyEnvelopeStore';
import { D1WalletExecutionAuthority } from '@server/router/cloudflare/d1/registration/d1WalletExecutionAuthority';
import { readActiveWalletSessionCredential } from '@server/router/cloudflare/d1/auth/walletSessionCredentialReaders';
import { prepareD1WalletAuthorityPutStatement } from '@server/router/cloudflare/d1/wallet/d1WalletAuthorityStore';
import { D1VoiceIdActivation } from '@server/router/cloudflare/d1/wallet/d1VoiceIdActivation';
import { D1VoiceIdSessions } from '@server/router/cloudflare/d1/wallet/d1VoiceIdSessions';
import { D1VoiceIdWalletSessionChallenges } from '@server/router/cloudflare/d1/wallet/d1VoiceIdWalletSessionChallenges';
import { D1WalletAuthorityStore } from '@server/router/cloudflare/d1/wallet/d1WalletAuthorityStore';
import { handleVoiceIdActivationRequest } from '@server/router/transport/fetch/routes/walletVoiceIdActivation';
import {
  handleVoiceIdChallengeRequest,
  handleVoiceIdVerifyRequest,
} from '@server/router/transport/fetch/routes/walletVoiceIdSessions';
import {
  parseVoiceIdActivationEnvelope,
  type VoiceIdActivationOwnerSession,
} from '@server/router/domains/voiceId/voiceIdActivation';
import { buildLinkedDeviceManagementAuthorityFixture } from '../../unit/helpers/linkedDeviceManagement.fixtures';
import { openSignerD1 } from '../../fixtures/signer-d1.mjs';
import { seedExecutionGeneration } from '../execution-generation.scenario.mjs';
import {
  initSync,
  passkey_custody_open_wallet_seed_v1,
} from '../../../wasm/near_signer/pkg/wasm_signer_worker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SCOPE = {
  namespace: 'voiceid-activation',
  orgId: 'voiceid-org',
  projectId: 'voiceid-project',
  envId: 'test',
};

type TestDeviceKey = {
  readonly publicKeyB64u: ReturnType<typeof parseVoiceIdDevicePublicKeyB64u>;
  readonly deviceKeyId: Awaited<ReturnType<typeof sha256DigestB64u>>;
  readonly privateKey: CryptoKey;
};

async function generateTestDeviceKey(): Promise<TestDeviceKey> {
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  if (!('publicKey' in keys) || !('privateKey' in keys)) {
    throw new Error('Test device key was unavailable');
  }
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  return {
    publicKeyB64u: parseVoiceIdDevicePublicKeyB64u(base64UrlEncode(publicKey)),
    deviceKeyId: await sha256DigestB64u(publicKey),
    privateKey: keys.privateKey,
  };
}

async function sealForTest(input: {
  readonly testInfo: TestInfo;
  readonly label: string;
  readonly walletId: string;
  readonly methodId: string;
  readonly envelopeId: string;
  readonly deviceKeyId: string;
}): Promise<ReturnType<typeof parseVoiceIdActivationEnvelope>> {
  const reportPath = input.testInfo.outputPath(`${input.label}.json`);
  execFileSync('cargo', [
    'run',
    '--offline',
    '--manifest-path',
    'crates/signer-core/Cargo.toml',
    '--features',
    'passkey-custody',
    '--example',
    'voiceid_custody_journey',
    '--',
    reportPath,
    input.walletId,
    input.methodId,
    input.deviceKeyId,
    input.envelopeId,
  ], { cwd: ROOT, timeout: 120_000 });
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  if (report.status !== 'passed') throw new Error('Rust VoiceID custody journey failed');
  return parseVoiceIdActivationEnvelope(report.envelope);
}

function requireEnvelopeId(value: string) {
  const parsed = parsePasskeyEnvelopeId(value);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

function activationHttpRequest(input: {
  readonly token: string;
  readonly origin: string;
  readonly methodId: string;
  readonly devicePublicKeyB64u: string;
  readonly envelope: ReturnType<typeof parseVoiceIdActivationEnvelope>;
}): Request {
  return new Request('https://router.example.test/wallet/voiceid/activate', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.token}`,
      origin: input.origin,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      targetWalletAuthMethodId: input.methodId,
      devicePublicKeyB64u: input.devicePublicKeyB64u,
      custodyEnvelope: input.envelope,
    }),
  });
}

function voiceIdHttpRequest(pathname: string, origin: string, body: unknown): Request {
  return new Request(`https://router.example.test${pathname}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('owner session activates one VoiceID key and envelope in the same D1 transaction', runJourney);

async function runJourney({ page }: { page: unknown }, testInfo: TestInfo): Promise<void> {
  void page;
  const runtime = await openSignerD1();
  try {
    const database = runtime.database;
    const fixture = await buildLinkedDeviceManagementAuthorityFixture({
      label: 'voiceid-activation-owner',
      permissions: buildFullOwnerPermissionsV1(),
      provenance: 'wallet_registration',
      expiresAtMs: Date.now() + 120_000,
    });
    await seedExecutionGeneration({
      api: { D1WalletExecutionAuthority },
      database,
      scope: SCOPE,
      walletId: fixture.authority.walletId,
    });
    await database.batch([
      prepareD1WalletAuthorityPutStatement({ database, scope: SCOPE, authority: fixture.authority }),
      prepareD1WalletAuthMethodV2PutStatement({ database, scope: SCOPE, record: fixture.authMethod }),
    ]);
    const authorizationStore = new CloudflareD1AuthorizationStore({
      database,
      namespace: SCOPE.namespace,
      walletSignerScope: SCOPE,
    });
    const authorization = new AuthorizationService({
      policy: capabilityPolicyPort,
      sessions: authorizationStore,
      grants: authorizationStore,
      evidence: authorizationStore,
      authorizedOperations: authorizationStore,
      audit: {},
    });
    const tenantId = parseTenantId(SCOPE.orgId);
    if (!tenantId.ok) throw new Error(tenantId.error.message);
    const issuedAtMs = Date.now();
    const issued = await authorization.issueDirectWalletSessionAuthorizationV2({
      tenantId: tenantId.value,
      principalId: fixture.issuedSession.session.principalId,
      walletId: fixture.authority.walletId,
      authority: fixture.authority,
      walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
      mintId: fixture.issuedSession.session.mintId,
      remainingUses: 7,
      issuedAtMs,
      expiresAtMs: issuedAtMs + 120_000,
    });
    if (issued.kind !== 'issued') throw new Error('Source owner Wallet Session was not issued');
    const source: VoiceIdActivationOwnerSession = {
      authorization: { session: issued.session, quota: issued.quota },
      authority: fixture.authority,
      authMethod: fixture.authMethod,
    };
    const authMethods = new D1WalletAuthMethodStore({ database, ...SCOPE });
    const envelopes = new CloudflareD1PasskeyCustodyEnvelopeStore({ database, scope: SCOPE });
    const activation = new D1VoiceIdActivation(database, SCOPE, authMethods, envelopes);
    const device = await generateTestDeviceKey();
    const methodId = allocateWalletAuthMethodId(randomUUID());
    const envelopeId = requireEnvelopeId(`wallet-custody-envelope:${randomUUID()}`);
    const envelope = await sealForTest({
      testInfo,
      label: 'first-seal',
      walletId: String(fixture.authority.walletId),
      methodId: String(methodId),
      envelopeId: String(envelopeId),
      deviceKeyId: String(device.deviceKeyId),
    });
    const route = {
      tenantId: issued.session.tenantId,
      readWalletSessionAuthorizationV2ByOperationCredential:
        readActiveWalletSessionCredential.bind(undefined, authorization),
      activateVoiceId: activation.activate.bind(activation),
      hostedWalletOrigins: ['https://wallet.example.test'],
    };
    const token = issued.operationCredential.token;
    const wrongOrigin = await handleVoiceIdActivationRequest(activationHttpRequest({
      token,
      origin: 'https://untrusted.example.test',
      methodId: String(methodId),
      devicePublicKeyB64u: String(device.publicKeyB64u),
      envelope,
    }), route);
    expect(wrongOrigin.status).toBe(403);
    const mismatchedDevice = await generateTestDeviceKey();
    const mismatchedKey = await handleVoiceIdActivationRequest(activationHttpRequest({
      token,
      origin: 'https://wallet.example.test',
      methodId: String(methodId),
      devicePublicKeyB64u: String(mismatchedDevice.publicKeyB64u),
      envelope,
    }), route);
    expect(mismatchedKey.status).toBe(400);
    const activated = await handleVoiceIdActivationRequest(activationHttpRequest({
      token,
      origin: 'https://wallet.example.test',
      methodId: String(methodId),
      devicePublicKeyB64u: String(device.publicKeyB64u),
      envelope,
    }), route);
    expect(activated.status).toBe(200);
    expect((await activated.json()).ok).toBe(true);
    const exactRetry = await handleVoiceIdActivationRequest(activationHttpRequest({
      token,
      origin: 'https://wallet.example.test',
      methodId: String(methodId),
      devicePublicKeyB64u: String(device.publicKeyB64u),
      envelope,
    }), route);
    expect(exactRetry.status).toBe(200);
    const active = await authMethods.getActiveVoiceIdV2({
      walletId: fixture.authority.walletId,
      walletAuthMethodId: methodId,
      walletAuthorityId: fixture.authority.authorityId,
    });
    expect(active?.deviceKeyId).toBe(device.deviceKeyId);
    const stored = await envelopes.lookupEnvelopeForWalletAuthMethod({
      walletId: fixture.authority.walletId,
      walletAuthMethodId: methodId,
      factor: { kind: 'voiceid', deviceKeyId: device.deviceKeyId },
    });
    if (stored.kind !== 'active') throw new Error('Activated VoiceID envelope was unavailable');
    expect(stored.envelope.envelopeId).toBe(envelopeId);
    initSync({ module: await readFile(path.join(ROOT, 'wasm/near_signer/pkg/wasm_signer_worker_bg.wasm')) });
    const factorSecret = new Uint8Array(32).fill(11);
    try {
      const handle = passkey_custody_open_wallet_seed_v1(
        factorSecret,
        custodyEnvelopeBindingJsonV1(stored.envelope),
        base64UrlDecode(stored.envelope.nonceB64u),
        stored.envelope.sealedCustodySecretB64u,
        stored.envelope.aadHashB64u,
        stored.envelope.ciphertextDigestB64u,
      );
      handle.destroy();
    } finally {
      factorSecret.fill(0);
    }

    const duplicateMethodId = allocateWalletAuthMethodId(randomUUID());
    const duplicateEnvelopeId = requireEnvelopeId(`wallet-custody-envelope:${randomUUID()}`);
    const duplicateEnvelope = await sealForTest({
      testInfo,
      label: 'duplicate-device-seal',
      walletId: String(fixture.authority.walletId),
      methodId: String(duplicateMethodId),
      envelopeId: String(duplicateEnvelopeId),
      deviceKeyId: String(device.deviceKeyId),
    });
    const duplicate = await activation.activate({
      source,
      targetWalletAuthMethodId: duplicateMethodId,
      devicePublicKeyB64u: device.publicKeyB64u,
      envelope: duplicateEnvelope,
      nowMs: Date.now(),
    });
    expect(duplicate).toEqual({ kind: 'rejected', code: 'conflict' });
    expect(await authMethods.readByIdV2({ walletAuthMethodId: duplicateMethodId })).toBeNull();
    const duplicateCustody = await envelopes.lookupEnvelopeForWalletAuthMethod({
      walletId: fixture.authority.walletId,
      walletAuthMethodId: duplicateMethodId,
      factor: { kind: 'voiceid', deviceKeyId: device.deviceKeyId },
    });
    expect(duplicateCustody.kind).toBe('missing');

    const secondDevice = await generateTestDeviceKey();
    const retiredMethodId = allocateWalletAuthMethodId(randomUUID());
    const retiredEnvelopeId = requireEnvelopeId(`wallet-custody-envelope:${randomUUID()}`);
    const retiredEnvelope = await sealForTest({
      testInfo,
      label: 'retired-session-seal',
      walletId: String(fixture.authority.walletId),
      methodId: String(retiredMethodId),
      envelopeId: String(retiredEnvelopeId),
      deviceKeyId: String(secondDevice.deviceKeyId),
    });
    const retiredAtMs = Date.now();
    await database.prepare(`UPDATE wallet_session_authorizations_v2 SET retired_at_ms = ?
      WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ?
        AND authorization_id = ?`).bind(
      retiredAtMs,
      SCOPE.namespace,
      SCOPE.orgId,
      SCOPE.projectId,
      SCOPE.envId,
      String(issued.session.authorizationId),
    ).run();
    const retired = await activation.activate({
      source,
      targetWalletAuthMethodId: retiredMethodId,
      devicePublicKeyB64u: secondDevice.publicKeyB64u,
      envelope: retiredEnvelope,
      nowMs: Date.now(),
    });
    expect(retired).toEqual({ kind: 'rejected', code: 'conflict' });
    expect(await authMethods.readByIdV2({ walletAuthMethodId: retiredMethodId })).toBeNull();
    const retiredCustody = await envelopes.lookupEnvelopeForWalletAuthMethod({
      walletId: fixture.authority.walletId,
      walletAuthMethodId: retiredMethodId,
      factor: { kind: 'voiceid', deviceKeyId: secondDevice.deviceKeyId },
    });
    expect(retiredCustody.kind).toBe('missing');

    const voiceIdSessions = new D1VoiceIdSessions(
      authMethods,
      new D1WalletAuthorityStore({ database, scope: SCOPE }),
      envelopes,
      new D1VoiceIdWalletSessionChallenges(database, SCOPE),
      authorization,
      SCOPE.orgId,
    );
    const voiceRoutes = {
      issueVoiceIdChallenge: voiceIdSessions.issueChallenge.bind(voiceIdSessions),
      verifyAndIssueVoiceId: voiceIdSessions.verifyAndIssue.bind(voiceIdSessions),
      hostedWalletOrigins: ['https://wallet.example.test'],
    };
    const challengeResponse = await handleVoiceIdChallengeRequest(voiceIdHttpRequest(
      '/wallet/voiceid/challenge',
      'https://wallet.example.test',
      { walletId: fixture.authority.walletId, walletAuthMethodId: methodId },
    ), voiceRoutes);
    expect(challengeResponse.status).toBe(200);
    const challengeBody = requireRecord(await challengeResponse.json(), 'VoiceID challenge response');
    const challenge = parseVoiceIdWalletSessionChallenge(challengeBody.challenge);
    const signature = await crypto.subtle.sign(
      'Ed25519',
      device.privateKey,
      voiceIdWalletSessionChallengeBytes(challenge),
    );
    const assertion = {
      kind: 'voiceid_device_assertion_v1',
      challenge,
      signatureB64u: base64UrlEncode(new Uint8Array(signature)),
    };
    const wrongVerifyOrigin = await handleVoiceIdVerifyRequest(voiceIdHttpRequest(
      '/wallet/voiceid/verify',
      'https://untrusted.example.test',
      { assertion },
    ), voiceRoutes);
    expect(wrongVerifyOrigin.status).toBe(403);
    const verifiedResponse = await handleVoiceIdVerifyRequest(voiceIdHttpRequest(
      '/wallet/voiceid/verify',
      'https://wallet.example.test',
      { assertion },
    ), voiceRoutes);
    expect(verifiedResponse.status).toBe(200);
    const verifiedBody = requireRecord(await verifiedResponse.json(), 'VoiceID verification response');
    const voiceCredential = parseWalletSessionOperationCredentialV1(
      verifiedBody.operationCredential,
    );
    const freshSession = await readActiveWalletSessionCredential(authorization, {
      tenantId: issued.session.tenantId,
      token: voiceCredential.token,
      nowMs: Date.now(),
    });
    if (!freshSession) throw new Error('VoiceID session credential was not active');
    expect(freshSession.authMethod.kind).toBe('voiceid');
    expect(freshSession.authorization.session.mintId).toBe(challenge.challengeId);
    expect(freshSession.authorization.session.walletSessionId).not.toBe(
      issued.session.walletSessionId,
    );
    const replayResponse = await handleVoiceIdVerifyRequest(voiceIdHttpRequest(
      '/wallet/voiceid/verify',
      'https://wallet.example.test',
      { assertion },
    ), voiceRoutes);
    expect(replayResponse.status).toBe(403);

    const reportPath = testInfo.outputPath('voiceid-activation.json');
    await writeFile(reportPath, `${JSON.stringify({
      schemaVersion: 'voiceid_activation_journey_v1',
      status: 'passed',
      walletId: String(fixture.authority.walletId),
      methodId: String(methodId),
      envelopeId: String(envelopeId),
      retiredSourceSessionId: String(issued.session.walletSessionId),
      freshVoiceIdSessionId: String(freshSession.authorization.session.walletSessionId),
      signedChallengeId: String(challenge.challengeId),
      cases: [
        'owner_session_http_activation_stores_method_and_envelope',
        'untrusted_origin_and_mismatched_device_key_rejected',
        'exact_activation_retry_returns_committed_method',
        'stored_envelope_opens_in_browser_wasm',
        'duplicate_device_key_rolls_back_envelope',
        'retired_owner_session_rolls_back_method_and_envelope',
        'voiceid_issues_fresh_session_after_source_retirement',
        'changed_origin_and_challenge_replay_rejected',
      ],
    }, null, 2)}\n`);
    await testInfo.attach('voiceid-activation.json', { path: reportPath, contentType: 'application/json' });
  } finally {
    await runtime.close();
  }
}

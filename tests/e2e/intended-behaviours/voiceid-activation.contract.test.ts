import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type TestInfo } from '@playwright/test';
import { buildFullOwnerPermissionsV1 } from '@shared/authorization/delegatedAuthority';
import { parseTenantId } from '@shared/authorization/capabilityKinds';
import {
  parseVoiceIdDeviceAssertion,
  parseVoiceIdDevicePublicKeyB64u,
  voiceIdWalletSessionChallengeBytes,
} from '@shared/authorization/voiceIdDeviceAssertion';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { sha256DigestB64u } from '@shared/utils/canonicalPrimitives';
import { allocateWalletAuthMethodId, parsePasskeyEnvelopeId } from '@shared/utils/domainIds';
import {
  custodyEnvelopeBindingJsonV1,
  type VoiceIdSeedEnvelope,
} from '@shared/passkey-custody/custodyEnvelope';
import { D1WalletAuthMethodStore, prepareD1WalletAuthMethodV2PutStatement } from '@server/core/d1WalletAuthMethodStore';
import { VoiceIdHttpClient, type VoiceIdVerifiedSession } from '@/plugins/voiceid/session/httpClient';
import { verifyVoiceIdChallengeWithDevice } from '@/plugins/voiceid/session/unlockFromDevice';
import {
  activateVoiceIdForUnlockedWallet,
  type VoiceIdSeedResealPort,
} from '@/plugins/voiceid/session/activation';
import {
  captureVoiceIdActivation,
  captureVoiceIdUnlock,
} from '@/plugins/voiceid/capture/deviceBridge';
import { VoiceIdActivationStore, type VoiceIdActivationStoragePort } from '@/plugins/voiceid/session/activationStore';
import type { ActiveVoiceIdWalletAuthMethodRecordV2 } from '@shared/utils/walletAuthMethodRecord';
import type { UnlockedWalletEd25519ExportRootCapabilityV1 } from '@/core/signingEngine/workerManager/workerTypes';
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

class VoiceIdRouteTransport {
  constructor(
    private readonly activation: Parameters<typeof handleVoiceIdActivationRequest>[1],
    private readonly sessions: Parameters<typeof handleVoiceIdChallengeRequest>[1] &
      Parameters<typeof handleVoiceIdVerifyRequest>[1],
    private readonly walletOrigin: string,
  ) {}

  async send(request: Request): Promise<Response> {
    const headers = new Headers(request.headers);
    headers.set('Origin', this.walletOrigin);
    const forwarded = new Request(request, { headers });
    switch (new URL(request.url).pathname) {
      case '/wallet/voiceid/activate':
        return await handleVoiceIdActivationRequest(forwarded, this.activation);
      case '/wallet/voiceid/challenge':
        return await handleVoiceIdChallengeRequest(forwarded, this.sessions);
      case '/wallet/voiceid/verify':
        return await handleVoiceIdVerifyRequest(forwarded, this.sessions);
      default:
        throw new Error('VoiceID test sent an unknown HTTP route');
    }
  }
}

class TestVoiceIdCapture {
  calls = 0;

  constructor(private readonly device: TestDeviceKey) {}

  async capture(
    _input: Parameters<typeof captureVoiceIdActivation>[0],
  ): ReturnType<typeof captureVoiceIdActivation> {
    this.calls += 1;
    return {
      kind: 'activated',
      publicKeyB64u: this.device.publicKeyB64u,
      deviceKeyId: this.device.deviceKeyId,
      factorSecret32: new Uint8Array(32).fill(11),
    };
  }
}

class RustSealedVoiceIdReseal {
  calls = 0;

  constructor(private readonly envelope: VoiceIdSeedEnvelope) {}

  async reseal(input: Parameters<VoiceIdSeedResealPort>[0]): Promise<unknown> {
    this.calls += 1;
    expect(input.bindingJson).toBe(custodyEnvelopeBindingJsonV1(this.envelope));
    expect([...new Uint8Array(input.factorSecret)]).toEqual([...new Uint8Array(32).fill(11)]);
    new Uint8Array(input.factorSecret).fill(0);
    return {
      nonceB64u: this.envelope.nonceB64u,
      sealedCustodySecretB64u: this.envelope.sealedCustodySecretB64u,
      aadHashB64u: this.envelope.aadHashB64u,
      ciphertextDigestB64u: this.envelope.ciphertextDigestB64u,
    };
  }
}

class MemoryActivationStorage implements VoiceIdActivationStoragePort {
  private readonly entries = new Map<string, unknown>();
  private readonly methods = new Map<string, ActiveVoiceIdWalletAuthMethodRecordV2>();

  async getAppState(key: string): Promise<unknown | undefined> {
    return this.entries.get(key);
  }

  async setAppState(key: string, value: unknown): Promise<void> {
    this.entries.set(key, JSON.parse(JSON.stringify(value)));
  }

  async listAppStateEntriesByPrefix(
    prefix: string,
  ): Promise<ReadonlyArray<{ key: string; value: unknown }>> {
    const matching: Array<{ key: string; value: unknown }> = [];
    for (const [key, value] of this.entries) {
      if (key.startsWith(prefix)) matching.push({ key, value });
    }
    return matching;
  }

  async upsertWalletAuthMethodV2(method: ActiveVoiceIdWalletAuthMethodRecordV2): Promise<void> {
    this.methods.set(method.walletAuthMethodId, method);
  }

  readMethod(walletAuthMethodId: string): ActiveVoiceIdWalletAuthMethodRecordV2 | null {
    return this.methods.get(walletAuthMethodId) ?? null;
  }
}

class LostFirstVoiceIdActivationReply {
  private first = true;

  constructor(private readonly client: VoiceIdHttpClient) {}

  async activate(input: Parameters<VoiceIdHttpClient['activate']>[0]): ReturnType<VoiceIdHttpClient['activate']> {
    const method = await this.client.activate(input);
    if (this.first) {
      this.first = false;
      throw new Error('VoiceID test reply was lost after server commit');
    }
    return method;
  }
}

function unlockedSeedCapabilityForTest(input: {
  readonly walletId: string;
  readonly sourceMethodId: string;
  readonly walletSessionId: string;
}): UnlockedWalletEd25519ExportRootCapabilityV1 {
  return {
    kind: 'unlocked_wallet_ed25519_export_root_capability_v1',
    capabilityHandleId: 'voiceid-test-unlocked-seed',
    walletId: input.walletId,
    walletAuthMethodId: input.sourceMethodId,
    walletSessionId: input.walletSessionId,
    expiresAtMs: Date.now() + 60_000,
  };
}

function onVoiceListening(): void {}

class GeneratedVoiceIdCapture {
  factorSecret32: Uint8Array | null = null;

  constructor(
    private readonly privateKey: CryptoKey,
    private readonly abortAfterCapture: AbortController | null,
  ) {}

  async capture(
    input: Parameters<typeof captureVoiceIdUnlock>[0],
  ): ReturnType<typeof captureVoiceIdUnlock> {
    input.onListening();
    const signature = await crypto.subtle.sign(
      'Ed25519',
      this.privateKey,
      voiceIdWalletSessionChallengeBytes(input.challenge),
    );
    this.factorSecret32 = new Uint8Array(32).fill(11);
    this.abortAfterCapture?.abort();
    return {
      kind: 'unlocked',
      assertion: parseVoiceIdDeviceAssertion({
        kind: 'voiceid_device_assertion_v1',
        challenge: input.challenge,
        signatureB64u: base64UrlEncode(new Uint8Array(signature)),
      }),
      factorSecret32: this.factorSecret32,
    };
  }
}

class VerifiedVoiceIdSessionInstaller {
  factorSecret32: Uint8Array | null = null;

  async install(
    verified: VoiceIdVerifiedSession,
    factorSecret32: Uint8Array,
  ): Promise<VoiceIdVerifiedSession> {
    this.factorSecret32 = factorSecret32;
    expect([...factorSecret32]).toEqual([...new Uint8Array(32).fill(11)]);
    return verified;
  }
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
    const authorities = new D1WalletAuthorityStore({ database, scope: SCOPE });
    const voiceIdSessions = new D1VoiceIdSessions(
      authMethods,
      authorities,
      envelopes,
      new D1VoiceIdWalletSessionChallenges(database, SCOPE),
      authorization,
      SCOPE.orgId,
    );
    const voiceRoutes = {
      prepareNear: unavailableNearInstallation,
      issueVoiceIdChallenge: voiceIdSessions.issueChallenge.bind(voiceIdSessions),
      verifyAndIssueVoiceId: voiceIdSessions.verifyAndIssue.bind(voiceIdSessions),
      hostedWalletOrigins: ['https://wallet.example.test'],
    };
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
    const transport = new VoiceIdRouteTransport(route, voiceRoutes, 'https://wallet.example.test');
    const client = new VoiceIdHttpClient(
      'https://router.example.test',
      'https://wallet.example.test',
      transport.send.bind(transport),
    );
    const signal = new AbortController().signal;
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
    const activated = await client.activate({
      ownerCredential: issued.operationCredential,
      walletId: fixture.authority.walletId,
      walletAuthMethodId: methodId,
      devicePublicKeyB64u: device.publicKeyB64u,
      deviceKeyId: device.deviceKeyId,
      custodyEnvelope: envelope,
      signal,
    });
    expect(activated.deviceKeyId).toBe(device.deviceKeyId);
    const exactRetry = await client.activate({
      ownerCredential: issued.operationCredential,
      walletId: fixture.authority.walletId,
      walletAuthMethodId: methodId,
      devicePublicKeyB64u: device.publicKeyB64u,
      deviceKeyId: device.deviceKeyId,
      custodyEnvelope: envelope,
      signal,
    });
    expect(exactRetry.walletAuthMethodId).toBe(methodId);
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

    const retriedDevice = await generateTestDeviceKey();
    const retriedMethodId = allocateWalletAuthMethodId(randomUUID());
    const retriedEnvelopeId = requireEnvelopeId(`wallet-custody-envelope:${randomUUID()}`);
    const retriedRustEnvelope = await sealForTest({
      testInfo,
      label: 'interrupted-activation-seal',
      walletId: String(fixture.authority.walletId),
      methodId: String(retriedMethodId),
      envelopeId: String(retriedEnvelopeId),
      deviceKeyId: String(retriedDevice.deviceKeyId),
    });
    const retriedCapture = new TestVoiceIdCapture(retriedDevice);
    const retriedReseal = new RustSealedVoiceIdReseal(retriedRustEnvelope);
    const localStorage = new MemoryActivationStorage();
    const pendingStore = new VoiceIdActivationStore(localStorage);
    const lostReply = new LostFirstVoiceIdActivationReply(client);
    const sharedActivation = {
      ownerCredential: issued.operationCredential,
      http: lostReply,
      signal,
      onListening: onVoiceListening,
      capture: retriedCapture.capture.bind(retriedCapture),
      persistPending: pendingStore.persistPending.bind(pendingStore),
      persistActive: pendingStore.persistActive.bind(pendingStore),
    };
    await expect(activateVoiceIdForUnlockedWallet({
      ...sharedActivation,
      plan: {
        kind: 'new',
        walletId: fixture.authority.walletId,
        walletAuthMethodId: retriedMethodId,
        envelopeId: retriedEnvelopeId,
        capability: unlockedSeedCapabilityForTest({
          walletId: String(fixture.authority.walletId),
          sourceMethodId: String(fixture.authMethod.walletAuthMethodId),
          walletSessionId: String(issued.session.walletSessionId),
        }),
        reseal: retriedReseal.reseal.bind(retriedReseal),
      },
    })).rejects.toThrow('reply was lost');
    const pending = await pendingStore.readPending(
      fixture.authority.walletId,
      retriedMethodId,
    );
    if (!pending) throw new Error('VoiceID pending activation was not retained');
    expect((await pendingStore.listPending(fixture.authority.walletId)).length).toBe(1);
    const resumed = await activateVoiceIdForUnlockedWallet({
      ...sharedActivation,
      plan: { kind: 'resume', pending },
    });
    expect(resumed.authMethod.walletAuthMethodId).toBe(retriedMethodId);
    expect(localStorage.readMethod(retriedMethodId)?.walletAuthMethodId).toBe(retriedMethodId);
    expect((await pendingStore.listPending(fixture.authority.walletId)).length).toBe(0);
    expect(retriedCapture.calls).toBe(2);
    expect(retriedReseal.calls).toBe(1);
    const retriedStored = await envelopes.lookupEnvelopeForWalletAuthMethod({
      walletId: fixture.authority.walletId,
      walletAuthMethodId: retriedMethodId,
      factor: { kind: 'voiceid', deviceKeyId: retriedDevice.deviceKeyId },
    });
    if (retriedStored.kind !== 'active') {
      throw new Error('Retried VoiceID envelope did not commit');
    }
    const retriedFactorSecret = new Uint8Array(32).fill(11);
    try {
      const handle = passkey_custody_open_wallet_seed_v1(
        retriedFactorSecret,
        custodyEnvelopeBindingJsonV1(retriedStored.envelope),
        base64UrlDecode(retriedStored.envelope.nonceB64u),
        retriedStored.envelope.sealedCustodySecretB64u,
        retriedStored.envelope.aadHashB64u,
        retriedStored.envelope.ciphertextDigestB64u,
      );
      handle.destroy();
    } finally {
      retriedFactorSecret.fill(0);
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

    const challenge = await client.challenge({
      walletId: fixture.authority.walletId,
      walletAuthMethodId: methodId,
      signal,
    });
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
    const verified = await client.verify({
      assertion: parseVoiceIdDeviceAssertion(assertion),
      signal,
    });
    const voiceCredential = verified.operationCredential;
    expect(verified.walletSession.authMethodId).toBe(methodId);
    expect(verified.custodyEnvelope.envelopeId).toBe(envelopeId);
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
    const deviceCapture = new GeneratedVoiceIdCapture(device.privateKey, null);
    const installer = new VerifiedVoiceIdSessionInstaller();
    const verifiedFromDevice = await verifyVoiceIdChallengeWithDevice({
      authMethod: activated,
      challenge: await client.challenge({
        walletId: fixture.authority.walletId,
        walletAuthMethodId: methodId,
        signal,
      }),
      http: client,
      capture: deviceCapture.capture.bind(deviceCapture),
      install: installer.install.bind(installer),
      signal,
      onListening: onVoiceListening,
    });
    expect(verifiedFromDevice.walletSession.authMethodId).toBe(methodId);
    expect(verifiedFromDevice.custodyEnvelope.envelopeId).toBe(envelopeId);
    expect(installer.factorSecret32?.every((value) => value === 0)).toBe(true);
    const cancelledController = new AbortController();
    const cancelledCapture = new GeneratedVoiceIdCapture(device.privateKey, cancelledController);
    const cancelledChallenge = await client.challenge({
      walletId: fixture.authority.walletId,
      walletAuthMethodId: methodId,
      signal,
    });
    await expect(verifyVoiceIdChallengeWithDevice({
      authMethod: activated,
      challenge: cancelledChallenge,
      http: client,
      capture: cancelledCapture.capture.bind(cancelledCapture),
      install: installer.install.bind(installer),
      signal: cancelledController.signal,
      onListening: onVoiceListening,
    })).rejects.toThrow('cancelled');
    expect(cancelledCapture.factorSecret32?.every((value) => value === 0)).toBe(true);
    const afterCancelSignature = await crypto.subtle.sign(
      'Ed25519',
      device.privateKey,
      voiceIdWalletSessionChallengeBytes(cancelledChallenge),
    );
    const afterCancelVerification = await client.verify({
      assertion: parseVoiceIdDeviceAssertion({
        kind: 'voiceid_device_assertion_v1',
        challenge: cancelledChallenge,
        signatureB64u: base64UrlEncode(new Uint8Array(afterCancelSignature)),
      }),
      signal,
    });
    expect(afterCancelVerification.walletSession.authMethodId).toBe(methodId);
    const replayResponse = await handleVoiceIdVerifyRequest(voiceIdHttpRequest(
      '/wallet/voiceid/verify',
      'https://wallet.example.test',
      { assertion },
    ), voiceRoutes);
    expect(replayResponse.status).toBe(403);

    const pendingRevocationChallenge = await client.challenge({
      walletId: fixture.authority.walletId,
      walletAuthMethodId: methodId,
      signal,
    });
    const pendingRevocationSignature = await crypto.subtle.sign(
      'Ed25519',
      device.privateKey,
      voiceIdWalletSessionChallengeBytes(pendingRevocationChallenge),
    );
    const revoked = await authorities.revokeWalletAuthMethod({
      walletId: fixture.authority.walletId,
      authorityId: fixture.authority.authorityId,
      walletAuthMethodId: methodId,
      expectedAuthorityRevocationEpoch: fixture.authority.revocationEpoch,
      requestedAtMs: Math.max(Date.now(), activated.updatedAtMs + 1),
    });
    if (revoked.kind !== 'revoked_method') {
      throw new Error(`VoiceID method revocation failed: ${revoked.kind}`);
    }
    expect(revoked.authMethod.kind).toBe('voiceid');
    expect(revoked.authority.state).toBe('active');
    expect((await authMethods.readByIdV2({
      walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
    }))?.status).toBe('active');
    const revokedAssertion = parseVoiceIdDeviceAssertion({
      kind: 'voiceid_device_assertion_v1',
      challenge: pendingRevocationChallenge,
      signatureB64u: base64UrlEncode(new Uint8Array(pendingRevocationSignature)),
    });
    await expect(client.verify({ assertion: revokedAssertion, signal })).rejects.toThrow('HTTP 403');
    await expect(client.challenge({
      walletId: fixture.authority.walletId,
      walletAuthMethodId: methodId,
      signal,
    })).rejects.toThrow('HTTP 403');

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
        'typed_client_activates_method_and_envelope_over_http',
        'untrusted_origin_and_mismatched_device_key_rejected',
        'exact_activation_retry_returns_committed_method',
        'stored_envelope_opens_in_browser_wasm',
        'interrupted_activation_retries_exact_pending_envelope_without_reseal',
        'duplicate_device_key_rolls_back_envelope',
        'retired_owner_session_rolls_back_method_and_envelope',
        'typed_client_reads_fresh_voiceid_session_after_source_retirement',
        'device_capture_and_server_verification_handoff_erases_factor_secret',
        'cancel_after_capture_erases_factor_without_consuming_server_challenge',
        'changed_origin_and_challenge_replay_rejected',
        'revoked_voiceid_method_blocks_pending_and_new_challenges_while_owner_authority_survives',
      ],
    }, null, 2)}\n`);
    await testInfo.attach('voiceid-activation.json', { path: reportPath, contentType: 'application/json' });
  } finally {
    await runtime.close();
  }
}

async function unavailableNearInstallation(): Promise<{ readonly kind: 'unavailable' }> {
  return { kind: 'unavailable' };
}

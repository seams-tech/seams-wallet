import { expect, test } from '@playwright/test';
import {
  spokenIntentRequestDigestB64u,
  spokenTextDigestB64u,
  voiceVaultTransferRequestBorsh,
} from '@shared/authorization/spokenIntentRequest';
import {
  parseVoiceIdIntentStatement,
  parseVoiceIdOperationStatement,
  voiceIdIntentStatementBytes,
} from '@shared/authorization/voiceIdDeviceAssertion';
import { sha256DigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  verifyVoiceIdIntentAssertion,
  type VerifiedVoiceIdIntentProof,
  type VerifiedVoiceIdOperationProof,
} from '../../packages/wallet-server/src/authorization/voiceIdDeviceProof';
import {
  createVoiceIntentRelayRouteExtensions,
  InMemoryVoiceIntentRelayStore,
  type VoiceIntentRelayConfig,
} from '../../packages/wallet-server/src/router/domains/voiceId/voiceIntentRelay';
import { findRouteDefinitionForRequest } from '../../packages/wallet-server/src/router/framework/routeDefinitions';
import type {
  RouterApiFetchRouteExtensionInput,
  RouterApiRouteExtension,
} from '../../packages/wallet-server/src/router/framework/routeExtensions';
import {
  buildVoiceIdIntentAssertionFixture,
  buildVoiceIdIntentDeviceFixture,
  decodeVaultTransferVector,
  digestFromHex,
  hexBytes,
  vaultTransferVectors,
  vectorRenderer,
  VOICE_INTENT_REQUEST_ORIGIN,
  type VoiceIdIntentDeviceFixture,
} from './helpers/voiceIdIntent.fixtures';

const NOW_MS = 1_800_000_000_000;
const ENABLED: VoiceIntentRelayConfig = {
  kind: 'enabled',
  network: 'testnet',
  allowedRequestOrigins: [VOICE_INTENT_REQUEST_ORIGIN],
};

function firstVector() {
  const vector = vaultTransferVectors()[0];
  if (!vector) throw new Error('The golden vectors have no vault transfer');
  return vector;
}

function ciphertext(length: number, fill = 7): Uint8Array<ArrayBuffer> {
  return new Uint8Array(length).fill(fill);
}

class RelayHarness {
  nowMs = NOW_MS;
  readonly store = new InMemoryVoiceIntentRelayStore(4);
  readonly extension: RouterApiRouteExtension;

  constructor(
    device: VoiceIdIntentDeviceFixture | null,
    config: VoiceIntentRelayConfig = ENABLED,
  ) {
    const [extension] = createVoiceIntentRelayRouteExtensions(config, {
      blobs: this.store,
      intentUses: this.store,
      renderer: vectorRenderer(),
      findDeviceKey: async (input) =>
        device && input.deviceKeyId === device.registered.deviceKeyId ? device.registered : null,
      now: () => this.nowMs,
    });
    if (!extension) throw new Error('The relay routes were not created');
    this.extension = extension;
  }

  async call(method: string, path: string, body?: BodyInit): Promise<Response> {
    const route = findRouteDefinitionForRequest(this.extension.routes, method, path);
    if (!route) return new Response(null, { status: 404 });
    const request = new Request(`https://relay.example.test${path}`, { method, body });
    return await this.extension.handleFetchRoute({
      request,
      route,
      pathname: path,
      method,
    } as RouterApiFetchRouteExtensionInput);
  }

  async putBlob(bytes: Uint8Array<ArrayBuffer>): Promise<{ digest: DigestB64u; response: Response }> {
    const digest = await sha256DigestB64u(bytes);
    return { digest, response: await this.call('PUT', `/voice-relay/v1/blob/${digest}`, bytes) };
  }
}

function intentCheckBody(assertion: unknown, audioDigest: DigestB64u, amountYocto?: bigint) {
  const request = decodeVaultTransferVector(firstVector());
  return JSON.stringify({
    assertion,
    audioDigest,
    request: {
      vault: request.vault,
      owner: request.owner,
      receiver: request.receiver,
      amountYocto: String(amountYocto ?? request.amountYocto),
      nonce: String(request.nonce),
    },
  });
}

test.describe('spoken-intent request digest in TypeScript', () => {
  test('matches every vault transfer golden vector from the Rust crate', async () => {
    const vectors = vaultTransferVectors();
    expect(vectors.length).toBeGreaterThan(5);
    for (const vector of vectors) {
      const bytes = voiceVaultTransferRequestBorsh(decodeVaultTransferVector(vector));
      expect(bytes, vector.name).toEqual(hexBytes(vector.borsh_hex));
      expect(await spokenIntentRequestDigestB64u(bytes), vector.name).toBe(
        digestFromHex(vector.request_digest_hex),
      );
      expect(await spokenTextDigestB64u(vector.spoken_text), vector.name).toBe(
        digestFromHex(vector.spoken_text_digest_hex),
      );
    }
  });
});

test.describe('voiceid_intent_statement_v1 parsing', () => {
  test('refuses extra keys, operation statements and the other domain', async () => {
    const device = await buildVoiceIdIntentDeviceFixture();
    const { statement } = await buildVoiceIdIntentAssertionFixture({
      device,
      vector: firstVector(),
      audioDigest: await sha256DigestB64u(ciphertext(32)),
      nowMs: NOW_MS,
    });
    expect(parseVoiceIdIntentStatement({ ...statement })).toEqual(statement);
    expect(() => parseVoiceIdIntentStatement({ ...statement, extra: true })).toThrow();
    expect(() => parseVoiceIdOperationStatement(statement)).toThrow();
    const { rendererVersion: _r, spokenTextDigest: _s, heardText: _h, audioDigest: _a, ...rest } =
      statement;
    const operationShaped = { ...rest, kind: 'voiceid_operation_statement_v1' };
    expect(() => parseVoiceIdIntentStatement(operationShaped)).toThrow();
    expect(() =>
      parseVoiceIdIntentStatement({ ...statement, expiresAtMs: statement.issuedAtMs + 60_001 }),
    ).toThrow();
    expect(() => parseVoiceIdIntentStatement({ ...statement, heardText: 'x'.repeat(257) })).toThrow();
    const signed = new TextDecoder().decode(voiceIdIntentStatementBytes(statement));
    expect(signed.startsWith('seams:wallet-operation:voiceid-intent:v1|{')).toBe(true);
  });
});

test.describe('verifyVoiceIdIntentAssertion', () => {
  async function verify(overrides: {
    statement?: Parameters<typeof buildVoiceIdIntentAssertionFixture>[0]['overrides'];
    audioDigest?: DigestB64u;
    requestBorsh?: Uint8Array;
  }) {
    const device = await buildVoiceIdIntentDeviceFixture();
    const vector = firstVector();
    const audioDigest = await sha256DigestB64u(ciphertext(64));
    const assertion = await buildVoiceIdIntentAssertionFixture({
      device,
      vector,
      audioDigest,
      nowMs: NOW_MS,
      overrides: overrides.statement,
    });
    const store = new InMemoryVoiceIntentRelayStore();
    const run = () =>
      verifyVoiceIdIntentAssertion({
        registered: device.registered,
        assertion,
        operationKind: 'near.voice_vault_transfer',
        requestBorsh: overrides.requestBorsh ?? hexBytes(vector.borsh_hex),
        audioDigest: overrides.audioDigest ?? audioDigest,
        requestOrigin: VOICE_INTENT_REQUEST_ORIGIN,
        renderer: vectorRenderer(),
        nowMs: NOW_MS + 1_000,
        consumeIntent: (challenge, expiresAtMs, nowMs) =>
          store.consume(challenge, expiresAtMs, nowMs),
      });
    return { run, vector };
  }

  test('returns an intent proof once for the signed request', async () => {
    const { run, vector } = await verify({});
    const proof: VerifiedVoiceIdIntentProof = await run();
    expect(proof.statement.operationChallenge).toBe(digestFromHex(vector.request_digest_hex));
    expect(proof.spokenText).toBe(vector.spoken_text);
    // @ts-expect-error An intent proof is not an operation proof.
    const operationProof: VerifiedVoiceIdOperationProof = proof;
    void operationProof;
    await expect(run()).rejects.toThrow('already used');
  });

  test('refuses another request, heard text, audio or spoken text digest', async () => {
    const other = vaultTransferVectors()[1];
    if (!other) throw new Error('The golden vectors need two vault transfers');
    await expect((await verify({ requestBorsh: hexBytes(other.borsh_hex) })).run()).rejects.toThrow(
      'different request',
    );
    await expect(
      (await verify({ statement: { heardText: 'send fifteen near to alice dot testnet' } })).run(),
    ).rejects.toThrow('heard text');
    await expect(
      (await verify({ audioDigest: await sha256DigestB64u(ciphertext(64, 9)) })).run(),
    ).rejects.toThrow('does not match');
    await expect(
      (
        await verify({
          statement: { spokenTextDigest: digestFromHex(other.spoken_text_digest_hex) },
        })
      ).run(),
    ).rejects.toThrow('spoken text');
  });
});

test.describe('voice intent relay routes', () => {
  test('exist only when the configuration enables them', () => {
    const dependencies = {
      blobs: new InMemoryVoiceIntentRelayStore(),
      intentUses: new InMemoryVoiceIntentRelayStore(),
      renderer: vectorRenderer(),
      findDeviceKey: async () => null,
    };
    expect(createVoiceIntentRelayRouteExtensions({ kind: 'disabled' }, dependencies)).toEqual([]);
    expect(() =>
      createVoiceIntentRelayRouteExtensions({ ...ENABLED, blobTtlMs: 300_001 }, dependencies),
    ).toThrow('5 minutes');
  });

  test('keeps one ciphertext for one read', async () => {
    const relay = new RelayHarness(null);
    const bytes = ciphertext(1_000);
    const { digest, response } = await relay.putBlob(bytes);
    expect(response.status).toBe(201);
    expect((await relay.putBlob(bytes)).response.status).toBe(409);
    const first = await relay.call('GET', `/voice-relay/v1/blob/${digest}`);
    expect(first.status).toBe(200);
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(bytes);
    expect((await relay.call('GET', `/voice-relay/v1/blob/${digest}`)).status).toBe(404);
  });

  test('refuses a wrong digest, an oversize body and a full store', async () => {
    const relay = new RelayHarness(null);
    const wrong = await sha256DigestB64u(ciphertext(10, 1));
    expect((await relay.call('PUT', `/voice-relay/v1/blob/${wrong}`, ciphertext(10, 2))).status).toBe(
      400,
    );
    expect((await relay.call('PUT', '/voice-relay/v1/blob/not-a-digest', ciphertext(10))).status).toBe(
      400,
    );
    expect((await relay.putBlob(ciphertext(262_145))).response.status).toBe(413);
    for (let fill = 10; fill < 14; fill += 1) {
      expect((await relay.putBlob(ciphertext(10, fill))).response.status).toBe(201);
    }
    expect((await relay.putBlob(ciphertext(10, 20))).response.status).toBe(503);
  });

  test('drops a ciphertext after 5 minutes', async () => {
    const relay = new RelayHarness(null);
    const { digest } = await relay.putBlob(ciphertext(100));
    relay.nowMs += 5 * 60_000;
    expect((await relay.call('GET', `/voice-relay/v1/blob/${digest}`)).status).toBe(404);
  });

  test('checks a signed intent against the request digest once', async () => {
    const device = await buildVoiceIdIntentDeviceFixture();
    const relay = new RelayHarness(device);
    const { digest: audioDigest } = await relay.putBlob(ciphertext(2_000));
    const assertion = await buildVoiceIdIntentAssertionFixture({
      device,
      vector: firstVector(),
      audioDigest,
      nowMs: NOW_MS,
    });
    const path = '/voice-relay/v1/intent-check';

    const changedAmount = await relay.call(
      'POST',
      path,
      intentCheckBody(assertion, audioDigest, 26_000_000_000_000_000_000_000_000n),
    );
    expect(changedAmount.status).toBe(403);
    expect(await changedAmount.json()).toEqual({ ok: false, code: 'intent_rejected' });

    const accepted = await relay.call('POST', path, intentCheckBody(assertion, audioDigest));
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      ok: true,
      kind: 'voiceid_intent_verified',
      operationChallenge: assertion.statement.operationChallenge,
      audioDigest,
    });
    expect((await relay.call('POST', path, intentCheckBody(assertion, audioDigest))).status).toBe(403);
    expect((await relay.call('POST', path, '{"assertion":{}}')).status).toBe(400);
  });
});

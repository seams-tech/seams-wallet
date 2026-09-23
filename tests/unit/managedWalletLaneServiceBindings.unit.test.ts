import { expect, test } from '@playwright/test';
import { base64UrlDecode, base64UrlEncode } from '../../packages/shared-ts/src/utils/encoders';
import { MANAGED_WALLET_LANES } from '../../packages/shared-ts/src/wallet-region';
import {
  buildVerifiedManagedWalletLaneConfiguration,
  walletLaneServiceBindingNameFromString,
  type ManagedWalletLaneCatalogStore,
  type WalletHomeLaneDirectoryRecord,
  type WalletHomeLaneDirectoryStore,
} from '../../packages/wallet-server/src/core/walletRegion';
import {
  createEd25519WalletLaneInternalRequestTokenIssuerV1,
  createManagedWalletLaneServiceBindingFetch,
  MANAGED_WALLET_LANE_ROUTER_ORIGIN,
  WALLET_LANE_INTERNAL_REQUEST_HEADER_V1,
} from '../../packages/wallet-server/src/router/cloudflare/runtime/managedWalletLaneServiceBindings';
import type { CloudflareServiceBindingFetcher } from '../../packages/wallet-server/src/router/cloudflare/runtime/routerAbServiceBindings';
import { buildWalletLaneAdmissionFixture } from './helpers/walletRegion.fixtures';

const TEST_PRIVATE_JWK = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: base64UrlEncode(
    hexBytes('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'),
  ),
  d: base64UrlEncode(
    hexBytes('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60'),
  ),
} as const;

function hexBytes(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function directoryStore(
  record: WalletHomeLaneDirectoryRecord | null,
): Pick<WalletHomeLaneDirectoryStore, 'getHomeLane'> {
  return {
    async getHomeLane(): Promise<WalletHomeLaneDirectoryRecord | null> {
      return record;
    },
  };
}

function catalogStore(
  configuration: Awaited<ReturnType<ManagedWalletLaneCatalogStore['getActiveConfiguration']>>,
): Pick<ManagedWalletLaneCatalogStore, 'getActiveConfiguration'> {
  return {
    async getActiveConfiguration() {
      return configuration;
    },
  };
}

function verifiedNorthAmericaConfiguration() {
  return buildVerifiedManagedWalletLaneConfiguration({
    laneId: MANAGED_WALLET_LANES.north_america.laneId,
    productRegion: 'north_america',
    status: 'available',
    placementEvidence: {
      kind: 'verified',
      recordedAtMs: 1_000,
      observedD1Location: 'ENAM',
      maximumWriteLatencyMs: 40,
    },
    bindings: {
      routerBinding: walletLaneServiceBindingNameFromString('MANAGED_NA_ROUTER'),
      deriverABinding: walletLaneServiceBindingNameFromString('MANAGED_NA_DERIVER_A'),
      deriverBBinding: walletLaneServiceBindingNameFromString('MANAGED_NA_DERIVER_B'),
      signingWorkerBinding: walletLaneServiceBindingNameFromString('MANAGED_NA_SIGNING_WORKER'),
    },
    configurationVersion: 1,
  });
}

async function verifyTokenSignature(token: string): Promise<boolean> {
  const [header, payload, signature, extra] = token.split('.');
  if (!header || !payload || !signature || extra) return false;
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: TEST_PRIVATE_JWK.kty, crv: TEST_PRIVATE_JWK.crv, x: TEST_PRIVATE_JWK.x },
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  return await crypto.subtle.verify(
    { name: 'Ed25519' },
    key,
    copyToArrayBuffer(base64UrlDecode(signature)),
    new TextEncoder().encode(`${header}.${payload}`),
  );
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(bytes.length);
  new Uint8Array(output).set(bytes);
  return output;
}

function decodeTokenPayload(token: string): unknown {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('test token has no payload');
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
}

test.describe('managed wallet lane service bindings', () => {
  test('routes through the directory-owned binding and signs the exact internal request', async () => {
    const fixture = buildWalletLaneAdmissionFixture({ authorityKind: 'active' });
    let received: Request | null = null;
    const routerBinding: CloudflareServiceBindingFetcher = {
      async fetch(request): Promise<Response> {
        received = new Request(request);
        return new Response('routed', { status: 202 });
      },
    };
    const fetch = createManagedWalletLaneServiceBindingFetch({
      walletId: fixture.context.walletId,
      directory: directoryStore(fixture.directory),
      catalog: catalogStore(verifiedNorthAmericaConfiguration()),
      bindings: { MANAGED_NA_ROUTER: routerBinding },
      tokenIssuer: createEd25519WalletLaneInternalRequestTokenIssuerV1({
        privateJwk: TEST_PRIVATE_JWK,
        keyId: 'wallet-lane-test-key',
        issuer: 'https://wallet-gateway.test',
        audience: 'wallet-lane-workers',
        lifetimeMs: 10_000,
        now: () => 20_000,
      }),
    });
    const requestBody = JSON.stringify({ command: 'prepare' });
    const requestBodyDigest = base64UrlEncode(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(requestBody))),
    );

    const response = await fetch(`${MANAGED_WALLET_LANE_ROUTER_ORIGIN}/commands?phase=prepare`, {
      method: 'POST',
      headers: { [WALLET_LANE_INTERNAL_REQUEST_HEADER_V1]: 'client-selected-token' },
      body: requestBody,
    });

    expect(response.status).toBe(202);
    expect(received).not.toBeNull();
    const token = received?.headers.get(WALLET_LANE_INTERNAL_REQUEST_HEADER_V1) ?? '';
    expect(token).not.toBe('client-selected-token');
    expect(await verifyTokenSignature(token)).toBe(true);
    expect(decodeTokenPayload(token)).toMatchObject({
      iss: 'https://wallet-gateway.test',
      aud: 'wallet-lane-workers',
      iat_ms: 20_000,
      exp_ms: 30_000,
      wallet_lane_context: {
        wallet_id: fixture.context.walletId,
        lane_id: fixture.context.laneId,
        lane_epoch: fixture.context.laneEpoch,
        directory_revision: fixture.context.directoryRevision,
      },
      service_role: 'router',
      request_method: 'POST',
      request_target: '/commands?phase=prepare',
      request_body_sha256_b64u: requestBodyDigest,
    });
  });

  test('rejects a lane whose deployment-owned binding is absent', async () => {
    const fixture = buildWalletLaneAdmissionFixture({ authorityKind: 'active' });
    const fetch = createManagedWalletLaneServiceBindingFetch({
      walletId: fixture.context.walletId,
      directory: directoryStore(fixture.directory),
      catalog: catalogStore(verifiedNorthAmericaConfiguration()),
      bindings: {},
      tokenIssuer: createEd25519WalletLaneInternalRequestTokenIssuerV1({
        privateJwk: TEST_PRIVATE_JWK,
        keyId: 'wallet-lane-test-key',
        issuer: 'https://wallet-gateway.test',
        audience: 'wallet-lane-workers',
      }),
    });

    await expect(fetch(`${MANAGED_WALLET_LANE_ROUTER_ORIGIN}/commands`)).rejects.toThrow(
      'managed wallet lane service binding MANAGED_NA_ROUTER is unavailable',
    );
  });
});

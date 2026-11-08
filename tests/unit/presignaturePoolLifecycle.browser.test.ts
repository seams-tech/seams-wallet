import { expect, test, type Page, type Route } from '@playwright/test';
import { setupBasicPasskeyTest } from '../setup';
import { build } from 'esbuild';
import path from 'node:path';

type PoolScenario = 'hydrate_after_clear' | 'hydrate_during_reservation';

type PoolScenarioResult = {
  readonly listCalls: number;
  readonly reservedHandles: readonly string[];
  readonly results: readonly string[];
};

/**
 * Runs in the page. The Client signing material and the evm crypto worker
 * are fakes, and every relayer request fails, so a signing attempt ends after
 * it reserves a presignature or after its foreground refill fails.
 */
async function runPoolScenarioInPage(scenario: PoolScenario): Promise<PoolScenarioResult> {
  const probePath = '/__presignature-pool.js';
  const { pool } = await import(probePath);

  window.fetch = async () => {
    throw new Error('relayer is offline in this test');
  };

  const walletId = `wallet-${crypto.randomUUID()}`;
  const materialActivation = {
    kind: 'mpc_material_activation_ref',
    activation_id: 'activation-1',
    capability: 'mpc-protocol-capability-1',
    material_owner: walletId,
    key_binding: 'key-binding-1',
    lifecycle_binding: 'lifecycle-binding-1',
    signing_worker: 'signing-worker-1',
  } as const;
  const digest = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc';
  const scope = {
    wallet_id: walletId,
    ecdsa_threshold_key_id: 'ecdsa-key-1',
    signing_root_id: 'root-1',
    signing_root_version: 'root-v1',
    context: { application_binding_digest_b64u: digest },
    public_identity: {
      context_binding_b64u: digest,
      derivation_client_share_public_key33_b64u: 'Anm-Zn753LusVaBilc6HCwcCm_zbLc4o2VnygVsW-BeY',
      server_public_key33_b64u: 'AsYEf5RB7X1tMEVAbpXAfNhcd45LjO88p6usCblccJ7l',
      threshold_public_key33_b64u: 'AvkwigGSWMMQSTRPhfidUim1MchFg2-ZsIYB8RO84Db5',
      ethereum_address20_b64u: 'BQUFBQUFBQUFBQUFBQUFBQUFBQU',
      client_share_retry_counter: 0,
      server_share_retry_counter: 1,
    },
    material_activation: materialActivation,
    signing_worker: {
      server_id: 'signing-worker-1',
      key_epoch: 'worker-epoch-1',
      recipient_encryption_key:
        'x25519:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    activation_epoch: 'activation-epoch-1',
  };

  function gate(): { readonly wait: Promise<void>; readonly open: () => void } {
    let open: () => void = () => undefined;
    const wait = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { wait, open };
  }
  async function until(condition: () => boolean, running: Promise<string>): Promise<void> {
    let ended: string | null = null;
    void running.then((result) => {
      ended = result;
    });
    for (let turn = 0; turn < 500 && !condition() && ended === null; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    if (!condition()) throw new Error(`condition was not reached; attempt ended with ${ended}`);
  }
  function presignature(materialHandle: string) {
    const bigR33 = new Uint8Array(33).fill(3);
    bigR33[0] = 2;
    return {
      presignatureId: `presignature-${materialHandle}`,
      materialHandle,
      bigR33,
      createdAtMs: Date.now(),
      expiresAtMs: Date.now() + 10 * 60_000,
    };
  }

  const listGate = gate();
  const reserveGate = gate();
  let listCalls = 0;
  let reservationLanded = false;
  const reservedHandles: string[] = [];
  const unused = async () => {
    throw new Error('not used in this test');
  };
  const clientSigningMaterial = {
    kind: 'router_ab_ecdsa_derivation_client_signing_material_source_v1',
    initClientPresignSession: unused,
    stepClientPresignSession: unused,
    abortClientPresignSession: async () => undefined,
    admitClientPresignature: unused,
    commitClientPresignature: unused,
    computeSignatureShareFromPresignatureHandle: unused,
    destroyClientPresignature: async () => undefined,
    async listAvailableClientPresignatures() {
      listCalls += 1;
      if (scenario === 'hydrate_after_clear') {
        if (listCalls === 1) {
          await listGate.wait;
          return [presignature('handle-before-clear')];
        }
        return [presignature('handle-after-clear')];
      }
      // The worker lists a handle as available until its reservation lands.
      return reservationLanded ? [] : [presignature('handle-1')];
    },
    async reserveClientPresignature(input: { materialHandle: string }) {
      if (scenario === 'hydrate_during_reservation' && reservedHandles.length === 0) {
        reservedHandles.push(input.materialHandle);
        await reserveGate.wait;
        reservationLanded = true;
        return { kind: 'reserved' };
      }
      reservedHandles.push(input.materialHandle);
      return reservedHandles.filter((handle) => handle === input.materialHandle).length > 1
        ? { kind: 'unavailable', reason: 'claimed_elsewhere' }
        : { kind: 'reserved' };
    },
  };
  const workerCtx = {
    async requestWorkerOperation(args: { request: { payload: { publicKey33: ArrayBuffer } } }) {
      return args.request.payload.publicKey33;
    },
  };
  const expiresAtMs = Date.now() + 60_000;
  const sign = () =>
    pool
      .signRouterAbEcdsaDerivationDigestWithPool({
        relayerUrl: 'https://router.example',
        scope,
        operationId: `operation-${crypto.randomUUID()}`,
        operationDigests: {
          lane_digest_b64u: digest,
          intent_digest_b64u: digest,
          display_digest_b64u: digest,
        },
        materialActivation,
        credential: { kind: 'operation_step_up', ownershipGeneration: 1 },
        keyHandle: 'key-handle-1',
        signingDigest32: new Uint8Array(32).fill(7),
        clientSigningMaterial,
        expiresAtMs,
        workerCtx,
        authorization: { kind: 'operation_step_up' },
        operation: {},
      })
      .then(
        (result: { ok: boolean; code?: string; message?: string }) =>
          result.ok ? 'ok' : `${result.code}: ${result.message}`,
        (error: unknown) => `threw: ${error instanceof Error ? error.message : String(error)}`,
      );

  const results: string[] = [];
  if (scenario === 'hydrate_after_clear') {
    const first = sign();
    await until(() => listCalls === 1, first);
    pool.clearRouterAbEcdsaDerivationClientPresignaturesForWallet(walletId);
    const second = sign();
    await new Promise((resolve) => setTimeout(resolve, 20));
    listGate.open();
    results.push(await first, await second);
  } else {
    const first = sign();
    await until(() => reservedHandles.length === 1, first);
    results.push(await sign());
    reserveGate.open();
    results.push(await first);
  }
  return { listCalls, reservedHandles, results };
}

async function servePoolProbe(source: string, route: Route): Promise<void> {
  await route.fulfill({ contentType: 'application/javascript', body: source });
}

async function runPoolScenario(page: Page, scenario: PoolScenario): Promise<PoolScenarioResult> {
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({
    stdin: {
      contents: `export * as pool from './packages/wallet/src/core/signingEngine/routerAb/ecdsaDerivation/presignaturePool';`,
      resolveDir: root,
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    tsconfig: path.join(root, 'packages/wallet/tsconfig.json'),
  });
  await setupBasicPasskeyTest(page, { skipSeamsWebInit: true });
  await page.route(
    '**/__presignature-pool.js',
    servePoolProbe.bind(null, bundle.outputFiles[0]!.text),
  );
  return await page.evaluate(runPoolScenarioInPage, scenario);
}

test('a hydration after a pool clear lists the pool again instead of joining the stale one', async ({
  page,
}) => {
  const result = await runPoolScenario(page, 'hydrate_after_clear');

  expect(result.listCalls).toBe(2);
  expect(result.reservedHandles).toEqual(['handle-after-clear']);
});

test('a hydration during a reservation does not hand out the handle being reserved', async ({
  page,
}) => {
  const result = await runPoolScenario(page, 'hydrate_during_reservation');

  expect(result.reservedHandles).toEqual(['handle-1']);
});

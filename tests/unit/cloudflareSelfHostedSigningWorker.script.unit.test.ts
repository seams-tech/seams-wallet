import { expect, test } from '@playwright/test';
import { ROUTER_AB_ECDSA_DERIVATION_HEALTH_PATH } from '../../packages/shared-ts/src/utils/routerAbEcdsaDerivation';
import { ROUTER_AB_ED25519_HEALTH_PATH } from '../../packages/shared-ts/src/utils/signingSessionSeal';
import {
  createSelfHostedCloudflareSigningRouter,
  createSelfHostedCloudflareSigningWorker,
} from '../../packages/wallet-server/src/router/cloudflare/runtime/createSelfHostedCloudflareSigningWorker';
import { createCloudflareRouter } from '../../packages/wallet-server/src/router/cloudflare/runtime/createCloudflareRouter';
import type { CfExecutionContext } from '../../packages/wallet-server/src/router/cloudflare/runtime/cloudflare.types';
import type { RouterApiServiceBag } from '../../packages/wallet-server/src/router/framework/authServicePort';

const fakeCtx = {} as CfExecutionContext;

function fakeRouterApiServiceBag(): RouterApiServiceBag {
  return {
    router: {
      getConfiguredRelayerAccount: () => 'self-host.testnet',
    },
    thresholdRuntime: {
      getRouterAbNormalSigningRuntime: () => null,
      getRouterAbEcdsaPresignRuntime: () => null,
    },
  } as unknown as RouterApiServiceBag;
}

async function responseSnapshot(response: Response): Promise<{
  readonly status: number;
  readonly body: unknown;
}> {
  return {
    status: response.status,
    body: await response.json(),
  };
}

test('self-host Cloudflare signing router exposes health without hosted Router API routes', async () => {
  const router = createSelfHostedCloudflareSigningRouter(fakeRouterApiServiceBag(), {
    healthz: true,
    readyz: true,
    corsOrigins: ['https://wallet.example.test'],
  });

  const health = await router(
    new Request('https://self-host.example.test/healthz', {
      headers: { origin: 'https://wallet.example.test' },
    }),
    {},
    fakeCtx,
  );
  await expect(health.json()).resolves.toMatchObject({
    ok: true,
    selfHosted: true,
    threshold: { configured: false },
  });
  expect(health.headers.get('access-control-allow-origin')).toBe('*');

  const hostedOnlyPath = '/.well-known/webauthn';
  const hosted = createCloudflareRouter(fakeRouterApiServiceBag(), { logger: console });
  const hostedResponse = await hosted(
    new Request(`https://hosted.example.test${hostedOnlyPath}`),
    {},
    fakeCtx,
  );
  expect(hostedResponse.status).not.toBe(404);
  const selfHostedResponse = await router(
    new Request(`https://self-host.example.test${hostedOnlyPath}`),
    {},
    fakeCtx,
  );
  expect(selfHostedResponse.status).toBe(404);
});

test('self-host Cloudflare signing worker creates per-request service and options', async () => {
  const calls: string[] = [];
  const worker = createSelfHostedCloudflareSigningWorker({
    createAuthService: ({ request }) => {
      calls.push(new URL(request.url).pathname);
      return fakeRouterApiServiceBag();
    },
    routerOptions: () => ({ healthz: true }),
  });

  const response = await worker.fetch(
    new Request('https://self-host.example.test/healthz'),
    {},
    fakeCtx,
  );

  expect(response.status).toBe(200);
  expect(calls).toEqual(['/healthz']);
});

test('hosted and self-host Cloudflare routers preserve threshold health route parity', async () => {
  const service = fakeRouterApiServiceBag();
  const hosted = createCloudflareRouter(service, { logger: console });
  const selfHosted = createSelfHostedCloudflareSigningRouter(service, {
    logger: console,
  });

  for (const path of [ROUTER_AB_ED25519_HEALTH_PATH, ROUTER_AB_ECDSA_DERIVATION_HEALTH_PATH]) {
    const hostedResult = await responseSnapshot(
      await hosted(new Request(`https://hosted.example.test${path}`), {}, fakeCtx),
    );
    const selfHostedResult = await responseSnapshot(
      await selfHosted(new Request(`https://self-host.example.test${path}`), {}, fakeCtx),
    );

    expect(selfHostedResult).toEqual(hostedResult);
  }
});

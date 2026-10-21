import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Route } from '@playwright/test';
import {
  requireCanonicalString,
  requireRecord,
} from '../../packages/shared-ts/src/utils/validation';

export async function mlDsaHostedTarget() {
  const directory = requireCanonicalString(
    process.env.ML_DSA_HOSTED_DEPLOYMENT,
    'ML_DSA_HOSTED_DEPLOYMENT',
  );
  const metadata = requireRecord(
    JSON.parse(await readFile(path.join(directory, 'metadata.json'), 'utf8')),
    'hosted ML-DSA deployment',
  );
  const secrets = requireRecord(
    JSON.parse(await readFile(path.join(directory, 'gateway-secrets.json'), 'utf8')),
    'hosted ML-DSA fixture credentials',
  );
  const gatewayUrl = new URL(requireCanonicalString(metadata.gatewayUrl, 'Gateway URL'));
  if (gatewayUrl.protocol !== 'https:' || !gatewayUrl.hostname.startsWith('ml-dsa-sdk-'))
    throw new Error('A disposable ML-DSA SDK deployment is required');
  return {
    gatewayUrl: gatewayUrl.origin,
    accessToken: requireCanonicalString(secrets.BENCHMARK_ACCESS_TOKEN, 'fixture access token'),
  };
}

export async function forwardMlDsaHostedRequest(accessToken: string, route: Route): Promise<void> {
  await route.continue({
    headers: { ...route.request().headers(), 'x-r150-benchmark-access': accessToken },
  });
}

export async function mlDsaHostedFixture(path: string, body: unknown) {
  const target = await mlDsaHostedTarget();
  const response = await fetch(new URL(path, target.gatewayUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: process.env.SEAMS_INTENDED_WALLET_ORIGIN ?? 'http://localhost:7602',
      'x-r150-benchmark-access': target.accessToken,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) throw new Error(`Hosted ML-DSA fixture ${path} returned ${response.status}`);
  return requireRecord(await response.json(), 'hosted ML-DSA fixture result');
}

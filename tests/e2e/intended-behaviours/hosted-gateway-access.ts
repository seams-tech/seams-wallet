import type { IntendedBehaviourHarness } from './harness';

export function hostedBenchmarkAccessToken(): string {
  const accessToken = process.env.SEAMS_INTENDED_BENCHMARK_ACCESS_TOKEN;
  if (!accessToken || accessToken.length < 32)
    throw new Error('Hosted benchmark access token must contain at least 32 characters');
  return accessToken;
}

export function hostedGatewayHeaders(
  mode: ConstructorParameters<typeof IntendedBehaviourHarness>[0]['networkMode'],
): Record<string, string> {
  return mode === 'external_staging'
    ? { 'x-r150-benchmark-access': hostedBenchmarkAccessToken() }
    : {};
}

import {
  createStaticWalletConsoleBindingV1,
  parseStaticWalletConsoleBindingConfigV1,
} from '../../../packages/wallet-server/src/router/cloudflare/runtime/staticWalletConsoleBinding';
import {
  handleSplitGatewayRequest,
  type CloudflareD1GatewayBaseEnv,
  type CloudflareD1GatewayEnv,
} from '../../../packages/wallet-server/src/hosted-wallet-gateway';
import type { CfExecutionContext } from '../../../packages/wallet-server/src/router/cloudflare/runtime/cloudflare.types';
import { TracedD1Database } from './d1Trace';

type BenchmarkGatewayEnv = CloudflareD1GatewayBaseEnv & {
  readonly BENCHMARK_WALLET_DEPLOYMENT_JSON: string;
};

async function fetch(
  request: Request,
  env: BenchmarkGatewayEnv,
  ctx: CfExecutionContext,
): Promise<Response> {
  const deployment = parseStaticWalletConsoleBindingConfigV1(
    JSON.parse(env.BENCHMARK_WALLET_DEPLOYMENT_JSON),
  );
  if (
    deployment.deployment.orgId !== env.SEAMS_STAGING_ORG_ID ||
    deployment.deployment.projectId !== env.SEAMS_STAGING_PROJECT_ID ||
    deployment.deployment.environmentId !== env.SEAMS_STAGING_ENV_ID
  ) {
    return new Response(null, { status: 503 });
  }
  const database = new TracedD1Database(env.SIGNER_DB);
  const gatewayEnv: CloudflareD1GatewayEnv = {
    ...env,
    SIGNER_DB: database,
    WALLET_CONSOLE: createStaticWalletConsoleBindingV1(deployment),
  };
  const response = database.response(await handleSplitGatewayRequest(request, gatewayEnv, ctx));
  response.headers.set('X-Benchmark-Placement', request.headers.get('cf-placement') ?? 'unreported');
  return response;
}

export default { fetch };

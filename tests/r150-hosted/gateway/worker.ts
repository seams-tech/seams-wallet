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
  const gatewayEnv: CloudflareD1GatewayEnv = {
    ...env,
    WALLET_CONSOLE: createStaticWalletConsoleBindingV1(deployment),
  };
  return await handleSplitGatewayRequest(request, gatewayEnv, ctx);
}

export default { fetch };

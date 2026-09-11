import { runRouterAbPrewarmScheduledV1 } from './cloud-host';
import {
  createStaticWalletConsoleBindingV1,
  parseStaticWalletConsoleBindingConfigV1,
} from './router/cloudflare/runtime/staticWalletConsoleBinding';
import {
  handleSplitGatewayRequest,
  type CloudflareD1GatewayBaseEnv,
  type CloudflareD1GatewayEnv,
} from './hosted-wallet-gateway';
import type { CfExecutionContext, CfScheduledEvent } from './router/cloudflare/runtime/cloudflare.types';

type LocalHostedWalletGatewayEnv = CloudflareD1GatewayBaseEnv & {
  readonly WALLET_LOCAL_DEPLOYMENT_JSON: string;
};

async function fetch(
  request: Request,
  env: LocalHostedWalletGatewayEnv,
  ctx: CfExecutionContext,
): Promise<Response> {
  const config = parseStaticWalletConsoleBindingConfigV1(
    JSON.parse(env.WALLET_LOCAL_DEPLOYMENT_JSON),
  );
  const gatewayEnv: CloudflareD1GatewayEnv = {
    ...env,
    WALLET_CONSOLE: createStaticWalletConsoleBindingV1(config),
  };
  return await handleSplitGatewayRequest(request, gatewayEnv, ctx);
}

async function scheduled(
  event: CfScheduledEvent,
  env: LocalHostedWalletGatewayEnv,
  _ctx: CfExecutionContext,
): Promise<void> {
  await runRouterAbPrewarmScheduledV1(event, env);
}

export default { fetch, scheduled };

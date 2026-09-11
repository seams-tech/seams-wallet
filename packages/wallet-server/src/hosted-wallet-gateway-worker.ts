import { runRouterAbPrewarmScheduledV1 } from './cloud-host';
import {
  handleSplitGatewayRequest,
  type CloudflareD1GatewayEnv,
} from './hosted-wallet-gateway';
import type { CfExecutionContext, CfScheduledEvent } from './router/cloudflare/runtime/cloudflare.types';

async function fetch(
  request: Request,
  env: CloudflareD1GatewayEnv,
  ctx: CfExecutionContext,
): Promise<Response> {
  return await handleSplitGatewayRequest(request, env, ctx);
}

async function scheduled(
  event: CfScheduledEvent,
  env: CloudflareD1GatewayEnv,
  _ctx: CfExecutionContext,
): Promise<void> {
  await runRouterAbPrewarmScheduledV1(event, env);
}

export default { fetch, scheduled };

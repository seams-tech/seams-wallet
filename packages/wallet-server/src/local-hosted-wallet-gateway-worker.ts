import { runRouterAbPrewarmScheduledV1 } from './cloud-host';
import {
  handleLocalHostedWalletGatewayRequestV1,
  type LocalHostedWalletGatewayEnv,
} from './localHostedWalletGatewayHandler';
import type {
  CfExecutionContext,
  CfScheduledEvent,
} from './router/cloudflare/runtime/cloudflare.types';

async function fetch(
  request: Request,
  env: LocalHostedWalletGatewayEnv,
  ctx: CfExecutionContext,
): Promise<Response> {
  return await handleLocalHostedWalletGatewayRequestV1(request, env, ctx);
}

async function scheduled(
  event: CfScheduledEvent,
  env: LocalHostedWalletGatewayEnv,
  _ctx: CfExecutionContext,
): Promise<void> {
  await runRouterAbPrewarmScheduledV1(event, env);
}

export default { fetch, scheduled };

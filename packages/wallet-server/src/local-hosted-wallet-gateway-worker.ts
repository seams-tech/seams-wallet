import { runRouterAbPrewarmScheduledV1 } from './cloud-host';
import {
  handleLocalHostedWalletGatewayRequestV1,
  resumeLocalRegistrationDirectoryPublicationsV1,
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
  const [prewarm, publications] = await Promise.allSettled([
    runRouterAbPrewarmScheduledV1(event, env),
    resumeLocalRegistrationDirectoryPublicationsV1(env),
  ]);
  if (prewarm.status === 'rejected') throw prewarm.reason;
  if (publications.status === 'rejected') throw publications.reason;
}

export default { fetch, scheduled };

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
import type {
  CfExecutionContext,
  CfScheduledEvent,
} from './router/cloudflare/runtime/cloudflare.types';
import { ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1 } from '@shared/utils/routerAbEd25519Yao';
import {
  LOCAL_INTENDED_YAO_FAULT_HEADER_V1,
  LOCAL_INTENDED_YAO_FAULT_TOKEN_HEADER_V1,
  LocalIntendedYaoFaultControllerV1,
  parseLocalIntendedYaoFaultModeV1,
  parseLocalIntendedYaoFaultTokenV1,
  requestWithoutLocalIntendedYaoFaultHeadersV1,
  responseWithLocalIntendedYaoFaultOutcomeV1,
} from './localIntendedYaoFault';

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
  const rawMode = request.headers.get(LOCAL_INTENDED_YAO_FAULT_HEADER_V1);
  const rawToken = request.headers.get(LOCAL_INTENDED_YAO_FAULT_TOKEN_HEADER_V1);
  const sanitizedRequest = requestWithoutLocalIntendedYaoFaultHeadersV1(request);
  if (rawMode === null && rawToken === null) {
    return await handleSplitGatewayRequest(sanitizedRequest, gatewayEnv, ctx);
  }

  const mode = parseLocalIntendedYaoFaultModeV1(rawMode);
  const token = parseLocalIntendedYaoFaultTokenV1(rawToken);
  const url = new URL(request.url);
  if (
    url.origin !== 'http://127.0.0.1:4100' ||
    url.pathname !== ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1 ||
    request.method !== 'POST' ||
    !mode ||
    !token
  ) {
    return Response.json({ code: 'invalid_intended_yao_fault' }, { status: 400 });
  }

  // Each registration owns its fault state, including every internal Router retry.
  const controller = new LocalIntendedYaoFaultControllerV1(
    env.MPC_ROUTER.fetch.bind(env.MPC_ROUTER),
  );
  controller.arm(mode);
  const response = await handleSplitGatewayRequest(
    sanitizedRequest,
    { ...gatewayEnv, MPC_ROUTER: controller },
    ctx,
  );
  return responseWithLocalIntendedYaoFaultOutcomeV1(response, controller.consumeOutcome(), token);
}

async function scheduled(
  event: CfScheduledEvent,
  env: LocalHostedWalletGatewayEnv,
  _ctx: CfExecutionContext,
): Promise<void> {
  await runRouterAbPrewarmScheduledV1(event, env);
}

export default { fetch, scheduled };

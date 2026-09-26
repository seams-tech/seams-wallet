import {
  createStaticWalletConsoleBindingV1,
  parseStaticWalletConsoleBindingConfigV1,
} from './router/cloudflare/runtime/staticWalletConsoleBinding';
import {
  handleSplitGatewayRequest,
  type CloudflareD1GatewayBaseEnv,
  type CloudflareD1GatewayEnv,
  type HostedWalletGatewayDependenciesV1,
} from './hosted-wallet-gateway';
import type { CfExecutionContext } from './router/cloudflare/runtime/cloudflare.types';
import { WALLET_CONSOLE_OP_PATHS_V1 } from './router/cloudflare/runtime/walletConsoleOps';
import type { WalletConsoleServiceBinding } from './router/cloudflare/runtime/walletConsoleOpsClient';
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
import {
  LOCAL_INTENDED_ECDSA_FINALIZE_FAULT_HEADER_V1,
  LOCAL_INTENDED_ECDSA_FINALIZE_FAULT_TOKEN_HEADER_V1,
  LocalIntendedEcdsaFinalizeFaultControllerV1,
  ROUTER_AB_ECDSA_FINALIZE_PATH_V1,
  parseLocalIntendedEcdsaFinalizeFaultModeV1,
  parseLocalIntendedEcdsaFinalizeFaultTokenV1,
  requestWithoutLocalIntendedEcdsaFinalizeFaultHeadersV1,
  responseWithLocalIntendedEcdsaFinalizeFaultOutcomeV1,
} from './localIntendedEcdsaFinalizeFault';

export type LocalHostedWalletGatewayEnv = CloudflareD1GatewayBaseEnv & {
  readonly WALLET_LOCAL_DEPLOYMENT_JSON: string;
};

const ECDSA_RESPOND_FAULT_HEADER = 'x-seams-intended-ecdsa-respond-fault-v1';
const ECDSA_RESPOND_FAULT_PROOF_HEADER = 'x-seams-intended-ecdsa-respond-proof-v1';
const ECDSA_REGISTRATION_PATH = '/router-ab/ecdsa-derivation/register';
const REGISTRATION_RESPOND_PATH = '/wallets/register/respond';

class DropEcdsaRouterReply {
  observed = false;

  constructor(private readonly baseFetch: typeof globalThis.fetch) {}

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    const response = await this.baseFetch(request);
    if (request.method === 'POST' && new URL(request.url).pathname === ECDSA_REGISTRATION_PATH) {
      if (!response.ok) return response;
      await response.clone().arrayBuffer();
      this.observed = true;
      throw new Error('Local ECDSA fault dropped the completed Router registration reply');
    }
    return response;
  }
}

class UnavailableTenantRootLineage {
  lookups = 0;

  constructor(private readonly base: WalletConsoleServiceBinding) {}

  async fetch(input: Request | string, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request ? input : new Request(input, init);
    if (new URL(request.url).pathname === WALLET_CONSOLE_OP_PATHS_V1.tenantRootActiveLineage) {
      this.lookups += 1;
      return Response.json(
        { ok: false, message: 'Local lineage lookup unavailable' },
        { status: 503 },
      );
    }
    return await this.base.fetch(request);
  }
}

function withoutEcdsaRespondFaultHeader(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete(ECDSA_RESPOND_FAULT_HEADER);
  return new Request(request, { headers });
}

function withEcdsaRespondFaultProof(
  response: Response,
  proof: string,
  environmentKey: string,
  projectEnvironmentId: string,
): Response {
  const headers = new Headers(response.headers);
  headers.set(ECDSA_RESPOND_FAULT_PROOF_HEADER, proof);
  headers.set('x-seams-intended-ecdsa-environment-key-v1', environmentKey);
  headers.set('x-seams-intended-ecdsa-environment-id-v1', projectEnvironmentId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleEcdsaRespondFault(
  request: Request,
  env: CloudflareD1GatewayEnv,
  ctx: CfExecutionContext,
  dependencies: HostedWalletGatewayDependenciesV1 | undefined,
  fault: string,
  environmentKey: string,
  projectEnvironmentId: string,
): Promise<Response> {
  const url = new URL(request.url);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== REGISTRATION_RESPOND_PATH ||
    request.method !== 'POST'
  ) {
    return Response.json({ code: 'invalid_intended_ecdsa_fault' }, { status: 400 });
  }
  const sanitizedRequest = withoutEcdsaRespondFaultHeader(request);
  if (fault === 'drop_router_reply') {
    const router = new DropEcdsaRouterReply(env.MPC_ROUTER.fetch.bind(env.MPC_ROUTER));
    let response: Response;
    try {
      response = await handleSplitGatewayRequest(
        sanitizedRequest,
        { ...env, MPC_ROUTER: router },
        ctx,
        dependencies,
      );
    } catch {
      response = Response.json({ code: 'router_reply_lost' }, { status: 503 });
    }
    return withEcdsaRespondFaultProof(
      response,
      router.observed ? 'router_reply_dropped' : 'router_reply_not_dropped',
      environmentKey,
      projectEnvironmentId,
    );
  }
  if (fault === 'unavailable_lineage') {
    const console = new UnavailableTenantRootLineage(env.WALLET_CONSOLE);
    const response = await handleSplitGatewayRequest(
      sanitizedRequest,
      { ...env, WALLET_CONSOLE: console },
      ctx,
      dependencies,
    );
    return withEcdsaRespondFaultProof(
      response,
      `lineage_lookups:${console.lookups}`,
      environmentKey,
      projectEnvironmentId,
    );
  }
  return Response.json({ code: 'invalid_intended_ecdsa_fault' }, { status: 400 });
}

/**
 * The local Gateway: the hosted Gateway handler plus the intended-suite
 * transport faults, which a request arms with local-only headers. The local
 * Worker and the local Node host both serve through this.
 */
export async function handleLocalHostedWalletGatewayRequestV1(
  request: Request,
  env: LocalHostedWalletGatewayEnv,
  ctx: CfExecutionContext,
  dependencies?: HostedWalletGatewayDependenciesV1,
): Promise<Response> {
  const config = parseStaticWalletConsoleBindingConfigV1(
    JSON.parse(env.WALLET_LOCAL_DEPLOYMENT_JSON),
  );
  const gatewayEnv: CloudflareD1GatewayEnv = {
    ...env,
    WALLET_CONSOLE: createStaticWalletConsoleBindingV1(config),
  };
  const ecdsaFault = request.headers.get(ECDSA_RESPOND_FAULT_HEADER);
  if (ecdsaFault !== null) {
    return await handleEcdsaRespondFault(
      request,
      gatewayEnv,
      ctx,
      dependencies,
      ecdsaFault,
      config.deployment.environmentKey,
      config.deployment.environmentId,
    );
  }
  const ecdsaFinalizeMode = request.headers.get(LOCAL_INTENDED_ECDSA_FINALIZE_FAULT_HEADER_V1);
  const ecdsaFinalizeToken = request.headers.get(
    LOCAL_INTENDED_ECDSA_FINALIZE_FAULT_TOKEN_HEADER_V1,
  );
  if (ecdsaFinalizeMode !== null || ecdsaFinalizeToken !== null) {
    return await handleEcdsaFinalizeFault(
      request,
      gatewayEnv,
      ctx,
      dependencies,
      ecdsaFinalizeMode,
      ecdsaFinalizeToken,
    );
  }
  const rawMode = request.headers.get(LOCAL_INTENDED_YAO_FAULT_HEADER_V1);
  const rawToken = request.headers.get(LOCAL_INTENDED_YAO_FAULT_TOKEN_HEADER_V1);
  const sanitizedRequest = requestWithoutLocalIntendedYaoFaultHeadersV1(request);
  if (rawMode === null && rawToken === null) {
    return await handleSplitGatewayRequest(sanitizedRequest, gatewayEnv, ctx, dependencies);
  }

  const mode = parseLocalIntendedYaoFaultModeV1(rawMode);
  const token = parseLocalIntendedYaoFaultTokenV1(rawToken);
  const url = new URL(request.url);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
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
    dependencies,
  );
  return responseWithLocalIntendedYaoFaultOutcomeV1(response, controller.consumeOutcome(), token);
}

/**
 * Loses the Router's response to one admitted ECDSA finalize and sends the
 * identical request again, inside this Gateway request and before the Gateway
 * records any outcome. Local only.
 */
async function handleEcdsaFinalizeFault(
  request: Request,
  env: CloudflareD1GatewayEnv,
  ctx: CfExecutionContext,
  dependencies: HostedWalletGatewayDependenciesV1 | undefined,
  rawMode: string | null,
  rawToken: string | null,
): Promise<Response> {
  const mode = parseLocalIntendedEcdsaFinalizeFaultModeV1(rawMode);
  const token = parseLocalIntendedEcdsaFinalizeFaultTokenV1(rawToken);
  const url = new URL(request.url);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== ROUTER_AB_ECDSA_FINALIZE_PATH_V1 ||
    request.method !== 'POST' ||
    !mode ||
    !token
  ) {
    return Response.json({ code: 'invalid_intended_ecdsa_finalize_fault' }, { status: 400 });
  }
  const controller = new LocalIntendedEcdsaFinalizeFaultControllerV1(
    env.MPC_ROUTER.fetch.bind(env.MPC_ROUTER),
  );
  const response = await handleSplitGatewayRequest(
    requestWithoutLocalIntendedEcdsaFinalizeFaultHeadersV1(request),
    { ...env, MPC_ROUTER: controller },
    ctx,
    dependencies,
  );
  return responseWithLocalIntendedEcdsaFinalizeFaultOutcomeV1(
    response,
    controller.consumeOutcome(),
    token,
  );
}

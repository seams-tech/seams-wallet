import { localPresignCancellationProbe } from './localIntendedPresignCancellation';
import { localMaterialAdmissionFault } from './localIntendedMaterialAdmissionFault';
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
import {
  ROUTER_AB_ED25519_YAO_EXPORT_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_EXECUTE_PATH_V1,
  ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1,
} from '@shared/utils/routerAbEd25519Yao';
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
import {
  LOCAL_INTENDED_YAO_FINALIZE_FAULT_HEADER_V1,
  LOCAL_INTENDED_YAO_FINALIZE_FAULT_TOKEN_HEADER_V1,
  LocalIntendedYaoFinalizeFaultDatabaseV1,
  parseLocalIntendedYaoFinalizeFaultModeV1,
  parseLocalIntendedYaoFinalizeFaultTokenV1,
  requestWithoutLocalIntendedYaoFinalizeFaultHeadersV1,
  responseWithLocalIntendedYaoFinalizeFaultOutcomeV1,
  WALLET_REGISTRATION_NEAR_PROVISIONING_PATH_V1,
} from './localIntendedYaoFinalizeFault';
import {
  LOCAL_INTENDED_YAO_RECOVERY_FAULT_HEADER_V1,
  LOCAL_INTENDED_YAO_RECOVERY_FAULT_TOKEN_HEADER_V1,
  LocalIntendedYaoRecoveryFaultControllerV1,
  parseLocalIntendedYaoRecoveryFaultModeV1,
  parseLocalIntendedYaoRecoveryFaultTokenV1,
  releaseLocalIntendedYaoRecoveryExecuteV1,
  requestWithoutLocalIntendedYaoRecoveryFaultHeadersV1,
  responseWithLocalIntendedYaoRecoveryFaultOutcomeV1,
} from './localIntendedYaoRecoveryFault';
import {
  LOCAL_INTENDED_YAO_EXPORT_FAULT_HEADER_V1,
  LOCAL_INTENDED_YAO_EXPORT_FAULT_TOKEN_HEADER_V1,
  LocalIntendedYaoExportFaultDatabaseV1,
  parseLocalIntendedYaoExportFaultModeV1,
  parseLocalIntendedYaoExportFaultTokenV1,
  requestWithoutLocalIntendedYaoExportFaultHeadersV1,
  responseWithLocalIntendedYaoExportFaultOutcomeV1,
} from './localIntendedYaoExportFault';
import {
  LOCAL_INTENDED_YAO_SIGNING_FAULT_HEADER_V1,
  LOCAL_INTENDED_YAO_SIGNING_FAULT_TOKEN_HEADER_V1,
  LocalIntendedYaoSigningFaultControllerV1,
  commandLocalIntendedSigningWorkerHoldV1,
  parseLocalIntendedYaoSigningFaultModeV1,
  parseLocalIntendedYaoSigningFaultTokenV1,
  releaseLocalIntendedYaoSigningFinalizeV1,
  requestWithoutLocalIntendedYaoSigningFaultHeadersV1,
  responseWithLocalIntendedYaoSigningFaultOutcomeV1,
  ROUTER_AB_ED25519_SIGNING_FINALIZE_PATH_V1,
} from './localIntendedYaoSigningFault';
import {
  LOCAL_INTENDED_LINK_EXECUTE_FAULT_HEADER_V1,
  LOCAL_INTENDED_LINK_EXECUTE_FAULT_TOKEN_HEADER_V1,
  LocalIntendedLinkExecuteFaultControllerV1,
  parseLocalIntendedLinkExecuteFaultModeV1,
  parseLocalIntendedLinkExecuteFaultTokenV1,
  requestWithoutLocalIntendedLinkExecuteFaultHeadersV1,
  responseWithLocalIntendedLinkExecuteFaultOutcomeV1,
} from './localIntendedLinkExecuteFault';
import {
  LINKED_DEVICE_REVOKE_PATH_PATTERN_V1,
  LOCAL_INTENDED_REVOKE_FAULT_HEADER_V1,
  LOCAL_INTENDED_REVOKE_FAULT_TOKEN_HEADER_V1,
  LocalIntendedRevokeFaultDatabaseV1,
  parseLocalIntendedRevokeFaultModeV1,
  parseLocalIntendedRevokeFaultTokenV1,
  requestWithoutLocalIntendedRevokeFaultHeadersV1,
  responseWithLocalIntendedRevokeFaultOutcomeV1,
  WALLET_REVOKE_AUTH_METHOD_PATH_PATTERN_V1,
} from './localIntendedRevokeFault';
import {
  ECDSA_SIGN_PREPARE_PATH_V1,
  LOCAL_INTENDED_SESSION_ADMISSION_FAULT_HEADER_V1,
  LOCAL_INTENDED_SESSION_ADMISSION_FAULT_TOKEN_HEADER_V1,
  LocalIntendedSessionAdmissionFaultDatabaseV1,
  parseLocalIntendedSessionAdmissionFaultModeV1,
  parseLocalIntendedSessionAdmissionFaultTokenV1,
  requestWithoutLocalIntendedSessionAdmissionFaultHeadersV1,
  responseWithLocalIntendedSessionAdmissionFaultOutcomeV1,
} from './localIntendedSessionAdmissionFault';

export type LocalHostedWalletGatewayEnv = CloudflareD1GatewayBaseEnv & {
  readonly WALLET_LOCAL_DEPLOYMENT_JSON: string;
};

const ECDSA_RESPOND_FAULT_HEADER = 'x-seams-intended-ecdsa-respond-fault-v1';
const ECDSA_RESPOND_FAULT_PROOF_HEADER = 'x-seams-intended-ecdsa-respond-proof-v1';
const ECDSA_REGISTRATION_PATH = '/router-ab/ecdsa-derivation/register';
const REGISTRATION_RESPOND_PATH = '/wallets/register/respond';
const LINK_SOURCE_CONTRIBUTION_EXECUTE_PATH =
  /^\/wallet\/device-linking\/v1\/sessions\/[^/]+\/source-contribution\/execute$/;

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
  const canceledPresign = await localPresignCancellationProbe(
    request,
    gatewayEnv,
    ctx,
    dependencies,
  );
  if (canceledPresign) return canceledPresign;
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
  const yaoRecoveryMode = request.headers.get(LOCAL_INTENDED_YAO_RECOVERY_FAULT_HEADER_V1);
  const yaoRecoveryToken = request.headers.get(LOCAL_INTENDED_YAO_RECOVERY_FAULT_TOKEN_HEADER_V1);
  if (yaoRecoveryMode !== null || yaoRecoveryToken !== null) {
    return await handleYaoRecoveryFault(
      request,
      gatewayEnv,
      ctx,
      dependencies,
      yaoRecoveryMode,
      yaoRecoveryToken,
    );
  }
  const yaoSigningMode = request.headers.get(LOCAL_INTENDED_YAO_SIGNING_FAULT_HEADER_V1);
  const yaoSigningToken = request.headers.get(LOCAL_INTENDED_YAO_SIGNING_FAULT_TOKEN_HEADER_V1);
  if (yaoSigningMode !== null || yaoSigningToken !== null) {
    return await handleYaoSigningFault(
      request,
      gatewayEnv,
      ctx,
      dependencies,
      yaoSigningMode,
      yaoSigningToken,
    );
  }
  const yaoExportMode = request.headers.get(LOCAL_INTENDED_YAO_EXPORT_FAULT_HEADER_V1);
  const yaoExportToken = request.headers.get(LOCAL_INTENDED_YAO_EXPORT_FAULT_TOKEN_HEADER_V1);
  if (yaoExportMode !== null || yaoExportToken !== null) {
    return await handleYaoExportFault(
      request,
      gatewayEnv,
      ctx,
      dependencies,
      yaoExportMode,
      yaoExportToken,
    );
  }
  const yaoFinalizeMode = request.headers.get(LOCAL_INTENDED_YAO_FINALIZE_FAULT_HEADER_V1);
  const yaoFinalizeToken = request.headers.get(LOCAL_INTENDED_YAO_FINALIZE_FAULT_TOKEN_HEADER_V1);
  if (yaoFinalizeMode !== null || yaoFinalizeToken !== null) {
    return await handleYaoFinalizeFault(
      request,
      gatewayEnv,
      ctx,
      dependencies,
      yaoFinalizeMode,
      yaoFinalizeToken,
    );
  }
  const linkExecuteMode = request.headers.get(LOCAL_INTENDED_LINK_EXECUTE_FAULT_HEADER_V1);
  const linkExecuteToken = request.headers.get(LOCAL_INTENDED_LINK_EXECUTE_FAULT_TOKEN_HEADER_V1);
  if (linkExecuteMode !== null || linkExecuteToken !== null) {
    return await handleLinkExecuteFault(
      request,
      gatewayEnv,
      ctx,
      dependencies,
      linkExecuteMode,
      linkExecuteToken,
    );
  }
  const revokeMode = request.headers.get(LOCAL_INTENDED_REVOKE_FAULT_HEADER_V1);
  const revokeToken = request.headers.get(LOCAL_INTENDED_REVOKE_FAULT_TOKEN_HEADER_V1);
  if (revokeMode !== null || revokeToken !== null) {
    return await handleRevokeFault(request, gatewayEnv, ctx, dependencies, revokeMode, revokeToken);
  }
  const materialFault = localMaterialAdmissionFault(request, gatewayEnv.SIGNER_DB);
  if (materialFault instanceof Response) return materialFault;
  if (materialFault) {
    const response = await handleSplitGatewayRequest(
      materialFault.request,
      { ...gatewayEnv, SIGNER_DB: materialFault.database },
      ctx,
      dependencies,
    );
    return materialFault.database.response(response, materialFault.token);
  }
  const admissionMode = request.headers.get(LOCAL_INTENDED_SESSION_ADMISSION_FAULT_HEADER_V1);
  const admissionToken = request.headers.get(
    LOCAL_INTENDED_SESSION_ADMISSION_FAULT_TOKEN_HEADER_V1,
  );
  if (admissionMode !== null || admissionToken !== null) {
    return await handleSessionAdmissionFault(
      request,
      gatewayEnv,
      ctx,
      dependencies,
      admissionMode,
      admissionToken,
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
 * Lets the Router run one linked device's source-preserving execution, then
 * loses its answer, so the Gateway's retry must recover the reservation the
 * Router already made. Local only.
 */
async function handleLinkExecuteFault(
  request: Request,
  env: CloudflareD1GatewayEnv,
  ctx: CfExecutionContext,
  dependencies: HostedWalletGatewayDependenciesV1 | undefined,
  rawMode: string | null,
  rawToken: string | null,
): Promise<Response> {
  const mode = parseLocalIntendedLinkExecuteFaultModeV1(rawMode);
  const token = parseLocalIntendedLinkExecuteFaultTokenV1(rawToken);
  const url = new URL(request.url);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !LINK_SOURCE_CONTRIBUTION_EXECUTE_PATH.test(url.pathname) ||
    request.method !== 'POST' ||
    !mode ||
    !token
  ) {
    return Response.json({ code: 'invalid_intended_link_execute_fault' }, { status: 400 });
  }
  const controller = new LocalIntendedLinkExecuteFaultControllerV1(
    env.MPC_ROUTER.fetch.bind(env.MPC_ROUTER),
  );
  const response = await handleSplitGatewayRequest(
    requestWithoutLocalIntendedLinkExecuteFaultHeadersV1(request),
    { ...env, MPC_ROUTER: controller },
    ctx,
    dependencies,
  );
  return responseWithLocalIntendedLinkExecuteFaultOutcomeV1(response, controller.outcome(), token);
}

/**
 * Faults one Ed25519 Yao recovery execution on its way to the Router: loses
 * every reply after the Router ran it, or keeps it from the Router, or sends
 * a kept one to the Router now. Local only.
 */
async function handleYaoRecoveryFault(
  request: Request,
  env: CloudflareD1GatewayEnv,
  ctx: CfExecutionContext,
  dependencies: HostedWalletGatewayDependenciesV1 | undefined,
  rawMode: string | null,
  rawToken: string | null,
): Promise<Response> {
  const mode = parseLocalIntendedYaoRecoveryFaultModeV1(rawMode);
  const token = parseLocalIntendedYaoRecoveryFaultTokenV1(rawToken);
  const url = new URL(request.url);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== ROUTER_AB_ED25519_YAO_RECOVERY_EXECUTE_PATH_V1 ||
    request.method !== 'POST' ||
    !mode ||
    !token
  ) {
    return Response.json({ code: 'invalid_intended_yao_recovery_fault' }, { status: 400 });
  }
  if (mode === 'release_router_recovery_execute') {
    return await releaseLocalIntendedYaoRecoveryExecuteV1(env.MPC_ROUTER, token);
  }
  const controller = new LocalIntendedYaoRecoveryFaultControllerV1(
    env.MPC_ROUTER.fetch.bind(env.MPC_ROUTER),
    mode,
    token,
  );
  const response = await handleSplitGatewayRequest(
    requestWithoutLocalIntendedYaoRecoveryFaultHeadersV1(request),
    { ...env, MPC_ROUTER: controller },
    ctx,
    dependencies,
  );
  return responseWithLocalIntendedYaoRecoveryFaultOutcomeV1(response, controller.outcome(), token);
}

/**
 * Holds one ECDSA signing prepare after its Wallet Session read until another
 * request changes the wallet's authority, and reports whether it did. Local
 * only.
 */
async function handleSessionAdmissionFault(
  request: Request,
  env: CloudflareD1GatewayEnv,
  ctx: CfExecutionContext,
  dependencies: HostedWalletGatewayDependenciesV1 | undefined,
  rawMode: string | null,
  rawToken: string | null,
): Promise<Response> {
  const mode = parseLocalIntendedSessionAdmissionFaultModeV1(rawMode);
  const token = parseLocalIntendedSessionAdmissionFaultTokenV1(rawToken);
  const url = new URL(request.url);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== ECDSA_SIGN_PREPARE_PATH_V1 ||
    request.method !== 'POST' ||
    !mode ||
    !token
  ) {
    return Response.json({ code: 'invalid_intended_session_admission_fault' }, { status: 400 });
  }
  const database = new LocalIntendedSessionAdmissionFaultDatabaseV1(env.SIGNER_DB);
  const response = await handleSplitGatewayRequest(
    requestWithoutLocalIntendedSessionAdmissionFaultHeadersV1(request),
    { ...env, SIGNER_DB: database },
    ctx,
    dependencies,
  );
  return responseWithLocalIntendedSessionAdmissionFaultOutcomeV1(
    response,
    database.outcome(),
    token,
  );
}

/**
 * Refuses the batch that would commit one auth-method revocation, as a failed
 * commit, and reports whether the request's Email OTP code was spent anywhere
 * but in that batch. Local only.
 */
async function handleRevokeFault(
  request: Request,
  env: CloudflareD1GatewayEnv,
  ctx: CfExecutionContext,
  dependencies: HostedWalletGatewayDependenciesV1 | undefined,
  rawMode: string | null,
  rawToken: string | null,
): Promise<Response> {
  const mode = parseLocalIntendedRevokeFaultModeV1(rawMode);
  const token = parseLocalIntendedRevokeFaultTokenV1(rawToken);
  const url = new URL(request.url);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !(
      WALLET_REVOKE_AUTH_METHOD_PATH_PATTERN_V1.test(url.pathname) ||
      LINKED_DEVICE_REVOKE_PATH_PATTERN_V1.test(url.pathname)
    ) ||
    request.method !== 'POST' ||
    !mode ||
    !token
  ) {
    return Response.json({ code: 'invalid_intended_revoke_fault' }, { status: 400 });
  }
  const database = new LocalIntendedRevokeFaultDatabaseV1(env.SIGNER_DB);
  const response = await handleSplitGatewayRequest(
    requestWithoutLocalIntendedRevokeFaultHeadersV1(request),
    { ...env, SIGNER_DB: database },
    ctx,
    dependencies,
  );
  return responseWithLocalIntendedRevokeFaultOutcomeV1(response, database.outcome(), token);
}

/**
 * Loses the Gateway's storage once during one Ed25519 Yao NEAR finalize,
 * right after the batch that made the registration visible committed its
 * decision. Local only.
 */
async function handleYaoFinalizeFault(
  request: Request,
  env: CloudflareD1GatewayEnv,
  ctx: CfExecutionContext,
  dependencies: HostedWalletGatewayDependenciesV1 | undefined,
  rawMode: string | null,
  rawToken: string | null,
): Promise<Response> {
  const mode = parseLocalIntendedYaoFinalizeFaultModeV1(rawMode);
  const token = parseLocalIntendedYaoFinalizeFaultTokenV1(rawToken);
  const url = new URL(request.url);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== WALLET_REGISTRATION_NEAR_PROVISIONING_PATH_V1 ||
    request.method !== 'POST' ||
    !mode ||
    !token
  ) {
    return Response.json({ code: 'invalid_intended_yao_finalize_fault' }, { status: 400 });
  }
  const database = new LocalIntendedYaoFinalizeFaultDatabaseV1(env.SIGNER_DB);
  const response = await handleSplitGatewayRequest(
    requestWithoutLocalIntendedYaoFinalizeFaultHeadersV1(request),
    { ...env, SIGNER_DB: database },
    ctx,
    dependencies,
  );
  return responseWithLocalIntendedYaoFinalizeFaultOutcomeV1(response, database.outcome(), token);
}

/**
 * Keeps one NEAR finalize the Gateway sends the Router after authorizing it,
 * run or withheld, or sends a kept one to the Router again: a request
 * authorized before a recovery, arriving after it. Local only.
 */
async function handleYaoSigningFault(
  request: Request,
  env: CloudflareD1GatewayEnv,
  ctx: CfExecutionContext,
  dependencies: HostedWalletGatewayDependenciesV1 | undefined,
  rawMode: string | null,
  rawToken: string | null,
): Promise<Response> {
  const mode = parseLocalIntendedYaoSigningFaultModeV1(rawMode);
  const token = parseLocalIntendedYaoSigningFaultTokenV1(rawToken);
  const url = new URL(request.url);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== ROUTER_AB_ED25519_SIGNING_FINALIZE_PATH_V1 ||
    request.method !== 'POST' ||
    !mode ||
    !token
  ) {
    return Response.json({ code: 'invalid_intended_yao_signing_fault' }, { status: 400 });
  }
  if (mode === 'release_signing_finalize') {
    return await releaseLocalIntendedYaoSigningFinalizeV1(env.MPC_ROUTER, token);
  }
  if (mode === 'arm_signing_worker_hold' || mode === 'read_signing_worker_hold') {
    return await commandLocalIntendedSigningWorkerHoldV1(
      env.SIGNING_WORKER,
      env.ROUTER_AB_GATEWAY_TO_SIGNING_WORKER_PRESIGN_AUTH_SECRET,
      mode,
      await request.json().catch(() => null),
    );
  }
  const controller = new LocalIntendedYaoSigningFaultControllerV1(
    env.MPC_ROUTER.fetch.bind(env.MPC_ROUTER),
    mode,
    token,
  );
  const response = await handleSplitGatewayRequest(
    requestWithoutLocalIntendedYaoSigningFaultHeadersV1(request),
    { ...env, MPC_ROUTER: controller },
    ctx,
    dependencies,
  );
  return responseWithLocalIntendedYaoSigningFaultOutcomeV1(response, controller.outcome());
}

/**
 * Loses the Gateway's storage once during one Ed25519 Yao export admission,
 * right after the batch that authorized the export committed, then sends the
 * identical request again inside this Gateway request. The client sees only
 * the second answer. Local only.
 */
async function handleYaoExportFault(
  request: Request,
  env: CloudflareD1GatewayEnv,
  ctx: CfExecutionContext,
  dependencies: HostedWalletGatewayDependenciesV1 | undefined,
  rawMode: string | null,
  rawToken: string | null,
): Promise<Response> {
  const mode = parseLocalIntendedYaoExportFaultModeV1(rawMode);
  const token = parseLocalIntendedYaoExportFaultTokenV1(rawToken);
  const url = new URL(request.url);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== ROUTER_AB_ED25519_YAO_EXPORT_ADMISSION_PATH_V1 ||
    request.method !== 'POST' ||
    !mode ||
    !token
  ) {
    return Response.json({ code: 'invalid_intended_yao_export_fault' }, { status: 400 });
  }
  const sanitized = requestWithoutLocalIntendedYaoExportFaultHeadersV1(request);
  const body = await sanitized.arrayBuffer();
  const database = new LocalIntendedYaoExportFaultDatabaseV1(env.SIGNER_DB);
  const interrupted = await handleSplitGatewayRequest(
    new Request(sanitized.url, { method: 'POST', headers: sanitized.headers, body }),
    { ...env, SIGNER_DB: database },
    ctx,
    dependencies,
  );
  await interrupted.arrayBuffer();
  const retried = await handleSplitGatewayRequest(
    new Request(sanitized.url, { method: 'POST', headers: sanitized.headers, body }),
    env,
    ctx,
    dependencies,
  );
  return responseWithLocalIntendedYaoExportFaultOutcomeV1(
    retried,
    database.outcome({ interruptedOk: interrupted.ok, retriedOk: retried.ok }),
    token,
  );
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

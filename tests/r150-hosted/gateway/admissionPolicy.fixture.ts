import { CloudflareD1RouterAbNormalSigningAdmissionStore } from '../../../packages/wallet-server/src/router/cloudflare/d1/signingAdmission/d1RouterAbNormalSigningAdmissionStore';
import { createRouterAbNormalSigningAdmissionAdapter, InMemoryRouterAbNormalSigningAdmissionStore } from '../../../packages/wallet-server/src/router/domains/signingOperations/routerAbNormalSigningAdmissionCore';
import type { RouterAbNormalSigningAdmissionInput } from '../../../packages/wallet-server/src/router/domains/signingOperations/routerAbNormalSigningAdmission';
import type { D1DatabaseLike } from '../../../packages/wallet-server/src/storage/tenantRoute';
import { parseMpcMaterialActivationId } from '../../../packages/shared-ts/src/utils/domainIds';
import { TracedD1Database } from './d1Trace';

const memory = new InMemoryRouterAbNormalSigningAdmissionStore();

function admissionInput(url: URL): RouterAbNormalSigningAdmissionInput {
  const runtimePolicyScope = {
    orgId: 'policy-org',
    projectId: 'policy-project',
    envId: url.searchParams.has('other-environment') ? 'other-env' : 'policy-env',
    signingRootVersion: url.searchParams.has('other-version') ? 'other-version' : 'policy-version',
  };
  const walletId = url.searchParams.has('other-wallet') ? 'other-wallet' : 'policy-wallet';
  const expiresAtMs = url.searchParams.has('expired') ? 1 : Date.now() + 60_000;
  if (url.searchParams.has('ed25519')) {
    return {
      curve: 'ed25519', phase: 'prepare', walletId,
      authorityKind: 'wallet_authority_v1', authorityId: 'policy-authority',
      thresholdSessionId: 'policy-threshold', walletSessionId: 'policy-session',
      quotaId: 'policy-quota', requestId: 'policy-request', expiresAtMs,
      signingWorkerId: 'policy-worker', runtimePolicyScope,
    };
  }
  const activation = parseMpcMaterialActivationId('policy-activation');
  if (!activation.ok) throw new Error(activation.error.message);
  return {
    curve: 'ecdsa', phase: 'prepare', walletId, materialActivationId: activation.value,
    authorizationIdentity: { kind: 'reusable_wallet_session', walletSessionId: 'policy-session' },
    requestId: 'policy-request', expiresAtMs, signingWorkerId: 'policy-worker',
    keyHandle: 'policy-key', runtimePolicyScope,
  };
}

export async function handlePolicyRequest(request: Request, database: D1DatabaseLike): Promise<Response> {
  const url = new URL(request.url);
  const input = admissionInput(url);
  const traced = new TracedD1Database(database);
  const store = url.searchParams.has('memory') ? memory : new CloudflareD1RouterAbNormalSigningAdmissionStore({
    database: traced,
    storageNamespace: url.searchParams.has('other-namespace') ? 'other-namespace' : 'policy-namespace',
  });
  switch (url.pathname) {
    case '/reject-project':
      await store.setProjectPolicy(input.runtimePolicyScope, { kind: 'rejected', retryAfterMs: 1_000 });
      break;
    case '/clear-project':
      await store.clearProjectPolicy(input.runtimePolicyScope);
      break;
    case '/throttle':
      await store.setAbuseDecision(input, { kind: 'rate_limited', retryAfterMs: 1_000 });
      break;
    case '/reject-abuse':
      await store.setAbuseDecision(input, { kind: 'rejected', retryAfterMs: 1_000 });
      break;
    case '/clear-abuse':
      await store.clearAbuseDecision(input);
      break;
    case '/evaluate': {
      try {
        const decision = await createRouterAbNormalSigningAdmissionAdapter(store).evaluatePolicy(input);
        return traced.response(Response.json(decision, { status: decision.ok ? 200 : decision.status }));
      } catch {
        return traced.response(Response.json({ error: 'invalid_policy' }, { status: 500 }));
      }
    }
    default:
      return new Response(null, { status: 404 });
  }
  return new Response(null, { status: 204 });
}

async function fetch(request: Request, env: { DB: D1DatabaseLike }): Promise<Response> {
  return handlePolicyRequest(request, env.DB);
}

export default { fetch };

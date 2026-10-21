/** Full SDK qualification. The ingress protects all routes with a disposable token. */
import {
  handleLocalHostedWalletGatewayRequestV1,
  type LocalHostedWalletGatewayEnv,
} from '../../packages/wallet-server/src/localHostedWalletGatewayHandler';
import type { CfExecutionContext } from '../../packages/wallet-server/src/router/cloudflare/runtime/cloudflare.types';
import {
  requireCanonicalString,
  requireRecord,
} from '../../packages/shared-ts/src/utils/validation';
import { exactRecord } from '../../packages/shared-ts/src/utils/exactRecord';

async function fetch(
  request: Request,
  env: LocalHostedWalletGatewayEnv,
  ctx: CfExecutionContext,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (pathname === '/router-ab/internal/tenant-root/creation/v1/create') {
    const headers = new Headers(request.headers);
    headers.set(
      'x-router-ab-internal-service-auth',
      requireCanonicalString(
        env.ROUTER_AB_INTERNAL_SERVICE_AUTH_SECRET,
        'internal service credential',
      ),
    );
    return env.MPC_ROUTER.fetch(new Request(request, { headers }));
  }
  if (pathname === '/fixture/prepare' || pathname === '/fixture/restoration-owner') {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const body = exactRecord(await request.json(), ['walletId'], 'hosted ML-DSA fixture');
    const walletId = requireCanonicalString(body.walletId, 'walletId');
    const deployment = requireRecord(JSON.parse(env.WALLET_LOCAL_DEPLOYMENT_JSON), 'deployment');
    const scope = requireRecord(deployment.deployment, 'deployment identity');
    if (pathname === '/fixture/restoration-owner') {
      const row = await env.SIGNER_DB.prepare(
        `SELECT json_extract(record_json,'$.preparation.owner.walletAuthMethodId') owner
         FROM router_ab_yao_versioned_json_records
         WHERE namespace=? AND org_id=? AND project_id=? AND env_id=? AND record_key=?`,
      )
        .bind(
          env.SEAMS_TENANT_STORAGE_NAMESPACE,
          scope.orgId,
          scope.projectId,
          scope.environmentId,
          `ml-dsa-registration:${JSON.stringify([walletId, 'near-ml-dsa-65:1'])}`,
        )
        .first();
      return Response.json(row);
    }
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.set(
      'x-router-ab-internal-service-auth',
      requireCanonicalString(
        env.ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET,
        'Gateway service credential',
      ),
    );
    return env.MPC_ROUTER.fetch(
      new Request('https://router-ab.internal/router-ab/ml-dsa/registration/prepare', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          wallet: {
            org: scope.orgId,
            project: scope.projectId,
            environment: scope.environmentId,
            wallet: walletId,
          },
        }),
      }),
    );
  }
  return handleLocalHostedWalletGatewayRequestV1(request, env, ctx);
}
export default { fetch };

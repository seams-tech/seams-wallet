/** Disposable qualification composition. Fixture routes require their own test token. */
import { timingSafeEqual } from 'node:crypto';
import {
  createCloudflareD1RouterApiAuthService,
  createFetchRouter,
  gatewayOwner,
  seedOwner,
  seedCustody,
} from './mlDsaGatewayRegistration.fixtures';
import { D1WalletMlDsaRegistration } from '../../packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletMlDsaRegistration';
import { sha256Utf8DigestB64u } from '../../packages/shared-ts/src/utils/canonicalPrimitives';
import { exactRecord } from '../../packages/shared-ts/src/utils/exactRecord';
import { requireCanonicalString } from '../../packages/shared-ts/src/utils/validation';
import { parseWalletId } from '../../packages/shared-ts/src/utils/domainIds';
import { requireParsed } from '../../packages/shared-ts/src/passkey-custody/primitives';
import { ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1 } from '../../packages/wallet-server/src/core/ThresholdService/routerAb/internalServiceHttp';
import type { D1DatabaseLike } from '../../packages/wallet-server/src/storage/tenantRoute';
import signerModule from '../../wasm/near_signer/pkg/wasm_signer_worker_bg.wasm';

type Environment = {
  readonly SIGNER_DB: D1DatabaseLike;
  readonly MPC_ROUTER: { fetch(request: Request): Promise<Response> };
  readonly PROBE_TOKEN: string;
  readonly GATEWAY_TOKEN: string;
};
const scope = {
  namespace: 'ml-dsa-qualification',
  orgId: 'ml-dsa-qualification',
  projectId: 'wallet',
  envId: 'temporary',
};
const origin = 'https://wallet.example.test';
function authorized(request: Request, token: string): boolean {
  const provided = Buffer.from(request.headers.get('X-ML-DSA-Test-Token') ?? '');
  const expected = Buffer.from(token);
  return (
    expected.length >= 32 &&
    provided.length === expected.length &&
    timingSafeEqual(provided, expected)
  );
}
function service(env: Environment) {
  return createCloudflareD1RouterApiAuthService({
    database: env.SIGNER_DB,
    ...scope,
    ecdsaStrictRegistration: {
      topology: unavailableEcdsa,
      registerWithTenantRoot: unavailableEcdsa,
      activate: unavailableEcdsa,
    },
    tenantRootCustodyLineage: {
      resolveActiveLineage: noTenantRootLineage,
      resolveActiveLineageForRuntimeScope: noTenantRootLineage,
    },
    signerWasmModuleOrPath: signerModule,
    mlDsaRegistrationProxy: {
      internalServiceAuthSecret: env.GATEWAY_TOKEN,
      fetch: env.MPC_ROUTER.fetch.bind(env.MPC_ROUTER),
    },
  });
}
async function fixture(request: Request, env: Environment): Promise<Response> {
  if (!authorized(request, env.PROBE_TOKEN)) return new Response(null, { status: 403 });
  const path = new URL(request.url).pathname;
  const raw: unknown = await request.json();
  const r = exactRecord(
    raw,
    path === '/fixture/prepare' || path === '/fixture/state'
      ? ['walletId']
      : ['walletId', 'credentialIdB64u', 'credentialPublicKeyB64u', 'custody'],
    'qualification fixture',
  );
  const walletId = requireParsed(parseWalletId(r.walletId), 'walletId');
  if (!walletId.startsWith('ml-dsa-qualification-'))
    throw new Error('Disposable wallet prefix required');
  if (path === '/fixture/state') {
    const custody = await env.SIGNER_DB.prepare(
      `SELECT record_key,version,record_json FROM router_ab_yao_versioned_json_records
      WHERE namespace=? AND org_id=? AND project_id=? AND env_id=? AND substr(record_key,1,17)='passkey-envelope:'
      AND json_extract(record_json,'$.walletId')=? ORDER BY record_key`,
    )
      .bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, walletId)
      .all();
    const operations = await env.SIGNER_DB.prepare(
      `SELECT operation.operation_id,operation.lifecycle_kind,operation.result_kind
      FROM authorized_operations operation JOIN wallet_operation_owners owner
      ON owner.namespace=operation.namespace AND owner.tenant_id=operation.tenant_id AND owner.authorized_operation_id=operation.authorized_operation_id
      WHERE owner.namespace=? AND owner.org_id=? AND owner.project_id=? AND owner.env_id=? AND owner.wallet_id=? ORDER BY operation.operation_id`,
    )
      .bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, walletId)
      .all();
    if (!custody.results || !operations.results) throw new Error('D1 result is absent');
    const published = await new D1WalletMlDsaRegistration({
      database: env.SIGNER_DB,
      scope,
      proxy: {
        internalServiceAuthSecret: env.GATEWAY_TOKEN,
        fetch: env.MPC_ROUTER.fetch.bind(env.MPC_ROUTER),
      },
    }).readPublished(walletId, 'near-ml-dsa-65:1');
    return Response.json({
      custodyDigest: await sha256Utf8DigestB64u(JSON.stringify(custody.results)),
      custodyRows: custody.results.length,
      operations: operations.results,
      published,
    });
  }
  if (path === '/fixture/prepare') {
    const headers = new Headers({ 'content-type': 'application/json' });
    headers.set(ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1, env.GATEWAY_TOKEN);
    return env.MPC_ROUTER.fetch(
      new Request('https://router-ab.internal/router-ab/ml-dsa/registration/prepare', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          wallet: {
            org: scope.orgId,
            project: scope.projectId,
            environment: scope.envId,
            wallet: walletId,
          },
        }),
      }),
    );
  }
  if (path !== '/fixture/owner') return new Response(null, { status: 404 });
  const owner = await gatewayOwner({
    walletId,
    credentialIdB64u: requireCanonicalString(r.credentialIdB64u, 'credentialIdB64u'),
    credentialPublicKeyB64u: requireCanonicalString(
      r.credentialPublicKeyB64u,
      'credentialPublicKeyB64u',
    ),
    label: walletId,
  });
  await seedOwner(env.SIGNER_DB, scope, owner);
  await env.SIGNER_DB.prepare(
    `INSERT INTO wallet_execution_generations
    (namespace,org_id,project_id,env_id,wallet_id,generation,origin,origin_id,state,registration_completion)
    VALUES (?,?,?,?,?,1,'registration','qualification','active','established')`,
  )
    .bind(scope.namespace, scope.orgId, scope.projectId, scope.envId, walletId)
    .run();
  await seedCustody(env.SIGNER_DB, scope, owner, r.custody);
  const intent = await service(env).walletAuthMethods.createAddSignerIntent({
    command: {
      subject: { kind: 'wallet_signer_management', walletId },
      signerSelection: { mode: 'ml_dsa_65', mlDsa: { signerSlot: 1 } },
    },
    orgId: scope.orgId,
    runtimePolicyScope: {
      orgId: scope.orgId,
      projectId: scope.projectId,
      envId: scope.envId,
      signingRootVersion: 'default',
    },
    expectedOrigin: origin,
  });
  return Response.json({
    owner: { walletAuthMethodId: owner.authMethod.walletAuthMethodId },
    intent,
  });
}
async function fetch(request: Request, env: Environment): Promise<Response> {
  if (new URL(request.url).pathname.startsWith('/fixture/')) {
    try {
      return await fixture(request, env);
    } catch {
      return Response.json({ error: 'Qualification fixture failed' }, { status: 400 });
    }
  }
  return createFetchRouter(
    service(env),
    { corsOrigins: [origin], hostedWalletOrigins: [origin] },
    { kind: 'inline' },
  )(request);
}
export default { fetch };

function unavailableEcdsa(): never {
  throw new Error('This qualification deployment provisions ML-DSA only');
}
async function noTenantRootLineage(): Promise<null> {
  return null;
}

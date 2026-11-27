import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { applySignerD1Migrations } from '../fixtures/signer-d1.mjs';
import { seedExecutionGeneration } from './execution-generation.scenario.mjs';
import { verifySigningCredit } from './signing-credit.scenario.mjs';

// The default tenant maximum: 100 signatures and 30 days.
const DEFAULT_TENANT_LIMITS = { maxTtlMs: 30 * 24 * 60 * 60_000, maxRemainingUses: 100 };

class BillingRefusingDirectory {
  home() {
    return { kind: 'direct' };
  }
  async publish() {
    throw new BillingRefusal();
  }
}
class BillingRefusal extends Error {
  code = 'billing_credit_exhausted';
  constructor() {
    super('The application has no credit for a newly billable login');
  }
}

const output = resolve('.artifacts/signing-credit');
const scope = { namespace: 'signing-credit', orgId: 'org', projectId: 'project', envId: 'prod' };
await mkdir(output, { recursive: true });
const bundle = await build({
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  tsconfig: 'packages/mpc-wallet-server/tsconfig.json',
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `
 export { AuthorizationService } from './packages/mpc-wallet-server/src/authorization/service';
 export { capabilityPolicyPort } from './packages/mpc-wallet-server/src/authorization/capabilityPolicy';
 export { CloudflareD1AuthorizationStore } from './packages/mpc-wallet-server/src/router/cloudflare/d1/authorization/d1AuthorizationStore';
 export { D1WalletExecutionAuthority } from './packages/mpc-wallet-server/src/router/cloudflare/d1/registration/d1WalletExecutionAuthority';
 export { prepareD1WalletAuthorityPutStatement } from './packages/mpc-wallet-server/src/router/cloudflare/d1/wallet/d1WalletAuthorityStore';
 export { prepareD1WalletAuthMethodV2PutStatement } from './packages/mpc-wallet-server/src/core/d1WalletAuthMethodStore';
 export { buildLinkedDeviceManagementAuthorityFixture } from './tests/unit/helpers/linkedDeviceManagement.fixtures';
 export { buildFullOwnerPermissionsV1 } from './packages/shared-ts/src/authorization/delegatedAuthority';
 export { buildStepUpSigningOperationFixture } from './tests/unit/helpers/authorizedOperation.fixtures';
 export { TracedD1Database } from './tests/r150-hosted/gateway/d1Trace';
`,
  },
});
const bundlePath = resolve(output, 'production-api.mjs');
await writeFile(bundlePath, bundle.outputFiles[0].text);
const api = await import(pathToFileURL(bundlePath));
const runtime = new Miniflare({
  modules: true,
  script: 'export default {fetch(){return new Response("Signing credit acceptance");}};',
  d1Databases: ['SIGNER_DB'],
  compatibilityDate: '2026-06-12',
  port: 0,
});
try {
  const database = await runtime.getD1Database('SIGNER_DB');
  await applySignerD1Migrations(database);
  const now = Date.now();
  const fixture = await api.buildLinkedDeviceManagementAuthorityFixture({
    label: 'signing-credit',
    keyFamily: 'ed25519',
    permissions: api.buildFullOwnerPermissionsV1(),
    provenance: 'wallet_registration',
    expiresAtMs: now + 3600000,
  });
  await seedExecutionGeneration({ api, database, scope, walletId: fixture.authority.walletId });
  await database.batch([
    api.prepareD1WalletAuthorityPutStatement({ database, scope, authority: fixture.authority }),
    api.prepareD1WalletAuthMethodV2PutStatement({ database, scope, record: fixture.authMethod }),
  ]);
  const store = new api.CloudflareD1AuthorizationStore({
    database,
    namespace: scope.namespace,
    walletSignerScope: scope,
  });
  const service = new api.AuthorizationService({
    walletSessionLimits: { readWalletSessionLimits: async () => DEFAULT_TENANT_LIMITS },
    policy: api.capabilityPolicyPort,
    sessions: store,
    grants: store,
    evidence: store,
    authorizedOperations: store,
    audit: {},
  });
  const issued = await service.issueDirectWalletSessionAuthorizationV2({
    tenantId: fixture.issuedSession.session.tenantId,
    principalId: fixture.issuedSession.session.principalId,
    walletId: fixture.authority.walletId,
    authority: fixture.authority,
    walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
    mintId: fixture.issuedSession.session.mintId,
    requestedBudget: { ttlMs: 3600000, remainingUses: 7 },
    issuedAtMs: now,
  });
  assert.equal(issued.kind, 'issued');
  await verifySigningCredit({
    api,
    database,
    scope,
    session: issued.session,
    authMethod: fixture.authMethod,
    nowMs: now,
    output,
  });
  const refusedService = new api.AuthorizationService({
    walletSessionLimits: { readWalletSessionLimits: async () => DEFAULT_TENANT_LIMITS },
    policy: api.capabilityPolicyPort,
    sessions: store,
    grants: store,
    evidence: store,
    authorizedOperations: store,
    audit: {},
    sessionRouting: new BillingRefusingDirectory(),
  });
  await assert.rejects(
    refusedService.issueDirectWalletSessionAuthorizationV2({
      tenantId: fixture.issuedSession.session.tenantId,
      principalId: fixture.issuedSession.session.principalId,
      walletId: fixture.authority.walletId,
      authority: fixture.authority,
      walletAuthMethodId: fixture.authMethod.walletAuthMethodId,
      mintId: 'wallet-mint:billing-refusal',
      requestedBudget: { ttlMs: 3_599_999, remainingUses: 7 },
      issuedAtMs: now + 1,
    }),
    { code: 'billing_credit_exhausted' },
  );
  await writeFile(
    resolve(output, 'login-refusal.json'),
    JSON.stringify(
      { newBillableLoginRefused: true, noCredentialReturned: true, existingPublicationCall: true },
      null,
      2,
    ),
  );
  console.log(`Signing credit acceptance passed: ${output}/signing-credit.json`);
} finally {
  await runtime.dispose();
}

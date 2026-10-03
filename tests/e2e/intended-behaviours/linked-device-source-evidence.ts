import { expect, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseTenantId } from '@shared/authorization/capabilityKinds';
import { parseWalletId } from '@shared/utils/domainIds';
import { requireNonEmptyString } from '@shared/utils/validation';
import { D1WalletAuthMethodStore } from '@server/core/d1WalletAuthMethodStore';
import { D1WalletStore } from '@server/core/d1WalletStore';
import { CloudflareD1AuthorizationStore } from '@server/router/cloudflare/d1/authorization/d1AuthorizationStore';
import { createD1LinkedDeviceVerifiedLinkSourceReaderV1 } from '@server/router/cloudflare/d1/deviceLinking/d1LinkedDeviceVerifiedLinkSourceReader';
import { D1WalletAuthorityStore } from '@server/router/cloudflare/d1/wallet/d1WalletAuthorityStore';
import { loadNodeDatabaseSync, nodeSqliteConnection } from '@server/router/node/nodeSqlite';
import { createSyncSqliteDatabase } from '@server/storage/syncSqlite';
import { isolatedGatewayDatabasePath } from './local-gateway-database';

export async function verifyRegisteredLinkSource(testInfo: TestInfo): Promise<void> {
  const DatabaseSync = await loadNodeDatabaseSync();
  const sqlite = new DatabaseSync(await isolatedGatewayDatabasePath(), { readOnly: true });
  try {
    const database = createSyncSqliteDatabase(nodeSqliteConnection(sqlite));
    const sessions = await database.prepare(`
      SELECT namespace, org_id, project_id, env_id, tenant_id, wallet_id,
             wallet_session_id, authorization_id
        FROM wallet_session_authorizations_v2
       WHERE retired_at_ms IS NULL
    `).all<Record<string, unknown>>();
    expect(sessions.results?.length).toBeGreaterThan(0);
    const verified = [];
    for (const row of sessions.results ?? []) {
      const scope = {
        namespace: requireNonEmptyString(row.namespace, 'namespace'),
        orgId: requireNonEmptyString(row.org_id, 'orgId'),
        projectId: requireNonEmptyString(row.project_id, 'projectId'),
        envId: requireNonEmptyString(row.env_id, 'envId'),
      };
      const tenantId = parseTenantId(row.tenant_id);
      const walletId = parseWalletId(row.wallet_id);
      if (!tenantId.ok || !walletId.ok) throw new Error('Invalid registered source identity');
      const authorizationService = new CloudflareD1AuthorizationStore({
        database,
        namespace: scope.namespace,
        walletSignerScope: scope,
      });
      const reader = createD1LinkedDeviceVerifiedLinkSourceReaderV1({
        authorizationService,
        authorityStore: new D1WalletAuthorityStore({ database, scope }),
        authMethodStore: new D1WalletAuthMethodStore({ database, ...scope, ensureSchema: false }),
        walletStore: new D1WalletStore({ database, ...scope, ensureSchema: false }),
        tenantId: tenantId.value,
      });
      for (const keyFamily of ['ed25519', 'ecdsa_secp256k1'] as const) {
        const source = await reader.readVerifiedSourceV1({
          walletId: walletId.value,
          walletSessionId: requireNonEmptyString(row.wallet_session_id, 'walletSessionId'),
          authorizationId: requireNonEmptyString(row.authorization_id, 'authorizationId'),
          keyFamily,
          requestedAtMs: Date.now(),
        });
        expect(source.authority.provenance.kind).toBe('wallet_registration');
        expect(source.signerManifest.keyFamilies).toEqual(['ed25519', 'ecdsa_secp256k1']);
        verified.push({
          scope,
          walletId: walletId.value,
          keyFamily,
          authorityId: source.authority.authorityId,
          authorityDigestB64u: source.authorityDigestB64u,
          keyManifestDigestB64u: source.keyManifestDigestB64u,
          verifiedRevocationEpoch: source.verifiedRevocationEpoch,
        });
      }
    }
    const evidence = JSON.stringify({
      kind: 'registered_link_source_evidence_v1',
      scope: 'Real local registration resolved through production Wallet Session, auth-method, authority and signer readers before linking; regional placement remains a separate gate.',
      verified,
    }, null, 2);
    await testInfo.attach('registered-link-source', { body: evidence, contentType: 'application/json' });
    const traceDirectory = process.env.SEAMS_INTENDED_TRACE_DIR;
    if (traceDirectory) {
      await mkdir(traceDirectory, { recursive: true });
      await writeFile(path.join(traceDirectory, 'registered-link-source.json'), `${evidence}\n`);
    }
  } finally {
    sqlite.close();
  }
}

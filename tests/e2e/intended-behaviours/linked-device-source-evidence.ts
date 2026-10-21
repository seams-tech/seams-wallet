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
import { openReadOnlyGatewayD1 } from './local-gateway-database';

export async function verifyLinkSource(
  testInfo: TestInfo,
  provenance: 'wallet_registration' | 'wallet_recovery',
): Promise<void> {
  const opened = await openReadOnlyGatewayD1();
  try {
    const { database } = opened;
    const sessions = await database
      .prepare(
        `
      SELECT session.namespace, session.org_id, session.project_id, session.env_id,
             session.tenant_id, session.wallet_id, session.wallet_session_id,
             session.authorization_id
        FROM wallet_session_authorizations_v2 AS session
        JOIN wallet_authorities AS authority
          ON authority.namespace = session.namespace AND authority.org_id = session.org_id
         AND authority.project_id = session.project_id AND authority.env_id = session.env_id
         AND authority.authority_id = session.authority_id
       WHERE session.retired_at_ms IS NULL AND authority.provenance_kind = ?
    `,
      )
      .bind(provenance)
      .all<Record<string, unknown>>();
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
      if (!tenantId.ok || !walletId.ok) throw new Error('Invalid link source identity');
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
        expect(source.authority.provenance.kind).toBe(provenance);
        expect(source.signerManifest.keyFamilies).toEqual(['ed25519', 'ecdsa_secp256k1']);
        verified.push({
          scope,
          provenance,
          walletId: walletId.value,
          keyFamily,
          authorityId: source.authority.authorityId,
          authorityDigestB64u: source.authorityDigestB64u,
          keyManifestDigestB64u: source.keyManifestDigestB64u,
          verifiedRevocationEpoch: source.verifiedRevocationEpoch,
        });
      }
    }
    const evidence = JSON.stringify(
      {
        kind: 'link_source_evidence_v1',
        scope:
          'Real local owner resolved through production Wallet Session, auth-method, authority and signer readers before linking; regional placement remains a separate gate.',
        verified,
      },
      null,
      2,
    );
    await testInfo.attach('link-source', {
      body: evidence,
      contentType: 'application/json',
    });
    const traceDirectory = process.env.SEAMS_INTENDED_TRACE_DIR;
    if (traceDirectory) {
      await mkdir(traceDirectory, { recursive: true });
      await writeFile(path.join(traceDirectory, 'link-source.json'), `${evidence}\n`);
    }
  } finally {
    opened.close();
  }
}

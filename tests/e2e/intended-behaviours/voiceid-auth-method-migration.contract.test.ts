import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type TestInfo } from '@playwright/test';
import { buildFullOwnerPermissionsV1 } from '@shared/authorization/delegatedAuthority';
import { parseVoiceIdDevicePublicKeyB64u } from '@shared/authorization/voiceIdDeviceAssertion';
import { base64UrlEncode } from '@shared/utils/base64';
import { sha256DigestB64u } from '@shared/utils/canonicalPrimitives';
import { allocateWalletAuthMethodId } from '@shared/utils/domainIds';
import {
  buildWalletAuthMethodRecordV2,
  sameWalletAuthMethodRecordV2,
} from '@shared/utils/walletAuthMethodRecord';
import {
  D1WalletAuthMethodStore,
  prepareD1WalletAuthMethodV2PutStatement,
} from '@server/core/d1WalletAuthMethodStore';
import { prepareD1WalletAuthorityPutStatement } from '@server/router/cloudflare/d1/wallet/d1WalletAuthorityStore';
import { AuthorizationService } from '@server/authorization/service';
import { capabilityPolicyPort } from '@server/authorization/capabilityPolicy';
import { CloudflareD1AuthorizationStore } from '@server/router/cloudflare/d1/authorization/d1AuthorizationStore';
import { D1WalletExecutionAuthority } from '@server/router/cloudflare/d1/registration/d1WalletExecutionAuthority';
import {
  buildEmailOtpEcdsaWalletSessionFixture,
  buildLinkedDeviceManagementAuthorityFixture,
} from '../../unit/helpers/linkedDeviceManagement.fixtures';
import { applySignerD1Migrations, openSignerD1 } from '../../fixtures/signer-d1.mjs';
import { seedExecutionGeneration } from '../execution-generation.scenario.mjs';

const MIGRATION = '0084_voiceid_wallet_auth_methods.sql';
const SCOPE = {
  namespace: 'voiceid-method-migration',
  orgId: 'voiceid-org',
  projectId: 'voiceid-project',
  envId: 'test',
};

function normalizeSql(value: string | undefined): string {
  if (!value) throw new Error('Expected a stored SQL definition');
  return value.replace(/\s+/gu, ' ').trim();
}

test('VoiceID table rebuild preserves existing methods and admits one device key', runJourney);

async function runJourney({ page }: { page: unknown }, testInfo: TestInfo): Promise<void> {
  void page;
  const opened = await openSignerD1(MIGRATION);
  try {
    const database = opened.database;
    const passkey = await buildLinkedDeviceManagementAuthorityFixture({
      label: 'voiceid-migration-passkey',
      permissions: buildFullOwnerPermissionsV1(),
      provenance: 'wallet_registration',
      expiresAtMs: Date.now() + 60_000,
    });
    const email = await buildEmailOtpEcdsaWalletSessionFixture({
      label: 'voiceid-migration-email',
      expiresAtMs: Date.now() + 60_000,
    });
    await seedExecutionGeneration({
      api: { D1WalletExecutionAuthority },
      database,
      scope: SCOPE,
      walletId: passkey.authority.walletId,
    });
    await database.batch([
      prepareD1WalletAuthorityPutStatement({ database, scope: SCOPE, authority: passkey.authority }),
      prepareD1WalletAuthMethodV2PutStatement({ database, scope: SCOPE, record: passkey.authMethod }),
      prepareD1WalletAuthorityPutStatement({ database, scope: SCOPE, authority: email.authority }),
      prepareD1WalletAuthMethodV2PutStatement({ database, scope: SCOPE, record: email.authMethod }),
    ]);
    const authorizationStore = new CloudflareD1AuthorizationStore({
      database,
      namespace: SCOPE.namespace,
      walletSignerScope: SCOPE,
    });
    const authorization = new AuthorizationService({
      policy: capabilityPolicyPort,
      sessions: authorizationStore,
      grants: authorizationStore,
      evidence: authorizationStore,
      authorizedOperations: authorizationStore,
      audit: {},
    });
    const issuedAtMs = Date.now();
    const issued = await authorization.issueDirectWalletSessionAuthorizationV2({
      tenantId: passkey.issuedSession.session.tenantId,
      principalId: passkey.issuedSession.session.principalId,
      walletId: passkey.authority.walletId,
      authority: passkey.authority,
      walletAuthMethodId: passkey.authMethod.walletAuthMethodId,
      mintId: passkey.issuedSession.session.mintId,
      remainingUses: 7,
      issuedAtMs,
      expiresAtMs: issuedAtMs + 60_000,
    });
    expect(issued.kind).toBe('issued');
    const triggerBefore = await database.prepare(
      "SELECT sql FROM sqlite_master WHERE name = 'authorized_operation_owner_grant_claim_atomic'",
    ).first<{ sql: string }>();
    expect(triggerBefore?.sql).toContain('wallet_auth_methods');

    await applySignerD1Migrations(database, [MIGRATION]);
    const store = new D1WalletAuthMethodStore({ database, ...SCOPE });
    const passkeyAfter = await store.readByIdV2({
      walletAuthMethodId: passkey.authMethod.walletAuthMethodId,
    });
    const emailAfter = await store.readByIdV2({
      walletAuthMethodId: email.authMethod.walletAuthMethodId,
    });
    expect(passkeyAfter && sameWalletAuthMethodRecordV2(passkeyAfter, passkey.authMethod)).toBe(true);
    expect(emailAfter && sameWalletAuthMethodRecordV2(emailAfter, email.authMethod)).toBe(true);
    const triggerAfter = await database.prepare(
      "SELECT sql FROM sqlite_master WHERE name = 'authorized_operation_owner_grant_claim_atomic'",
    ).first<{ sql: string }>();
    expect(normalizeSql(triggerAfter?.sql)).toBe(normalizeSql(triggerBefore?.sql));
    const foreignKeyCheck = await database.prepare('PRAGMA foreign_key_check').all();
    expect(foreignKeyCheck.results).toEqual([]);
    const survivingSession = await database.prepare(
      `SELECT wallet_auth_method_id FROM wallet_session_authorizations_v2
        WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ? AND mint_id = ?`,
    ).bind(
      SCOPE.namespace,
      SCOPE.orgId,
      SCOPE.projectId,
      SCOPE.envId,
      String(passkey.issuedSession.session.mintId),
    ).first<{ wallet_auth_method_id: string }>();
    expect(survivingSession?.wallet_auth_method_id).toBe(passkey.authMethod.walletAuthMethodId);

    const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
    if (!('publicKey' in keys)) throw new Error('VoiceID public key was unavailable');
    const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
    const deviceKeyId = await sha256DigestB64u(publicKey);
    const devicePublicKeyB64u = parseVoiceIdDevicePublicKeyB64u(base64UrlEncode(publicKey));
    const nowMs = Date.now();
    const voiceMethod = buildWalletAuthMethodRecordV2({
      version: 'wallet_auth_method_v2',
      walletAuthMethodId: allocateWalletAuthMethodId(randomUUID()),
      walletId: passkey.authority.walletId,
      walletAuthorityId: passkey.authority.authorityId,
      kind: 'voiceid',
      status: 'active',
      deviceKeyId,
      devicePublicKeyB64u,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      activatedAtMs: nowMs,
    });
    await store.putV2(voiceMethod);
    const storedVoiceMethod = await store.readByIdV2({
      walletAuthMethodId: voiceMethod.walletAuthMethodId,
    });
    expect(storedVoiceMethod && sameWalletAuthMethodRecordV2(storedVoiceMethod, voiceMethod)).toBe(true);
    const activeVoiceId = await store.getActiveVoiceIdV2({
      walletId: passkey.authority.walletId,
      walletAuthMethodId: voiceMethod.walletAuthMethodId,
      walletAuthorityId: passkey.authority.authorityId,
    });
    expect(activeVoiceId?.deviceKeyId).toBe(deviceKeyId);
    expect(await store.getActiveVoiceIdV2({
      walletId: email.authority.walletId,
      walletAuthMethodId: voiceMethod.walletAuthMethodId,
      walletAuthorityId: passkey.authority.authorityId,
    })).toBeNull();

    const duplicate = buildWalletAuthMethodRecordV2({
      version: 'wallet_auth_method_v2',
      walletAuthMethodId: allocateWalletAuthMethodId(randomUUID()),
      walletId: passkey.authority.walletId,
      walletAuthorityId: passkey.authority.authorityId,
      kind: 'voiceid',
      status: 'active',
      deviceKeyId,
      devicePublicKeyB64u,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      activatedAtMs: nowMs,
    });
    await expect(store.putV2(duplicate)).rejects.toThrow();
    expect(await store.readByIdV2({ walletAuthMethodId: duplicate.walletAuthMethodId })).toBeNull();

    const reportPath = testInfo.outputPath('voiceid-auth-method-migration.json');
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify({
      schemaVersion: 'voiceid_auth_method_migration_journey_v1',
      status: 'passed',
      cases: [
        'preexisting_passkey_preserved',
        'preexisting_email_otp_preserved',
        'authorized_operation_trigger_preserved',
        'foreign_keys_valid',
        'preexisting_wallet_session_preserved',
        'voiceid_method_round_trip',
        'active_voiceid_lookup_checks_wallet_and_authority',
        'duplicate_voiceid_device_key_rejected',
      ],
    }, null, 2)}\n`);
    await testInfo.attach('voiceid-auth-method-migration.json', {
      path: reportPath,
      contentType: 'application/json',
    });
  } finally {
    await opened.close();
  }
}

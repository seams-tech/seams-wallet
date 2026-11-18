import { expect, test } from '@playwright/test';
import { buildFullOwnerPermissionsV1 } from '@shared/authorization/delegatedAuthority';
import { parseVoiceIdDevicePublicKeyB64u } from '@shared/authorization/voiceIdDeviceAssertion';
import { base64UrlEncode } from '@shared/utils/base64';
import { sha256DigestB64u } from '@shared/utils/canonicalPrimitives';
import { allocateWalletAuthMethodId, parseWebAuthnCredentialIdB64u } from '@shared/utils/domainIds';
import { requireParsed } from '@shared/passkey-custody/primitives';
import {
  buildWalletAuthMethodRecordV2,
  type ActivePasskeyWalletAuthMethodRecordV2,
  type WalletAuthMethodRecordV2,
} from '@shared/utils/walletAuthMethodRecord';
import { deriveWebAuthnAuthenticatorDeviceInfo } from '@shared/utils/webauthnDeviceInfo';
import type { D1DatabaseLike } from '../../../packages/wallet-server/src/storage/tenantRoute';
import { prepareD1TenantStatement } from '../../../packages/wallet-server/src/core/d1TenantStore';
import {
  D1WalletAuthMethodStore,
  prepareD1WalletAuthMethodPutStatement,
  prepareD1WalletAuthMethodV2PutStatement,
} from '../../../packages/wallet-server/src/core/d1WalletAuthMethodStore';
import { CloudflareD1EmailOtpEnrollmentStore } from '../../../packages/wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpEnrollmentStore';
import { D1WalletExecutionAuthority } from '../../../packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletExecutionAuthority';
import { createCloudflareD1VersionedJsonRecordStore } from '../../../packages/wallet-server/src/router/cloudflare/d1/versionedJson/d1VersionedJsonRecordStore';
import { prepareD1WalletAuthorityPutStatement } from '../../../packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletAuthorityStore';
import { CloudflareD1WebAuthnStore } from '../../../packages/wallet-server/src/router/cloudflare/d1/webauthn/d1WebAuthnStore';
import { openSignerD1 } from '../../fixtures/signer-d1.mjs';
import { seedExecutionGeneration } from '../../e2e/execution-generation.scenario.mjs';
import { buildLinkedDeviceManagementAuthorityFixture } from '../../unit/helpers/linkedDeviceManagement.fixtures';
import { committedRecordFixture, readRecordFixture } from './recordFixtures';

/* D1 rows of the auth tables, as today's writers make them. The new Auth Worker must read
   these rows, or its migration must convert them. Areas 3.12 to 3.14 of the audit. */

const SCOPE = {
  namespace: 'conformance-records',
  orgId: 'conformance-org',
  projectId: 'conformance-project',
  envId: 'test',
} as const;
const WALLET_ID = 'wallet:conformance-records';
const RP_ID = 'wallet.example.test';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
/** Far in the future, so that a consume from the fixture is never expired. */
const CHALLENGE_EXPIRES_AT_MS = 4_102_444_800_000;

/** The tables that hold auth records, with the columns that a reader uses. */
const AUTH_TABLES = {
  wallet_auth_methods: 'SELECT * FROM wallet_auth_methods ORDER BY wallet_auth_method_id',
  webauthn_authenticators: 'SELECT * FROM webauthn_authenticators ORDER BY credential_id_b64u',
  webauthn_credential_bindings:
    'SELECT * FROM webauthn_credential_bindings ORDER BY credential_id_b64u',
  webauthn_challenges: 'SELECT * FROM webauthn_challenges ORDER BY challenge_id',
  email_otp_wallet_enrollments: 'SELECT * FROM email_otp_wallet_enrollments ORDER BY wallet_id',
  // created_at_ms and updated_at_ms are the database clock, not record content.
  router_ab_yao_versioned_json_records:
    'SELECT namespace, org_id, project_id, env_id, record_key, version, record_json FROM router_ab_yao_versioned_json_records ORDER BY record_key',
} as const;
type AuthTable = keyof typeof AUTH_TABLES;
type AuthTableRows = Record<AuthTable, Record<string, unknown>[]>;

const authorityFixture = buildLinkedDeviceManagementAuthorityFixture({
  label: 'conformance-records',
  permissions: buildFullOwnerPermissionsV1(),
  provenance: 'wallet_registration',
  identity: {
    walletId: WALLET_ID,
    authorityId: 'authority:conformance-records',
    walletAuthMethodId: 'auth-method:conformance-passkey-active',
    rpId: RP_ID,
  },
});

async function openAuthorityDatabase() {
  const runtime = await openSignerD1();
  const { authority } = await authorityFixture;
  await seedExecutionGeneration({
    api: { D1WalletExecutionAuthority },
    database: runtime.database,
    scope: SCOPE,
    walletId: authority.walletId,
  });
  await prepareD1WalletAuthorityPutStatement({
    database: runtime.database,
    scope: SCOPE,
    authority,
  }).run();
  return runtime;
}

function credentialId(fill: number) {
  return requireParsed(
    parseWebAuthnCredentialIdB64u(base64UrlEncode(new Uint8Array(32).fill(fill))),
    'credentialIdB64u',
  );
}

/** One method row of each kind and status that the V2 table admits. */
async function methodRecords(
  active: ActivePasskeyWalletAuthMethodRecordV2,
): Promise<WalletAuthMethodRecordV2[]> {
  const devicePublicKeyB64u = parseVoiceIdDevicePublicKeyB64u(
    base64UrlEncode(new Uint8Array(32).fill(41)),
  );
  const common = {
    version: 'wallet_auth_method_v2',
    walletId: active.walletId,
    walletAuthorityId: active.walletAuthorityId,
    createdAtMs: 100,
    updatedAtMs: 300,
  } as const;
  const passkey = {
    kind: 'passkey',
    rpId: active.rpId,
    credentialPublicKeyB64u: active.credentialPublicKeyB64u,
    counter: 0,
  } as const;
  return [
    active,
    buildWalletAuthMethodRecordV2({
      ...common,
      ...passkey,
      walletAuthMethodId: allocateWalletAuthMethodId('conformance-passkey-pending'),
      credentialIdB64u: credentialId(42),
      status: 'pending_local_install',
    }),
    buildWalletAuthMethodRecordV2({
      ...common,
      ...passkey,
      walletAuthMethodId: allocateWalletAuthMethodId('conformance-passkey-revoked'),
      credentialIdB64u: credentialId(43),
      status: 'revoked',
      activatedAtMs: 200,
      revokedAtMs: 300,
    }),
    buildWalletAuthMethodRecordV2({
      ...common,
      walletAuthMethodId: allocateWalletAuthMethodId('conformance-email-otp'),
      kind: 'email_otp',
      emailHashHex: 'a'.repeat(64),
      registrationAuthorityId: 'registration-authority:conformance',
      status: 'active',
      activatedAtMs: 200,
    }),
    buildWalletAuthMethodRecordV2({
      ...common,
      walletAuthMethodId: allocateWalletAuthMethodId('conformance-voiceid'),
      kind: 'voiceid',
      devicePublicKeyB64u,
      deviceKeyId: await sha256DigestB64u(new Uint8Array(32).fill(41)),
      status: 'active',
      activatedAtMs: 200,
    }),
  ];
}

function webAuthnStore(database: D1DatabaseLike): CloudflareD1WebAuthnStore {
  return new CloudflareD1WebAuthnStore({ database, ...SCOPE });
}

function enrollmentStore(database: D1DatabaseLike): CloudflareD1EmailOtpEnrollmentStore {
  return new CloudflareD1EmailOtpEnrollmentStore({
    prepare: (sql, values) => prepareD1TenantStatement(database, SCOPE, sql, values),
  });
}

function versionedRecords(database: D1DatabaseLike) {
  return createCloudflareD1VersionedJsonRecordStore<Record<string, string>>({
    database,
    scope: SCOPE,
    encode: (value) => value,
    parse: (raw) => (raw && typeof raw === 'object' ? (raw as Record<string, string>) : null),
    keyPrefix: 'conformance-records',
  });
}

async function writeAuthRecords(database: D1DatabaseLike): Promise<void> {
  const { authMethod } = await authorityFixture;
  await database.batch(
    (await methodRecords(authMethod)).map((record) =>
      prepareD1WalletAuthMethodV2PutStatement({ database, scope: SCOPE, record }),
    ),
  );
  const webauthn = webAuthnStore(database);
  await webauthn.writeAuthenticator({
    userId: WALLET_ID,
    record: {
      credentialIdB64u: authMethod.credentialIdB64u,
      credentialPublicKeyB64u: authMethod.credentialPublicKeyB64u,
      counter: 0,
      createdAtMs: 100,
      updatedAtMs: 200,
      deviceInfo: deriveWebAuthnAuthenticatorDeviceInfo({
        userAgent: USER_AGENT,
        aaguid: 'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4',
        backedUp: true,
        transports: ['internal', 'hybrid'],
      }),
    },
  });
  // A binding before the Ed25519 signer settles, and one after it.
  const binding = {
    version: 'webauthn_credential_binding_v1',
    rpId: RP_ID,
    userId: WALLET_ID,
    createdAtMs: 100,
    updatedAtMs: 200,
  } as const;
  await (
    await webauthn.prepareCredentialBindingInsertStatement({
      ...binding,
      credentialIdB64u: authMethod.credentialIdB64u,
    })
  ).run();
  await (
    await webauthn.prepareCredentialBindingInsertStatement({
      ...binding,
      credentialIdB64u: credentialId(44),
      nearAccountId: 'conformance.testnet',
      nearEd25519SigningKeyId: 'near-ed25519-key:conformance',
      signerSlot: 1,
      publicKey: `ed25519:${'1'.repeat(44)}`,
    })
  ).run();
  await webauthn.updateAuthenticatorCounter({
    userId: WALLET_ID,
    credentialIdB64u: authMethod.credentialIdB64u,
    newCounter: 3,
    updatedAtMs: 250,
  });
  const challenge = { createdAtMs: 100, expiresAtMs: CHALLENGE_EXPIRES_AT_MS } as const;
  await webauthn.writeChallenge({
    ...challenge,
    challengeId: 'challenge:conformance-login',
    challengeKind: 'login',
    record: {
      ...challenge,
      version: 'webauthn_login_challenge_v1',
      challengeId: 'challenge:conformance-login',
      userId: authMethod.walletId,
      rpId: RP_ID,
      challengeB64u: base64UrlEncode(new Uint8Array(32).fill(45)),
    },
  });
  await webauthn.writeChallenge({
    ...challenge,
    challengeId: 'challenge:conformance-sync',
    challengeKind: 'sync',
    record: {
      ...challenge,
      version: 'webauthn_sync_challenge_v1',
      challengeId: 'challenge:conformance-sync',
      rpId: RP_ID,
      challengeB64u: base64UrlEncode(new Uint8Array(32).fill(46)),
    },
  });
  // An enrollment row as the old code makes it. A later rotation of the Email OTP factor reads
  // such rows; this check states no rule about which fields a new enrollment keeps.
  await enrollmentStore(database).putEnrollment({
    version: 'email_otp_wallet_enrollment_v1',
    walletId: WALLET_ID,
    providerUserId: 'provider-user:conformance',
    orgId: SCOPE.orgId,
    verifiedEmail: 'owner@example.test',
    enrollmentId: `email-enrollment:${WALLET_ID}`,
    enrollmentVersion: '1',
    enrollmentSealKeyVersion: 'seal-v1',
    clientUnlockPublicKeyB64u: base64UrlEncode(new Uint8Array(65).fill(4)),
    unlockKeyVersion: 'unlock-v1',
    serverSealedFactorCiphertextB64u: base64UrlEncode(new Uint8Array(48).fill(47)),
    createdAtMs: 100,
    updatedAtMs: 200,
  });
  const versioned = versionedRecords(database);
  await versioned.put('envelope:first', { state: 'sealed' }, null);
  await versioned.put('envelope:first', { state: 'resealed' }, '1');
  await versioned.put('envelope:second', { state: 'sealed' }, null);
}

async function readAuthTableRows(database: D1DatabaseLike): Promise<AuthTableRows> {
  const rows: Partial<AuthTableRows> = {};
  for (const [table, sql] of Object.entries(AUTH_TABLES) as [AuthTable, string][]) {
    rows[table] = [...((await database.prepare(sql).all()).results ?? [])] as Record<
      string,
      unknown
    >[];
  }
  return rows as AuthTableRows;
}

async function insertAuthTableRows(database: D1DatabaseLike, rows: AuthTableRows): Promise<void> {
  for (const [table, tableRows] of Object.entries(rows)) {
    for (const row of tableRows) {
      const columns = Object.keys(row);
      await database
        .prepare(
          `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
        )
        .bind(...columns.map((column) => row[column]))
        .run();
    }
  }
}

test('today writes the D1 auth rows of the committed fixture', async () => {
  const runtime = await openAuthorityDatabase();
  try {
    await writeAuthRecords(runtime.database);
    const written = await readAuthTableRows(runtime.database);
    expect(written).toEqual(await committedRecordFixture('d1-auth-rows', written));
  } finally {
    await runtime.close();
  }
});

test('today reads each D1 auth row of the committed fixture', async () => {
  const fixture = await readRecordFixture<AuthTableRows>('d1-auth-rows');
  const runtime = await openAuthorityDatabase();
  try {
    const database = runtime.database;
    await insertAuthTableRows(database, fixture);
    const { authMethod } = await authorityFixture;
    const methods = new D1WalletAuthMethodStore({ database, ...SCOPE, ensureSchema: false });
    const expected = await methodRecords(authMethod);
    expect(await methods.listForWalletV2({ walletId: WALLET_ID })).toEqual(
      expect.arrayContaining(expected),
    );
    for (const record of expected) {
      expect(await methods.readByIdV2({ walletAuthMethodId: record.walletAuthMethodId })).toEqual(
        record,
      );
    }
    expect(
      await methods.getPasskeyV2({ rpId: RP_ID, credentialIdB64u: authMethod.credentialIdB64u }),
    ).toEqual(authMethod);
    expect(
      await methods.getEmailOtpV2({ walletId: WALLET_ID, emailHashHex: 'a'.repeat(64) }),
    ).toMatchObject({ kind: 'email_otp', status: 'active' });
    expect(
      await methods.getActiveVoiceIdV2({
        walletId: authMethod.walletId,
        walletAuthMethodId: expected[4]!.walletAuthMethodId,
        walletAuthorityId: authMethod.walletAuthorityId,
      }),
    ).toEqual(expected[4]);

    const webauthn = webAuthnStore(database);
    expect(
      await webauthn.readAuthenticator({
        userId: WALLET_ID,
        credentialIdB64u: authMethod.credentialIdB64u,
      }),
    ).toMatchObject({ counter: 3, updatedAtMs: 250, deviceInfo: { synced: true } });
    const bindings = await webauthn.readBindingRows({ userId: WALLET_ID, rpId: RP_ID });
    expect(bindings.map((binding) => binding.signerSlot ?? null).sort()).toEqual([1, null]);
    expect(await webauthn.readBindingByCredentialId(authMethod.credentialIdB64u)).toMatchObject({
      userId: WALLET_ID,
      rpId: RP_ID,
    });
    expect(await webauthn.consumeLoginChallenge('challenge:conformance-login')).toMatchObject({
      userId: WALLET_ID,
    });
    expect(
      await webauthn.consumeSyncChallenge('challenge:conformance-sync', authMethod.credentialIdB64u),
    ).toMatchObject({ ok: true, record: { rpId: RP_ID } });

    expect(await enrollmentStore(database).readEnrollment(WALLET_ID)).toMatchObject({
      walletId: WALLET_ID,
      enrollmentId: `email-enrollment:${WALLET_ID}`,
      verifiedEmail: 'owner@example.test',
    });
    const versioned = versionedRecords(database);
    expect(await versioned.read('envelope:first')).toEqual({
      kind: 'present',
      value: { state: 'resealed' },
      version: '2',
    });
    expect((await versioned.listByKeyPrefix('envelope:')).map((entry) => entry.key)).toEqual([
      'envelope:first',
      'envelope:second',
    ]);
  } finally {
    await runtime.close();
  }
});

/* The table holds only V2 rows since migration 0084: the V1 writer that the older
   registration surface still exports is refused by the table's checks. */
test('the D1 method table refuses a V1 method row', async () => {
  const runtime = await openAuthorityDatabase();
  try {
    const { authMethod } = await authorityFixture;
    await expect(
      prepareD1WalletAuthMethodPutStatement({
        database: runtime.database,
        scope: SCOPE,
        record: {
          version: 'wallet_auth_method_v1',
          kind: 'passkey',
          status: 'active',
          walletId: authMethod.walletId,
          rpId: authMethod.rpId,
          credentialIdB64u: authMethod.credentialIdB64u,
          credentialPublicKeyB64u: authMethod.credentialPublicKeyB64u,
          counter: 0,
          createdAtMs: 100,
          updatedAtMs: 200,
        },
      }).run(),
    ).rejects.toThrow();
  } finally {
    await runtime.close();
  }
});

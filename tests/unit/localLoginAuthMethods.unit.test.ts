import { expect, test } from '@playwright/test';
import { projectLocalLoginAuthMethods } from '@/SeamsWeb/operations/auth/login';
import { parseVerifiedEmailAddress } from '@shared/utils/domainIds';
import { injectImportMap } from '../setup/bootstrap';
import { sha256HexUtf8 } from '@shared/utils/digests';
import { buildActiveEmailOtpAuthMethodFixture } from './helpers/emailOtpAuthMethod.fixtures';

const PERSISTENCE_MODULES = {
  manager: '/_test-sdk/esm/core/indexedDB/seamsWalletDB/manager.js',
  repositories: '/_test-sdk/esm/core/indexedDB/seamsWalletDB/repositories.js',
  schema: '/_test-sdk/esm/core/indexedDB/seamsWalletDB/schema.js',
  schemaNames: '/_test-sdk/esm/core/indexedDB/schemaNames.js',
} as const;

function verifiedEmailAddress(value: string) {
  const parsed = parseVerifiedEmailAddress(value);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

test('projects the verified Email OTP address for the login account menu', () => {
  const fixture = buildActiveEmailOtpAuthMethodFixture({
    walletId: 'coral-reef-r8f5ju',
    emailAddress: 'n6378056@gmail.com',
    emailHashHex: 'email-hash-login-menu',
  });

  expect(
    projectLocalLoginAuthMethods([
      {
        kind: 'email_otp',
        record: fixture.record,
        presentation: {
          version: 'wallet_auth_method_local_presentation_v1',
          kind: 'email_otp',
          email: {
            kind: 'verified',
            address: verifiedEmailAddress('n6378056@gmail.com'),
          },
        },
      },
    ]),
  ).toEqual([
    {
      walletId: 'coral-reef-r8f5ju',
      authMethod: 'email_otp',
      emailAddress: 'n6378056@gmail.com',
    },
  ]);
});

test('keeps Email OTP presentation unavailable when no verified address is retained', () => {
  const fixture = buildActiveEmailOtpAuthMethodFixture({
    walletId: 'coral-reef-r8f5ju',
    emailAddress: 'n6378056@gmail.com',
    emailHashHex: 'email-hash-login-menu',
  });

  expect(
    projectLocalLoginAuthMethods([
      {
        kind: 'email_otp',
        record: fixture.record,
        presentation: {
          version: 'wallet_auth_method_local_presentation_v1',
          kind: 'email_otp',
          email: { kind: 'unavailable' },
        },
      },
    ]),
  ).toEqual([
    {
      walletId: 'coral-reef-r8f5ju',
      authMethod: 'email_otp',
      emailAddress: null,
    },
  ]);
});

test('retains verified Email OTP presentation beside the canonical V2 record', async ({ page }) => {
  const fixture = buildActiveEmailOtpAuthMethodFixture({
    walletId: 'coral-reef-r8f5ju',
    emailAddress: 'n6378056@gmail.com',
    emailHashHex: 'email-hash-login-menu',
  });
  await page.goto('/');
  await injectImportMap(page);
  const result = await page.evaluate(
    async ({ modules, record, localRecord }) => {
      const { SeamsWalletDBManager } = await import(modules.manager);
      const { SeamsWalletRepositories } = await import(modules.repositories);
      const { SEAMS_WALLET_DB_CONFIG } = await import(modules.schema);
      const { SEAMS_WALLET_STORES } = await import(modules.schemaNames);
      const manager = new SeamsWalletDBManager({
        dbName: 'seams_test_wallet_auth_method_presentation',
        dbVersion: SEAMS_WALLET_DB_CONFIG.dbVersion,
      });
      const repositories = new SeamsWalletRepositories(manager);
      await repositories.upsertProfile({ profileId: record.walletId });
      await repositories.upsertWalletAuthMethod(localRecord);
      await repositories.upsertWalletAuthMethodV2(record);
      const projections = await repositories.listLocalWalletAuthMethodProjectionsV2ForWallet(
        record.walletId,
      );
      const database = await manager.getDB();
      const stored = await database.get(
        SEAMS_WALLET_STORES.walletAuthMethods,
        record.walletAuthMethodId,
      );
      const storedPresentation = stored.presentation;
      delete stored.presentation;
      await database.put(SEAMS_WALLET_STORES.walletAuthMethods, stored);
      const migrated = await repositories.listLocalWalletAuthMethodProjectionsV2ForWallet(
        record.walletId,
      );
      const migratedStored = await database.get(
        SEAMS_WALLET_STORES.walletAuthMethods,
        record.walletAuthMethodId,
      );
      manager.close();
      return {
        projections,
        storedPresentation,
        migrated,
        migratedPresentation: migratedStored.presentation,
      };
    },
    { modules: PERSISTENCE_MODULES, record: fixture.record, localRecord: fixture.localRecord },
  );
  const projections = result.projections;
  expect(projections).toEqual([
    {
      kind: 'email_otp',
      record: fixture.record,
      presentation: {
        version: 'wallet_auth_method_local_presentation_v1',
        kind: 'email_otp',
        email: {
          kind: 'verified',
          address: 'n6378056@gmail.com',
        },
      },
    },
  ]);

  expect(result.storedPresentation).toEqual(projections[0]?.presentation);
  expect(result.migrated).toEqual(projections);
  expect(result.migratedPresentation).toEqual(projections[0]?.presentation);
});

test('backfills verified Email OTP presentation only when it matches the canonical digest', async ({
  page,
}) => {
  const emailAddress = verifiedEmailAddress('n6378056@gmail.com');
  const fixture = buildActiveEmailOtpAuthMethodFixture({
    walletId: 'coral-reef-r8f5ju',
    emailAddress,
    emailHashHex: await sha256HexUtf8(emailAddress),
  });
  await page.goto('/');
  await injectImportMap(page);
  const result = await page.evaluate(
    async ({ modules, record, emailAddress }) => {
      const { SeamsWalletDBManager } = await import(modules.manager);
      const { SeamsWalletRepositories } = await import(modules.repositories);
      const { SEAMS_WALLET_DB_CONFIG } = await import(modules.schema);
      const manager = new SeamsWalletDBManager({
        dbName: 'seams_test_wallet_auth_method_presentation_backfill',
        dbVersion: SEAMS_WALLET_DB_CONFIG.dbVersion,
      });
      const repositories = new SeamsWalletRepositories(manager);
      await repositories.upsertProfile({ profileId: record.walletId });
      await repositories.upsertWalletAuthMethodV2(record);
      const mismatch = await repositories.retainVerifiedEmailOtpLocalPresentation({
        walletId: record.walletId,
        walletAuthMethodId: record.walletAuthMethodId,
        emailAddress: 'other@example.com',
      });
      const retained = await repositories.retainVerifiedEmailOtpLocalPresentation({
        walletId: record.walletId,
        walletAuthMethodId: record.walletAuthMethodId,
        emailAddress,
      });
      const projections = await repositories.listLocalWalletAuthMethodProjectionsV2ForWallet(
        record.walletId,
      );
      manager.close();
      return { mismatch, retained, projections };
    },
    { modules: PERSISTENCE_MODULES, record: fixture.record, emailAddress },
  );
  const mismatch = result.mismatch;
  expect(mismatch).toEqual({ kind: 'not_retained', reason: 'email_hash_mismatch' });

  const retained = result.retained;
  expect(retained).toEqual({
    kind: 'retained',
    projection: {
      kind: 'email_otp',
      record: fixture.record,
      presentation: {
        version: 'wallet_auth_method_local_presentation_v1',
        kind: 'email_otp',
        email: { kind: 'verified', address: emailAddress },
      },
    },
  });

  expect(result.projections).toEqual([retained.projection]);
});

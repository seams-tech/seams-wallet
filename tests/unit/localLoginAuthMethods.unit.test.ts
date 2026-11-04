import { expect, test } from '@playwright/test';
import { parseVerifiedEmailAddress } from '@shared/utils/domainIds';
import { injectImportMap } from '../setup/bootstrap';
import { sha256HexUtf8 } from '@shared/utils/digests';
import { buildActiveEmailOtpAuthMethodFixture } from './helpers/emailOtpAuthMethod.fixtures';

const PERSISTENCE_MODULES = {
  manager: '/_test-sdk/esm/core/indexedDB/seamsWalletDB/manager.js',
  repositories: '/_test-sdk/esm/core/indexedDB/seamsWalletDB/repositories.js',
  schema: '/_test-sdk/esm/core/indexedDB/seamsWalletDB/schema.js',
} as const;

function verifiedEmailAddress(value: string) {
  const parsed = parseVerifiedEmailAddress(value);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

test('an email digest mismatch is not retained', async ({ page }) => {
  const emailAddress = verifiedEmailAddress('n6378056@gmail.com');
  const fixture = buildActiveEmailOtpAuthMethodFixture({
    walletId: 'coral-reef-r8f5ju',
    emailAddress,
    emailHashHex: await sha256HexUtf8(emailAddress),
  });
  await page.goto('/');
  await injectImportMap(page);
  const result = await page.evaluate(
    async ({ modules, record }) => {
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
      const projections = await repositories.listLocalWalletAuthMethodProjectionsV2ForWallet(
        record.walletId,
      );
      manager.close();
      return { mismatch, projections };
    },
    { modules: PERSISTENCE_MODULES, record: fixture.record },
  );
  expect(result.mismatch).toEqual({ kind: 'not_retained', reason: 'email_hash_mismatch' });
  expect(JSON.stringify(result.projections)).not.toContain('other@example.com');
});

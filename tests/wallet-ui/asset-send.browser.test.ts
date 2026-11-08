import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { injectImportMap } from '../setup/bootstrap';
import { routePreactModules } from '../setup/preact';

type SendLog = {
  readonly prepared: readonly {
    readonly receiverId: string;
    readonly actions: readonly Record<string, unknown>[];
    readonly storageDepositYocto: string | null;
  }[];
  readonly reviews: readonly { readonly confirmed: boolean }[];
  readonly receive: readonly string[];
};

function readSendLog(): SendLog {
  return Reflect.get(window, 'assetSendLog');
}

async function openSendScreen(page: Page, baseURL: string): Promise<void> {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../fixtures/ui/asset-send.tsx', import.meta.url))],
    bundle: true,
    write: false,
    format: 'esm',
    jsx: 'automatic',
    external: ['react', 'react-dom/client', 'react/jsx-runtime'],
  });
  const walletUiCss = fs.readFileSync(
    path.resolve(import.meta.dirname, '../../packages/wallet/dist/esm/sdk/wallet-ui.css'),
    'utf8',
  );
  await page.route('**/wallet-ui.css', (route) =>
    route.fulfill({ contentType: 'text/css', body: walletUiCss }),
  );
  await injectImportMap(page, { frontendUrl: baseURL });
  await routePreactModules(page);
  await page.goto(baseURL);
  await page.addStyleTag({ url: '/wallet-ui.css' });
  await page.addScriptTag({ type: 'module', content: bundle.outputFiles[0].text });
  await expect(page.getByRole('button', { name: 'Review and send', exact: true })).toBeVisible();
}

function reviewCard(page: Page) {
  return page.locator('.seams-confirmation-surface');
}

// The surface element itself has no box; its Confirm button shows that the card is open.
function reviewConfirm(page: Page) {
  return reviewCard(page).getByRole('button', { name: 'Confirm', exact: true });
}

test('Send checks the amount and the recipient, then opens the wallet review card before anything is signed', async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error('The Send browser test requires a frontend URL');
  await openSendScreen(page, baseURL);
  const asset = page.getByLabel('Asset', { exact: true });
  const amount = page.getByLabel('Amount', { exact: true });
  const recipient = page.getByLabel('To', { exact: true });
  const submit = page.getByRole('button', { name: 'Review and send', exact: true });

  // A balance error offers Receive for the same asset.
  await amount.fill('6');
  await recipient.fill('bob.testnet');
  await submit.click();
  await expect(page.getByRole('alert')).toHaveText('This is more than you can send.');
  await page.getByRole('button', { name: 'Receive NEAR', exact: true }).click();
  expect((await page.evaluate(readSendLog)).receive).toEqual(['near-testnet:native']);

  // A named recipient that does not exist stops before any review.
  await amount.fill('1.5');
  await recipient.fill('nobody.testnet');
  await submit.click();
  await expect(page.getByRole('alert')).toHaveText('This NEAR account does not exist.');
  await expect(page.getByRole('button', { name: 'Receive NEAR', exact: true })).toHaveCount(0);
  expect((await page.evaluate(readSendLog)).prepared).toEqual([]);

  // NEAR: one transfer to the recipient, shown in the review card; Cancel signs nothing.
  await recipient.fill('bob.testnet');
  await submit.click();
  await expect(reviewConfirm(page)).toBeVisible();
  await expect(reviewCard(page)).toContainText('bob.testnet');
  await expect(reviewCard(page)).toContainText('1.5');
  await expect(page.getByRole('button', { name: 'Confirm in your wallet…' })).toBeDisabled();
  await reviewCard(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(reviewCard(page)).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveText('You cancelled the transaction.');
  await expect(submit).toBeEnabled();

  // USDC to a recipient without storage: storage_deposit, then ft_transfer, in one review.
  await asset.selectOption({ label: 'USDC on NEAR testnet' });
  await amount.fill('2.5');
  await recipient.fill('bob.testnet');
  await submit.click();
  await expect(reviewConfirm(page)).toBeVisible();
  await expect(reviewCard(page)).toContainText('storage_deposit');
  await expect(reviewCard(page)).toContainText('bob.testnet');
  await reviewConfirm(page).click();
  await expect(page.getByRole('status')).toContainText('Funds sent.');

  const log = await page.evaluate(readSendLog);
  expect(log.reviews).toEqual([{ confirmed: false }, { confirmed: true }]);
  expect(log.prepared).toEqual([
    {
      receiverId: 'bob.testnet',
      actions: [{ type: 'Transfer', amount: (15n * 10n ** 23n).toString() }],
      storageDepositYocto: null,
    },
    {
      receiverId: expect.any(String),
      actions: [
        expect.objectContaining({
          methodName: 'storage_deposit',
          args: { account_id: 'bob.testnet', registration_only: true },
          deposit: '1250000000000000000000',
        }),
        expect.objectContaining({
          methodName: 'ft_transfer',
          args: { receiver_id: 'bob.testnet', amount: '2500000' },
          deposit: '1',
        }),
      ],
      storageDepositYocto: '1250000000000000000000',
    },
  ]);
});

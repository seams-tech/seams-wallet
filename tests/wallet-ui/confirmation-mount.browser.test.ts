import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { injectImportMap } from '../setup/bootstrap';
import { routePreactModules } from '../setup/preact';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import type {
  ConfirmSurfaceModel,
  ConfirmationSurfaceHandle,
} from '@/core/signingEngine/uiConfirm/ui/preact/mountConfirmationSurface';
import type {
  MessageReceiptState,
  TransactionReceiptState,
} from '@/core/signingEngine/uiConfirm/ui/transaction-receipt';

const walletUiCss = fs.readFileSync(
  path.resolve(import.meta.dirname, '../../packages/wallet/dist/esm/sdk/wallet-ui.css'),
  'utf8',
);

declare global {
  interface Window {
    __confirmationMount: {
      mount(
        variant: 'modal' | 'drawer',
        context: 'standalone' | 'wallet-iframe',
        shape?: Record<string, string>,
      ): string;
      update(index: number, heading: string, ready: boolean): void;
      error(index: number): void;
      close(index: number): void;
      dispose(index: number): void;
      receipt(index: number, state: TransactionReceiptState, view?: 'expanded' | 'toast'): void;
      messageReceipt(index: number, state: MessageReceiptState, view: 'expanded' | 'toast'): void;
      recipient(index: number, value: string): void;
      contract(index: number, value: string): void;
      calls: string[];
      closed: number;
      violations: string[];
    };
  }
}

test.beforeEach(async ({ page }) => {
  await injectImportMap(page);
  await routePreactModules(page);
  await page.route('**/wallet-ui.css', (route) =>
    route.fulfill({ contentType: 'text/css', body: walletUiCss }),
  );
  await page.route('**/confirmation-mount-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'content-security-policy': "style-src 'self'; style-src-attr 'none'" },
      body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}
      <link rel="stylesheet" href="/wallet-ui.css">
      </head><body><button id="opener">Open confirmation</button><main></main></body></html>`,
    }),
  );
  await page.goto('/confirmation-mount-test');
  await page.evaluate(async () => {
    const moduleUrl =
      '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/preact/mountConfirmationSurface.js';
    const { mountConfirmationSurface } = await import(moduleUrl);
    const handles: ConfirmationSurfaceHandle[] = [];
    // The shape an app sets, kept for every model the fixture builds after mount.
    let appShape: Record<string, string> | undefined;
    function firstConfirm() {
      window.__confirmationMount.calls.push('first');
    }
    function updatedConfirm() {
      window.__confirmationMount.calls.push('updated');
    }
    function cancel() {
      window.__confirmationMount.calls.push('cancel');
    }
    function closed() {
      window.__confirmationMount.closed++;
    }
    function model(heading: string, ready: boolean): ConfirmSurfaceModel {
      return {
        appearance: {
          palette: 'default',
          theme: {
            id: 'default',
            mode: 'light',
            colors: { accent: 'rgb(12, 34, 56)' },
            ...(appShape ? { shape: appShape } : {}),
          },
        },
        content: {
          kind: 'transaction',
          capture: null,
          review: { model: null, tree: null },
          header: {
            heading,
            website: { kind: 'ready', text: 'wallet.example' },
            chainDetails: { kind: 'ready', text: 'NEAR' },
          },
          body: { kind: 'empty' },
          prompt: { kind: 'passkey' },
          transaction: {
            tree: null,
            theme: 'light',
            explorers: { near: 'https://testnet.nearblocks.io' },
            decision: ready
              ? {
                  kind: 'ready',
                  onConfirm: heading === 'First confirmation' ? firstConfirm : updatedConfirm,
                }
              : { kind: 'preparing' },
            confirmText: 'Confirm',
            cancelText: 'Cancel',
            onCancel: cancel,
          },
        },
      };
    }
    function mount(
      variant: 'modal' | 'drawer',
      context: 'standalone' | 'wallet-iframe',
      shape?: Record<string, string>,
    ) {
      appShape = shape;
      const handle = mountConfirmationSurface({
        parent: document.querySelector('main')!,
        presentation: { variant, context },
        model: model('First confirmation', true),
        onClosed: closed,
      });
      handles.push(handle);
      return handle.element.id;
    }
    function update(index: number, heading: string, ready: boolean) {
      handles[index].update(model(heading, ready));
    }
    function error(index: number) {
      const viewModel = model('First confirmation', true);
      if (viewModel.content.kind !== 'transaction') throw new Error('Expected transaction fixture');
      viewModel.content.header.errorMessage = 'Unable to prepare transaction.';
      viewModel.content.transaction.errorMessage = 'Unable to prepare transaction.';
      handles[index].update(viewModel);
    }
    function close(index: number) {
      handles[index].close();
    }
    function dispose(index: number) {
      handles[index].dispose();
    }
    function receiptView() {
      window.__confirmationMount.calls.push('receipt-view');
    }
    function recipient(index: number, value: string) {
      const viewModel = model('Review transfer', true);
      if (viewModel.content.kind !== 'transaction') throw new Error('Expected transaction fixture');
      viewModel.content.review = {
        tree: null,
        model: {
          chain: 'evm',
          chainId: 8453,
          operations: [
            { id: 'transfer', kind: 'generic.contractCall', label: 'Transfer', to: value },
          ],
        },
      };
      viewModel.content.transaction.explorers.evm = 'https://basescan.org';
      handles[index].update(viewModel);
    }
    function contract(index: number, value: string) {
      const viewModel = model('Review contract call', true);
      if (viewModel.content.kind !== 'transaction') throw new Error('Expected transaction fixture');
      const label = 'Transaction to contract';
      viewModel.content.review = {
        detailsInitiallyOpen: true,
        model: {
          chain: 'evm',
          chainId: 5042002,
          operations: [{ id: 'call', kind: 'generic.contractCall', label, to: value }],
        },
        tree: {
          id: 'root',
          label: 'EVM Transaction',
          type: 'folder',
          open: true,
          children: [{ id: 'call', label, type: 'folder', open: true, contractAddress: value }],
        },
      };
      handles[index].update(viewModel);
    }
    function receiptDismiss() {
      window.__confirmationMount.calls.push('receipt-dismiss');
    }
    function receipt(
      index: number,
      state: TransactionReceiptState,
      view: 'expanded' | 'toast' = 'toast',
    ) {
      handles[index].showReceipt({
        subject: 'transaction',
        state,
        view,
        onView: receiptView,
        onDismiss: receiptDismiss,
      });
    }
    function messageReceipt(index: number, state: MessageReceiptState, view: 'expanded' | 'toast') {
      const viewModel = model('Sign message', true);
      if (viewModel.content.kind !== 'transaction') throw new Error('Expected transaction fixture');
      viewModel.content.review = {
        tree: null,
        model: {
          chain: 'near',
          signerAccount: 'alice.testnet',
          operations: [
            {
              id: 'near.message',
              kind: 'near.message',
              label: 'Message signature',
              fields: [
                { label: 'Signer', value: 'alice.testnet' },
                { label: 'Recipient', value: 'auction.example' },
                { label: 'Message', value: 'Sign in to Auction House', renderAs: 'file-content' },
              ],
            },
          ],
        },
      };
      handles[index].update(viewModel);
      handles[index].showReceipt({
        subject: 'message',
        state,
        view,
        onView: receiptView,
        onDismiss: receiptDismiss,
      });
    }
    function violation(event: SecurityPolicyViolationEvent) {
      window.__confirmationMount.violations.push(event.violatedDirective);
    }
    window.__confirmationMount = {
      mount,
      update,
      error,
      close,
      dispose,
      receipt,
      messageReceipt,
      recipient,
      contract,
      calls: [],
      closed: 0,
      violations: [],
    };
    document.addEventListener('securitypolicyviolation', violation);
  });
});

test('the contract row shows the called contract and copies its full address', async ({ page }) => {
  const contract = '0xeb7ab5a6f761072c96147a54b8a15f012e836691';
  await page.evaluate((value) => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        async writeText(text: string) {
          window.__confirmationMount.calls.push(text);
        },
      },
    });
    window.__confirmationMount.mount('modal', 'wallet-iframe');
    window.__confirmationMount.contract(0, value);
  }, contract);
  await expect(page.locator('.seams-review-eyebrow')).toHaveText('Transaction to contract');
  const row = page.locator('.seams-review-contract');
  const address = row.locator('.seams-review-contract-address');
  await expect(address).toHaveAttribute('title', contract);
  const copy = row.getByRole('button', { name: `Copy contract address ${contract}`, exact: true });
  await row.hover();
  await copy.click();
  await expect
    .poll(() => page.evaluate(() => window.__confirmationMount.calls))
    .toEqual([contract]);
  await expect(row.locator('.seams-review-copy')).toHaveAccessibleName('Copied');
  await expect.poll(() => page.evaluate(() => window.__confirmationMount.violations)).toEqual([]);
});

test('a hosted card keeps its corners while it moves', async ({ page }) => {
  // The surface clips the card only while the card is still: a height motion pins the
  // surface and a receipt morph unclips it. So the clip and the card must share one radius,
  // whatever card radius the app sets.
  const corners = () =>
    page.evaluate(() => {
      const surface = document.querySelector<HTMLElement>('.seams-confirmation-surface')!;
      const card = surface.querySelector<HTMLElement>('.modal-container-root')!;
      return {
        clip: getComputedStyle(surface).borderTopLeftRadius,
        card: getComputedStyle(card).borderTopLeftRadius,
      };
    });
  const settled = () =>
    expect
      .poll(() =>
        page.evaluate(() =>
          document
            .querySelector('.seams-confirmation-surface')!
            .hasAttribute('data-receipt-morphing'),
        ),
      )
      .toBe(false);
  const cases = [
    { shape: undefined, radius: '26px' },
    { shape: { card: '2rem' }, radius: '32px' },
  ];
  for (const [index, { shape, radius }] of cases.entries()) {
    await page.evaluate(
      (shape) => window.__confirmationMount.mount('modal', 'wallet-iframe', shape),
      shape,
    );
    expect(await corners()).toEqual({ clip: radius, card: radius });

    // The receipt morph starts from the corner that the confirmation showed.
    const morph = await page.evaluate((index) => {
      window.__confirmationMount.receipt(index, { kind: 'broadcasting' }, 'toast');
      const shell = document.querySelector('.seams-receipt-morph-shell')!;
      const effect = shell.getAnimations()[0].effect as KeyframeEffect;
      return effect.getKeyframes().map((frame) => frame.borderRadius);
    }, index);
    expect(morph).toEqual([radius, '12px']);
    await settled();
    expect(await corners()).toEqual({ clip: '12px', card: '12px' });

    await page.evaluate((index) => window.__confirmationMount.dispose(index), index);
  }
  await expect.poll(() => page.evaluate(() => window.__confirmationMount.violations)).toEqual([]);
});

test('the receipt shows the full recipient address and copies it again after feedback', async ({
  page,
}) => {
  const recipient = '0xBB442B54c85efBa2D7B81eA52990ad638cDba483';
  await page.evaluate((value) => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        async writeText(text: string) {
          window.__confirmationMount.calls.push(text);
        },
      },
    });
    window.__confirmationMount.mount('modal', 'wallet-iframe');
    window.__confirmationMount.recipient(0, value);
    window.__confirmationMount.receipt(0, { kind: 'signed' }, 'expanded');
  }, recipient);
  const destination = page.locator('.seams-receipt-destination');
  const button = destination.getByRole('button', {
    name: `Copy recipient address ${recipient}`,
    exact: true,
  });
  await expect(button.locator('.seams-review-full-address')).toHaveText(recipient);
  await page.getByText('Receipt details', { exact: true }).click();
  await expect(page.locator('.seams-review-technical .seams-review-full-address')).toHaveText(
    recipient,
  );
  await button.hover();
  await button.locator('.seams-review-full-address').click();
  await expect
    .poll(() => page.evaluate(() => window.__confirmationMount.calls))
    .toEqual([recipient]);
  const copied = destination.locator('.seams-review-copy-address');
  await expect(copied).toHaveAccessibleName('Copied');
  await expect(copied).toHaveAccessibleName(`Copy recipient address ${recipient}`, {
    timeout: 5000,
  });
  await copied.focus();
  await copied.press('Enter');
  await expect
    .poll(() => page.evaluate(() => window.__confirmationMount.calls))
    .toEqual([recipient, recipient]);
  await expect.poll(() => page.evaluate(() => window.__confirmationMount.violations)).toEqual([]);
});

test('confirmed receipts link to the configured block explorer', async ({ page }) => {
  const recipient = '0x2F0100000000000000000000000000000000004EC9';
  const hash = `0x${'1234567890abcdef'.repeat(4)}`;
  await page.evaluate(
    ({ recipient, hash }) => {
      window.__confirmationMount.mount('modal', 'wallet-iframe');
      window.__confirmationMount.recipient(0, recipient);
      window.__confirmationMount.receipt(0, { kind: 'confirmed', hash }, 'expanded');
    },
    { recipient, hash },
  );
  const link = page.getByRole('link', { name: 'View transaction' });
  await expect(link).toHaveAttribute('href', `https://basescan.org/tx/${hash}`);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

test('a failed NEAR receipt states the reason that NEAR gave', async ({ page }) => {
  const panic = 'The contract refused the call: Smart contract panicked: account is not speakable';
  const rejection =
    'NEAR rejected this transaction before it ran, so nothing was submitted. ' +
    'The account has 0.01 NEAR, and the transaction can cost up to 0.15031 NEAR.';
  await page.evaluate(
    ({ panic }) => {
      window.__confirmationMount.mount('modal', 'wallet-iframe');
      window.__confirmationMount.receipt(
        0,
        { kind: 'reverted', hash: '3FUntsAnjo7YtZmLU1429k4FKUAATE4UZZYnPtfKdBRz', message: panic },
        'expanded',
      );
    },
    { panic },
  );
  const receipt = page.locator('.seams-transaction-receipt');
  await expect(receipt.getByRole('status')).toHaveText('Transaction reverted');
  await expect(receipt.locator('.seams-receipt-heading p')).toHaveText(panic);

  await page.evaluate(
    ({ rejection }) =>
      window.__confirmationMount.receipt(
        0,
        { kind: 'failed', hash: null, message: rejection },
        'expanded',
      ),
    { rejection },
  );
  await expect(receipt.getByRole('status')).toHaveText('Transaction failed');
  await expect(receipt.locator('.seams-receipt-heading p')).toHaveText(rejection);
  await expect(receipt.getByText('Confirmation unavailable')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__confirmationMount.violations)).toEqual([]);
});

test('a message signature receipt is complete once signed and has no network stages', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__confirmationMount.mount('modal', 'wallet-iframe');
    window.__confirmationMount.messageReceipt(0, { kind: 'signed' }, 'expanded');
  });
  const receipt = page.locator('.seams-transaction-receipt');
  await expect(receipt.locator('.seams-review-toolbar')).toHaveText('Message signature');
  await expect(receipt.getByRole('status')).toHaveText('Message signed');
  await expect(receipt.locator('.seams-receipt-heading p')).toHaveText(
    'Signed off-chain. Nothing was sent to the network.',
  );
  const steps = receipt.locator('.seams-receipt-step');
  await expect(steps).toHaveCount(3);
  expect(await steps.evaluateAll((items) => items.map((item) => item.dataset.state))).toEqual([
    'complete',
    'complete',
    'complete',
  ]);
  await expect(receipt.locator('.seams-receipt-steps')).toHaveText('Signed');
  await page.getByText('Receipt details', { exact: true }).click();
  const details = receipt.locator('.seams-review-technical .seams-review-fields');
  await expect(details.locator('dt')).toHaveText(['Signer', 'Recipient', 'Message', 'Status']);
  await expect(details.locator('.seams-receipt-message')).toHaveText('Sign in to Auction House');
  await expect(receipt.getByRole('button', { name: 'Done' })).toBeVisible();

  await page.evaluate(() =>
    window.__confirmationMount.messageReceipt(0, { kind: 'signed' }, 'toast'),
  );
  await expect(page.getByRole('button', { name: 'Close transaction' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__confirmationMount.violations)).toEqual([]);
});

test('a toast offers to close only once its transaction has finished', async ({ page }) => {
  await page.evaluate(() => {
    window.__confirmationMount.mount('modal', 'wallet-iframe');
    window.__confirmationMount.receipt(0, { kind: 'broadcasting' }, 'toast');
  });
  const close = page.getByRole('button', { name: 'Close transaction' });
  await expect(page.getByRole('button', { name: 'Open', exact: true })).toBeVisible();
  await expect(close).toHaveCount(0);
  await page.evaluate(() =>
    window.__confirmationMount.receipt(0, { kind: 'confirmed', hash: null }, 'toast'),
  );
  await close.click();
  expect(await page.evaluate(() => window.__confirmationMount.calls)).toEqual(['receipt-dismiss']);
});

test('mount updates complete models and invokes the current callback synchronously', async ({
  page,
}) => {
  const id = await page.evaluate(() => window.__confirmationMount.mount('modal', 'wallet-iframe'));
  const root = page.locator(`#${id}`);
  await expect(root.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  expect(
    await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>('.confirm')!.click();
      return window.__confirmationMount.calls;
    }),
  ).toEqual(['first']);
  await page.evaluate(() => window.__confirmationMount.update(0, 'Updated confirmation', false));
  await expect(root.getByRole('heading')).toHaveText('Updated confirmation');
  await expect(root.getByRole('button', { name: 'Loading...', exact: true })).toBeDisabled();
  await page.evaluate(() => window.__confirmationMount.update(0, 'Updated confirmation', true));
  await root.getByRole('button', { name: 'Confirm', exact: true }).click();
  expect(await page.evaluate(() => window.__confirmationMount.calls)).toEqual(['first', 'updated']);
  await page.evaluate(() => {
    window.__confirmationMount.close(0);
    window.__confirmationMount.dispose(0);
    window.__confirmationMount.update(0, 'Retired', true);
  });
  await expect(root).toHaveCount(0);
  expect(await page.evaluate(() => window.__confirmationMount.closed)).toBe(1);
  expect(await page.evaluate(() => window.__confirmationMount.violations)).toEqual([]);
});

test('an immediate error remains visible and clears when the review updates', async ({ page }) => {
  const id = await page.evaluate(() => {
    const id = window.__confirmationMount.mount('modal', 'wallet-iframe');
    window.__confirmationMount.error(0);
    return id;
  });
  const root = page.locator(`#${id}`);
  await expect(root.getByRole('alert')).toHaveText('Unable to prepare transaction.');
  await expect(root.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await page.evaluate(() => window.__confirmationMount.update(0, 'First confirmation', true));
  await expect(root.getByRole('alert')).toHaveCount(0);
  await expect(root.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  await page.evaluate(() => window.__confirmationMount.dispose(0));
  expect(await page.evaluate(() => window.__confirmationMount.violations)).toEqual([]);
});

test('drawer close filters callbacks and disposes after its transition', async ({ page }) => {
  await page.locator('#opener').focus();
  const id = await page.evaluate(() => window.__confirmationMount.mount('drawer', 'standalone'));
  await expect(page.locator(`#${id} .is-open`)).toBeVisible();
  await page.evaluate(() => {
    const cancel = document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
    window.__confirmationMount.close(0);
    cancel.click();
    window.__confirmationMount.close(0);
    window.__confirmationMount.update(0, 'Too late', true);
  });
  await expect(page.locator(`#${id}`)).toHaveCount(0);
  expect(await page.evaluate(() => window.__confirmationMount.closed)).toBe(1);
  expect(await page.evaluate(() => window.__confirmationMount.calls)).toEqual([]);
  await expect(page.locator('#opener')).toBeFocused();
  expect(await page.evaluate(() => window.__confirmationMount.violations)).toEqual([]);
});

test('disposing one surface leaves the other mounted and usable', async ({ page }) => {
  const first = await page.evaluate(() =>
    window.__confirmationMount.mount('modal', 'wallet-iframe'),
  );
  const second = await page.evaluate(() =>
    window.__confirmationMount.mount('drawer', 'wallet-iframe'),
  );
  await page.evaluate(() => window.__confirmationMount.dispose(0));
  await expect(page.locator(`#${first}`)).toHaveCount(0);
  const surviving = page.locator(`#${second}`);
  await expect(surviving.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  await surviving.getByRole('button', { name: 'Confirm', exact: true }).click();
  expect(await page.evaluate(() => window.__confirmationMount.calls)).toEqual(['first']);
  await page.evaluate(() => window.__confirmationMount.dispose(1));
  expect(await page.evaluate(() => window.__confirmationMount.closed)).toBe(2);
  expect(await page.evaluate(() => window.__confirmationMount.violations)).toEqual([]);
});

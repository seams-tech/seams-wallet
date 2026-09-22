import { expect, test, type Page } from '@playwright/test';
import { injectImportMap } from '../setup/bootstrap';

async function mountSettingsLayout(page: Page): Promise<void> {
  await page.goto('about:blank');
  await injectImportMap(page);
  await page.evaluate(async () => {
    const React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const layoutPath = '/_test-sdk/esm/react/components/AccountMenuButton/WalletSettingsLayout.js';
    const themePath = '/_test-sdk/esm/react/components/theme/ThemeProvider.js';
    const { WalletSettingsLayout } = await import(layoutPath);
    const { Theme } = await import(themePath);
    const ids = [
      'accounts',
      'export-keys',
      'recovery-codes',
      'authentication-methods',
      'scan-link-device',
      'linked-devices',
      'transaction-settings',
    ];
    const sections: Record<string, React.ReactNode> = {};
    for (const id of ids) {
      sections[id] = React.createElement('button', { type: 'button' }, `Manage ${id}`);
    }
    function item(id: string) {
      return { id, icon: null, label: id, description: id, disabled: id === 'export-keys' };
    }
    function lock() {
      return Promise.reject(new Error('Lock failed. Try again.'));
    }
    const mount = document.createElement('div');
    document.body.append(mount);
    createRoot(mount).render(
      React.createElement(
        Theme,
        { theme: 'light' },
        React.createElement(WalletSettingsLayout, {
          walletId: 'tranquil-brook-xm5838',
          menuItems: ids.map(item),
          sections,
          onLock: lock,
          error: null,
        }),
      ),
    );
  });
}

test('settings sidebar selects panels, preserves capability restrictions, and works on narrow screens', async ({
  page,
}) => {
  await mountSettingsLayout(page);
  const nav = page.getByRole('navigation', { name: 'Wallet settings' });
  await expect(nav.getByRole('button')).toHaveCount(8);
  await expect(
    page.getByRole('heading', { name: 'Authentication methods', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('img', { name: 'Seams', exact: true })).toBeVisible();
  await expect(page.locator('.seams-settings-wordmark path')).toHaveCount(1);
  await page.screenshot({
    path: test.info().outputPath('wallet-settings-desktop.png'),
    fullPage: true,
  });
  await nav.getByRole('button', { name: /^Linked devices/ }).click();
  await expect(page.getByRole('heading', { name: 'Linked devices', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Manage linked-devices' })).toBeVisible();
  await nav.getByRole('button', { name: /^Export keys/ }).click();
  await expect(page.getByRole('status')).toContainText('unavailable');
  await expect(page.getByRole('button', { name: 'Manage export-keys' })).toHaveCount(0);
  await nav.getByRole('button', { name: 'Lock wallet', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Lock failed. Try again.');
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(nav).toBeHidden();
  await page.getByRole('button', { name: 'All settings', exact: true }).click();
  await expect(nav).toBeVisible();
  await nav.getByRole('button', { name: /^Accounts/ }).click();
  await expect(nav).toBeHidden();
  await expect(page.getByRole('button', { name: 'Manage accounts' })).toBeVisible();
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(fits).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('wallet-settings-mobile.png'),
    fullPage: true,
  });
});

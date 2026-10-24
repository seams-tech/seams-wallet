import { expect, test } from '@playwright/test';
import { injectImportMap } from '../setup/bootstrap';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';

test('desktop transaction settings switch review and choose the review layout', async ({
  page,
}) => {
  await injectImportMap(page);
  await page.route('**/transaction-settings-preview', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><head>${buildTestBrowserImportMapHtml()}<link rel="stylesheet" href="/_test-sdk/esm/sdk/wallet-ui.css"></head><body></body></html>`,
    }),
  );
  await page.goto('/transaction-settings-preview');
  await page.addStyleTag({
    path: '../packages/wallet/src/react/components/AccountMenuButton/WalletSettingsLayout.css',
  });
  await page.evaluate(async () => {
    const React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { Theme } = await import('/_test-sdk/esm/react/components/theme/ThemeProvider.js');
    const { TransactionSettingsSection } =
      await import('/_test-sdk/esm/react/components/AccountMenuButton/TransactionSettingsSection.js');
    class Fixture extends React.Component {
      state = { uiMode: 'modal', behavior: 'requireClick', autoProceedDelay: 0 };
      setMode = (uiMode: string) => this.setState({ uiMode });
      setDelay = (autoProceedDelay: number) => this.setState({ autoProceedDelay });
      toggle = () =>
        this.setState({
          behavior: this.state.behavior === 'skipClick' ? 'requireClick' : 'skipClick',
        });
      render() {
        return React.createElement(
          Theme,
          { theme: 'light', className: 'seams-settings-page' },
          React.createElement(
            'main',
            { className: 'seams-settings-main' },
            React.createElement('h1', null, 'Transaction settings'),
            React.createElement(TransactionSettingsSection, {
              presentation: 'page',
              currentConfirmConfig: this.state,
              onSetUiMode: this.setMode,
              onSetDelay: this.setDelay,
              onToggleSkipClick: this.toggle,
            }),
          ),
        );
      }
    }
    createRoot(document.body).render(React.createElement(Fixture));
  });
  const modal = page.getByRole('button', { name: /^Modal/ });
  const drawer = page.getByRole('button', { name: /^Drawer/ });
  const review = page.getByRole('switch', { name: 'Review before signing' });
  await expect(page.getByRole('button', { name: /^No review/ })).toHaveCount(0);
  await expect(modal).toHaveAttribute('aria-pressed', 'true');
  await expect(review).toHaveAttribute('aria-checked', 'true');
  await review.click();
  await expect(review).toHaveAttribute('aria-checked', 'false');
  await drawer.click();
  await expect(drawer).toHaveAttribute('aria-pressed', 'true');
  await expect(review).toHaveAttribute('aria-checked', 'false');
  await review.click();
  await expect(review).toHaveAttribute('aria-checked', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

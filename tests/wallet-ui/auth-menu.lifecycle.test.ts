import { expect, test } from '@playwright/test';
import { injectImportMap } from '../setup/bootstrap';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import { authBranchFixtures, registration } from './auth-menu-fixtures';
import { mountAuthMenu, prepareAuthMenuDocument } from './auth-menu.harness';

declare global {
  interface Window {
    __authCspViolations: string[];
  }
}

test.beforeEach(async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('Browser test origin is required');
  await injectImportMap(page, { frontendUrl: baseURL });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
});

test('auth appearance is instance-owned and disposal removes rules and rejects late updates', async ({
  page,
}) => {
  await prepareAuthMenuDocument(page);
  const original = registration('light');
  const custom = {
    ...original,
    appearance: {
      theme: {
        id: 'custom-auth',
        mode: 'light' as const,
        colors: { colorBackground: '#123456' },
        shape: { card: '28px' },
      },
      palette: 'default' as const,
    },
  };
  await mountAuthMenu(page, custom);
  const card = page.locator('.seams-auth-menu-surface .auth-menu-root');
  await expect(card).toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await expect(card).toHaveCSS('border-radius', '28px');
  await page.evaluate((model) => window.__authMenu.handle.update(model), original);
  await expect(card).not.toHaveCSS('background-color', 'rgb(18, 52, 86)');
  await expect(card).not.toHaveCSS('border-radius', '28px');
  const sheetCount = await page.evaluate(() => document.adoptedStyleSheets.length);
  for (let cycle = 0; cycle < 5; cycle++) {
    await mountAuthMenu(page, custom);
    const result = await page.evaluate((model) => {
      const handle = window.__authMenu.handle;
      const id = handle.element.id;
      handle.dispose();
      handle.dispose();
      handle.update(model);
      const leakedRules = Array.from(document.adoptedStyleSheets)
        .flatMap((sheet) => Array.from(sheet.cssRules))
        .filter((rule) => rule.cssText.includes(id));
      return {
        connected: handle.element.isConnected,
        children: handle.element.childElementCount,
        leakedRules: leakedRules.length,
        sheets: document.adoptedStyleSheets.length,
      };
    }, original);
    expect(result).toEqual({ connected: false, children: 0, leakedRules: 0, sheets: sheetCount });
  }
});

for (const fallback of [false, true]) {
  test(`auth branches preserve strict style CSP with ${fallback ? 'nonce fallback' : 'CSSOM'}`, async ({
    page,
  }) => {
    await page.addInitScript((fallback) => {
      window.__authCspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        window.__authCspViolations.push(event.violatedDirective);
      });
      if (fallback) {
        Reflect.deleteProperty(Document.prototype, 'adoptedStyleSheets');
        Reflect.deleteProperty(ShadowRoot.prototype, 'adoptedStyleSheets');
        Object.assign(window, { seamsNonce: 'auth-menu-test-nonce' });
      }
    }, fallback);
    await page.route('**/auth-menu-csp', (route) =>
      route.fulfill({
        contentType: 'text/html',
        headers: {
          'content-security-policy': fallback
            ? "style-src 'self' 'nonce-auth-menu-test-nonce'; style-src-attr 'none'"
            : "style-src 'self'; style-src-attr 'none'",
        },
        body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}</head><body></body></html>`,
      }),
    );
    await page.goto('/auth-menu-csp');
    await prepareAuthMenuDocument(page);
    const model = registration('light');
    await mountAuthMenu(page, model);
    for (const fixture of authBranchFixtures('light')) {
      await page.evaluate((model) => window.__authMenu.handle.update(model), fixture.model);
      await expect(page.locator('.seams-auth-menu-surface')).toBeVisible();
      await expect(page.locator('.seams-auth-menu-surface [style]')).toHaveCount(0);
    }
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    expect(await page.evaluate(() => window.__authCspViolations)).toEqual([]);
    if (fallback) {
      expect(
        await page
          .locator('style[data-seams-auth-menu-dynamic]')
          .evaluateAll((elements) =>
            elements.every(
              (element) => (element as HTMLStyleElement).nonce === 'auth-menu-test-nonce',
            ),
          ),
      ).toBe(true);
    } else {
      await expect(page.locator('style')).toHaveCount(0);
    }
    await page.evaluate(() => window.__authMenu.handle.dispose());
  });
}

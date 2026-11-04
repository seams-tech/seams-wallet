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

test('disposal removes the auth menu and late updates cannot revive it', async ({ page }) => {
  await prepareAuthMenuDocument(page);
  const model = registration('light');
  for (let cycle = 0; cycle < 3; cycle++) {
    await mountAuthMenu(page, model);
    await expect(page.locator('.seams-auth-menu-surface')).toHaveCount(1);
    await page.evaluate((model) => {
      const handle = window.__authMenu.handle;
      handle.dispose();
      handle.dispose();
      handle.update(model);
    }, model);
    await expect(page.locator('.seams-auth-menu-surface')).toHaveCount(0);
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

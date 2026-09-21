import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { injectImportMap } from '../setup/bootstrap';
import { buildTestBrowserImportMapHtml } from '../setup/importMap';
import { routePreactModules } from '../setup/preact';

declare global {
  interface Window {
    __confirmationPrimitive: {
      update(animated: boolean, icon: 'fingerprint' | 'mail'): void;
      dispose(): void;
      hasRule(): boolean;
    };
    __primitiveViolations: string[];
  }
}

const root = path.resolve(import.meta.dirname, '../..');
const walletUiCss = fs.readFileSync(
  path.join(root, 'packages/wallet/dist/esm/sdk/wallet-ui.css'),
  'utf8',
);

for (const fallback of [false, true]) {
  test(`confirmation indicator motion, updates and disposal under ${fallback ? 'nonce CSP' : 'CSSOM CSP'}`, async ({
    page,
    baseURL,
  }, testInfo) => {
    if (!baseURL) throw new Error('Browser origin required');
    await injectImportMap(page, { frontendUrl: baseURL });
    await routePreactModules(page);
    await page.addInitScript((fallback) => {
      window.__primitiveViolations = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        window.__primitiveViolations.push(event.violatedDirective);
      });
      if (fallback) Reflect.deleteProperty(Document.prototype, 'adoptedStyleSheets');
    }, fallback);
    await page.route('**/wallet-ui.css', (route) =>
      route.fulfill({ contentType: 'text/css', body: walletUiCss }),
    );
    await page.route('**/confirmation-primitives', (route) =>
      route.fulfill({
        contentType: 'text/html',
        headers: {
          'content-security-policy': fallback
            ? "style-src 'self' 'nonce-primitive-test'; style-src-attr 'none'"
            : "style-src 'self'; style-src-attr 'none'",
        },
        body: `<!doctype html><html><head>${buildTestBrowserImportMapHtml()}<link rel="stylesheet" data-seams-wallet-ui-css href="/wallet-ui.css"></head><body><main class="seams-wallet-ui" data-theme="light"></main></body></html>`,
      }),
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/confirmation-primitives');
    await page.evaluate(async () => {
      const preactUrl = '/_test-preact/preact.module.js';
      const { h, render } = await import(preactUrl);
      const componentUrl =
        '/_test-sdk/esm/core/signingEngine/uiConfirm/ui/preact/PasskeyHaloLoading.js';
      const { PasskeyHaloLoading } = await import(componentUrl);
      const stylesheetUrl = '/_test-sdk/esm/core/browser/walletIframe/csp-stylesheet.js';
      const { createCspStylesheetManager } = await import(stylesheetUrl);
      const styles = createCspStylesheetManager({
        doc: document,
        baseCss: '',
        nonce: 'primitive-test',
        dynamicStyleDataAttr: 'data-primitive-test',
      });
      const root = document.querySelector('main')!;
      function update(animated: boolean, icon: 'fingerprint' | 'mail') {
        render(h(PasskeyHaloLoading, { animated, icon, styles }), root);
      }
      function dispose() {
        render(null, root);
      }
      update(true, 'fingerprint');
      const haloId = root.querySelector('.seams-halo-border')!.id;
      function hasRule() {
        return styles.hasDynamicRule(haloId);
      }
      window.__confirmationPrimitive = { update, dispose, hasRule };
    });
    const halo = page.locator('.seams-halo-border');
    await expect(halo).toBeVisible();
    await expect(page.locator('.halo-ring')).toHaveCount(1);
    expect(await page.evaluate(() => window.__confirmationPrimitive.hasRule())).toBe(false);
    const id = await halo.getAttribute('id');
    for (const icon of ['fingerprint', 'mail'] as const) {
      await page.evaluate((icon) => window.__confirmationPrimitive.update(true, icon), icon);
      await expect(page.locator('svg path')).toHaveCount(icon === 'mail' ? 2 : 1);
      await expect(halo).toHaveAttribute('id', id!);
      for (const theme of ['light', 'dark']) {
        await page.evaluate((theme) => {
          document.querySelector('main')!.setAttribute('data-theme', theme);
        }, theme);
        // WebKit screenshots inject an inline animation-sync stylesheet under CSP.
        if (testInfo.project.name === 'chromium') {
          await page.locator('.seams-passkey-halo-loading').screenshot({
            caret: 'initial',
            path: path.join(
              root,
              '.artifacts/refactor-127/visual/preact-primitives',
              `${testInfo.project.name}-${fallback ? 'nonce' : 'cssom'}-${icon}-${theme}.png`,
            ),
          });
        }
      }
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect
      .poll(() =>
        halo.evaluate((node) =>
          parseFloat(getComputedStyle(node).getPropertyValue('--halo-angle')),
        ),
      )
      .toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect
      .poll(() => page.evaluate(() => window.__confirmationPrimitive.hasRule()))
      .toBe(false);
    await page.evaluate(() => window.__confirmationPrimitive.update(false, 'mail'));
    await expect(page.locator('.halo-ring')).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await page.evaluate(() => window.__confirmationPrimitive.hasRule())).toBe(false);
    await page.evaluate(() => window.__confirmationPrimitive.update(true, 'mail'));
    await expect
      .poll(() => page.evaluate(() => window.__confirmationPrimitive.hasRule()))
      .toBe(true);
    await expect(page.locator('main [style]')).toHaveCount(0);
    await page.evaluate(() => {
      window.__confirmationPrimitive.dispose();
      window.__confirmationPrimitive.dispose();
    });
    await expect(page.locator('main > *')).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await page.evaluate(() => window.__confirmationPrimitive.hasRule())).toBe(false);
    expect(await page.evaluate(() => window.__primitiveViolations)).toEqual([]);
  });
}

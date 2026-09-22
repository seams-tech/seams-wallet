import { expect, test } from '@playwright/test';
import { setupBasicPasskeyTest, sdkEsmPath } from '../setup';

test('native React theme scope updates without changing the document theme', async ({ page }) => {
  await setupBasicPasskeyTest(page);
  const result = await page.evaluate(async (themeModule) => {
    const React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { flushSync } = await import('react-dom');
    const { Theme } = await import(themeModule);
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const originalDocumentTheme = document.documentElement.getAttribute('data-seams-theme');
    const root = createRoot(mount);
    const samples = [];
    for (const mode of ['light', 'dark'] as const) {
      flushSync(() => root.render(React.createElement(Theme, { theme: mode }, 'Theme fixture')));
      const scope = mount.querySelector<HTMLElement>('.seams-theme-provider');
      if (!scope) throw new Error('Missing React theme scope');
      samples.push({
        mode: scope.getAttribute('data-seams-theme'),
        background: getComputedStyle(scope)
          .getPropertyValue('--seams-colors-colorBackground')
          .trim(),
      });
    }
    flushSync(() => root.unmount());
    const emptyAfterUnmount = mount.childElementCount === 0;
    mount.remove();
    return {
      samples,
      emptyAfterUnmount,
      documentThemeUnchanged:
        document.documentElement.getAttribute('data-seams-theme') === originalDocumentTheme,
    };
  }, sdkEsmPath('react/components/theme/ThemeProvider.js'));

  expect(result.samples.map((sample) => sample.mode)).toEqual(['light', 'dark']);
  expect(result.samples[0].background).not.toBe('');
  expect(result.samples[1].background).not.toBe('');
  expect(result.samples[0].background).not.toBe(result.samples[1].background);
  expect(result.emptyAfterUnmount).toBe(true);
  expect(result.documentThemeUnchanged).toBe(true);
});

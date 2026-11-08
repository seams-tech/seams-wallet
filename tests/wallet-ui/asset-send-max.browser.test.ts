import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { injectImportMap } from '../setup/bootstrap';
import { routePreactModules } from '../setup/preact';

test('Send locks the form while the Max fee probe is in flight', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('The Send Max browser test requires a frontend URL');
  const root = path.resolve(import.meta.dirname, '../..');
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../fixtures/ui/asset-send-max.tsx', import.meta.url))],
    bundle: true,
    write: false,
    format: 'esm',
    jsx: 'automatic',
    external: ['react', 'react-dom/client', 'react/jsx-runtime'],
    tsconfig: path.join(root, 'packages/wallet/tsconfig.json'),
  });
  await injectImportMap(page, { frontendUrl: baseURL });
  await routePreactModules(page);
  await page.goto(baseURL);
  await page.addScriptTag({ type: 'module', content: bundle.outputFiles[0]!.text });

  const submit = page.getByRole('button', { name: 'Review and send', exact: true });
  const amount = page.getByPlaceholder('0', { exact: true });
  const max = page.getByRole('button', { name: 'Max', exact: true });
  await expect(submit).toBeVisible();
  await amount.fill('0.5');
  await page.getByPlaceholder('0x…').fill('0x2222222222222222222222222222222222222222');

  await max.click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, 'assetSendMaxLog').prepared))
    .toHaveLength(1);
  // While the probe runs, nothing can start a review that the probe result would overwrite.
  await expect(submit).toBeDisabled();
  await expect(amount).toBeDisabled();
  await expect(max).toBeDisabled();

  await page.evaluate(() => (Reflect.get(window, 'releaseMaxProbe') as () => void)());
  await expect(amount).toBeEnabled();
  await expect(amount).toHaveValue('1.999');
  await expect(submit).toBeEnabled();
  expect(await page.evaluate(() => Reflect.get(window, 'assetSendMaxLog').sent)).toBe(0);
});

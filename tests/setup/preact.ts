import type { Page } from '@playwright/test';
import path from 'node:path';
import { createRequire } from 'node:module';

const walletRequire = createRequire(new URL('../../packages/wallet/package.json', import.meta.url));
const preactRoot = path.dirname(walletRequire.resolve('preact/package.json'));
const preactModules: Record<string, string> = {
  'preact.module.js': path.join(preactRoot, 'dist/preact.module.js'),
  'hooks.module.js': path.join(preactRoot, 'hooks/dist/hooks.module.js'),
  'jsxRuntime.module.js': path.join(preactRoot, 'jsx-runtime/dist/jsxRuntime.module.js'),
};

export async function routePreactModules(page: Page): Promise<void> {
  await page.route('**/_test-preact/*', (route) => {
    const file = preactModules[path.basename(new URL(route.request().url()).pathname)];
    if (!file) return route.fulfill({ status: 404, body: 'Unknown Preact test module' });
    return route.fulfill({ path: file, contentType: 'text/javascript' });
  });
}

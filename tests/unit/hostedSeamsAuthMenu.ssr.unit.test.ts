import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import url from 'node:url';

test.describe('SSR sanity: HostedSeamsAuthMenu adapter', () => {
  test('SSR import and render do not touch window', async () => {
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const packageJsonPath = path.resolve(here, '../../packages/mpc-wallet/package.json');
    const packageRequire = createRequire(packageJsonPath);
    const React = packageRequire('react');
    const { renderToString } = packageRequire('react-dom/server');
    // The auth menu module itself: `@seams/mpc-wallet/react` also loads component stylesheets,
    // which only a bundler resolves.
    const distMarkerCandidates = [
      path.resolve(
        path.dirname(packageJsonPath),
        'dist/esm/react/components/HostedSeamsAuthMenu/public.js',
      ),
    ];
    test.skip(
      distMarkerCandidates.every((candidate) => !fs.existsSync(candidate)),
      `SDK dist not found at ${distMarkerCandidates[0]}; run pnpm -C packages/mpc-wallet build:rolldown`,
    );

    expect(typeof (globalThis as any).window).toBe('undefined');

    const mod: any = await import(url.pathToFileURL(distMarkerCandidates[0]).href);
    renderToString(React.createElement(mod.HostedSeamsAuthMenu, { onOutcome: () => undefined }));

    expect(typeof (globalThis as any).window).toBe('undefined');
  });
});

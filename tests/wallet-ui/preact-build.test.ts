import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

type BuiltChunk = { fileName: string; code: string; imports: string[]; dynamicImports: string[] };
type ProbeBuild = { library: BuiltChunk[]; react: BuiltChunk[]; embedded: BuiltChunk[] };
const buildScript = path.resolve(import.meta.dirname, '../scripts/build-preact-probe.mjs');

for (const mode of ['development', 'production']) {
  test(`native Preact mount/update/dispose and React isolation in ${mode}`, async ({
    page,
    baseURL,
  }) => {
    const built: ProbeBuild = JSON.parse(
      execFileSync(process.execPath, [buildScript], {
        encoding: 'utf8',
        env: { ...process.env, NODE_ENV: mode },
      }),
    );
    const libraryImports = built.library.flatMap((chunk) => chunk.imports);
    expect(libraryImports).toContain('preact/jsx-runtime');
    expect(libraryImports).toContain('preact/hooks');
    expect(libraryImports.some((specifier) => specifier.startsWith('react'))).toBe(false);
    expect(built.react.flatMap((chunk) => chunk.imports)).toContain('react/jsx-runtime');
    expect(
      built.react
        .flatMap((chunk) => chunk.imports)
        .some((specifier) => specifier.startsWith('preact')),
    ).toBe(false);
    expect(built.embedded).toHaveLength(1);
    expect(built.embedded[0].imports).toEqual([]);
    expect(built.embedded[0].dynamicImports).toEqual([]);

    await page.route('**/preact-probe.js', (route) =>
      route.fulfill({ contentType: 'application/javascript', body: built.embedded[0].code }),
    );
    await page.route('**/preact-probe', (route) =>
      route.fulfill({
        contentType: 'text/html',
        headers: {
          'content-security-policy':
            "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'none'",
        },
        body: '<!doctype html><html><head><title>Preact build contract</title></head><body><main></main></body></html>',
      }),
    );
    await page.goto(`${baseURL}/preact-probe`);
    const result = await page.evaluate(async () => {
      const moduleUrl = new URL('/preact-probe.js', location.href).href;
      const { renderProbe, disposeProbe } = await import(moduleUrl);
      const root = document.querySelector('main');
      if (!root) throw new Error('Probe root is missing');
      const violations: string[] = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        violations.push(event.violatedDirective);
      });
      let clicks = 0;
      let disposals = 0;
      const onIncrement = () => {
        clicks += 1;
      };
      const onDispose = () => {
        disposals += 1;
      };
      renderProbe(root, { count: 1, onIncrement, onDispose });
      const first = root.querySelector('button');
      const initialText = first?.textContent;
      renderProbe(root, { count: 2, onIncrement, onDispose });
      const updatedText = root.textContent;
      const reused = first === root.querySelector('button');
      first?.click();
      disposeProbe(root);
      disposeProbe(root);
      await new Promise(requestAnimationFrame);
      return {
        initialText,
        updatedText,
        reused,
        clicks,
        disposals,
        children: root.childElementCount,
        styles: document.querySelectorAll('style, [style]').length,
        violations,
      };
    });
    expect(result).toEqual({
      initialText: '1',
      updatedText: '2',
      reused: true,
      clicks: 1,
      disposals: 1,
      children: 0,
      styles: 0,
      violations: [],
    });
  });
}

import type { Page, Route } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';

type FrameKit = typeof import('../../packages/frame-kit/src/index');

declare global {
  // The bundled frame kit, which openFrameKitApp loads into the app page.
  var frameKit: FrameKit;
}

/** The app page, the frame's origin, and an origin that neither of them trusts. */
export const APP_ORIGIN = 'http://app.frame-kit.test';
export const FRAME_ORIGIN = 'http://account.frame-kit.test';
export const OTHER_ORIGIN = 'http://other.frame-kit.test';

const APP_PAGE = `<!doctype html>
<html>
  <head>
    <style>
      body { margin: 0; font: 16px sans-serif; }
      .card { width: 360px; height: 200px; background: #fff; }
      .card.large { width: 900px; height: 1400px; }
    </style>
  </head>
  <body>
    <button id="opener" type="button">Open</button>
  </body>
</html>`;

let bundle: Promise<string> | null = null;

function frameKitBundle(): Promise<string> {
  bundle ??= (async () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const result = await build({
      stdin: { contents: `export * from './packages/frame-kit/src/index';`, resolveDir: root },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      tsconfig: path.join(root, 'packages/frame-kit/tsconfig.json'),
    });
    return result.outputFiles[0]!.text;
  })();
  return bundle;
}

function framePage(script: string): string {
  return `<!doctype html>
<html>
  <body>
    <script type="module">
      import * as frameKit from '/frame-kit.js';
      ${script}
    </script>
  </body>
</html>`;
}

/**
 * A frame that accepts a connection from the app page and answers `ping` with `pong`, and
 * `count` with the number of connections that it accepted.
 */
export function echoFrame(options: { version?: string; allowed?: readonly string[] } = {}): string {
  const version = JSON.stringify(options.version ?? '1');
  const allowed = JSON.stringify(options.allowed ?? [APP_ORIGIN]);
  return framePage(`
    let connections = 0;
    frameKit.acceptFrameConnection({
      protocol: { name: 'frame-kit-test', version: ${version} },
      isAllowedParent: (origin) => ${allowed}.includes(origin),
      onConnect: ({ port, parentOrigin }) => {
        connections += 1;
        port.onmessage = (event) => {
          const { type, requestId } = event.data;
          if (type === 'ping') port.postMessage({ type: 'pong', requestId, parentOrigin });
          if (type === 'count') port.postMessage({ type: 'count', requestId, connections });
        };
      },
    });
  `);
}

async function fulfill(body: string, contentType: string, route: Route): Promise<void> {
  await route.fulfill({ status: 200, contentType, body });
}

/**
 * Serves the frame kit at `/frame-kit.js` on each test origin, the app page at the app origin,
 * and each named frame page at `/<name>`. Then it opens the app page with the kit loaded.
 */
export async function openFrameKitApp(
  page: Page,
  frames: Readonly<Record<string, string>> = {},
): Promise<void> {
  const source = await frameKitBundle();
  for (const origin of [APP_ORIGIN, FRAME_ORIGIN, OTHER_ORIGIN]) {
    await page.route(`${origin}/frame-kit.js`, fulfill.bind(null, source, 'text/javascript'));
    for (const [name, html] of Object.entries(frames)) {
      await page.route(`${origin}/${name}*`, fulfill.bind(null, html, 'text/html'));
    }
  }
  await page.route(`${APP_ORIGIN}/`, fulfill.bind(null, APP_PAGE, 'text/html'));
  await page.goto(`${APP_ORIGIN}/`);
  await page.evaluate(async () => {
    const kitPath = '/frame-kit.js';
    globalThis.frameKit = await import(kitPath);
  });
}

import type { Page, Route } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
import { accountFrameHtml } from '../../packages/auth/src/origin/document';
import { openAuthWorker, type AuthWorkerHarness } from './harness';

type AuthClient = typeof import('../../packages/auth/src/client/index');

declare global {
  // The bundled auth client and the auth object of the app page.
  var seamsAuthClient: AuthClient;
  var auth: import('../../packages/auth/src/client/index').SeamsAuth;
  var authErrors: unknown[];
}

/**
 * The app page and the account origin. Both are on localhost, which is a secure context, so the
 * browser allows passkeys. The account origin also serves the routes of the Auth Worker.
 */
export const APP_ORIGIN = 'http://localhost:4610';
export const ACCOUNT_ORIGIN = 'http://localhost:4611';
export const OTHER_APP_ORIGIN = 'http://localhost:4613';

const ROOT = path.resolve(import.meta.dirname, '../..');
const bundles = new Map<string, Promise<{ text: string; inputs: string[] }>>();

/** One browser bundle of an auth entry, with the list of the files in it. */
export function authBundle(entry: 'client/index.ts' | 'origin/main.ts') {
  let bundle = bundles.get(entry);
  if (!bundle) {
    bundle = (async () => {
      const result = await build({
        entryPoints: [path.join(ROOT, 'packages/auth/src', entry)],
        bundle: true,
        write: false,
        metafile: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        tsconfig: path.join(ROOT, 'packages/auth/tsconfig.json'),
      });
      // The paths of the bundled files, from the repository root.
      const inputs = Object.keys(result.metafile.inputs).map((file) =>
        path.relative(ROOT, path.resolve(file)),
      );
      return { text: result.outputFiles[0]!.text, inputs };
    })();
    bundles.set(entry, bundle);
  }
  return bundle;
}

const APP_PAGE = `<!doctype html>
<html>
  <head><style>body { margin: 0; font: 16px sans-serif; }</style></head>
  <body><button id="opener" type="button">Open</button></body>
</html>`;

/** A gate that passes when the owner presses its button. It keeps one record in its store. */
const TEST_GATE = `
export const gateApiVersion = 1;
function ask(surface, label) {
  return new Promise((resolve) => {
    const button = document.createElement('button');
    button.textContent = label;
    button.onclick = () => resolve();
    surface.element.append(button);
  });
}
export const gate = {
  async enroll({ surface, store }) {
    await ask(surface, 'Record my voice');
    await store.set('template', 'voice-template');
    return 'enrolled';
  },
  async check({ surface, store, purpose }) {
    if ((await store.get('template')) !== 'voice-template') return 'cancelled';
    await ask(surface, 'Pass the voice check: ' + purpose);
    return 'passed';
  },
};`;

/**
 * A plugin with the audience \`wallet\`. Its page half asks it to prove with a secret sink. It
 * answers with the kind of the proof and the size of the secret that its sink got.
 */
const TEST_PLUGIN = `
export const plugin = {
  pluginApiVersion: 1,
  id: 'test-plugin',
  audiences: ['wallet'],
  start(host) {
    return {
      connect(port) {
        port.onmessage = async (event) => {
          if (event.data.type === 'refuse_removal') { globalThis.refuseRemoval = true; return; }
          const sink = new MessageChannel();
          let secretBytes = 0;
          sink.port1.onmessage = (message) => { secretBytes = message.data.secret.byteLength; };
          const result = await host.prove({
            audience: event.data.audience,
            challenge: event.data.challenge,
            secretSink: sink.port2,
            prfSalt: new Uint8Array(32).fill(7).buffer,
          });
          await new Promise((resolve) => setTimeout(resolve, 50));
          port.postMessage({
            kind: result.kind,
            reason: result.reason,
            factor: result.proof?.factor,
            method: result.method,
            assertion: result.proof?.assertion,
            secretBytes,
            keys: Object.keys(result),
          });
        };
      },
      beforeMethodRemoval: async () => !globalThis.refuseRemoval,
    };
  },
};`;

async function fulfill(body: string, contentType: string, route: Route): Promise<void> {
  await route.fulfill({ status: 200, contentType, body });
}

export type AuthApp = {
  readonly worker: AuthWorkerHarness;
  /** The account frame of the page, after the client connected. */
  frame(): import('@playwright/test').FrameLocator;
  close(): Promise<void>;
};

/**
 * Opens an app page with the auth client and an account origin with the account frame, the
 * Auth Worker, a test gate and a test plugin. The page has a passkey authenticator.
 */
export async function openAuthApp(
  page: Page,
  options: {
    config?: Record<string, unknown>;
    frameScript?: string;
    appOrigin?: string;
  } = {},
): Promise<AuthApp> {
  const appOrigin = options.appOrigin ?? APP_ORIGIN;
  const worker = await openAuthWorker({
    origins: {
      issuer: ACCOUNT_ORIGIN,
      accountOrigin: ACCOUNT_ORIGIN,
      appOrigin: APP_ORIGIN,
      rpId: 'localhost',
    },
  });
  const [client, frame] = await Promise.all([
    authBundle('client/index.ts'),
    authBundle('origin/main.ts'),
  ]);
  await page.route(`${appOrigin}/`, fulfill.bind(null, APP_PAGE, 'text/html'));
  await page.route(
    `${appOrigin}/auth-client.js`,
    fulfill.bind(null, client.text, 'text/javascript'),
  );
  await page.route(
    `${ACCOUNT_ORIGIN}/account/`,
    fulfill.bind(
      null,
      accountFrameHtml({
        authApiUrl: '',
        rpId: 'localhost',
        purposes: { checkout: { en: 'Approve a payment', ja: '支払いの承認' } },
      }),
      'text/html',
    ),
  );
  await page.route(
    `${ACCOUNT_ORIGIN}/account/account-frame.js`,
    fulfill.bind(null, options.frameScript ?? frame.text, 'text/javascript'),
  );
  await page.route(
    `${ACCOUNT_ORIGIN}/sdk/voiceid/gate.js`,
    fulfill.bind(null, TEST_GATE, 'text/javascript'),
  );
  await page.route(
    `${ACCOUNT_ORIGIN}/sdk/test-plugin/host.js`,
    fulfill.bind(null, TEST_PLUGIN, 'text/javascript'),
  );
  // The routes of the Auth Worker, on the account origin.
  for (const pattern of [`${ACCOUNT_ORIGIN}/v1/**`, `${ACCOUNT_ORIGIN}/.well-known/**`]) {
    await page.route(pattern, async (route) => {
      const request = route.request();
      const response = await worker.handler(
        new Request(request.url(), {
          method: request.method(),
          headers: request.headers(),
          body: request.method() === 'GET' ? undefined : request.postData(),
        }),
      );
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: await response.text(),
      });
    });
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
      automaticPresenceSimulation: true,
    },
  });
  await page.goto(`${appOrigin}/`);
  await page.evaluate(
    async ({ accountOrigin, config }) => {
      const clientPath = '/auth-client.js';
      globalThis.seamsAuthClient = await import(clientPath);
      const { createSeamsAuth, passkey, emailCode, voiceId, AUTH_ERROR_EVENT } =
        globalThis.seamsAuthClient;
      globalThis.authErrors = [];
      window.addEventListener(AUTH_ERROR_EVENT, (event) => {
        globalThis.authErrors.push((event as CustomEvent).detail);
      });
      globalThis.auth = createSeamsAuth({
        accountOrigin,
        publishableKey: 'pk_test_auth_1',
        environmentId: 'project-1:production',
        methods: [passkey(), emailCode(), voiceId()],
        ...config,
      });
    },
    { accountOrigin: ACCOUNT_ORIGIN, config: options.config ?? {} },
  );
  return {
    worker,
    frame: () => page.frameLocator('iframe[src^="http://localhost:4611/account/"]'),
    close: worker.close,
  };
}

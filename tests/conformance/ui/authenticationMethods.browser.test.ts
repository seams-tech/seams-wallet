import { expect, test, type Page } from '@playwright/test';
import { build, type Plugin } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { injectImportMap } from '../../setup/bootstrap';
import type {
  AuthMethodsCall,
  AuthMethodsScenario,
  ScenarioMethod,
} from './authenticationMethods.fixture';

/**
 * The methods of the account menu (audit row 7.10): the Authentication methods screen lists the
 * methods of the authority in use, adds a passkey, Email OTP or VoiceID, and removes a method
 * after a confirmation. The screen renders from today's source with a fake wallet in place of
 * SeamsWeb, so each check reads which wallet calls the screen makes.
 */

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const contextStub = fileURLToPath(new URL('./seamsContextStub.ts', import.meta.url));
const WALLET_ID = 'conformance-wallet.testnet';
const AUTHORITY = 'conformance-authority';
const PASSKEY: ScenarioMethod = { kind: 'passkey', id: 'method-passkey', authorityId: AUTHORITY };
const EMAIL: ScenarioMethod = { kind: 'email_otp', id: 'method-email', authorityId: AUTHORITY };
const VOICE: ScenarioMethod = { kind: 'voiceid', id: 'method-voice', authorityId: AUTHORITY };

/** The account menu reads `useSeams()` from `../../context`; the bundle reads the stub. */
const seamsContextStub: Plugin = {
  name: 'seams-context-stub',
  setup(builder) {
    builder.onResolve({ filter: /^\.\.\/\.\.\/context$/ }, (args) =>
      args.importer.includes(`${path.sep}AccountMenuButton${path.sep}`)
        ? { path: contextStub }
        : undefined,
    );
  },
};

let fixtureBundle: Promise<string> | null = null;

function bundleFixture(): Promise<string> {
  fixtureBundle ??= build({
    entryPoints: [fileURLToPath(new URL('./authenticationMethods.fixture.ts', import.meta.url))],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
    tsconfig: path.join(repoRoot, 'packages/mpc-wallet/tsconfig.json'),
    plugins: [seamsContextStub],
  }).then((result) => result.outputFiles[0]!.text);
  return fixtureBundle;
}

async function renderScreen(
  page: Page,
  baseURL: string | undefined,
  scenario: Partial<AuthMethodsScenario>,
): Promise<void> {
  if (!baseURL) throw new Error('The browser check needs the test web server');
  const full: AuthMethodsScenario = {
    walletId: WALLET_ID,
    methods: [PASSKEY],
    selected: PASSKEY,
    voiceIdConfigured: false,
    voiceIdAvailability: 'not_enrolled',
    removalFailure: null,
    ...scenario,
  };
  await injectImportMap(page, { frontendUrl: baseURL });
  await page.goto(baseURL);
  await page.evaluate((value) => {
    Object.assign(window, { __authMethods: { scenario: value, calls: [] } });
  }, full);
  await page.addScriptTag({ type: 'module', content: await bundleFixture() });
}

function walletCalls(page: Page): Promise<AuthMethodsCall[]> {
  return page.evaluate(() => Reflect.get(window, '__authMethods').calls as AuthMethodsCall[]);
}

async function callsNamed(page: Page, name: string): Promise<unknown[]> {
  return (await walletCalls(page)).flatMap((call) => (call.name === name ? [call.input] : []));
}

function methodRow(page: Page, title: string) {
  return page.locator('li').filter({ has: page.getByText(title, { exact: true }) });
}

test('lists the methods of the authority in use and marks the one in use', async ({
  page,
  baseURL,
}) => {
  const otherAuthority = { ...EMAIL, id: 'method-other', authorityId: 'another-authority' };
  await renderScreen(page, baseURL, { methods: [PASSKEY, EMAIL, otherAuthority] });
  const active = page.getByRole('region', { name: 'Authentication methods' });
  await expect(active.getByRole('button', { name: 'Remove Passkey' })).toBeVisible();
  await expect(active.getByRole('button', { name: 'Remove Email OTP' })).toHaveCount(1);
  await expect(methodRow(page, 'Passkey')).toContainText('In use now');
  await expect(methodRow(page, 'Passkey')).toContainText('Conformance keychain');
  await expect(methodRow(page, 'Email OTP')).not.toContainText('In use now');
  // Both kinds are active on this authority, so nothing is left to add.
  await expect(page.getByText('Add a method')).toHaveCount(0);
  expect(await callsNamed(page, 'devices.list')).toEqual([
    { walletId: WALLET_ID, limit: 50, cursor: null },
  ]);
});

test('the last method has no Remove, and the missing kind can be added', async ({
  page,
  baseURL,
}) => {
  await renderScreen(page, baseURL, {});
  await expect(page.getByText('Add another method before removing this one.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Email OTP' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add passkey' })).toHaveCount(0);
});

test('a locked wallet lists no method', async ({ page, baseURL }) => {
  await renderScreen(page, baseURL, { selected: null });
  await expect(page.getByRole('alert')).toContainText(
    'Unlock this wallet to manage authentication.',
  );
  expect(await callsNamed(page, 'devices.list')).toEqual([]);
});

test("adding a passkey uses the wallet's RP ID, then refreshes the session and the list", async ({
  page,
  baseURL,
}) => {
  await renderScreen(page, baseURL, { methods: [EMAIL], selected: EMAIL });
  await page.getByRole('button', { name: 'Add passkey' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Passkey added.' })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Remove Passkey' })).toBeVisible();
  expect(await walletCalls(page)).toEqual([
    { name: 'devices.list', input: { walletId: WALLET_ID, limit: 50, cursor: null } },
    { name: 'registration.addPasskey', input: { walletId: WALLET_ID, rpId: 'example.localhost' } },
    { name: 'refreshSession', input: WALLET_ID },
    { name: 'devices.list', input: { walletId: WALLET_ID, limit: 50, cursor: null } },
  ]);
});

test('adding Email OTP asks for a valid address and sends it trimmed', async ({
  page,
  baseURL,
}) => {
  await renderScreen(page, baseURL, {});
  await page.getByRole('button', { name: 'Add Email OTP' }).click();
  const address = page.getByLabel('Email address');
  await expect(address).toBeFocused();
  const send = page.getByRole('button', { name: 'Send code' });
  await send.click();
  await expect(page.getByRole('alert')).toHaveText('Enter the email address to verify.');
  await address.fill('not-an-address');
  await send.click();
  await expect(page.getByRole('alert')).toHaveText('Enter a valid email address.');
  await address.fill('  owner@example.test ');
  await send.click();
  await expect(page.getByRole('button', { name: 'Remove Email OTP' })).toBeVisible();
  expect(await callsNamed(page, 'registration.addEmail')).toEqual([
    { walletId: WALLET_ID, emailAddress: 'owner@example.test' },
  ]);
});

test('removing a method asks first, then removes it and refreshes', async ({ page, baseURL }) => {
  await renderScreen(page, baseURL, { methods: [PASSKEY, EMAIL] });
  await page.getByRole('button', { name: 'Remove Email OTP' }).click();
  await expect(
    page.getByText(
      'Remove Email OTP from this device? You will need the other active method to unlock it.',
    ),
  ).toBeVisible();
  expect(await callsNamed(page, 'registration.removeAuthMethod')).toEqual([]);
  await page.getByRole('button', { name: 'Remove method' }).click();
  // Email OTP leaves the active list and is offered under Add a method again.
  await expect(page.getByRole('button', { name: 'Add Email OTP' })).toBeVisible();
  await expect(page.getByText('Add another method before removing this one.')).toBeVisible();
  expect(await callsNamed(page, 'registration.removeAuthMethod')).toEqual([
    { walletId: WALLET_ID, walletAuthMethodId: EMAIL.id },
  ]);
  expect(await callsNamed(page, 'refreshSession')).toEqual([WALLET_ID]);
});

test('a refused removal shows its error and keeps the method', async ({ page, baseURL }) => {
  const refusal = 'Removing a method needs a fresh proof from another method.';
  await renderScreen(page, baseURL, { methods: [PASSKEY, EMAIL], removalFailure: refusal });
  await page.getByRole('button', { name: 'Remove Email OTP' }).click();
  await page.getByRole('button', { name: 'Remove method' }).click();
  await expect(page.getByRole('alert')).toHaveText(refusal);
  await expect(page.getByRole('button', { name: 'Remove Email OTP' })).toBeVisible();
  expect(await callsNamed(page, 'refreshSession')).toEqual([]);
});

test('an active VoiceID method shows its browser switch, and the switch turns it off', async ({
  page,
  baseURL,
}) => {
  await renderScreen(page, baseURL, {
    methods: [PASSKEY, VOICE],
    voiceIdConfigured: true,
    voiceIdAvailability: 'enabled',
  });
  const toggle = page.getByRole('switch', { name: 'Enable VoiceID in this browser' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(methodRow(page, 'VoiceID')).toContainText('On in this browser');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(await callsNamed(page, 'registration.setAuthMethodEnabled')).toEqual([
    { walletId: WALLET_ID, method: 'voiceid', enabled: false },
  ]);
});

test('a configured VoiceID plugin offers VoiceID under Add a method', async ({ page, baseURL }) => {
  await renderScreen(page, baseURL, { methods: [PASSKEY, EMAIL], voiceIdConfigured: true });
  const setup = methodRow(page, 'VoiceID');
  await expect(page.getByText('Add a method')).toBeVisible();
  await expect(setup).toContainText('Experimental');
  await expect(setup).toContainText('Not set up in this browser. Turn it on to record your voice.');
  await expect(
    page.getByRole('switch', { name: 'Enable VoiceID in this browser' }),
  ).toHaveAttribute('aria-checked', 'false');
});

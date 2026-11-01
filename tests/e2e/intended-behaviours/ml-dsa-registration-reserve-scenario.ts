import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { execFile } from 'node:child_process';
import { appendFile, copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import {
  IntendedBehaviourHarness,
  autoConfirmWalletIframeUntil,
  waitForWalletIframeConfirmationSettlement,
} from './harness';
import { openSigningKeys, signMlDsaTransaction } from './ml-dsa-lifecycle-scenario';
import { fundImplicitWallet } from './ml-dsa-testnet';

const run = promisify(execFile);
const PUBLICATION_LIMIT_MS = 420_000;
const ACTIVITY_LIFETIME_MS = 3_600_000;
const PREPARATION_LIFETIME_MS = 900_000;
const ACTIVITY_ROUTE = /\/wallets\/[^/]+\/ml-dsa\/registration-activity$/;
const SIGNING_KEY_GROUP = { name: 'ML-DSA-65 signing key', exact: true } as const;
const CREATION_STAGES = ['Preparing secure key material', 'Creating ML-DSA key'];
const ADD_TO_NEAR_STAGE = 'Add key to NEAR';
const STATUS_RECORDER = 'recordMlDsaSetupStatus';

type StatusObserver = { readonly recorder: string; readonly stages: readonly string[] };
type StoredKey = { readonly store: string; readonly key: string; readonly text: string };
type NetworkMark = { readonly path: string; readonly status: number; readonly atMs: number };

/** Records one timeline from the Settings flow, the network, and local admission storage. */
class RegistrationTrace {
  readonly network: NetworkMark[] = [];
  readonly statuses: { readonly wallet: string; readonly text: string }[] = [];
  private constructor(
    private readonly file: string,
    private readonly runtimeRoot: string | null,
    private readonly copyRoot: string,
  ) {}
  static async open(testInfo: TestInfo): Promise<RegistrationTrace> {
    const directory = process.env.SEAMS_INTENDED_TRACE_DIR ?? testInfo.outputDir;
    await mkdir(directory, { recursive: true });
    return new RegistrationTrace(
      path.join(directory, 'ml-dsa-registration.jsonl'),
      process.env.SEAMS_INTENDED_ROUTER_AB_ROOT ?? null,
      await mkdtemp(path.join(tmpdir(), 'ml-dsa-trace-')),
    );
  }
  async mark(event: string, detail: Record<string, unknown> = {}): Promise<void> {
    const line = JSON.stringify({ atMs: Date.now(), event, ...detail });
    console.log(`[ml-dsa-trace] ${line}`);
    await appendFile(this.file, line + '\n');
  }
  /** The context sees frame requests also. NEAR RPC shows when the AddKey leaves the browser. */
  watch(context: BrowserContext, wallet: string): void {
    context.on('response', (response) => {
      const url = new URL(response.url());
      if (!/^\/wallets\/.*ml-dsa/.test(url.pathname) || response.request().method() === 'OPTIONS')
        return;
      const mark = {
        path: url.pathname.replace(/wallets\/[^/]+/, 'wallets/*'),
        status: response.status(),
        atMs: Date.now(),
      };
      this.network.push(mark);
      void this.mark('network', { wallet, method: response.request().method(), ...mark });
    });
    context.on('request', (request) => {
      if (!/rpc\.testnet\./.test(request.url()) || request.method() !== 'POST') return;
      const body = request.postData() ?? '';
      if (body.includes('send_tx') || body.includes('broadcast_tx'))
        void this.mark('near_transaction_sent', { wallet });
    });
  }
  /** A stage can last a few milliseconds, so the page reports each change of status text. */
  async watchStatus(page: Page, wallet: string): Promise<void> {
    await page.exposeFunction(STATUS_RECORDER, async (text: string) => {
      this.statuses.push({ wallet, text });
      await this.mark('ui_status', { wallet, text });
    });
    await page.evaluate(installStatusObserver, {
      recorder: STATUS_RECORDER,
      stages: [...CREATION_STAGES, ADD_TO_NEAR_STAGE],
    });
  }
  statusesOf(wallet: string): string[] {
    return this.statuses.filter((status) => status.wallet === wallet).map(({ text }) => text);
  }
  /** Lists registration keys. Tagged state names stay readable in the stored bytes. */
  async storage(): Promise<StoredKey[]> {
    if (!this.runtimeRoot) throw new Error('Hosted runs have no local admission storage');
    const stored: StoredKey[] = [];
    for (const file of await sqliteFiles(this.runtimeRoot)) {
      const rows = await readRegistrationKeys(file, this.copyRoot);
      for (const row of rows) stored.push({ store: path.basename(file).slice(0, 12), ...row });
    }
    return stored;
  }
  async snapshot(label: string): Promise<StoredKey[]> {
    // A copy can catch a database file and its log between two writes. Read again.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const stored = await this.storage();
      if (!stored.some((row) => row.key === 'unreadable')) {
        await this.mark('storage', { label, keys: stored });
        return stored;
      }
      await delay(200);
    }
    throw new Error(`Admission storage is unreadable at ${label}`);
  }
}

function installStatusObserver({ recorder, stages }: StatusObserver): void {
  const record = (window as unknown as Record<string, (text: string) => void>)[recorder];
  let last = '';
  new MutationObserver(() => {
    for (const status of document.querySelectorAll('[role="status"]')) {
      const text = status.textContent?.trim() ?? '';
      if (text === last || !stages.includes(text)) continue;
      last = text;
      record(text);
    }
  }).observe(document, { subtree: true, childList: true, characterData: true });
}

async function sqliteFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sqlite'))
    .filter((entry) => entry.name !== 'metadata.sqlite')
    .filter((entry) => entry.parentPath.includes('RouterAbMlDsaAdmissionDurableObject'))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** Reads a private copy. A read-only open fails when workerd has no open write-ahead log. */
async function readRegistrationKeys(
  file: string,
  copyRoot: string,
): Promise<Omit<StoredKey, 'store'>[]> {
  const query = "select key, hex(value) from _cf_KV where key like 'registration-%' order by key";
  const copy = path.join(copyRoot, 'admission.sqlite');
  try {
    await rm(`${copy}-wal`, { force: true });
    await rm(`${copy}-shm`, { force: true });
    await copyFile(file, copy);
    for (const suffix of ['-wal', '-shm'])
      await copyFile(`${file}${suffix}`, `${copy}${suffix}`).catch(ignoreMissingFile);
    const { stdout } = await run('sqlite3', ['-separator', '\t', copy, query]);
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [key, value] = line.split('\t');
        return { key, text: printableStrings(value) };
      });
  } catch (error: unknown) {
    const message = String(error);
    if (message.includes('no such table')) return [];
    return [{ key: 'unreadable', text: message.slice(-200) }];
  }
}
function ignoreMissingFile(error: NodeJS.ErrnoException): void {
  if (error.code !== 'ENOENT') throw error;
}

function printableStrings(hexValue: string): string {
  const text = Buffer.from(hexValue, 'hex').toString('latin1');
  return (text.match(/[a-z_]{4,}/g) ?? []).join(' ').slice(0, 300);
}

function readyJobs(stored: readonly StoredKey[]): string[] {
  return stored
    .filter((row) => row.key.startsWith('registration-job/') && /\bready\b/.test(row.text))
    .map((row) => row.key);
}

function isMlDsaPublication(response: import('@playwright/test').Response): boolean {
  return (
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname.endsWith('/signers/ml-dsa/publish')
  );
}
function isRegistrationActivity(response: import('@playwright/test').Response): boolean {
  return (
    response.request().method() === 'POST' && ACTIVITY_ROUTE.test(new URL(response.url()).pathname)
  );
}

async function registerWallet(
  harness: IntendedBehaviourHarness,
  trace: RegistrationTrace,
  wallet: string,
): Promise<void> {
  await trace.mark('register_started', { wallet });
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  await harness.useLiveNearTestnetRpc();
  await trace.mark('registered', { wallet });
}

/** The real screen sends the signal. This case never calls the private preparation route. */
async function openKeys(page: Page, trace: RegistrationTrace, wallet: string): Promise<void> {
  const signal = page.context().waitForEvent('response', {
    predicate: isRegistrationActivity,
    timeout: 60_000,
  });
  await trace.mark('signing_keys_opening', { wallet });
  await openSigningKeys(page);
  expect((await signal).status()).toBe(200);
  await trace.mark('signing_keys_open', { wallet });
}

type Creation = { readonly elapsedMs: number; readonly executeStatuses: readonly number[] };
async function createKey(
  page: Page,
  trace: RegistrationTrace,
  wallet: string,
): Promise<Creation> {
  await page.getByRole('button', { name: 'Add signer', exact: true }).click();
  const create = page.getByRole('button', { name: 'Create key', exact: true });
  await expect(create).toBeVisible();
  const networkStart = trace.network.length;
  const clickedAtMs = Date.now();
  await trace.mark('create_clicked', { wallet });
  const published = page.waitForResponse(isMlDsaPublication, { timeout: PUBLICATION_LIMIT_MS });
  const confirming = autoConfirmWalletIframeUntil(page, published, {
    timeoutMs: PUBLICATION_LIMIT_MS,
  });
  await create.click();
  const response = await confirming;
  expect(response.status()).toBe(200);
  // The auto-confirm loop returns late. The network mark holds the real publication time.
  const marks = trace.network.slice(networkStart);
  const publication = marks.find((mark) => mark.path.endsWith('/signers/ml-dsa/publish'));
  const elapsedMs = (publication?.atMs ?? Date.now()) - clickedAtMs;
  await trace.mark('published', { wallet, elapsedMs });
  const executeStatuses = marks
    .filter((mark) => mark.path.endsWith('/signers/ml-dsa/execute'))
    .map((mark) => mark.status);
  return { elapsedMs, executeStatuses };
}

async function addKeyToNear(page: Page, trace: RegistrationTrace, wallet: string): Promise<void> {
  const approve = page.getByRole('button', { name: 'Approve NEAR key addition', exact: true });
  await expect(approve).toBeVisible({ timeout: 60_000 });
  const activated = expect(
    page.getByRole('group', SIGNING_KEY_GROUP).getByText('Active on NEAR', { exact: true }),
  ).toBeVisible({ timeout: 120_000 });
  const confirming = autoConfirmWalletIframeUntil(page, activated, { timeoutMs: 120_000 });
  await trace.mark('near_approval_clicked', { wallet });
  await approve.click();
  await confirming;
  await trace.mark('near_key_active', { wallet });
  await expect(page.getByRole('heading', { name: 'Key active', exact: true })).toBeVisible();
  await waitForWalletIframeConfirmationSettlement(page);
}

/** Signs at once after activation, while refill may still be below the admission minimum. */
async function signFirstTransaction(
  harness: IntendedBehaviourHarness,
  page: Page,
  trace: RegistrationTrace,
  wallet: string,
): Promise<void> {
  const inventory = await harness.runMlDsaCommand({ kind: 'metadata' });
  if (!('kind' in inventory) || inventory.kind !== 'inventory') throw new Error('Missing signer');
  const entry = inventory.entries[0];
  if (entry?.kind !== 'published') throw new Error('The signer is not published');
  const { signingKeyId, publicKeyB64u, keyManifestDigestB64u, materialEpoch } = entry.key;
  const signer = {
    kind: 'near_ml_dsa_65',
    signingKeyId,
    publicKeyB64u,
    keyManifestDigestB64u,
    materialEpoch,
  } as const;
  const startedAtMs = Date.now();
  await trace.mark('first_signature_started', { wallet });
  await autoConfirmWalletIframeUntil(page, signMlDsaTransaction(harness, signer), {
    timeoutMs: PUBLICATION_LIMIT_MS,
  });
  await trace.mark('first_signature_finished', { wallet, elapsedMs: Date.now() - startedAtMs });
}

async function waitForReadyJob(
  trace: RegistrationTrace,
  label: string,
  excluded: readonly string[] = [],
): Promise<string[]> {
  const deadline = Date.now() + PUBLICATION_LIMIT_MS;
  while (Date.now() < deadline) {
    const ready = readyJobs(await trace.storage());
    if (ready.some((job) => !excluded.includes(job))) {
      await trace.snapshot(`${label}:ready`);
      return ready;
    }
    await delay(500);
  }
  await trace.snapshot(`${label}:ready_timeout`);
  throw new Error(`No new registration job became ready: ${label}`);
}

type CaseInput = {
  readonly harness: IntendedBehaviourHarness;
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly request: APIRequestContext;
};

async function withSeparateWallet<T>(
  { browser, request }: Pick<CaseInput, 'browser' | 'request'>,
  trace: RegistrationTrace,
  wallet: string,
  use: (harness: IntendedBehaviourHarness, page: Page) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    trace.watch(context, wallet);
    const separate = new IntendedBehaviourHarness({
      context,
      page,
      request,
      flow: 'passkey.registration',
      networkMode: 'managed_local',
    });
    await separate.initialize();
    return await use(separate, page);
  } finally {
    await context.close();
  }
}

/** Opening Signing keys prepares the first job. Claims reuse it and replace it. */
export async function runMlDsaActiveScopeRegistration(
  { harness, browser, context, page, request }: CaseInput,
  testInfo: TestInfo,
): Promise<void> {
  const input = { browser, request };
  testInfo.setTimeout(900_000);
  const trace = await RegistrationTrace.open(testInfo);
  trace.watch(context, 'first');
  await trace.snapshot('start');
  await registerWallet(harness, trace, 'first');
  await trace.watchStatus(page, 'first');
  const idle = await trace.snapshot('first:registered');
  expect(readyJobs(idle)).toEqual([]);
  expect(idle.filter((row) => row.key === 'registration-active-scopes')).toEqual([]);
  expect(trace.network.filter((mark) => ACTIVITY_ROUTE.test(mark.path))).toEqual([]);

  const identity = await harness.runMlDsaCommand({ kind: 'context' });
  if (!('nearAccountId' in identity) || typeof identity.nearAccountId !== 'string')
    throw new Error('Missing browser wallet account');
  await fundImplicitWallet(identity.nearAccountId);
  await openKeys(page, trace, 'first');
  const stocked = await waitForReadyJob(trace, 'first:signing_keys');
  expect(stocked).toHaveLength(1);

  const first = await createKey(page, trace, 'first');
  expect(first.executeStatuses).toEqual([200]);
  await addKeyToNear(page, trace, 'first');
  await signFirstTransaction(harness, page, trace, 'first');
  const replaced = await waitForReadyJob(trace, 'first:replacement', stocked);
  expect(replaced).toHaveLength(1);
  expect(trace.statusesOf('first')).toEqual([...CREATION_STAGES, ADD_TO_NEAR_STAGE]);

  const warm = await withSeparateWallet(input, trace, 'warm', async (separate, separatePage) => {
    await registerWallet(separate, trace, 'warm');
    await openKeys(separatePage, trace, 'warm');
    return createKey(separatePage, trace, 'warm');
  });
  expect(warm.executeStatuses).toEqual([200]);
  // The warm claim started the replacement. This wallet clicks before that job is ready.
  const waiting = await withSeparateWallet(
    input,
    trace,
    'waiting',
    async (separate, separatePage) => {
      await registerWallet(separate, trace, 'waiting');
      await trace.watchStatus(separatePage, 'waiting');
      await openKeys(separatePage, trace, 'waiting');
      return createKey(separatePage, trace, 'waiting');
    },
  );
  expect(waiting.executeStatuses.at(-1)).toBe(200);
  expect(trace.statusesOf('waiting')).toEqual(CREATION_STAGES);
  await trace.mark('finished', {
    firstElapsedMs: first.elapsedMs,
    warmElapsedMs: warm.elapsedMs,
    waitingElapsedMs: waiting.elapsedMs,
    waitingExecuteStatuses: waiting.executeStatuses,
  });
}

/**
 * Local trace for the one-hour window. It waits past one job lifetime, claims the
 * renewed job, then waits past the claim's window until the stock stops renewing.
 */
export async function runMlDsaActiveScopeWindow(
  { harness, browser, context, page, request }: CaseInput,
  testInfo: TestInfo,
): Promise<void> {
  const input = { browser, request };
  testInfo.setTimeout(7_200_000);
  const trace = await RegistrationTrace.open(testInfo);
  trace.watch(context, 'renewed');
  await registerWallet(harness, trace, 'renewed');
  await openKeys(page, trace, 'renewed');
  const initial = await waitForReadyJob(trace, 'renewed:signing_keys');
  await trace.mark('idle_started', { waitMs: PREPARATION_LIFETIME_MS + 5_000 });
  await delay(PREPARATION_LIFETIME_MS + 5_000);
  const renewed = readyJobs(await trace.snapshot('renewed:idle_finished'));
  expect(renewed.some((job) => !initial.includes(job))).toBe(true);
  const claimed = await createKey(page, trace, 'renewed');
  expect(claimed.executeStatuses).toEqual([200]);
  const claimedAtMs = Date.now();

  const windowEndMs = claimedAtMs + ACTIVITY_LIFETIME_MS + PREPARATION_LIFETIME_MS + 60_000;
  while (Date.now() < windowEndMs) {
    await trace.snapshot('window:poll');
    await delay(60_000);
  }
  const ended = await trace.snapshot('window:ended');
  expect(ended.filter((row) => row.key === 'registration-active-scopes')).toEqual([]);

  const late = await withSeparateWallet(input, trace, 'late', async (separate, separatePage) => {
    await registerWallet(separate, trace, 'late');
    await openKeys(separatePage, trace, 'late');
    return createKey(separatePage, trace, 'late');
  });
  await trace.mark('finished', {
    renewedElapsedMs: claimed.elapsedMs,
    lateElapsedMs: late.elapsedMs,
    lateExecuteStatuses: late.executeStatuses,
  });
}

type HostedWallet = {
  readonly label: string;
  readonly harness: IntendedBehaviourHarness;
  readonly page: Page;
};
type HostedInput = Pick<CaseInput, 'browser' | 'request'> & {
  readonly openHarness: (
    context: BrowserContext,
    page: Page,
    request: APIRequestContext,
  ) => Promise<IntendedBehaviourHarness>;
};
const HOSTED_EMPTY_WALLETS = ['empty-1', 'empty-2', 'empty-3'];
const HOSTED_READY_WALLETS = ['ready-1', 'ready-2', 'ready-3'];
const HOSTED_READY_WAIT_MS = 300_000;
// The testnet faucet has a daily limit. Creation times need no NEAR funds.
const HOSTED_SIGNS = process.env.SEAMS_INTENDED_ML_DSA_HOSTED_SKIP_SIGNATURE !== '1';
const HOSTED_READY_ONLY = process.env.SEAMS_INTENDED_ML_DSA_HOSTED_READY_ONLY === '1';

/**
 * Times the real Settings flow on Cloudflare. Empty wallets register first, so registration
 * traffic never overlaps a measured click, and each clicks as the previous one publishes.
 * Ready wallets register after a long wait, because an idle wallet page can lose its session.
 */
export async function runMlDsaHostedSettingsTimes(
  { browser, request, openHarness }: HostedInput,
  testInfo: TestInfo,
): Promise<void> {
  testInfo.setTimeout(3_000_000);
  const trace = await RegistrationTrace.open(testInfo);
  const contexts: BrowserContext[] = [];
  const openWallet = async (label: string): Promise<HostedWallet> => {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    trace.watch(context, label);
    const harness = await openHarness(context, page, request);
    await registerWallet(harness, trace, label);
    await trace.watchStatus(page, label);
    return { label, harness, page };
  };
  const create = async ({ label, page }: HostedWallet): Promise<void> => {
    await openKeys(page, trace, label);
    const creation = await createKey(page, trace, label);
    await trace.mark('creation_measured', { wallet: label, ...creation });
  };
  try {
    if (!HOSTED_READY_ONLY) {
      const wallets: HostedWallet[] = [];
      for (const label of HOSTED_EMPTY_WALLETS) wallets.push(await openWallet(label));
      for (const wallet of wallets) await create(wallet);
    }
    for (const label of HOSTED_READY_WALLETS) {
      await trace.mark('ready_wait_started', { wallet: label });
      await delay(HOSTED_READY_WAIT_MS);
      const wallet = await openWallet(label);
      if (HOSTED_SIGNS) {
        const identity = await wallet.harness.runMlDsaCommand({ kind: 'context' });
        if (!('nearAccountId' in identity) || typeof identity.nearAccountId !== 'string')
          throw new Error('Missing browser wallet account');
        await fundImplicitWallet(identity.nearAccountId);
      }
      await create(wallet);
      if (HOSTED_SIGNS) {
        await addKeyToNear(wallet.page, trace, label);
        await signFirstTransaction(wallet.harness, wallet.page, trace, label);
      }
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
}

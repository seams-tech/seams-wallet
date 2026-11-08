import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';
import type {} from '../../intended-app/src/speakToSignHelpers';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';
import { allowBrowserMicrophone, enrollBrowserMicrophone, requireActivatedVoiceId } from './voiceid-browser-audio';
import { readNearIdentity } from './voiceid-near-signing';

// A live testnet run: the Wallet owns a vault on the Speak-to-Sign vault contract, enrolls a
// macOS `say` voice with the verifier through `seams.speakToSign.enroll`, and pays by voice. The
// Wallet's microphone plays the `say` recording of whatever sentence the VoiceID surface shows.
// It needs the OutLayer payment key on the local server and a relayer that creates named
// accounts funded with ACCOUNT_INITIAL_BALANCE of at least 0.3 NEAR: `create_vault` takes
// 0.15 NEAR, and testnet charges about 0.051 NEAR up front for the 50 Tgas of
// `transfer_with_verdict`.
const LIVE = process.env.SEAMS_SPEAK_TO_SIGN_LIVE === '1';
const CONTACT = 'seams-v1.testnet';
const VOICE = 'Samantha';
const RPC_URL = 'https://test.rpc.fastnear.com';
/** The owner reads these on the VoiceID surface during `enroll`. */
const ENROLL_PHRASES = [
  'My voice is my signature for this vault.',
  'I send money only to the contacts I saved.',
  'Seams, please learn how I sound today.',
];
/** The owner always says 0.01 NEAR, so a prompt for another amount gets a wrong sentence. */
const SPOKEN_TRANSFER = 'Send 0.01 NEAR to seams dash v1 dot testnet.';
const CREATE_VAULT_DEPOSIT = '150000000000000000000000';
/** The owner pays the prepaid gas of each spoken payment: 0.0509 NEAR measured on testnet. */
const TRANSFER_PREPAID_YOCTO = 60_000_000_000_000_000_000_000n;
const STORAGE_YOCTO_PER_BYTE = 10_000_000_000_000_000_000n;
const WALLET = 'iframe.seams-wallet-overlay-iframe';
const AUDIO_ROUTE = /\/speak-to-sign-test-audio\/(\d)\.wav$/;

const audioRoot = path.join(tmpdir(), `seams-speak-to-sign-${process.pid}`);
const RUN_LEAD_IN_MS = 200 + (Date.now() % 500);
/** Clip 0 to 2 are the enrollment phrases; clip 3 is the transfer sentence. */
const clipFiles = LIVE
  ? [...ENROLL_PHRASES, SPOKEN_TRANSFER].map((text, index) => sayWav(text, `clip-${index}`))
  : [];

test.skip(!LIVE, 'Set SEAMS_SPEAK_TO_SIGN_LIVE=1 with the live testnet environment.');
test.use({ video: 'off', trace: 'off' });
test.setTimeout(600_000);

test('a Wallet enrolls and pays from its vault by voice on testnet and refuses a wrong spoken amount', run);

async function run(
  { harness, page, context }: { harness: IntendedBehaviourHarness; page: Page; context: import('@playwright/test').BrowserContext },
  testInfo: TestInfo,
): Promise<void> {
  // The harness stubs NEAR RPC. This run reads and writes the real testnet vault.
  await context.route('**/*', useRealNearRpc);
  await context.route(AUDIO_ROUTE, serveClip);
  context.on('response', logVerifyResponse);
  await allowBrowserMicrophone(context);
  harness.enableVoiceIdPlugin();
  await harness.registerPasskeyEd25519YaoWallet();
  await harness.assertRegistrationOwnerSessionIsActive();
  const identity = await readNearIdentity(page);
  const owner = identity.accountId;
  log('owner', owner);
  expect(owner.endsWith(`.${process.env.RELAYER_ACCOUNT_ID}`)).toBe(true);

  const wallet = page.frameLocator(WALLET);
  const activation = page.evaluate(activateVoiceId);
  await wallet.getByRole('button', { name: 'Activate VoiceID', exact: true }).click();
  await enrollBrowserMicrophone(page);
  requireActivatedVoiceId(await activation);
  log('voiceid', 'activated in the Wallet');

  const call = vaultCaller(page, identity.walletId, owner);
  log('create_vault', await call('create_vault', {}, CREATE_VAULT_DEPOSIT));
  log('add_contact', await call('add_contact', { account_id: CONTACT }, '0'));

  // From here the Wallet microphone says whatever sentence the VoiceID surface shows.
  await wallet.locator('body').evaluate(speakVisibleSentence, ENROLL_PHRASES);
  const enrollment = page.evaluate(enroll, identity.walletId);
  for (const phrase of ENROLL_PHRASES) await recordSentence(page, phrase);
  const enrolled = await approveUntilSettled(page, enrollment);
  log('enroll', JSON.stringify(enrolled));
  expect(enrolled).toMatchObject({ kind: 'enrolled' });

  log('near account state', JSON.stringify(await page.evaluate(readNearAccountState, identity.walletId)));
  const free = await freeBalance(owner);
  log('owner free balance', `${free} yoctoNEAR`);
  expect(free, 'The owner cannot prepay a spoken payment; raise ACCOUNT_INITIAL_BALANCE')
    .toBeGreaterThanOrEqual(TRANSFER_PREPAID_YOCTO);
  const sent = await speak(page, '0.01');
  log('transfer', JSON.stringify(sent));
  expect(sent).toMatchObject({ kind: 'sent' });
  const refused = await speak(page, '0.02');
  log('wrong amount', JSON.stringify(refused));
  expect(refused).toMatchObject({ kind: 'refused' });
  await testInfo.attach('speak-to-sign-live.json', {
    body: JSON.stringify({ owner, enrolled, sent, refused }, null, 2),
    contentType: 'application/json',
  });
}

/** Waits for the VoiceID surface to show `sentence`, then clicks Record. */
async function recordSentence(page: Page, sentence: string): Promise<void> {
  const dialog = page.frameLocator(WALLET).getByRole('dialog', { name: 'Say this with your voice' });
  await expect(dialog.locator('.seams-voiceid-prompt')).toHaveText(sentence, { timeout: 60_000 });
  log('sentence', sentence);
  await dialog.getByRole('button', { name: 'Record', exact: true }).click();
}

/** One spoken payment: the owner clicks Record and the microphone says the 0.01 NEAR sentence. */
async function speak(page: Page, amount: string) {
  const wallet = page.frameLocator(WALLET);
  const walletId = await readNearIdentity(page).then(walletIdOf);
  const result = page.evaluate(requestTransfer, { walletId, receiver: CONTACT, amount });
  const dialog = wallet.getByRole('dialog', { name: 'Say this with your voice' });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  log('sentence', await dialog.locator('.seams-voiceid-prompt').innerText());
  await dialog.getByRole('button', { name: 'Record', exact: true }).click();
  return await approveUntilSettled(page, result);
}

function walletIdOf(identity: { walletId: string }): string {
  return identity.walletId;
}

function vaultCaller(page: Page, walletId: string, nearAccountId: string) {
  return async (method: string, args: Record<string, unknown>, depositYocto: string) => {
    const result = await approveUntilSettled(
      page,
      page.evaluate(callVault, { walletId, nearAccountId, method, args, depositYocto }),
    );
    if (!result.success) throw new Error(`${method} failed: ${JSON.stringify(result)}`);
    return result.transactionId ?? 'no transaction id';
  };
}

/** Clicks the Wallet confirmation whenever one appears, until the operation settles. */
async function approveUntilSettled<T>(page: Page, operation: Promise<T>): Promise<T> {
  let settled = false;
  const done = operation.finally(() => {
    settled = true;
  });
  const confirm = page.frameLocator(WALLET).locator('button.confirm');
  while (!settled) {
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click().catch(() => undefined);
      log('wallet', 'confirmed');
    }
    await Promise.race([done.catch(() => undefined), page.waitForTimeout(250)]);
  }
  return await done;
}

function sayWav(text: string, name: string): string {
  mkdirSync(audioRoot, { recursive: true });
  const aiff = path.join(audioRoot, `${name}.aiff`);
  const wav = path.join(audioRoot, `${name}.wav`);
  execFileSync('say', ['-v', VOICE, '-r', '175', '-o', aiff, text]);
  // The verifier refuses audio it has seen, and `say` repeats its bytes. A lead-in silence
  // unique to this run makes new clips. Silence after the sentence ends the recording.
  const filters = ['-af', `adelay=${RUN_LEAD_IN_MS},apad=pad_dur=3`];
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', aiff, ...filters,
    '-ac', '1', '-ar', '16000', '-sample_fmt', 's16', '-map_metadata', '-1', '-fflags', '+bitexact', wav,
  ]);
  return wav;
}

/** The balance the account can spend: its amount less the stake for its storage. */
async function freeBalance(accountId: string): Promise<bigint> {
  const account = await rpc('query', {
    request_type: 'view_account',
    finality: 'final',
    account_id: accountId,
  });
  return BigInt(account.amount) - BigInt(account.storage_usage) * STORAGE_YOCTO_PER_BYTE;
}

async function rpc(method: string, params: unknown) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'speak-to-sign', method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 300));
  return body.result;
}

/** The verify reply holds the verdict and timings, or an error code and message. */
function logVerifyResponse(response: import('@playwright/test').Response): void {
  if (!response.url().endsWith('/speak-to-sign/v1/verify')) return;
  if (response.request().method() !== 'POST') return;
  void response
    .text()
    .then((body) => log('verify reply', response.status(), body.slice(0, 1500)))
    .catch(() => log('verify reply', response.status(), 'unreadable'));
}

async function useRealNearRpc(route: import('@playwright/test').Route): Promise<void> {
  const host = new URL(route.request().url()).hostname;
  if (/(^|\.)(fastnear\.com|near\.org)$/i.test(host)) await route.continue();
  else await route.fallback();
}

function log(...parts: unknown[]): void {
  console.log(`[speak-to-sign] ${parts.join(' ')}`);
}

function activateVoiceId() {
  if (!window.__seamsIntendedVoiceId) throw new Error('VoiceID acceptance helper is unavailable');
  return window.__seamsIntendedVoiceId.activate();
}

function callVault(input: Parameters<NonNullable<Window['__seamsIntendedSpeakToSign']>['callVault']>[0]) {
  if (!window.__seamsIntendedSpeakToSign) throw new Error('Speak-to-Sign helper is unavailable');
  return window.__seamsIntendedSpeakToSign.callVault(input);
}

function readNearAccountState(walletId: string) {
  if (!window.__seamsIntendedSpeakToSign) throw new Error('Speak-to-Sign helper is unavailable');
  return window.__seamsIntendedSpeakToSign.readNearAccountState(walletId);
}

async function serveClip(route: import('@playwright/test').Route): Promise<void> {
  const index = Number(AUDIO_ROUTE.exec(route.request().url())?.[1]);
  await route.fulfill({ contentType: 'audio/wav', body: readFileSync(clipFiles[index]) });
}

/**
 * Runs in the Wallet frame. Each recording plays the `say` clip of the sentence that the
 * VoiceID surface shows: an enrollment phrase, or else the 0.01 NEAR transfer sentence.
 */
function speakVisibleSentence(_body: Element, phrases: readonly string[]): void {
  let audio: AudioContext | null = null;
  navigator.mediaDevices.getUserMedia = async () => {
    const shown = document.querySelector('.seams-voiceid-prompt')?.textContent?.trim() ?? '';
    const index = phrases.indexOf(shown);
    const response = await fetch(`/speak-to-sign-test-audio/${index < 0 ? phrases.length : index}.wav`);
    if (!response.ok) throw new Error('The spoken test clip is unavailable');
    if (audio) await audio.close();
    audio = new AudioContext();
    const source = audio.createBufferSource();
    source.buffer = await audio.decodeAudioData(await response.arrayBuffer());
    const destination = audio.createMediaStreamDestination();
    source.connect(destination);
    await audio.resume();
    source.start(audio.currentTime + 0.2);
    return destination.stream;
  };
}

function enroll(walletId: string) {
  if (!window.__seamsIntendedSpeakToSign) throw new Error('Speak-to-Sign helper is unavailable');
  return window.__seamsIntendedSpeakToSign.enroll({ walletId });
}

function requestTransfer(input: { walletId: string; receiver: string; amount: string }) {
  if (!window.__seamsIntendedSpeakToSign) throw new Error('Speak-to-Sign helper is unavailable');
  return window.__seamsIntendedSpeakToSign.requestTransfer(input);
}

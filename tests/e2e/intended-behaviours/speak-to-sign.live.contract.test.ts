import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';
import type {} from '../../intended-app/src/speakToSignHelpers';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';
import { allowBrowserMicrophone, enrollBrowserMicrophone, requireActivatedVoiceId } from './voiceid-browser-audio';
import { readNearIdentity } from './voiceid-near-signing';

// A live testnet run: the Wallet owns a vault on the Speak-to-Sign vault contract, the OutLayer
// verifier enrolls a macOS `say` voice, and the Wallet pays by voice through Chromium's fake
// microphone. It needs the OutLayer payment key and a relayer that creates named accounts.
const LIVE = process.env.SEAMS_SPEAK_TO_SIGN_LIVE === '1';
const VAULT = 'seams-wallet.testnet';
const CONTACT = 'seams-v1.testnet';
const VOICE = 'Samantha';
const RPC_URL = 'https://test.rpc.fastnear.com';
const OUTLAYER_URL = 'https://testnet-api.outlayer.ai/call/seams-v1.testnet/voice-verifier';
const VERSION_KEY = '1e79327b0afa2a0f026aee519bd0d1801272e21cb21205d31788e4d1452231f0';
const ENROLLMENT_DOMAIN = 'seams:voice-enrollment:v1';
const ENROLL_PHRASES = [
  'My voice is my signature for this vault.',
  'I send money only to the contacts I saved.',
  'Seams, please learn how I sound today.',
];
const CREATE_VAULT_DEPOSIT = '150000000000000000000000';
const WALLET = 'iframe.seams-wallet-overlay-iframe';

const audioRoot = path.join(tmpdir(), `seams-speak-to-sign-${process.pid}`);
const RUN_LEAD_IN_MS = 200 + (Date.now() % 500);
const microphoneWav = LIVE
  ? sayWav('Send 0.01 NEAR to seams dash v1 dot testnet.', 'microphone', true)
  : '';

test.skip(!LIVE, 'Set SEAMS_SPEAK_TO_SIGN_LIVE=1 with the live testnet environment.');
test.use({
  video: 'off',
  trace: 'off',
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${microphoneWav}`,
    ],
  },
});
test.setTimeout(600_000);

test('a Wallet pays from its vault by voice on testnet and refuses a wrong spoken amount', run);

async function run(
  { harness, page, context }: { harness: IntendedBehaviourHarness; page: Page; context: import('@playwright/test').BrowserContext },
  testInfo: TestInfo,
): Promise<void> {
  // The harness stubs NEAR RPC. This run reads and writes the real testnet vault.
  await context.route('**/*', useRealNearRpc);
  context.on('response', logVerifyResponse);
  // Keep Chromium's own microphone before the VoiceID fixture replaces it for enrollment.
  await context.addInitScript(keepBrowserMicrophone);
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

  // The verifier enrolls only the three clips whose digest the owner authorized on the vault.
  const clips = ENROLL_PHRASES.map(enrollmentClip);
  const digest = enrollmentDigest(owner, clips);
  log('authorize_enrollment', await call('authorize_enrollment', { enrollment_digest: digest }, '0'));
  await expect.poll(pendingDigest.bind(null, owner), { timeout: 30_000 }).toBe(digest);
  const enrolled = await outlayer({
    op: 'enroll',
    vault: VAULT,
    owner,
    audio_wav_b64: clips.map(base64),
  });
  log('enroll', JSON.stringify(enrolled.output), `${enrolled.wallMs} ms`);
  expect(enrolled.output.outcome).toBe('accept');

  log('near account state', JSON.stringify(await page.evaluate(readNearAccountState, identity.walletId)));
  await wallet.locator('body').evaluate(useBrowserMicrophone);
  const sent = await speak(page, '0.01');
  log('transfer', JSON.stringify(sent));
  expect(sent).toMatchObject({ kind: 'sent' });
  const refused = await speak(page, '0.02');
  log('wrong amount', JSON.stringify(refused));
  expect(refused).toMatchObject({ kind: 'refused' });
  await testInfo.attach('speak-to-sign-live.json', {
    body: JSON.stringify({ owner, sent, refused }, null, 2),
    contentType: 'application/json',
  });
}

/** One spoken payment: the owner clicks Record and the fake microphone plays the sentence. */
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

function sayWav(text: string, name: string, padded = false): string {
  mkdirSync(audioRoot, { recursive: true });
  const aiff = path.join(audioRoot, `${name}.aiff`);
  const wav = path.join(audioRoot, `${name}.wav`);
  execFileSync('say', ['-v', VOICE, '-r', '175', '-o', aiff, text]);
  // The verifier refuses audio it has seen, and `say` repeats its bytes. A lead-in silence
  // unique to this run makes new clips. The fake microphone loops its file, so silence after
  // the sentence ends the recording.
  const filters = ['-af', `adelay=${RUN_LEAD_IN_MS}${padded ? ',apad=pad_dur=3' : ''}`];
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', aiff, ...filters,
    '-ac', '1', '-ar', '16000', '-sample_fmt', 's16', '-map_metadata', '-1', '-fflags', '+bitexact', wav,
  ]);
  return wav;
}

/** The verifier's canonical WAV: a 44-byte header, then the PCM16 samples. */
function enrollmentClip(phrase: string, index: number): Buffer {
  const file = readFileSync(sayWav(phrase, `enroll-${index}`));
  const dataAt = file.indexOf('data');
  const pcm = file.subarray(dataAt + 8, dataAt + 8 + file.readUInt32LE(dataAt + 4));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function enrollmentDigest(owner: string, clips: readonly Buffer[]): string {
  const hash = createHash('sha256');
  hash.update(`${ENROLLMENT_DOMAIN}${VAULT}\0${owner}\0`);
  for (const clip of clips) hash.update(createHash('sha256').update(clip).digest());
  return hash.digest('base64url');
}

async function pendingDigest(owner: string): Promise<string | null> {
  const reply = await rpc('query', {
    request_type: 'call_function',
    finality: 'final',
    account_id: VAULT,
    method_name: 'get_pending_enrollment',
    args_base64: Buffer.from(JSON.stringify({ owner_id: owner })).toString('base64'),
  });
  const value = JSON.parse(Buffer.from(reply.result).toString('utf8'));
  return value?.enrollment_digest ?? null;
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

async function outlayer(input: Record<string, unknown>) {
  const paymentKey = process.env.SPEAK_TO_SIGN_OUTLAYER_PAYMENT_KEY;
  if (!paymentKey) throw new Error('SPEAK_TO_SIGN_OUTLAYER_PAYMENT_KEY is not set');
  const started = performance.now();
  const response = await fetch(OUTLAYER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-payment-key': paymentKey },
    body: JSON.stringify({
      input,
      async: false,
      version_key: VERSION_KEY,
      secrets_ref: { profile: 'main', account_id: 'cyan-loong.testnet' },
      resource_limits: {
        max_instructions: 10_000_000_000,
        max_memory_mb: 256,
        max_execution_seconds: 60,
      },
    }),
  });
  const body = await response.json();
  const raw = body?.output;
  const output = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!response.ok || !output) {
    throw new Error(`OutLayer HTTP ${response.status}: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return { output, wallMs: Math.round(performance.now() - started) };
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

function base64(bytes: Buffer): string {
  return bytes.toString('base64');
}

function log(...parts: unknown[]): void {
  console.log(`[speak-to-sign] ${parts.join(' ')}`);
}

function keepBrowserMicrophone(): void {
  const media = navigator.mediaDevices;
  if (media) {
    (window as unknown as Record<string, unknown>).__seamsBrowserGetUserMedia =
      media.getUserMedia.bind(media);
  }
}

function useBrowserMicrophone(): void {
  const original = (window as unknown as Record<string, unknown>).__seamsBrowserGetUserMedia;
  if (typeof original !== 'function') throw new Error('The browser microphone was not kept');
  navigator.mediaDevices.getUserMedia = original as MediaDevices['getUserMedia'];
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

function requestTransfer(input: { walletId: string; receiver: string; amount: string }) {
  if (!window.__seamsIntendedSpeakToSign) throw new Error('Speak-to-Sign helper is unavailable');
  return window.__seamsIntendedSpeakToSign.requestTransfer(input);
}

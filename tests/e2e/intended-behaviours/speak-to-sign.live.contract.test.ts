import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';
import type {} from '../../intended-app/src/speakToSignHelpers';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';
import { allowBrowserMicrophone, enrollBrowserMicrophone, requireActivatedVoiceId } from './voiceid-browser-audio';
import { readNearIdentity } from './voiceid-near-signing';

// A live testnet run: the Wallet enrolls a macOS `say` voice with the verifier through
// `seams.near.speakToSign.enroll` (one NEP-413 confirm), then pays by voice from its own account. The
// Wallet's microphone plays the `say` recording of whatever sentence the VoiceID surface shows.
// An accepted verdict must pay with no Wallet confirm. An 11 NEAR payment is above the stub
// step-up rule, so it must show the confirm again; the account cannot pay 11 NEAR, so NEAR
// then refuses the transfer before it runs. It needs the OutLayer payment key on the local
// server, the local app built with VITE_SEAMS_INTENDED_SPEAK_TO_SIGN_NETWORK=testnet, and a
// relayer that creates named accounts funded with ACCOUNT_INITIAL_BALANCE of at least 0.1 NEAR.
// The local services serve the Speak-to-Sign host plugin only when SEAMS_SPEAK_TO_SIGN_PACKAGE_DIR
// names a built @seams/speak-to-sign package, for example ../speak-to-sign/packages/speak-to-sign
// after `pnpm build` there (seams-tech/speak-to-sign).
const LIVE = process.env.SEAMS_SPEAK_TO_SIGN_LIVE === '1';
const RECEIVER = 'seams-v1.testnet';
const VOICE = 'Samantha';
const RPC_URL = 'https://test.rpc.fastnear.com';
/** The owner reads these on the VoiceID surface during `enroll`. */
const ENROLL_PHRASES = [
  'My voice is my signature for this wallet.',
  'I send money only when I say so.',
  'Seams, please learn how I sound today.',
];
/** The owner says 0.01 NEAR for any small amount, so a prompt for 0.02 NEAR gets wrong words. */
const SPOKEN_TRANSFER = 'Send 0.01 NEAR to seams dash v1 dot testnet.';
const SPOKEN_STEP_UP = 'Send 11 NEAR to seams dash v1 dot testnet.';
const STEP_UP_SENTENCE = 'Send 11 NEAR to seams-v1.testnet';
/** 0.01 NEAR and the gas of one plain transfer, with a margin. */
const TRANSFER_NEEDS_YOCTO = 20_000_000_000_000_000_000_000n;
const STORAGE_YOCTO_PER_BYTE = 10_000_000_000_000_000_000n;
const WALLET = 'iframe.seams-wallet-overlay-iframe';
const AUDIO_ROUTE = /\/speak-to-sign-test-audio\/(\d)\.wav$/;

const audioRoot = path.join(tmpdir(), `seams-speak-to-sign-${process.pid}`);
const RUN_LEAD_IN_MS = 200 + (Date.now() % 500);
/**
 * Clip 0 to 2 are the enrollment phrases. Clips 3 and 4 both say the 0.01 NEAR sentence with
 * different lead-ins: the verifier refuses audio it has seen, so the wrong-amount case needs
 * new bytes to reach the words check. Clip 5 says the 11 NEAR sentence.
 */
const clipFiles = LIVE
  ? [
      ...[...ENROLL_PHRASES, SPOKEN_TRANSFER].map((text, index) => sayWav(text, `clip-${index}`)),
      sayWav(SPOKEN_TRANSFER, 'clip-4', RUN_LEAD_IN_MS + 137),
      sayWav(SPOKEN_STEP_UP, 'clip-5'),
    ]
  : [];

test.skip(!LIVE, 'Set SEAMS_SPEAK_TO_SIGN_LIVE=1 with the live testnet environment.');
test.use({ video: 'off', trace: 'off' });
test.setTimeout(600_000);

test('a Wallet enrolls, pays by voice with no confirm, refuses wrong words and steps up above 10 NEAR', run);

async function run(
  { harness, page, context }: { harness: IntendedBehaviourHarness; page: Page; context: import('@playwright/test').BrowserContext },
  testInfo: TestInfo,
): Promise<void> {
  // The harness stubs NEAR RPC. This run reads and writes real testnet accounts.
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

  // From here the Wallet microphone says whatever sentence the VoiceID surface shows.
  await wallet
    .locator('body')
    .evaluate(speakVisibleSentence, { phrases: ENROLL_PHRASES, stepUp: STEP_UP_SENTENCE });
  const enrollment = page.evaluate(enroll, identity.walletId);
  for (const phrase of ENROLL_PHRASES) await recordSentence(page, phrase);
  const enrolled = await approveUntilSettled(page, enrollment);
  log('enroll', JSON.stringify(enrolled.result), `confirms ${enrolled.confirms}`);
  expect(enrolled.result).toMatchObject({ kind: 'enrolled' });

  log('near account state', JSON.stringify(await page.evaluate(readNearAccountState, identity.walletId)));
  const free = await freeBalance(owner);
  log('owner free balance', `${free} yoctoNEAR`);
  expect(free, 'The owner cannot pay a spoken payment; raise ACCOUNT_INITIAL_BALANCE')
    .toBeGreaterThanOrEqual(TRANSFER_NEEDS_YOCTO);
  const sent = await speak(page, '0.01');
  log('transfer', JSON.stringify(sent.result), `confirms ${sent.confirms}`);
  expect(sent.result).toMatchObject({ kind: 'approved', approval: 'voice' });
  expect(sent.confirms, 'An accepted verdict pays with no Wallet confirm').toBe(0);
  const refused = await speak(page, '0.02');
  log('wrong amount', JSON.stringify(refused.result));
  // A new recording of the 0.01 NEAR sentence: the verifier must refuse the words, not the audio.
  expect(refused.result).toMatchObject({ kind: 'refused', reason: 'words' });
  const steppedUp = await speak(page, '11');
  log('step-up', JSON.stringify(steppedUp.result), `confirms ${steppedUp.confirms}`);
  expect(steppedUp.confirms, 'A step-up verdict asks for the confirm again').toBeGreaterThan(0);
  // NEAR checks the balance before the transfer runs, so nothing is submitted.
  expect(steppedUp.result).toMatchObject({ kind: 'unavailable', reason: 'not_submitted' });
  await testInfo.attach('speak-to-sign-live.json', {
    body: JSON.stringify({ owner, enrolled, sent, refused, steppedUp }, null, 2),
    contentType: 'application/json',
  });
}

/** Waits for the VoiceID surface to show `sentence`, then clicks Record. */
async function recordSentence(page: Page, sentence: string): Promise<void> {
  const dialog = page.frameLocator(WALLET).getByRole('dialog', { name: 'Say this with your voice' });
  await expect(dialog.locator('.seams-voiceid-phrase')).toHaveText(sentence, { timeout: 60_000 });
  log('sentence', sentence);
  await dialog.getByRole('button', { name: 'Record', exact: true }).click();
}

/** One spoken payment: the owner clicks Record and the microphone says a prepared sentence. */
async function speak(page: Page, amount: string) {
  const wallet = page.frameLocator(WALLET);
  const walletId = await readNearIdentity(page).then(walletIdOf);
  const result = page.evaluate(requestTransfer, { walletId, receiver: RECEIVER, amount });
  const dialog = wallet.getByRole('dialog', { name: 'Say this with your voice' });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  log('sentence', await dialog.locator('.seams-voiceid-phrase').innerText());
  await dialog.getByRole('button', { name: 'Record', exact: true }).click();
  return await approveUntilSettled(page, result);
}

function walletIdOf(identity: { walletId: string }): string {
  return identity.walletId;
}

/**
 * Clicks the Wallet confirmation and the VoiceID card's buttons whenever they appear, until the
 * operation settles, and counts the confirms it clicked (a confirm or the card's passkey button).
 */
async function approveUntilSettled<T>(
  page: Page,
  operation: Promise<T>,
): Promise<{ result: T; confirms: number }> {
  let settled = false;
  let confirms = 0;
  const done = operation.finally(() => {
    settled = true;
  });
  let passkeyClicked = false;
  const confirm = page.frameLocator(WALLET).locator('button.confirm');
  // The VoiceID card shows the result and waits on its one button: "Done" after a payment,
  // "Close" or "Try again" after a refusal, "Confirm with passkey" for a step-up.
  const card = page.frameLocator(WALLET).getByRole('dialog', { name: 'Say this with your voice' });
  const cardButton = (name: string) => card.getByRole('button', { name, exact: true });
  const shown = async (name: string) => await cardButton(name).isVisible().catch(() => false);
  while (!settled) {
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click().catch(() => undefined);
      confirms += 1;
      log('wallet', 'confirmed');
    } else if (await shown('Done')) {
      await cardButton('Done').click().catch(() => undefined);
    } else if (await shown('Close')) {
      await cardButton('Close').click().catch(() => undefined);
    } else if (await shown('Try again')) {
      // "Try again" records again; Cancel ends the request with the refusal.
      await cardButton('Cancel').click().catch(() => undefined);
    } else if (!passkeyClicked && (await shown('Confirm with passkey'))) {
      const button = cardButton('Confirm with passkey');
      if (await button.isEnabled({ timeout: 100 }).catch(() => false)) {
        passkeyClicked = true;
        await button.click().catch(() => undefined);
        confirms += 1;
        log('wallet', 'confirmed on the card');
      }
    }
    await Promise.race([done.catch(() => undefined), page.waitForTimeout(250)]);
  }
  return { result: await done, confirms };
}

function sayWav(text: string, name: string, leadInMs = RUN_LEAD_IN_MS): string {
  mkdirSync(audioRoot, { recursive: true });
  const aiff = path.join(audioRoot, `${name}.aiff`);
  const wav = path.join(audioRoot, `${name}.wav`);
  execFileSync('say', ['-v', VOICE, '-r', '175', '-o', aiff, text]);
  // The verifier refuses audio it has seen, and `say` repeats its bytes. A lead-in silence
  // unique to this run makes new clips. Silence after the sentence ends the recording.
  const filters = ['-af', `adelay=${leadInMs},apad=pad_dur=3`];
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

/**
 * The verify reply is a `text/event-stream` (`verifier_running`, then `verdict` or `failed`),
 * or a JSON error before the verifier call. Playwright cannot read a streamed body, so the log
 * shows the status and the content type; a JSON error also shows its body.
 */
function logVerifyResponse(response: import('@playwright/test').Response): void {
  if (!response.url().endsWith('/speak-to-sign/v1/verify')) return;
  if (response.request().method() !== 'POST') return;
  const contentType = response.headers()['content-type'] ?? 'none';
  log('verify reply', response.status(), contentType);
  if (contentType.startsWith('text/event-stream')) return;
  void response
    .text()
    .then((body) => log('verify error', response.status(), body.slice(0, 1500)))
    .catch(() => log('verify error', response.status(), 'unreadable'));
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
 * VoiceID surface shows: an enrollment phrase, the 11 NEAR step-up clip, or else a 0.01 NEAR
 * transfer clip. Each distinct small transfer sentence gets its own clip, so a second payment
 * never replays the first one's audio.
 */
function speakVisibleSentence(
  _body: Element,
  clips: { readonly phrases: readonly string[]; readonly stepUp: string },
): void {
  const { phrases } = clips;
  let audio: AudioContext | null = null;
  const transferClips = new Map<string, number>();
  navigator.mediaDevices.getUserMedia = async () => {
    const shown = document.querySelector('.seams-voiceid-phrase')?.textContent?.trim() ?? '';
    const index = phrases.indexOf(shown);
    if (index < 0 && shown !== clips.stepUp && !transferClips.has(shown)) {
      transferClips.set(shown, phrases.length + transferClips.size);
    }
    const clip =
      shown === clips.stepUp
        ? phrases.length + 2
        : index < 0
          ? (transferClips.get(shown) ?? phrases.length)
          : index;
    const response = await fetch(`/speak-to-sign-test-audio/${clip}.wav`);
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

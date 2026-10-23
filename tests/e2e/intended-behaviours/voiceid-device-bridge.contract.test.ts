import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import {
  parseVoiceIdDeviceAssertion,
  parseVoiceIdDevicePublicKeyB64u,
} from '@shared/authorization/voiceIdDeviceAssertion';
import { base64UrlDecode } from '@shared/utils/base64';
import { parseDigestB64u, sha256DigestB64u } from '@shared/utils/canonicalPrimitives';
import { requireRecord } from '@shared/utils/validation';
import { voiceIdWalletSessionChallengeBytes } from '@shared/authorization/voiceIdDeviceAssertion';
import type {} from '../../fixtures/ui/VoiceIdDeviceCaptureProbe';

const WALLET_ORIGIN = 'https://wallet.example.test';
const PROBE_HTML = `<!doctype html>
<html><head><title>VoiceID device bridge</title></head><body>
<button id="approval">Approve transfer</button>
<button id="activate">Activate</button>
<button id="unlock">Unlock</button>
<button id="wrong-origin">Wrong origin</button>
<button id="held">Hold capture</button>
</body></html>`;

function fulfillProbePage(route: Route): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'text/html', body: PROBE_HTML });
}

function captureResult(): Promise<unknown> {
  return window.voiceIdDeviceCaptureProbe.result();
}

function requestCount(): number {
  return window.voiceIdDeviceCaptureProbe.requestCount();
}

function prepareUnlock(): Promise<void> {
  return window.voiceIdDeviceCaptureProbe.prepareUnlock();
}

function setWrongKey(): void {
  window.voiceIdDeviceCaptureProbe.setMode('wrong_key');
}

function clearListening(): void {
  delete document.body.dataset.listening;
}

function abortCapture(): void {
  window.voiceIdDeviceCaptureProbe.abort();
}

function startWalletActivation(): void {
  window.voiceIdDeviceCaptureProbe.startWalletActivation();
}

function setApproved(): void {
  window.voiceIdDeviceCaptureProbe.setMode('approved');
}

test('VoiceID browser bridge checks device identity, origin, signature, and cancellation', runJourney);

async function runJourney({ page }: { page: Page }, testInfo: TestInfo): Promise<void> {
  const bundle = JSON.parse(execFileSync(
    process.execPath,
    [path.resolve(import.meta.dirname, '../../scripts/build-preact-probe.mjs'), 'VoiceIdDeviceCaptureProbe.ts'],
    { encoding: 'utf8' },
  ));
  if (!Array.isArray(bundle) || typeof bundle[0]?.code !== 'string') {
    throw new Error('VoiceID device bridge probe bundle is invalid');
  }
  await page.addInitScript({ content: bundle[0].code });
  await page.route(`${WALLET_ORIGIN}/**`, fulfillProbePage);
  await page.goto(`${WALLET_ORIGIN}/voiceid-bridge`);
  await page.bringToFront();

  await page.getByRole('button', { name: 'Approve transfer' }).click();
  expect(await page.evaluate(captureResult)).toBe('approved');
  expect(await page.evaluate(requestCount)).toBe(1);

  await page.getByRole('button', { name: 'Activate' }).click();
  const activation = requireRecord(await page.evaluate(captureResult), 'VoiceID activation');
  expect(activation.kind).toBe('activated');
  const publicKeyB64u = parseVoiceIdDevicePublicKeyB64u(activation.publicKeyB64u);
  const deviceKeyId = parseDigestB64u(activation.deviceKeyId);
  expect(await sha256DigestB64u(base64UrlDecode(publicKeyB64u))).toBe(deviceKeyId);
  expect(await page.evaluate(requestCount)).toBe(2);

  await page.evaluate(prepareUnlock);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  const unlock = requireRecord(await page.evaluate(captureResult), 'VoiceID unlock');
  expect(unlock.kind).toBe('unlocked');
  const assertion = parseVoiceIdDeviceAssertion(unlock.assertion);
  const publicKey = await crypto.subtle.importKey(
    'raw',
    base64UrlDecode(publicKeyB64u),
    'Ed25519',
    false,
    ['verify'],
  );
  expect(await crypto.subtle.verify(
    'Ed25519',
    publicKey,
    base64UrlDecode(assertion.signatureB64u),
    voiceIdWalletSessionChallengeBytes(assertion.challenge),
  )).toBe(true);
  expect(await page.evaluate(requestCount)).toBe(3);

  await page.getByRole('button', { name: 'Wrong origin' }).click();
  await expect(page.evaluate(captureResult)).rejects.toThrow('different Wallet origin');
  expect(await page.evaluate(requestCount)).toBe(3);

  await page.evaluate(setWrongKey);
  await page.getByRole('button', { name: 'Activate' }).click();
  await expect(page.evaluate(captureResult)).rejects.toThrow('does not match its key ID');
  expect(await page.evaluate(requestCount)).toBe(4);

  await page.evaluate(clearListening);
  await page.getByRole('button', { name: 'Hold capture' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-listening', 'true');
  await page.evaluate(abortCapture);
  await expect(page.evaluate(captureResult)).rejects.toThrow('cancelled');
  expect(await page.evaluate(requestCount)).toBe(5);

  await page.evaluate(setApproved);
  await page.evaluate(startWalletActivation);
  expect(await page.evaluate(requestCount)).toBe(5);
  await page.getByRole('button', { name: 'Activate VoiceID' }).click();
  const walletActivation = requireRecord(await page.evaluate(captureResult), 'Wallet VoiceID activation');
  expect(walletActivation.walletId).toBe('wallet:voiceid-browser');
  expect(await page.evaluate(requestCount)).toBe(6);

  await page.evaluate(startWalletActivation);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.evaluate(captureResult)).rejects.toThrow('cancelled');
  expect(await page.evaluate(requestCount)).toBe(6);

  const reportPath = testInfo.outputPath('voiceid-device-bridge.json');
  await writeFile(reportPath, `${JSON.stringify({
    schemaVersion: 'voiceid_device_bridge_journey_v1',
    status: 'passed',
    deviceKeyId,
    cases: [
      'existing_transfer_approval_uses_shared_native_transport',
      'visible_activation_checks_device_public_key',
      'voice_unlock_returns_signed_exact_challenge',
      'changed_wallet_origin_rejected_before_native_request',
      'mismatched_device_key_rejected',
      'cancelled_capture_aborts_local_request',
      'wallet_origin_button_starts_capture_only_after_click',
      'wallet_activation_cancel_does_not_start_capture',
    ],
  }, null, 2)}\n`);
  await testInfo.attach('voiceid-device-bridge.json', {
    path: reportPath,
    contentType: 'application/json',
  });
}

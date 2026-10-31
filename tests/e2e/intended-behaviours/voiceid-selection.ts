import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page, type Request, type TestInfo } from '@playwright/test';
import { waitForWalletIframeConfirmationSettlement } from './harness';
import { startReviewedTransfer } from './voiceid-near-signing';
import type {} from '../../fixtures/ui/VoiceIdMicrophoneObservation';
import type {} from '../../intended-app/src/voiceIdHelpers';

export class VoiceDownloads {
  readonly requests: string[] = [];
  constructor(readonly entryName: string) {}
  readonly observe = (request: Request): void => {
    const url = new URL(request.url());
    if (
      url.pathname.endsWith(`/${this.entryName}`) ||
      url.pathname.startsWith('/sdk/voiceid/') ||
      url.pathname.includes('ort.wasm') ||
      url.pathname.includes('ort-wasm')
    )
      this.requests.push(url.pathname);
  };
}

export async function voiceEntryName(): Promise<string> {
  await access(path.resolve(import.meta.dirname, '../../../packages/voiceid/dist/public/sdk/voiceid/host.js'));
  return 'voiceid/host.js';
}

export async function signTransfer(page: Page): Promise<void> {
  await startReviewedTransfer(page);
  await page.frameLocator('iframe.seams-wallet-overlay-iframe').locator('button.confirm').click();
  await expect(page.getByTestId('reviewed-near-result')).toHaveAttribute(
    'data-state',
    'submitted',
    { timeout: 60_000 },
  );
  await waitForWalletIframeConfirmationSettlement(page);
}

export async function beginDirectVoiceUnlock(page: Page): Promise<void> {
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  const button = wallet.getByRole('button', { name: 'Unlock with VoiceID', exact: true });
  await expect(button).toBeEnabled({ timeout: 45_000 });
  await expect(wallet.locator('.seams-voiceid-prompt')).not.toHaveAttribute(
    'data-capture',
    'listening',
  );
  await button.click();
}

export function microphoneCount(): number {
  return window.voiceIdMicrophoneStates().length;
}
export function session() {
  if (!window.__seamsIntendedVoiceId) throw new Error('VoiceID helper is unavailable');
  return window.__seamsIntendedVoiceId.session();
}
export async function saveEvidence(
  testInfo: TestInfo,
  name: string,
  value: unknown,
): Promise<void> {
  const file = testInfo.outputPath(name);
  await writeFile(file, JSON.stringify(value, null, 2));
  await testInfo.attach(name, { path: file, contentType: 'application/json' });
}

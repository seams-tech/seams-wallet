import { readFile, readdir, writeFile } from 'node:fs/promises';
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
  const directory = path.resolve(import.meta.dirname, '../../../packages/wallet/dist/esm/sdk');
  const matches: string[] = [];
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.js')) continue;
    const source = await readFile(path.join(directory, name), 'utf8');
    // Discover the emitted module by its public export, independently of its content hash.
    if (/export\s*\{[^}]*\bvoiceIdHostPlugin\b/.test(source)) matches.push(name);
  }
  if (matches.length !== 1) throw new Error('Expected one emitted VoiceID host module');
  return matches[0];
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

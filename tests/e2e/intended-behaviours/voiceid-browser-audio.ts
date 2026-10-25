import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { expect, type BrowserContext, type Page, type Route } from '@playwright/test';

export const voiceIdBrowserAudio = {
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${path.resolve(import.meta.dirname, '../../fixtures/audio/voiceid-owner.wav')}`,
    ],
  },
};

export async function allowBrowserMicrophone(context: BrowserContext): Promise<void> {
  const probe = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve(import.meta.dirname, '../../scripts/build-preact-probe.mjs'),
        'VoiceIdMicrophoneObservation.ts',
      ],
      { encoding: 'utf8' },
    ),
  );
  await context.addInitScript({ content: probe[0].code });
  await context.route(/\/voiceid-test-audio\/(?:natural\/)?\d+\.wav$/, servePhraseAudio);
  await context.grantPermissions(['microphone'], {
    origin: process.env.SEAMS_INTENDED_WALLET_ORIGIN || 'http://localhost:4202',
  });
}

export async function enrollBrowserMicrophone(page: Page): Promise<void> {
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  for (let sample = 1; sample <= 3; sample += 1) {
    const button = wallet.getByRole('button', { name: `Record sample ${sample}`, exact: true });
    await expect(button).toBeEnabled({ timeout: 60_000 });
    await button.click();
    if (sample === 3) {
      await expect(
        wallet.getByRole('button', { name: 'Cancel enrollment', exact: true }),
      ).toHaveCount(0, { timeout: 30_000 });
    }
  }
}

async function servePhraseAudio(route: Route): Promise<void> {
  const match = new URL(route.request().url()).pathname.match(
    /\/voiceid-test-audio\/(natural\/)?(\d+)\.wav$/,
  );
  const index = match?.[2];
  const directory = match?.[1] ?? '';
  if (index === undefined || Number(index) >= 16) throw new Error('Unknown phrase fixture');
  const bytes = await readFile(
    path.resolve(import.meta.dirname, `../../fixtures/audio/aurora/${directory}${index}.wav`),
  );
  await route.fulfill({ contentType: 'audio/wav', body: bytes });
}

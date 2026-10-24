import path from 'node:path';
import { expect, type BrowserContext, type Page } from '@playwright/test';

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
  }
}

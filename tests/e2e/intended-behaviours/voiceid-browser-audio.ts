import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import type {} from '../../intended-app/src/voiceIdHelpers';
import phrases from '../../fixtures/audio/aurora/phrases.json' with { type: 'json' };

type VoiceIdActivation = Awaited<
  ReturnType<NonNullable<Window['__seamsIntendedVoiceId']>['activate']>
>;

export const voiceIdBrowserAudio = {
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${path.resolve(import.meta.dirname, '../../fixtures/audio/voiceid-owner.wav')}`,
    ],
  },
};

export async function allowBrowserMicrophone(
  context: BrowserContext,
  passkeyAlgorithm: 'es256' | 'rs256' = 'es256',
): Promise<void> {
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
  const configurePasskey =
    passkeyAlgorithm === 'rs256' ? '\nwindow.voiceIdRequireRsaPasskey();' : '';
  await context.addInitScript({ content: probe[0].code + configurePasskey });
  await context.route(/\/voiceid-test-audio\/(?:natural\/)?\d+\.wav$/, servePhraseAudio);
  await context.grantPermissions(['microphone'], {
    origin: process.env.SEAMS_INTENDED_WALLET_ORIGIN || 'http://localhost:4202',
  });
}

export async function enrollBrowserMicrophone(page: Page): Promise<number> {
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  const maximumCaptures = 9;
  for (let captures = 1; captures <= maximumCaptures; captures++) {
    const button = wallet.getByRole('button', {
      name: /^(Record|Retry) sample [1-3]$/,
    });
    await expect(button).toBeEnabled({ timeout: 60_000 });
    await button.click();
    await expect.poll(enrollmentProgress.bind(null, page), { timeout: 30_000 }).not.toBe('capturing');
    if (await enrollmentProgress(page) === 'complete') return captures;
  }
  throw new Error(
    `VoiceID enrollment did not accept three samples within ${maximumCaptures} recordings`,
  );
}

type EnrollmentProgress = 'capturing' | 'ready' | 'complete';

async function enrollmentProgress(page: Page): Promise<EnrollmentProgress> {
  const owner = await page.$('dialog[open] iframe.seams-wallet-overlay-iframe');
  if (!owner) return 'complete';
  const frame = await owner.contentFrame();
  if (!frame) return 'capturing';
  return await frame.evaluate(readEnrollmentProgress);
}

function readEnrollmentProgress(): EnrollmentProgress {
  if (!document.querySelector('button[aria-label="Cancel enrollment"]')) return 'complete';
  const record = document.querySelector<HTMLButtonElement>('.seams-voiceid-primary');
  return record && !record.disabled ? 'ready' : 'capturing';
}

/** A completed enrollment must report an activated method, not a closed surface. */
export function requireActivatedVoiceId(
  activation: VoiceIdActivation,
): Extract<VoiceIdActivation, { kind: 'activated' }> {
  if (activation.kind !== 'activated') throw new Error('VoiceID activation was cancelled.');
  return activation;
}

async function servePhraseAudio(route: Route): Promise<void> {
  const match = new URL(route.request().url()).pathname.match(
    /\/voiceid-test-audio\/(natural\/)?(\d+)\.wav$/,
  );
  const index = match?.[2];
  const directory = match?.[1] ?? '';
  if (index === undefined || Number(index) >= phrases.length)
    throw new Error('Unknown phrase fixture');
  const bytes = await readFile(
    path.resolve(import.meta.dirname, `../../fixtures/audio/aurora/${directory}${index}.wav`),
  );
  await route.fulfill({ contentType: 'audio/wav', body: bytes });
}

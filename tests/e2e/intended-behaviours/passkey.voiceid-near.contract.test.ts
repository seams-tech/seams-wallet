import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';
import {
  verifyVoiceIdNearSigning,
  verifyVoiceIdNearBroadcastFailure,
  type VoiceCommand,
} from './voiceid-near-signing';
import type { Page, TestInfo, BrowserContext } from '@playwright/test';
import type {} from '../../fixtures/ui/VoiceIdBridgeProbe';

test('VoiceID requires fresh approval after a real NEAR MPC broadcast failure', verifyTransfer);
test.use({ video: 'off', trace: 'off' });
test.setTimeout(120_000);

async function verifyTransfer(
  {
    harness,
    page,
    context,
  }: { harness: IntendedBehaviourHarness; page: Page; context: BrowserContext },
  testInfo: TestInfo,
): Promise<void> {
  const output = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve(import.meta.dirname, '../../scripts/build-preact-probe.mjs'),
        'VoiceIdBridgeProbe.ts',
      ],
      { encoding: 'utf8' },
    ),
  );
  await context.addInitScript({ content: output[0].code });
  const voice = { select: selectVoice.bind(null, page) };
  const report = await verifyVoiceIdNearSigning({
    context,
    page,
    harness,
    voice,
    walletOrigin: process.env.SEAMS_INTENDED_WALLET_ORIGIN || 'http://localhost:4202',
    gatewayOrigin: process.env.SEAMS_INTENDED_ROUTER_URL || 'http://127.0.0.1:4100',
  });
  const broadcastFailure = await verifyVoiceIdNearBroadcastFailure({
    context,
    page,
    harness,
    voice,
    gatewayOrigin: process.env.SEAMS_INTENDED_ROUTER_URL || 'http://127.0.0.1:4100',
    identity: report.owner,
  });
  const reportPath = testInfo.outputPath('voiceid-near-mpc.json');
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({ ...report, broadcastFailure }, null, 2)}\n`);
  await testInfo.attach('voiceid-near-mpc.json', {
    path: reportPath,
    contentType: 'application/json',
  });
}

async function selectVoice(page: Page, command: VoiceCommand): Promise<void> {
  const outcome = voiceOutcome(command);
  for (const frame of page.frames()) await frame.evaluate(setVoiceOutcome, outcome);
}
function setVoiceOutcome(outcome: 'approved' | 'cancelled' | 'rejected'): void {
  window.voiceBridgeProbe.setMode(outcome);
}
function voiceOutcome(command: VoiceCommand): 'approved' | 'cancelled' | 'rejected' {
  switch (command) {
    case 'approve':
      return 'approved';
    case 'cancel':
      return 'cancelled';
    case 'other_speaker':
    case 'extra_words':
      return 'rejected';
  }
}

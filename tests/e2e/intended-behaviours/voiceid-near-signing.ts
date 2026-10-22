import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, type BrowserContext, type Page, type Request, type Route } from '@playwright/test';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import {
  IntendedBehaviourHarness,
  verifyNearEd25519Signature,
  waitForWalletIframeConfirmationSettlement,
} from './harness';
import type {} from '../../fixtures/ui/VoiceIdBridgeObservation';

export type VoiceCommand = 'approve' | 'cancel' | 'other_speaker' | 'extra_words';
export type VoiceTransferDriver = { select(command: VoiceCommand): Promise<void> };

type NearIdentity = { walletId: string; accountId: string; publicKey: string };
type CapturedTransfer = {
  signedTransactionSha256: string;
  signerId: string;
  receiverId: string;
  amountYocto: string;
  nonce: string;
};

class VoiceIdNearSigningEvidence {
  readonly transfers: CapturedTransfer[] = [];
  private finalizations = 0;

  constructor(
    private readonly gatewayOrigin: string,
    readonly identity: NearIdentity,
  ) {}

  async observe(context: BrowserContext): Promise<void> {
    context.on('request', this.request);
    await context.route('**/*', this.rpc);
  }

  private readonly request = (request: Request): void => {
    const url = new URL(request.url());
    if (
      url.origin === this.gatewayOrigin &&
      url.pathname === '/router-ab/ed25519/sign' &&
      request.method() === 'POST'
    ) {
      this.finalizations += 1;
    }
  };

  private readonly rpc = async (route: Route): Promise<void> => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'POST' || url.origin !== 'https://rpc.testnet.fastnear.com') {
      await route.fallback();
      return;
    }
    const message = requireRecord(JSON.parse(request.postData() || '{}'), 'NEAR RPC request');
    if (message.method !== 'send_tx') {
      await route.fallback();
      return;
    }
    const params = requireRecord(message.params, 'send_tx params');
    const base64 = requireCanonicalString(params.signed_tx_base64, 'signed transaction');
    this.transfers.push(await verifyVoiceIdNearTransfer(this.identity, base64));
    await route.fallback();
  };

  snapshot(): { finalizations: number; transfers: number } {
    return { finalizations: this.finalizations, transfers: this.transfers.length };
  }
}

export async function verifyVoiceIdNearTransfer(
  identity: NearIdentity,
  base64: string,
): Promise<CapturedTransfer> {
  const bytes = Buffer.from(base64, 'base64');
  const result = capturedSigningResult(identity, base64, bytes.length);
  await verifyNearEd25519Signature({
    registration: { operationalPublicKey: identity.publicKey },
    result,
  });
  const transfer = parseSingleTransfer(bytes);
  expect(transfer.signerId).toBe(identity.accountId);
  expect(transfer.receiverId).toBe(identity.accountId);
  expect(transfer.amountYocto).toBe('1');
  return transfer;
}

function capturedSigningResult(identity: NearIdentity, base64: string, length: number) {
  return {
    kind: 'near_sign_success' as const,
    walletId: identity.walletId,
    nearAccountId: identity.accountId,
    signedTransactionB64: base64,
    signedTransactionByteLength: length,
  };
}

async function readNearIdentity(page: Page): Promise<NearIdentity> {
  const snapshot = requireRecord(
    JSON.parse(await page.getByTestId('intended-result-json').innerText()),
    'registration snapshot',
  );
  const action = requireRecord(snapshot.action, 'registration action');
  const result = requireRecord(action.result, 'registration result');
  return {
    walletId: requireCanonicalString(result.walletId, 'walletId'),
    accountId: requireCanonicalString(result.nearAccountId, 'nearAccountId'),
    publicKey: requireCanonicalString(result.operationalPublicKey, 'operationalPublicKey'),
  };
}

function parseSingleTransfer(bytes: Buffer): CapturedTransfer {
  let offset = 0;
  const signerLength = bytes.readUInt32LE(offset);
  offset += 4;
  const signerId = bytes.subarray(offset, offset + signerLength).toString('utf8');
  offset += signerLength;
  expect(bytes.readUInt8(offset)).toBe(0);
  offset += 1 + 32; // Ed25519 key tag and public key.
  const nonce = bytes.readBigUInt64LE(offset).toString();
  offset += 8;
  const receiverLength = bytes.readUInt32LE(offset);
  offset += 4;
  const receiverId = bytes.subarray(offset, offset + receiverLength).toString('utf8');
  offset += receiverLength + 32; // Receiver and recent block hash.
  expect(bytes.readUInt32LE(offset)).toBe(1);
  offset += 4;
  expect(bytes.readUInt8(offset)).toBe(3); // NEAR Transfer action.
  offset += 1;
  const deposit = bytes.readBigUInt64LE(offset) | (bytes.readBigUInt64LE(offset + 8) << 64n);
  offset += 16;
  expect(bytes.length - offset).toBe(1 + 64); // Ed25519 signature tag and bytes.
  return {
    signedTransactionSha256: createHash('sha256').update(bytes).digest('hex'),
    signerId,
    receiverId,
    amountYocto: deposit.toString(),
    nonce,
  };
}

export async function verifyVoiceIdNearSigning(args: {
  context: BrowserContext;
  page: Page;
  harness: IntendedBehaviourHarness;
  voice: VoiceTransferDriver;
  walletOrigin: string;
  gatewayOrigin: string;
}) {
  const { context, page, harness, voice } = args;
  const bundles = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve(import.meta.dirname, '../../scripts/build-preact-probe.mjs'),
        'VoiceIdBridgeObservation.ts',
      ],
      { encoding: 'utf8' },
    ),
  );
  await context.addInitScript({ content: bundles[0].code });
  await harness.registerPasskeyEd25519YaoWallet();
  await harness.assertRegistrationOwnerSessionIsActive();
  await installVoiceObservation(page);
  const evidence = new VoiceIdNearSigningEvidence(args.gatewayOrigin, await readNearIdentity(page));
  await evidence.observe(context);
  const settings = await context.newPage();
  await settings.goto(`${args.walletOrigin}/sdk/voiceid.html`);
  await settings.getByRole('button', { name: 'Enable VoiceID', exact: true }).click();
  await expect(settings.getByRole('status')).toHaveText(
    'VoiceID is required on this wallet origin.',
  );
  await settings.close();

  const outcomes: string[] = [];
  for (const command of ['cancel', 'other_speaker', 'extra_words'] as const) {
    await voice.select(command);
    await startReviewedTransfer(page);
    await page.frameLocator('iframe.seams-wallet-overlay-iframe').locator('button.confirm').click();
    await expect(page.getByTestId('reviewed-near-result')).toHaveAttribute('data-state', 'failed');
    const denial = requireRecord(
      JSON.parse(await page.getByTestId('reviewed-near-result').innerText()),
      'denied transfer',
    );
    expect(denial.message).toBe('Request cancelled.');
    outcomes.push(command === 'cancel' ? 'cancelled' : 'rejected');
    expect(await readVoiceOutcomes(page)).toEqual(outcomes);
    expect(evidence.snapshot()).toEqual({ finalizations: 0, transfers: 0 });
    await waitForWalletIframeConfirmationSettlement(page);
  }

  const exhausted = await harness.readCurrentWalletSessionStatus();
  expect(exhausted.status).toBe('exhausted');
  expect(exhausted.remainingUses).toBe(0);
  await harness.unlockPasskeyWallet();
  await installVoiceObservation(page);
  await voice.select('approve');
  await startReviewedTransfer(page);
  const wallet = page.frameLocator('iframe.seams-wallet-overlay-iframe');
  await expect(wallet.getByText('Select Confirm, then say', { exact: false })).toBeVisible();
  expect(evidence.snapshot()).toEqual({ finalizations: 0, transfers: 0 });
  await wallet.locator('button.confirm').click();
  await expect(page.getByTestId('reviewed-near-result')).not.toHaveAttribute(
    'data-state',
    'pending',
    { timeout: 60_000 },
  );
  await expect(page.getByTestId('reviewed-near-result')).toHaveAttribute('data-state', 'submitted');
  expect(await readVoiceOutcomes(page)).toEqual(['approved']);
  expect(evidence.transfers).toHaveLength(1);
  expect(evidence.snapshot().finalizations).toBeGreaterThan(0);
  await harness.assertRegistrationOwnerSessionIsActive();
  const active = await harness.readCurrentWalletSessionStatus();
  expect(active.status).toBe('active');
  expect(active.remainingUses).toBe(2);
  return {
    status: 'passed',
    chain: 'deterministic_near_rpc',
    onChainConfirmed: false,
    ownerAuthority: 'registered_wallet_with_owner_passkey_unlock_after_quota_exhaustion',
    signing: 'real_ed25519_yao_mpc',
    signatureVerification: 'registered_wallet_public_key',
    preparationQuota: {
      afterDenials: exhausted.remainingUses,
      afterOwnerUnlockAndSigning: active.remainingUses,
    },
    cancellationPreventedFinalization: true,
    differentSpeakerPreventedFinalization: true,
    extraWordsPreventedFinalization: true,
    observedVoiceOutcomes: [...outcomes, 'approved'],
    owner: evidence.identity,
    transfers: evidence.transfers,
  };
}

async function installVoiceObservation(page: Page): Promise<void> {
  for (const frame of page.frames()) await frame.evaluate(activateVoiceObservation);
}
function activateVoiceObservation(): void {
  window.voiceBridgeObservation.install();
}
async function readVoiceOutcomes(page: Page): Promise<readonly string[]> {
  return await page
    .frameLocator('iframe.seams-wallet-overlay-iframe')
    .locator('body')
    .evaluate(voiceOutcomes);
}
function voiceOutcomes(): readonly string[] {
  return window.voiceBridgeObservation.outcomes();
}

export async function startReviewedTransfer(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Review NEAR testnet transfer', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Review NEAR testnet transfer', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Continue to wallet', exact: true }).click();
  await expect(
    page.frameLocator('iframe.seams-wallet-overlay-iframe').locator('button.confirm'),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.frameLocator('iframe.seams-wallet-overlay-iframe').locator('.seams-confirmation-surface'),
  ).not.toHaveAttribute('inert', '');
}

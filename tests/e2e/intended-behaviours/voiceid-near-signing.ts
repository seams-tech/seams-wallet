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
  signedTransactionB64: string;
  signedTransactionSha256: string;
  signerId: string;
  receiverId: string;
  amountYocto: string;
  nonce: string;
};

export class VoiceIdNearSigningEvidence {
  readonly transfers: CapturedTransfer[] = [];
  private finalizations = 0;

  constructor(
    private readonly gatewayOrigin: string,
    readonly identity: NearIdentity,
    private readonly broadcastReply: 'available' | 'unavailable',
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
    if (this.broadcastReply === 'unavailable') {
      await route.fulfill({ status: 503, body: 'The broadcast reply is unavailable.' });
      return;
    }
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

export async function readNearIdentity(page: Page): Promise<NearIdentity> {
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
    signedTransactionB64: bytes.toString('base64'),
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
  harness.enableVoiceIdPlugin();
  await harness.registerPasskeyEd25519YaoWallet();
  await harness.assertRegistrationOwnerSessionIsActive();
  await installVoiceObservation(page);
  const evidence = new VoiceIdNearSigningEvidence(
    args.gatewayOrigin,
    await readNearIdentity(page),
    'available',
  );
  await evidence.observe(context);
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

export async function verifyVoiceIdNearBroadcastFailure(args: {
  context: BrowserContext;
  page: Page;
  harness: IntendedBehaviourHarness;
  voice: VoiceTransferDriver;
  gatewayOrigin: string;
  identity: NearIdentity;
}) {
  const { page, harness, voice } = args;
  await waitForWalletIframeConfirmationSettlement(page);
  const evidence = new VoiceIdNearSigningEvidence(args.gatewayOrigin, args.identity, 'unavailable');
  await evidence.observe(args.context);
  await voice.select('approve');
  await startReviewedTransfer(page);
  expect(evidence.snapshot()).toEqual({ finalizations: 0, transfers: 0 });
  await page.frameLocator('iframe.seams-wallet-overlay-iframe').locator('button.confirm').click();
  await expect(page.getByTestId('reviewed-near-result')).toHaveAttribute('data-state', 'failed', {
    timeout: 60_000,
  });
  const failure = requireRecord(
    JSON.parse(await page.getByTestId('reviewed-near-result').innerText()),
    'broadcast failure',
  );
  const failureMessage = requireCanonicalString(failure.message, 'broadcast failure message');
  expect(failureMessage).toContain('RPC request failed.');
  const receiptError = page
    .frameLocator('iframe.seams-wallet-overlay-iframe')
    .getByText('RPC request failed: 503 Service Unavailable', { exact: true });
  await expect(receiptError).toBeVisible();
  const walletReceiptMessage = await receiptError.innerText();
  expect(await readVoiceOutcomes(page)).toEqual(['approved', 'approved']);
  const failedSubmission = evidence.snapshot();
  expect(failedSubmission.finalizations).toBe(1);
  expect(failedSubmission.transfers).toBeGreaterThan(1);
  const signedTransactionHashes = new Set(evidence.transfers.map(signedTransactionHash));
  expect(signedTransactionHashes.size).toBe(1);
  const afterFailure = await harness.readCurrentWalletSessionStatus();
  expect(afterFailure.status).toBe('active');
  expect(afterFailure.remainingUses).toBe(1);
  await waitForWalletIframeConfirmationSettlement(page);

  await voice.select('cancel');
  await startReviewedTransfer(page);
  expect(evidence.snapshot()).toEqual(failedSubmission);
  await page.frameLocator('iframe.seams-wallet-overlay-iframe').locator('button.confirm').click();
  await expect(page.getByTestId('reviewed-near-result')).toHaveAttribute('data-state', 'failed');
  const cancellation = requireRecord(
    JSON.parse(await page.getByTestId('reviewed-near-result').innerText()),
    'fresh review cancellation',
  );
  expect(cancellation.message).toBe('Request cancelled.');
  expect(await readVoiceOutcomes(page)).toEqual(['approved', 'approved', 'cancelled']);
  expect(evidence.snapshot()).toEqual(failedSubmission);
  const afterCancellation = await harness.readCurrentWalletSessionStatus();
  expect(afterCancellation.status).toBe('exhausted');
  expect(afterCancellation.remainingUses).toBe(0);
  return {
    status: 'passed',
    fault: 'http_503_after_receiving_each_signed_transaction',
    onChainOutcome: 'unknown',
    signingFinalizations: failedSubmission.finalizations,
    broadcastAttempts: failedSubmission.transfers,
    distinctSignedTransactions: signedTransactionHashes.size,
    signedTransactionSha256: evidence.transfers[0].signedTransactionSha256,
    applicationState: { kind: 'failed', message: failureMessage },
    walletReceiptMessage,
    quotaAfterBroadcastFailure: afterFailure.remainingUses,
    quotaAfterFreshReviewCancellation: afterCancellation.remainingUses,
    freshVoiceCancellationPreventedAnotherSignature: true,
  };
}

function signedTransactionHash(transfer: CapturedTransfer): string {
  return transfer.signedTransactionSha256;
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

import { createHash } from 'node:crypto';
import { expect, type BrowserContext, type Page, type Request, type Route } from '@playwright/test';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import { verifyNearEd25519Signature } from './harness';

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

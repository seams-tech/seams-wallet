import { expect, test } from '@playwright/test';
import { EMAIL_OTP_CHANNEL } from '@shared/utils/emailOtpDomain';
import type { EmailOtpGrantRecord } from '../../packages/mpc-wallet-server/src/core/EmailOtpStores';
import { parseCurrentEmailOtpGrantRow } from '../../packages/mpc-wallet-server/src/core/EmailOtpRecords';
import { emailOtpGrantRecord } from '../../packages/mpc-wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpRecords';
import { CloudflareD1EmailOtpRecoveryService } from '../../packages/mpc-wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpRecoveryService';
import { handleWalletEmailOtpFactorRelease } from '../../packages/mpc-wallet-server/src/router/transport/fetch/routes/sessions';
import type { FetchRouterApiContext } from '../../packages/mpc-wallet-server/src/router/transport/fetch/fetchRouter.types';

const scope = { walletId: 'wallet-a', userId: 'provider-a', orgId: 'org-a' };

function grantFor(operation: EmailOtpGrantRecord['operation']): EmailOtpGrantRecord {
  const issuedAtMs = Date.now();
  return emailOtpGrantRecord({
    grantToken: `grant-${operation}`,
    ...scope,
    challengeId: `challenge-${operation}`,
    ownerProofBindingDigest: 'binding-a',
    operation,
    issuedAtMs,
    expiresAtMs: issuedAtMs + 60_000,
  });
}

/** A recovery service over in-memory grants; it records the grants that a consume deleted. */
function recoveryService(grants: readonly EmailOtpGrantRecord[]) {
  const live = new Map(grants.map((grant) => [grant.grantToken, grant]));
  const grantStore = {
    read: async (token: string) => live.get(token) ?? null,
    prepareConsumeMatching: (record: EmailOtpGrantRecord) => ({ consume: record.grantToken }),
  };
  const rateLimits = {
    consume: async () => ({ ok: true }),
    consumeVerifiedGrant: async (input: { grantDelete: { consume: string } }) => {
      live.delete(input.grantDelete.consume);
    },
    readExceededGrantRateLimit: async () => null,
  };
  const service = new CloudflareD1EmailOtpRecoveryService({
    emailOtpGrants: grantStore,
    emailOtpRateLimits: rateLimits,
  } as unknown as ConstructorParameters<typeof CloudflareD1EmailOtpRecoveryService>[0]);
  return { service, live };
}

function consumeInput(grant: EmailOtpGrantRecord, operation: string) {
  return {
    subject: {
      kind: 'provider_identity',
      orgId: scope.orgId,
      providerSubject: scope.userId,
      walletId: scope.walletId,
    },
    loginGrant: grant.grantToken,
    otpChannel: EMAIL_OTP_CHANNEL,
    operation,
  } as unknown as Parameters<CloudflareD1EmailOtpRecoveryService['consumeEmailOtpGrant']>[0];
}

test('a grant keeps the operation of its code', () => {
  const grant = grantFor('export_key');
  const row = { recordJson: JSON.stringify(grant), expiresAtMs: grant.expiresAtMs };
  expect(parseCurrentEmailOtpGrantRow(row)?.operation).toBe('export_key');

  const { operation: _operation, ...withoutOperation } = grant;
  for (const record of [withoutOperation, { ...grant, operation: 'registration' }]) {
    expect(
      parseCurrentEmailOtpGrantRow({
        recordJson: JSON.stringify(record),
        expiresAtMs: grant.expiresAtMs,
      }),
    ).toBeNull();
  }
});

test('an unlock grant cannot release for export, and the reverse', async () => {
  const unlock = grantFor('wallet_unlock');
  const exportKey = grantFor('export_key');
  const { service, live } = recoveryService([unlock, exportKey]);

  for (const [grant, operation] of [
    [unlock, 'export_key'],
    [exportKey, 'wallet_unlock'],
    [unlock, 'transaction_sign'],
  ] as const) {
    const refused = await service.consumeEmailOtpGrant(consumeInput(grant, operation));
    expect(refused).toMatchObject({ ok: false, code: 'grant_invalid_or_expired' });
  }
  // A refused grant stays, so its own operation can still use it.
  expect(live.size).toBe(2);

  await expect(
    service.consumeEmailOtpGrant(consumeInput(unlock, 'wallet_unlock')),
  ).resolves.toMatchObject({ ok: true, challengeId: unlock.challengeId });
  await expect(
    service.consumeEmailOtpGrant(consumeInput(exportKey, 'export_key')),
  ).resolves.toMatchObject({ ok: true, challengeId: exportKey.challengeId });
  expect(live.size).toBe(0);
});

test('a consume that names no operation is refused', async () => {
  const unlock = grantFor('wallet_unlock');
  const { service, live } = recoveryService([unlock]);
  const input = consumeInput(unlock, 'wallet_unlock') as unknown as Record<string, unknown>;
  delete input.operation;

  const refused = await service.consumeEmailOtpGrant(
    input as unknown as Parameters<CloudflareD1EmailOtpRecoveryService['consumeEmailOtpGrant']>[0],
  );
  expect(refused).toMatchObject({ ok: false, code: 'invalid_body' });
  expect(live.size).toBe(1);
});

async function postRelease(body: Record<string, unknown>): Promise<Response | null> {
  const ctx = {
    method: 'POST',
    pathname: '/wallet/email-otp/factor-release',
    request: new Request('https://gateway.test/wallet/email-otp/factor-release', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wallet-session' },
    }),
  } as unknown as FetchRouterApiContext;
  return await handleWalletEmailOtpFactorRelease(ctx);
}

test('the release refuses a Wallet Session bearer and a grant with no operation', async () => {
  const deviceFactors = [{ factorNonceB64u: 'nonce', blindedElementB64u: 'blinded' }];
  for (const body of [
    { kind: 'wallet_session', walletId: scope.walletId, deviceFactors },
    { kind: 'verified_grant', walletId: scope.walletId, loginGrant: 'grant', deviceFactors },
    {
      kind: 'verified_grant',
      walletId: scope.walletId,
      loginGrant: 'grant',
      operation: 'registration',
      deviceFactors,
    },
  ]) {
    const response = await postRelease(body);
    expect(response?.status).toBe(400);
    expect(await response?.json()).toMatchObject({ ok: false, code: 'invalid_body' });
  }
});

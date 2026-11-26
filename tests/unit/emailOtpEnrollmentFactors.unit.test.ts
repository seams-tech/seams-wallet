import { expect, test } from '@playwright/test';
import { prepareD1TenantStatement } from '../../packages/mpc-wallet-server/src/core/d1TenantStore';
import { emailOtpWalletEnrollmentRows } from '../../packages/mpc-wallet-server/src/core/emailOtpD1Statements';
import type {
  EmailOtpEnrollmentFactorRecord,
  EmailOtpWalletEnrollmentRecord,
} from '../../packages/mpc-wallet-server/src/core/EmailOtpStores';
import { CloudflareD1EmailOtpEnrollmentStore } from '../../packages/mpc-wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpEnrollmentStore';
import { parseEmailOtpWalletEnrollmentRow } from '../../packages/mpc-wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpRecords';
import { selectEmailOtpDeviceFactor } from '../../packages/mpc-wallet-server/src/router/domains/emailOtp/emailOtpRouteHandlers';
import type { D1DatabaseLike } from '../../packages/mpc-wallet-server/src/storage/tenantRoute';
import { openSignerD1 } from '../fixtures/signer-d1.mjs';
import { buildEmailOtpEnrollmentFixture } from './helpers/emailOtpAuthMethod.fixtures';

const SCOPE = {
  namespace: 'email-otp-factors',
  orgId: 'org-factors',
  projectId: 'project-factors',
  envId: 'env-factors',
};
const WALLET_ID = 'wallet-factors';

function factor(index: number): EmailOtpEnrollmentFactorRecord {
  return {
    walletAuthMethodId: `wallet-auth-method:email-${index}`,
    factorNonceB64u: Buffer.alloc(32, index).toString('base64url'),
    wrappedFactorB64u: Buffer.alloc(60, index).toString('base64url'),
    clientUnlockPublicKeyB64u: Buffer.alloc(33, index).toString('base64url'),
    createdAtMs: 100 + index,
  };
}

function enrollment(factors: readonly EmailOtpEnrollmentFactorRecord[]) {
  return {
    ...buildEmailOtpEnrollmentFixture({
      walletId: WALLET_ID,
      orgId: SCOPE.orgId,
      providerUserId: 'owner@example.test',
      email: 'owner@example.test',
      nowMs: 100,
    }),
    factors,
  } satisfies EmailOtpWalletEnrollmentRecord;
}

function parseRecord(record: unknown) {
  return parseEmailOtpWalletEnrollmentRow({
    record_json: JSON.stringify(record),
    updated_at_ms: 100,
  });
}

function enrollmentStore(database: D1DatabaseLike) {
  return new CloudflareD1EmailOtpEnrollmentStore({
    prepare: (sql, values) => prepareD1TenantStatement(database, SCOPE, sql, values),
  });
}

test('the enrollment keeps one factor for each Email OTP method', () => {
  expect(parseRecord(enrollment([factor(1), factor(2)]))?.factors).toEqual([factor(1), factor(2)]);
  expect(parseRecord(enrollment([]))).toBeNull();
  expect(
    parseRecord(enrollment(Array.from({ length: 9 }, (_, index) => factor(index + 1)))),
  ).toBeNull();
  expect(
    parseRecord(
      enrollment([factor(1), { ...factor(2), factorNonceB64u: factor(1).factorNonceB64u }]),
    ),
  ).toBeNull();
  expect(
    parseRecord(
      enrollment([factor(1), { ...factor(2), walletAuthMethodId: factor(1).walletAuthMethodId }]),
    ),
  ).toBeNull();
  // A row from 0.75.0 kept one factor beside the identity. It no longer parses, so that wallet
  // is reset.
  const { factors: _factors, ...identity } = enrollment([factor(1)]);
  const { walletAuthMethodId: _method, createdAtMs: _created, ...singleFactor } = factor(1);
  expect(parseRecord({ ...identity, ...singleFactor })).toBeNull();
});

test('the release picks the stored factor that this device holds', () => {
  const stored = { factors: [factor(1), factor(2)] };
  const selected = selectEmailOtpDeviceFactor({
    enrollment: stored,
    deviceFactors: [
      { factorNonceB64u: factor(7).factorNonceB64u, blindedElementB64u: 'unknown' },
      { factorNonceB64u: factor(2).factorNonceB64u, blindedElementB64u: 'device-2' },
    ],
  });
  expect(selected).toEqual({ ok: true, factor: factor(2), blindedElementB64u: 'device-2' });
  expect(
    selectEmailOtpDeviceFactor({
      enrollment: stored,
      deviceFactors: [{ factorNonceB64u: factor(7).factorNonceB64u, blindedElementB64u: 'x' }],
    }),
  ).toMatchObject({ ok: false, code: 'email_otp_device_factor_missing' });
});

test('a revoke removes only the revoked method factor', async () => {
  const runtime = await openSignerD1();
  try {
    const store = enrollmentStore(runtime.database);
    await store.putEnrollment(enrollment([factor(1), factor(2)]));
    await emailOtpWalletEnrollmentRows
      .removeMethodFactor(
        (sql, values) => prepareD1TenantStatement(runtime.database, SCOPE, sql, values),
        { walletId: WALLET_ID, walletAuthMethodId: factor(1).walletAuthMethodId, nowMs: 500 },
      )
      .run();
    const after = await store.readEnrollment(WALLET_ID);
    expect(after?.factors).toEqual([factor(2)]);
    expect(after?.updatedAtMs).toBe(500);
  } finally {
    await runtime.close();
  }
});

test('the enrollment goes with its last unrevoked Email OTP method', async () => {
  const runtime = await openSignerD1();
  try {
    const store = enrollmentStore(runtime.database);
    await store.putEnrollment(enrollment([factor(1), factor(2)]));
    // No Email OTP method row is active, as after the revoke of the wallet's last one.
    await runtime.database.batch([
      ...store.prepareRevokedMethodStatements({
        walletId: WALLET_ID,
        walletAuthMethodId: factor(1).walletAuthMethodId,
        revokedAtMs: 500,
      }),
    ]);
    expect(await store.readEnrollment(WALLET_ID)).toBeNull();
  } finally {
    await runtime.close();
  }
});

function addFactorBatch(
  database: D1DatabaseLike,
  input: {
    readonly expected: EmailOtpWalletEnrollmentRecord;
    readonly factor: EmailOtpEnrollmentFactorRecord;
  },
) {
  return database.batch([
    ...enrollmentStore(database).prepareAddMethodFactorStatements({ ...input, nowMs: 500 }),
  ]);
}

test('a recovered or linked device adds its own factor beside the others', async () => {
  const runtime = await openSignerD1();
  try {
    const store = enrollmentStore(runtime.database);
    const stored = enrollment([factor(1)]);
    await store.putEnrollment(stored);
    await addFactorBatch(runtime.database, { expected: stored, factor: factor(2) });
    const after = await store.readEnrollment(WALLET_ID);
    expect(after?.factors).toEqual([factor(1), factor(2)]);
    expect(after?.updatedAtMs).toBe(500);
  } finally {
    await runtime.close();
  }
});

test('an added factor fails its batch when the enrollment is not the one read', async () => {
  const runtime = await openSignerD1();
  try {
    const store = enrollmentStore(runtime.database);
    const stored = enrollment([factor(1)]);
    await store.putEnrollment(stored);
    const refusals = [
      {
        expected: stored,
        factor: { ...factor(2), walletAuthMethodId: factor(1).walletAuthMethodId },
      },
      { expected: stored, factor: { ...factor(2), factorNonceB64u: factor(1).factorNonceB64u } },
      { expected: { ...stored, enrollmentSealKeyVersion: 'another-key' }, factor: factor(2) },
      { expected: { ...stored, verifiedEmail: 'other@example.test' }, factor: factor(2) },
    ];
    for (const refusal of refusals) {
      await expect(addFactorBatch(runtime.database, refusal)).rejects.toThrow();
    }
    expect((await store.readEnrollment(WALLET_ID))?.factors).toEqual([factor(1)]);

    const full = enrollment(Array.from({ length: 8 }, (_, index) => factor(index + 1)));
    await store.putEnrollment(full);
    await expect(
      addFactorBatch(runtime.database, { expected: full, factor: factor(9) }),
    ).rejects.toThrow();
    expect((await store.readEnrollment(WALLET_ID))?.factors).toHaveLength(8);
  } finally {
    await runtime.close();
  }
});

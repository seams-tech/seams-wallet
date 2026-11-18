import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createEmailOtpEnrollmentShamir3PassCipher } from '../../packages/wallet-server/src/threshold/session/signingSessionSeal/crypto/cipher';
import { parseSigningSessionSealRootConfig } from '../../packages/wallet-server/src/threshold/session/signingSessionSeal/options';

const keyVersion = 'email-otp-seal-v1';

function emailOtpCipher() {
  return createEmailOtpEnrollmentShamir3PassCipher({
    config: parseSigningSessionSealRootConfig({
      rootSecretB64u: Buffer.alloc(32, 9).toString('base64url'),
      currentKeyVersion: keyVersion,
    }),
  });
}

function groupElementB64u(): string {
  const bytes = randomBytes(64);
  bytes[0] = 0x40;
  return bytes.toString('base64url');
}

test('a seal comes off only with the key of its own wallet and enrollment', async () => {
  const cipher = emailOtpCipher();
  const factor = groupElementB64u();
  const scopeA = {
    walletId: 'wallet-a',
    enrollmentId: 'email-otp-device-enrollment-v1:wallet-a:s1',
  };
  const sealed = await cipher.run({
    operation: 'apply-server-seal',
    ...scopeA,
    keyVersion,
    ciphertext: factor,
  });
  if (!sealed.ok) throw new Error(sealed.message);
  expect(sealed.ciphertext).not.toBe(factor);

  const remove = async (scope: { walletId: string; enrollmentId: string }) => {
    const result = await cipher.run({
      operation: 'remove-server-seal',
      ...scope,
      keyVersion,
      ciphertext: sealed.ciphertext,
    });
    if (!result.ok) throw new Error(result.message);
    return result.ciphertext;
  };

  expect(await remove(scopeA)).toBe(factor);
  // A valid code for another wallet removes that wallet's seal, which does not open this factor.
  expect(
    await remove({
      walletId: 'wallet-b',
      enrollmentId: 'email-otp-device-enrollment-v1:wallet-b:s1',
    }),
  ).not.toBe(factor);
  expect(
    await remove({ ...scopeA, enrollmentId: 'email-otp-device-enrollment-v1:wallet-a:s2' }),
  ).not.toBe(factor);
});

test('a seal request with no wallet or enrollment fails', async () => {
  const cipher = emailOtpCipher();
  for (const scope of [
    { walletId: '', enrollmentId: 'enrollment-1' },
    { walletId: 'wallet-a', enrollmentId: ' ' },
  ]) {
    const result = await cipher.run({
      operation: 'apply-server-seal',
      ...scope,
      keyVersion,
      ciphertext: groupElementB64u(),
    });
    expect(result).toMatchObject({ ok: false, code: 'invalid_scope' });
  }
});

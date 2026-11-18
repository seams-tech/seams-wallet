import { expect, test } from '@playwright/test';
import { readEmailOtpSealedRefreshSeal } from '@/core/signingEngine/session/emailOtp/ecdsaPublication';

const expiresAtMs = 1_900_000_000_000;
const seal = {
  sealedSecretB64u: ' sealed-secret ',
  keyVersion: 'seal-key-v1',
  expiresAtMs,
  remainingUses: 4,
};

test('the sealed record takes the budget that the seal reports', () => {
  expect(readEmailOtpSealedRefreshSeal(seal)).toEqual({
    sealedSecretB64u: 'sealed-secret',
    sealKeyVersion: 'seal-key-v1',
    expiresAtMs,
    remainingUses: 4,
  });
});

test('a missing or bad granted count fails, and no older count fills it', () => {
  for (const remainingUses of [undefined, 0, -1, 1.5, Number.NaN, '4']) {
    expect(() => readEmailOtpSealedRefreshSeal({ ...seal, remainingUses })).toThrow(
      'Email OTP sealed refresh seal remainingUses must be a positive safe integer',
    );
  }
});

test('a missing or bad lifetime, secret or key version fails', () => {
  for (const bad of [undefined, 0, Number.NaN, String(expiresAtMs)]) {
    expect(() => readEmailOtpSealedRefreshSeal({ ...seal, expiresAtMs: bad })).toThrow(
      'Email OTP sealed refresh seal expiresAtMs must be a positive safe integer',
    );
  }
  expect(() => readEmailOtpSealedRefreshSeal({ ...seal, sealedSecretB64u: ' ' })).toThrow(
    'Email OTP sealed refresh seal returned no sealed secret',
  );
  expect(() => readEmailOtpSealedRefreshSeal({ ...seal, keyVersion: undefined })).toThrow(
    'Email OTP sealed refresh seal returned no key version',
  );
});

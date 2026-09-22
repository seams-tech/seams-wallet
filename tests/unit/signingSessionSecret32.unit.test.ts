import { expect, test } from '@playwright/test';
import { decodeSigningSessionSecret32 } from '@shared/utils/signingSessionSeal';
import { decodeEmailOtpEscrowSecret32 } from '@/core/signingEngine/session/emailOtp/secretEscrow';

test('session restore preserves leading zeroes for both authentication factors', () => {
  const original = new Uint8Array(32).fill(73);
  original.fill(0, 0, 3);
  const integerEncoding = original.subarray(3);
  expect(decodeSigningSessionSecret32(integerEncoding)).toEqual(original);
  expect(decodeSigningSessionSecret32(original)).toEqual(original);
  expect(decodeEmailOtpEscrowSecret32(integerEncoding)).toEqual({
    kind: 'secret32',
    secret32: original,
  });
  expect(decodeSigningSessionSecret32(new Uint8Array())).toBeNull();
  expect(decodeSigningSessionSecret32(new Uint8Array(33))).toBeNull();
});

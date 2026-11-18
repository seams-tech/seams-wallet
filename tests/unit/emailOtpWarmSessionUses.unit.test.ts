import { expect, test } from '@playwright/test';
import { parseEmailOtpWorkerRequest } from '@/core/signingEngine/workerManager/workers/email-otp/requestEnvelope';
import {
  bindEmailOtpEcdsaWarmSessionFactor,
  consumeEmailOtpWarmSessionUses,
  deleteEmailOtpWarmMaterial,
} from '@/core/signingEngine/workerManager/workers/email-otp/sessionState';

const target = { kind: 'ecdsa', thresholdSessionId: 'email-otp-threshold-session-1' } as const;
const badUses: unknown[] = [0, -1, 1.5, Number.NaN, '2', null];

function bindWarmSession(remainingUses: number): void {
  bindEmailOtpEcdsaWarmSessionFactor({
    session: {
      threshold_session_id: target.thresholdSessionId,
      remaining_uses: remainingUses,
      expires_at_ms: Date.now() + 60_000,
    },
    factorSecret32: new Uint8Array(32).fill(5),
  });
}

function consumeRequest(payload: Record<string, unknown>) {
  return parseEmailOtpWorkerRequest({
    id: 'request-1',
    type: 'consumeEmailOtpWarmSessionUses',
    payload,
  });
}

test.afterEach(() => {
  deleteEmailOtpWarmMaterial(target);
});

test('a bad uses count is refused, not turned into one use', () => {
  bindWarmSession(3);

  for (const uses of badUses) {
    expect(() => consumeEmailOtpWarmSessionUses({ target, uses: uses as number })).toThrow(
      'Email OTP warm-session uses must be a positive safe integer',
    );
  }
  expect(consumeEmailOtpWarmSessionUses({ target, uses: 2 })).toMatchObject({
    ok: true,
    remainingUses: 1,
  });
  // An absent count spends one use.
  expect(consumeEmailOtpWarmSessionUses({ target })).toMatchObject({ ok: true, remainingUses: 0 });
});

test('the worker request refuses a bad uses count and keeps an absent count absent', () => {
  expect(consumeRequest({ target })).toEqual({
    id: 'request-1',
    type: 'consumeEmailOtpWarmSessionUses',
    payload: { target },
  });
  expect(consumeRequest({ target, uses: 2 })).toMatchObject({ payload: { target, uses: 2 } });
  for (const uses of badUses) {
    expect(() => consumeRequest({ target, uses })).toThrow(
      'consumeEmailOtpWarmSessionUses.uses must be a positive safe integer',
    );
  }
});

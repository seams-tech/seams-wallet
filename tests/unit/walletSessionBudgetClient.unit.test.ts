import { expect, test } from '@playwright/test';
import {
  isGrantedWithinRequestedBudget,
  resolveRequestedWalletSessionBudget,
} from '../../packages/wallet/src/core/signingEngine/threshold/sessionPolicy';

const DEFAULTS = { ttlMs: 60_000, remainingUses: 5 };

test.describe("the app's Wallet Session budget on the client", () => {
  test('an override field replaces only that field of the defaults', () => {
    expect(
      resolveRequestedWalletSessionBudget({ defaults: DEFAULTS, override: { remainingUses: 9 } }),
    ).toEqual({ ttlMs: 60_000, remainingUses: 9 });
  });

  test('0 in either field asks for no warm session', () => {
    expect(
      resolveRequestedWalletSessionBudget({ defaults: DEFAULTS, override: { ttlMs: 0 } }),
    ).toBeNull();
    expect(
      resolveRequestedWalletSessionBudget({ defaults: { ttlMs: 60_000, remainingUses: 0 } }),
    ).toBeNull();
  });

  test('a value that is not a non-negative integer is an error, not a disabled session', () => {
    for (const invalid of [-1, 0.5, 2.7, Number.POSITIVE_INFINITY, Number.NaN, '5']) {
      expect(() =>
        resolveRequestedWalletSessionBudget({
          defaults: DEFAULTS,
          override: { remainingUses: invalid },
        }),
      ).toThrow(/signingSession\.remainingUses/);
    }
  });
});

test.describe('the client adopts a grant by one rule', () => {
  const REQUESTED = { ttlMs: 60_000, remainingUses: 7 };

  test('a grant at or below the request is adopted', () => {
    expect(isGrantedWithinRequestedBudget(REQUESTED, { remainingUses: 7, lifetimeMs: 60_000 })).toBe(
      true,
    );
    expect(isGrantedWithinRequestedBudget(REQUESTED, { remainingUses: 1, lifetimeMs: 1 })).toBe(
      true,
    );
  });

  test('a grant above the request, or of nothing, is refused', () => {
    expect(isGrantedWithinRequestedBudget(REQUESTED, { remainingUses: 8, lifetimeMs: null })).toBe(
      false,
    );
    expect(
      isGrantedWithinRequestedBudget(REQUESTED, { remainingUses: null, lifetimeMs: 60_001 }),
    ).toBe(false);
    expect(isGrantedWithinRequestedBudget(REQUESTED, { remainingUses: 0, lifetimeMs: null })).toBe(
      false,
    );
  });

  test("with no request, the server's default is adopted", () => {
    expect(
      isGrantedWithinRequestedBudget(null, { remainingUses: 100, lifetimeMs: 30 * 86_400_000 }),
    ).toBe(true);
    expect(isGrantedWithinRequestedBudget(null, { remainingUses: 0, lifetimeMs: null })).toBe(false);
  });
});

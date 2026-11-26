import { expect, test } from '@playwright/test';
import {
  isD1TriggerRefusal,
  isD1UniqueConstraintError,
} from '../../packages/mpc-wallet-server/src/storage/d1Sql';

const unique = new Error(
  'D1_ERROR: UNIQUE constraint failed: wallet_recovery_code_locators.locator_digest: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)',
);
const casGuard = new Error(
  'D1_ERROR: UNIQUE constraint failed: router_ab_yao_versioned_json_cas_guard.guard_id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_PRIMARYKEY)',
);
const check = new Error(
  "D1_ERROR: CHECK constraint failed: length(authorization_id) > 0: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_CHECK)",
);
const notNull = new Error(
  'D1_ERROR: NOT NULL constraint failed: wallet_auth_methods.status: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_NOTNULL)',
);
const foreignKey = new Error(
  'D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)',
);
const trigger = new Error(
  'D1_ERROR: wallet_auth_methods_frozen_update: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)',
);

test.describe('D1 constraint error matchers', () => {
  test('a UNIQUE or PRIMARY KEY failure is a conflict, on the named table only', () => {
    expect(isD1UniqueConstraintError(unique)).toBe(true);
    expect(isD1UniqueConstraintError(casGuard)).toBe(true);
    expect(isD1UniqueConstraintError(unique, 'wallet_recovery_code_locators')).toBe(true);
    expect(isD1UniqueConstraintError(unique, 'wallet_recovery_codes')).toBe(false);
  });

  test('CHECK, NOT NULL, FOREIGN KEY and trigger failures are not a UNIQUE conflict', () => {
    for (const error of [check, notNull, foreignKey, trigger]) {
      expect(isD1UniqueConstraintError(error)).toBe(false);
    }
  });

  test('only a trigger abort is a trigger refusal', () => {
    expect(isD1TriggerRefusal(trigger)).toBe(true);
    for (const error of [unique, casGuard, check, notNull, foreignKey]) {
      expect(isD1TriggerRefusal(error)).toBe(false);
    }
  });
});

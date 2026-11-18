import { test } from '@playwright/test';

/**
 * Marks the running check as an expected failure: today's code breaks the contract that the
 * check states. `row` names the row of the auth and wallet audit table
 * (docs/refactor-251-slice-0-inventory.md) that records the fault. Playwright reports the check
 * as failed when it starts to pass, so the marker goes in the change that fixes the fault.
 */
export function expectKnownFault(row: string, fault: string): void {
  test.fail(true, `Known fault, audit row ${row}: ${fault}`);
}

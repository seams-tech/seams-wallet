import { expect, type Page, type Request } from '@playwright/test';
import { isPlainObject } from '../../../packages/shared-ts/src/utils/validation';
import {
  DEFAULT_TENANT_WALLET_SESSION_MAX_REMAINING_USES,
  DEFAULT_TENANT_WALLET_SESSION_MAX_TTL_MS,
} from '../../../packages/shared-ts/src/threshold/sessionPolicy';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';

const DAY_MS = 24 * 60 * 60_000;

/** Records the `walletSessionBudget` of each request to one route. */
class BudgetRequests {
  readonly bodies: unknown[] = [];

  private constructor(private readonly pathname: string) {}

  static start(page: Page, pathname: string): BudgetRequests {
    const requests = new BudgetRequests(pathname);
    page.on('request', requests.observe.bind(requests));
    return requests;
  }

  private observe(request: Request): void {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== this.pathname) return;
    let body: unknown;
    try {
      body = request.postDataJSON();
    } catch {
      return;
    }
    this.bodies.push(isPlainObject(body) ? body.walletSessionBudget : undefined);
  }
}

async function grantedBudget(harness: IntendedBehaviourHarness) {
  const status = await harness.readCurrentWalletSessionStatus();
  return {
    remainingUses: status.remainingUses,
    ttlMs: status.expiresAtMs - status.authorization.issuedAtMs,
  };
}

test('registration and unlock grant the budget that the app asks for', async ({
  harness,
  page,
}) => {
  const asked = { ttlMs: 2 * DAY_MS, remainingUses: 7 };
  harness.useSigningSessionBudget(asked);
  const setups = BudgetRequests.start(page, '/wallets/register/setup');
  const unlocks = BudgetRequests.start(page, '/wallet/unlock/verify');

  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  expect(setups.bodies).toContainEqual(asked);
  await harness.signTempoTransaction('post_registration');
  expect(await grantedBudget(harness)).toEqual({ remainingUses: 6, ttlMs: asked.ttlMs });

  await harness.lockWallet();
  await harness.unlockPasskeyWallet();
  expect(unlocks.bodies).toEqual([asked]);
  await harness.signNearTransaction('post_unlock');
  expect(await grantedBudget(harness)).toEqual({ remainingUses: 6, ttlMs: asked.ttlMs });
});

test('a cold sync grants the budget that the app asks for', async ({ harness, page }) => {
  const asked = { ttlMs: 2 * DAY_MS, remainingUses: 7 };
  harness.useSigningSessionBudget(asked);
  const syncs = BudgetRequests.start(page, '/sync-account/verify');

  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  await harness.syncPasskeyWalletFromEmptyStorage();
  expect(syncs.bodies).toEqual([asked]);
  await harness.signNearTransaction('post_unlock');
  expect(await grantedBudget(harness)).toEqual({ remainingUses: 6, ttlMs: asked.ttlMs });
});

test('an unlock that asks for more than the maximum gets the maximum', async ({
  harness,
  page,
}) => {
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  await harness.lockWallet();
  const asked = { ttlMs: 60 * DAY_MS, remainingUses: 500 };
  harness.useSigningSessionBudget(asked);
  const unlocks = BudgetRequests.start(page, '/wallet/unlock/verify');

  await harness.unlockPasskeyWallet();
  expect(unlocks.bodies).toEqual([asked]);
  await harness.signNearTransaction('post_unlock');
  // The local Console sets no tenant maximum, so the default maximum applies.
  expect(await grantedBudget(harness)).toEqual({
    remainingUses: DEFAULT_TENANT_WALLET_SESSION_MAX_REMAINING_USES - 1,
    ttlMs: DEFAULT_TENANT_WALLET_SESSION_MAX_TTL_MS,
  });
});

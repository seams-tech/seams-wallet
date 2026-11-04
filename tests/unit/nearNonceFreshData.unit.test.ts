import { expect, test } from '@playwright/test';
import type { AccessKeyView, BlockReference } from '@near-js/types';
import type { NearClient } from '@/core/rpcClients/near/NearClient';
import {
  createNearNonceLaneState,
  fetchNearFreshDataForState,
  initializeNearAccessKeyState,
  NearImplicitAccountFundingRequiredError,
} from '@/core/signingEngine/nonce/nearNonceLane';

type NearFreshDataClient = Pick<NearClient, 'viewAccessKey' | 'viewBlock'>;

const IMPLICIT_ACCOUNT_ID = 'a'.repeat(64);
const PUBLIC_KEY = `ed25519:${'b'.repeat(44)}`;

class MissingAccessKeyNearFreshDataClient implements NearFreshDataClient {
  async viewAccessKey(): Promise<AccessKeyView> {
    throw new Error('access key not found');
  }

  async viewBlock(_params: BlockReference): ReturnType<NearFreshDataClient['viewBlock']> {
    return { header: { height: 101, hash: 'transaction-block' } };
  }
}

function initializedImplicitNearState() {
  const state = createNearNonceLaneState();
  initializeNearAccessKeyState({
    state,
    walletId: 'wallet-near-latency',
    nearAccountId: IMPLICIT_ACCOUNT_ID,
    publicKey: PUBLIC_KEY,
  });
  return state;
}

test('a missing implicit-account access key still requests funding', async () => {
  const state = initializedImplicitNearState();

  await expect(
    fetchNearFreshDataForState({
      state,
      nearClient: new MissingAccessKeyNearFreshDataClient(),
      force: true,
      now: Date.now,
      nonceFreshnessThresholdMs: 5_000,
      blockFreshnessThresholdMs: 20_000,
    }),
  ).rejects.toBeInstanceOf(NearImplicitAccountFundingRequiredError);
  expect(state.lifecycle.kind).toBe('implicit_unfunded');
});

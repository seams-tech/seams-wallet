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

class ReadyNearFreshDataClient implements NearFreshDataClient {
  accessKeyRequests = 0;
  blockRequests = 0;

  async viewAccessKey(): Promise<AccessKeyView> {
    this.accessKeyRequests += 1;
    return {
      nonce: 7n,
      permission: 'FullAccess',
      block_height: 100,
      block_hash: 'access-key-block',
    };
  }

  async viewBlock(_params: BlockReference): ReturnType<NearFreshDataClient['viewBlock']> {
    this.blockRequests += 1;
    return { header: { height: 101, hash: 'transaction-block' } };
  }
}

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

test('implicit NEAR readiness uses the access-key result without a second account lookup', async () => {
  const state = initializedImplicitNearState();
  const nearClient = new ReadyNearFreshDataClient();

  const context = await fetchNearFreshDataForState({
    state,
    nearClient,
    force: true,
    now: Date.now,
    nonceFreshnessThresholdMs: 5_000,
    blockFreshnessThresholdMs: 20_000,
  });

  expect(context.nextNonce).toBe('8');
  expect(nearClient.accessKeyRequests).toBe(1);
  expect(nearClient.blockRequests).toBe(1);
});

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

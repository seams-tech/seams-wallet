import { expect, test } from '@playwright/test';
import type { NearProvisioningState } from '../../packages/wallet/src/core/types/seams';
import type { WalletId } from '../../packages/shared-ts/src/utils/registrationIntent';
import {
  runSingleFlightNearProvisioning,
  subscribeToNearProvisioning,
} from '../../packages/wallet/src/core/signingEngine/flows/registration/nearProvisioningRegistry';

const ready: NearProvisioningState = {
  status: 'near_ready',
  updatedAtMs: 2,
} as NearProvisioningState;

test('a listener that starts provisioning again joins the attempt in flight', async () => {
  const walletId = 'wallet-reentrant' as WalletId;
  let attempts = 0;
  const attempt = async (): Promise<NearProvisioningState> => {
    attempts += 1;
    return ready;
  };
  const joined: Promise<NearProvisioningState>[] = [];
  const unsubscribe = subscribeToNearProvisioning((notifiedWalletId, state) => {
    if (notifiedWalletId !== walletId || state.status !== 'near_provisioning') return;
    joined.push(runSingleFlightNearProvisioning({ walletId, nowMs: () => 1, attempt }));
  });
  try {
    const first = runSingleFlightNearProvisioning({ walletId, nowMs: () => 1, attempt });

    expect(joined).toHaveLength(1);
    expect(joined[0]).toBe(first);
    expect(await first).toEqual(ready);
    expect(attempts).toBe(1);
  } finally {
    unsubscribe();
  }
});

test('an attempt that throws publishes a retryable failure', async () => {
  const walletId = 'wallet-throws' as WalletId;
  const states: string[] = [];
  const unsubscribe = subscribeToNearProvisioning((notifiedWalletId, state) => {
    if (notifiedWalletId === walletId) states.push(state.status);
  });
  try {
    const result = await runSingleFlightNearProvisioning({
      walletId,
      nowMs: () => 1,
      attempt: () => {
        throw new Error('injected attempt failure');
      },
    });

    expect(result).toMatchObject({
      status: 'near_failed_retryable',
      error: 'injected attempt failure',
    });
    expect(states).toEqual(['near_provisioning', 'near_failed_retryable']);
  } finally {
    unsubscribe();
  }
});

import { expect, test } from '@playwright/test';
import { walletIframeRequestIdFromBoundary } from '@/core/types/walletIframeIdentity';
import { WalletIframeTransactionSurfaceQueue } from '@/SeamsWeb/walletIframe/client/surface/transactionSurfaceQueue';

test('a distant deadline keeps its place in the transaction surface queue', async () => {
  const queue = new WalletIframeTransactionSurfaceQueue();
  const first = walletIframeRequestIdFromBoundary('first');
  const second = walletIframeRequestIdFromBoundary('second');
  const firstLease = await queue.acquire({ requestId: first, deadline: { kind: 'interactive' } });

  const waiting = queue.acquire({
    requestId: second,
    deadline: { kind: 'deadline', atMs: Date.now() + 40 * 24 * 60 * 60 * 1000 },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  firstLease.release();
  const secondLease = await waiting;
  expect(secondLease.requestId).toBe(second);
  secondLease.release();
});

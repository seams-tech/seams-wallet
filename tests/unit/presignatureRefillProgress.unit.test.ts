import { expect, test } from '@playwright/test';
import { PresignatureRefillProgressV1 } from '@/core/signingEngine/routerAb/ecdsaDerivation/presignatureRefillProgress';

test('foreground waiters resume when the first presignature is published', async () => {
  const progress = new PresignatureRefillProgressV1();
  const initial = progress.snapshot();
  const background = progress.waitForChange(initial, 'background');
  expect(progress.hasForegroundWaiters()).toBe(false);
  const firstAvailable = progress.waitForChange(initial, 'foreground');
  expect(progress.hasForegroundWaiters()).toBe(true);

  progress.publishAvailable();

  await expect(firstAvailable).resolves.toEqual({ kind: 'refilling', revision: 1 });
  await expect(background).resolves.toEqual({ kind: 'refilling', revision: 1 });
  expect(progress.hasForegroundWaiters()).toBe(false);
  expect(progress.snapshot()).toEqual({ kind: 'refilling', revision: 1 });

  const refillSettled = progress.waitForChange(progress.snapshot(), 'foreground');
  progress.settle();
  await expect(refillSettled).resolves.toEqual({ kind: 'settled', revision: 1 });
  expect(progress.hasForegroundWaiters()).toBe(false);
});

import { expect, test } from '@playwright/test';
import { PresignatureRefillProgressV1 } from '@/core/signingEngine/routerAb/ecdsaDerivation/presignatureRefillProgress';

test('foreground waiters resume when the first presignature is published', async () => {
  const progress = new PresignatureRefillProgressV1();
  const initial = progress.snapshot();
  const firstAvailable = progress.waitForChange(initial);

  progress.publishAvailable();

  await expect(firstAvailable).resolves.toEqual({ kind: 'refilling', revision: 1 });
  expect(progress.snapshot()).toEqual({ kind: 'refilling', revision: 1 });

  const refillSettled = progress.waitForChange(progress.snapshot());
  progress.settle();
  await expect(refillSettled).resolves.toEqual({ kind: 'settled', revision: 1 });
});

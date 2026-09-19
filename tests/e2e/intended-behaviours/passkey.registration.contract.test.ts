import { expect, type Request } from '@playwright/test';
import { intendedTest as test, type IntendedSigningStage } from './harness';

type SigningRequests = {
  foregroundFills: number;
  presignatureIds: string[];
};

function collectSigningRequests(requests: SigningRequests, request: Request): void {
  const pathname = new URL(request.url()).pathname;
  if (
    pathname !== '/router-ab/ecdsa-derivation/sign/prepare' &&
    pathname !== '/router-ab/ecdsa-derivation/presignature-pool/fill/init'
  ) {
    return;
  }
  const body: unknown = request.postDataJSON();
  if (typeof body !== 'object' || body === null) return;
  if ('client_presignature_id' in body && typeof body.client_presignature_id === 'string') {
    requests.presignatureIds.push(body.client_presignature_id);
  }
  if ('requestTag' in body && body.requestTag === 'foreground_presign_pool_refill') {
    requests.foregroundFills += 1;
  }
}

function isLastWarmSessionUse(remaining: number): boolean {
  return remaining <= 1;
}

test('passkey registration establishes an immediately usable owner session', async ({ harness }) => {
  await harness.registerPasskeyWallet();
  await harness.assertRegistrationOwnerSessionIsActive();
  await harness.signTempoTransaction('post_registration');
  await harness.awaitNearReady();
  await harness.signNearTransaction('post_registration');
  await harness.signArcEvmTransaction('post_registration');
  await harness.assertRegistrationOwnerSessionIsActive();
});

test('sustained Tempo and Arc signing uses fresh presignatures beyond pool capacity', async ({
  harness,
  context,
}) => {
  const requests: SigningRequests = { foregroundFills: 0, presignatureIds: [] };
  const collect = collectSigningRequests.bind(undefined, requests);
  context.on('request', collect);
  try {
    await harness.registerPasskeyWallet();
    let stage: IntendedSigningStage = 'post_registration';
    for (let index = 0; index < 10; index += 1) {
      const tempo = await harness.signTempoTransaction(stage);
      if (index === 0) expect(requests.foregroundFills).toBeLessThanOrEqual(1);
      // Warm-session events report the allowance before this signature consumes a use.
      if (tempo.remainingUses.some(isLastWarmSessionUse)) stage = 'step_up_required';
      const arc = await harness.signArcEvmTransaction(stage);
      if (arc.remainingUses.some(isLastWarmSessionUse)) stage = 'step_up_required';
    }
    expect(requests.presignatureIds).toHaveLength(20);
    expect(new Set(requests.presignatureIds).size).toBe(20);
  } finally {
    context.off('request', collect);
  }
});

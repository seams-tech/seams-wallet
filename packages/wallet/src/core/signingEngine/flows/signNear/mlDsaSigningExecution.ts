import { assertSigningNotCancelled } from '../shared/cancellation';
import { executeMlDsaNearSigning } from '@/core/rpcClients/relayer/mlDsaSigning';
import type { MlDsaSigningOutcome } from '@shared/near/mlDsaSigning';

type SettledMlDsaSigningOutcome = Exclude<MlDsaSigningOutcome, { readonly kind: 'retry' }>;

function scheduleRetry(milliseconds: number, resolve: () => void): void {
  setTimeout(resolve, milliseconds);
}

async function waitForRetry(
  retryAtMs: number,
  deadlineAtMs: number,
  shouldAbort: () => boolean,
): Promise<void> {
  const wakeAtMs = Math.max(Date.now() + 100, retryAtMs);
  for (;;) {
    assertSigningNotCancelled(shouldAbort);
    const nowMs = Date.now();
    if (nowMs >= deadlineAtMs) throw new Error('ML-DSA signing approval expired');
    if (nowMs >= wakeAtMs) return;
    await new Promise<void>(scheduleRetry.bind(null, Math.min(100, wakeAtMs - nowMs)));
  }
}

/** An in-flight request settles normally; cancellation prevents the next dispatch. */
export async function executeMlDsaSigningUntilSettled(input: {
  readonly request: Parameters<typeof executeMlDsaNearSigning>[0];
  readonly deadlineAtMs: number;
  readonly shouldAbort: () => boolean;
  readonly onDispatch: () => void;
}): Promise<SettledMlDsaSigningOutcome> {
  for (;;) {
    assertSigningNotCancelled(input.shouldAbort);
    if (Date.now() >= input.deadlineAtMs) throw new Error('ML-DSA signing approval expired');
    input.onDispatch();
    const result = await executeMlDsaNearSigning(input.request);
    if (result.kind !== 'retry') return result;
    assertSigningNotCancelled(input.shouldAbort);
    if (result.retryAtMs >= input.deadlineAtMs) throw new Error('ML-DSA signing approval expired');
    await waitForRetry(result.retryAtMs, input.deadlineAtMs, input.shouldAbort);
  }
}

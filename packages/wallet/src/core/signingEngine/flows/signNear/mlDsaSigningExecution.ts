import { MlDsaSigningError } from '@shared/near/mlDsaSigning';
import { assertSigningNotCancelled } from '../shared/cancellation';
import { executeMlDsaNearSigning } from '@/core/rpcClients/relayer/mlDsaSigning';
import type { Variant } from '@shared/utils/variant';
import type { MlDsaSigningOutcome } from '@shared/near/mlDsaSigning';

type SettledMlDsaSigningOutcome = Exclude<MlDsaSigningOutcome, { readonly kind: 'retry' }>;

function scheduleRetry(milliseconds: number, resolve: () => void): void {
  setTimeout(resolve, milliseconds);
}

async function waitForRetry(
  retryAtMs: number,
  deadlineAtMs: number,
  shouldAbort: () => boolean,
  onRetry: (retry: Variant<MlDsaSigningOutcome, 'kind', 'retry'>, seconds: number) => void,
  retry: Variant<MlDsaSigningOutcome, 'kind', 'retry'>,
): Promise<void> {
  const wakeAtMs = Math.max(Date.now() + 100, retryAtMs);
  let displayedSeconds = -1;
  for (;;) {
    assertSigningNotCancelled(shouldAbort);
    const nowMs = Date.now();
    if (nowMs >= deadlineAtMs)
      throw new MlDsaSigningError({
        kind: 'refused',
        code: 'expired',
        message: 'ML-DSA signing approval expired',
      });
    if (nowMs >= wakeAtMs) return;
    const seconds = Math.ceil((wakeAtMs - nowMs) / 1000);
    if (seconds !== displayedSeconds) {
      onRetry(retry, seconds);
      displayedSeconds = seconds;
    }
    await new Promise<void>(scheduleRetry.bind(null, Math.min(100, wakeAtMs - nowMs)));
  }
}

/** An in-flight request settles normally; cancellation prevents the next dispatch. */
export async function executeMlDsaSigningUntilSettled(input: {
  readonly request: Parameters<typeof executeMlDsaNearSigning>[0];
  readonly deadlineAtMs: number;
  readonly shouldAbort: () => boolean;
  readonly onDispatch: () => void;
  readonly onRetry: (retry: Variant<MlDsaSigningOutcome, 'kind', 'retry'>, seconds: number) => void;
}): Promise<SettledMlDsaSigningOutcome> {
  for (;;) {
    assertSigningNotCancelled(input.shouldAbort);
    if (Date.now() >= input.deadlineAtMs)
      throw new MlDsaSigningError({
        kind: 'refused',
        code: 'expired',
        message: 'ML-DSA signing approval expired',
      });
    input.onDispatch();
    const result = await executeMlDsaNearSigning(input.request);
    if (result.kind !== 'retry') return result;
    assertSigningNotCancelled(input.shouldAbort);
    if (result.retryAtMs >= input.deadlineAtMs)
      throw new MlDsaSigningError({
        kind: 'refused',
        code: 'expired',
        message: 'ML-DSA signing approval expired',
      });
    await waitForRetry(
      result.retryAtMs,
      input.deadlineAtMs,
      input.shouldAbort,
      input.onRetry,
      result,
    );
  }
}

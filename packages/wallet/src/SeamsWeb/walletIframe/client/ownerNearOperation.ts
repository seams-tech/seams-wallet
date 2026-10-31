import type { ExecuteOwnerNearOperation } from '@/SeamsWeb/publicApi/ownerNearOperation';
import type { WalletIframeRequestId } from '@/core/types/walletIframeIdentity';
import { safeErrorMessage } from '@shared/utils/errors';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';
import type { ProgressPayload } from '../shared/messages';
import { parseOwnerNearOutcome, type OwnerNearCommand } from '../shared/ownerNearOperation';

type OwnerNearRequestPorts = {
  allocateRequestId(): WalletIframeRequestId;
  cancelRequest(requestId: string): Promise<void>;
  post(
    request: {
      type: 'PM_OWNER_NEAR_TRANSACTION';
      payload: OwnerNearCommand;
      options: { onProgress: (payload: ProgressPayload) => void };
    },
    options: {
      requestId: WalletIframeRequestId;
      timeout: 'interactive';
      shouldContinue: () => boolean;
      onDispatched: () => void;
    },
  ): Promise<{ result?: unknown }>;
};

export async function executeOwnerNearRequest(
  ports: OwnerNearRequestPorts,
  ...args: Parameters<ExecuteOwnerNearOperation>
): ReturnType<ExecuteOwnerNearOperation> {
  const [command, execution] = args;
  const request = new OwnerNearRequest(ports, command, execution);
  return await request.run();
}

class OwnerNearRequest {
  private readonly requestId: WalletIframeRequestId;
  private state: ReadonlyExclusiveUnion<
    { kind: 'preparing' } | { kind: 'dispatched' } | { kind: 'submitting'; transactionId: string }
  > = { kind: 'preparing' };

  constructor(
    private readonly ports: OwnerNearRequestPorts,
    private readonly command: OwnerNearCommand,
    private readonly execution: Parameters<ExecuteOwnerNearOperation>[1],
  ) {
    this.requestId = ports.allocateRequestId();
  }

  current(): boolean {
    return !this.execution.signal.aborted;
  }
  dispatched(): void {
    this.state = { kind: 'dispatched' };
  }
  progress(payload: ProgressPayload): void {
    if (
      'event' in payload &&
      payload.event === 'owner_near_submitting' &&
      payload.operationId === this.command.recovery.operationId
    ) {
      this.state = { kind: 'submitting', transactionId: payload.transactionId };
      this.execution.onSubmission(payload.transactionId);
    }
  }
  cancel(): void {
    void this.ports.cancelRequest(this.requestId).catch(ignoreCancellationFailure);
  }

  async run(): ReturnType<ExecuteOwnerNearOperation> {
    if (!this.current()) return { kind: 'cancelled' };
    const cancel = this.cancel.bind(this);
    this.execution.signal.addEventListener('abort', cancel, { once: true });
    try {
      const response = await this.ports.post(
        {
          type: 'PM_OWNER_NEAR_TRANSACTION',
          payload: this.command,
          options: { onProgress: this.progress.bind(this) },
        },
        {
          requestId: this.requestId,
          timeout: 'interactive',
          shouldContinue: this.current.bind(this),
          onDispatched: this.dispatched.bind(this),
        },
      );
      return parseOwnerNearOutcome(response.result);
    } catch (error) {
      if (this.state.kind === 'submitting') {
        return {
          kind: 'unresolved',
          recovery: this.command.recovery,
          transactionId: this.state.transactionId,
          error: safeErrorMessage(error).trim() || 'The transaction outcome is unavailable.',
        };
      }
      if (this.command.action === 'recover') {
        return {
          kind: 'recovery_unavailable',
          recovery: this.command.recovery,
          error: safeErrorMessage(error).trim() || 'The operation recovery is unavailable.',
        };
      }
      if (this.state.kind === 'preparing') {
        if (!this.current() || isOwnerRequestCancellation(error)) return { kind: 'cancelled' };
        return {
          kind: 'not_submitted',
          error:
            safeErrorMessage(error).trim() || 'The owner operation did not submit a transaction.',
        };
      }
      return { kind: 'unknown', recovery: this.command.recovery };
    } finally {
      this.execution.signal.removeEventListener('abort', cancel);
    }
  }
}

function ignoreCancellationFailure(): void {}

function isOwnerRequestCancellation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code: unknown = Reflect.get(error, 'code');
  return code === 'cancelled' || code === 'wallet_operation_step_up_cancelled';
}

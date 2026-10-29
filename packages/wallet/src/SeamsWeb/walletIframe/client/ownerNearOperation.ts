import type { ExecuteOwnerNearOperation } from '@/SeamsWeb/publicApi/ownerNearOperation';
import type { WalletIframeRequestId } from '@/core/types/walletIframeIdentity';
import type { ProgressPayload } from '../shared/messages';
import {
  parseOwnerNearOutcome,
  parseOwnerNearSubmissionProgress,
  type OwnerNearCommand,
} from '../shared/ownerNearOperation';

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
  private state: 'preparing' | 'dispatched' | 'submitting' = 'preparing';

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
    this.state = 'dispatched';
  }
  progress(payload: ProgressPayload): void {
    const submission = parseOwnerNearSubmissionProgress(payload);
    if (submission?.operationId === this.command.recovery.operationId) {
      this.state = 'submitting';
      this.execution.onSubmission();
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
      if (this.state !== 'submitting' && isOwnerRequestCancellation(error))
        return { kind: 'cancelled' };
      if (this.state === 'preparing' && !this.current()) return { kind: 'cancelled' };
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

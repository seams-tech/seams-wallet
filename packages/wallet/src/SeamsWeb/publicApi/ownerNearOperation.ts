import { SigningSessionIds } from '@/core/signingEngine/session/operationState/types';
import { toAccountId } from '@/core/types/accountIds';
import { toActionArgsWasm, type TransactionInput } from '@/core/types/actions';
import type { ActionResult } from '@/core/types/seams';
import type { ExternalWalletAuthentication } from '@shared/auth/externalAuth';
import { secureRandomBase64Url } from '@shared/utils/secureRandomId';
import { safeErrorMessage } from '@shared/utils/errors';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';
import {
  parseOwnerNearCommand,
  parseOwnerNearRecovery,
  type OwnerNearCommand,
  type OwnerNearOutcome,
  type OwnerNearRecovery,
} from '../walletIframe/shared/ownerNearOperation';

export type {
  OwnerNearOutcome,
  OwnerNearRecovery,
} from '../walletIframe/shared/ownerNearOperation';

export type OwnerNearOperationState = Readonly<{ recovery: OwnerNearRecovery }> &
  ReadonlyExclusiveUnion<
    | { kind: 'prepared'; expiresAtMs: number }
    | { kind: 'approval'; expiresAtMs: number }
    | { kind: 'submitting'; transactionId: string }
    | { kind: 'unknown' }
    | { kind: 'unresolved'; transactionId: string; error: string }
    | { kind: 'recovery_unavailable'; error: string }
    | { kind: 'completed'; result: Extract<ActionResult, { success: true }> }
    | { kind: 'reverted'; transactionId: string; error: string }
    | { kind: 'cancelled' }
    | { kind: 'expired' }
    | { kind: 'not_submitted'; error: string }
  >;

export interface OwnerNearOperation {
  getState(): OwnerNearOperationState;
  subscribe(listener: () => void): () => void;
  approve(): Promise<OwnerNearOutcome>;
  cancel(): void;
  recover(): Promise<OwnerNearOutcome>;
}

export type PrepareOwnerNearTransaction = {
  readonly authentication: ExternalWalletAuthentication;
  readonly nearAccountId: string;
  readonly transaction: TransactionInput;
};

export type ResumeOwnerNearTransaction = {
  readonly authentication: ExternalWalletAuthentication;
  readonly recovery: OwnerNearRecovery;
};

export type ExecuteOwnerNearOperation = (
  command: OwnerNearCommand,
  execution: {
    readonly signal: AbortSignal;
    readonly onSubmission: (transactionId: string) => void;
  },
) => Promise<OwnerNearOutcome>;

export function prepareOwnerNearTransaction(
  execute: ExecuteOwnerNearOperation,
  input: PrepareOwnerNearTransaction,
): OwnerNearOperation {
  const recovery: OwnerNearRecovery = {
    operationId: SigningSessionIds.signingOperation(
      `owner-near:${secureRandomBase64Url(32, 'owner NEAR operation IDs')}`,
    ),
    walletId: input.authentication.walletId,
    nearAccountId: toAccountId(input.nearAccountId),
  };
  const command = parseOwnerNearCommand({
    action: 'approve',
    authentication: input.authentication,
    recovery,
    expiresAtMs: Math.min(input.authentication.expiresAtMs, Date.now() + 120_000),
    transaction: {
      receiverId: input.transaction.receiverId,
      actions: input.transaction.actions.map(toActionArgsWasm),
    },
  });
  if (command.action !== 'approve') throw new Error('Invalid prepared owner operation.');
  return new OwnerNearTransaction(execute, command, {
    kind: 'prepared',
    recovery,
    expiresAtMs: command.expiresAtMs,
  });
}

export function resumeOwnerNearTransaction(
  execute: ExecuteOwnerNearOperation,
  input: ResumeOwnerNearTransaction,
): OwnerNearOperation {
  const recovery = parseOwnerNearRecovery(input.recovery);
  const command = parseOwnerNearCommand({
    action: 'recover',
    authentication: input.authentication,
    recovery,
  });
  return new OwnerNearTransaction(execute, command, { kind: 'unknown', recovery });
}

class OwnerNearTransaction implements OwnerNearOperation {
  private readonly controller = new AbortController();
  private readonly listeners = new Set<() => void>();
  private inFlight: Promise<OwnerNearOutcome> | null = null;

  constructor(
    private readonly execute: ExecuteOwnerNearOperation,
    private readonly command: OwnerNearCommand,
    private state: OwnerNearOperationState,
  ) {}

  getState(): OwnerNearOperationState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return this.removeListener.bind(this, listener);
  }

  private removeListener(listener: () => void): void {
    this.listeners.delete(listener);
  }

  private transition(state: OwnerNearOperationState): void {
    this.state = state;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {}
    }
  }

  approve(): Promise<OwnerNearOutcome> {
    if (this.inFlight) return this.inFlight;
    if (this.command.action !== 'approve' || this.state.kind !== 'prepared')
      throw new Error('This operation cannot request another approval.');
    if (this.command.expiresAtMs <= Date.now()) {
      this.transition({ kind: 'expired', recovery: this.command.recovery });
      return Promise.resolve({ kind: 'expired' });
    }
    this.transition({
      kind: 'approval',
      recovery: this.command.recovery,
      expiresAtMs: this.command.expiresAtMs,
    });
    this.inFlight = this.run(this.command);
    return this.inFlight;
  }

  cancel(): void {
    if (this.state.kind === 'prepared') {
      this.controller.abort();
      this.transition({ kind: 'cancelled', recovery: this.command.recovery });
    } else if (this.state.kind === 'approval') {
      this.controller.abort();
    }
  }

  recover(): Promise<OwnerNearOutcome> {
    if (this.inFlight) return this.inFlight;
    if (
      this.state.kind !== 'unknown' &&
      this.state.kind !== 'unresolved' &&
      this.state.kind !== 'recovery_unavailable'
    )
      throw new Error('Only an unresolved outcome requires recovery.');
    this.inFlight = this.run({
      action: 'recover',
      authentication: this.command.authentication,
      recovery: this.state.recovery,
    });
    return this.inFlight;
  }

  private submitted(transactionId: string): void {
    this.transition({ kind: 'submitting', recovery: this.command.recovery, transactionId });
  }

  private async run(command: OwnerNearCommand): Promise<OwnerNearOutcome> {
    let outcome: OwnerNearOutcome;
    try {
      outcome = await this.execute(command, {
        signal:
          command.action === 'recover' ? new AbortController().signal : this.controller.signal,
        onSubmission: this.submitted.bind(this),
      });
    } catch (error) {
      outcome = {
        kind: 'recovery_unavailable',
        recovery: command.recovery,
        error: safeErrorMessage(error).trim() || 'The operation recovery is unavailable.',
      };
    }
    if (
      (outcome.kind === 'unknown' || outcome.kind === 'recovery_unavailable') &&
      outcome.recovery.operationId === this.state.recovery.operationId &&
      (this.state.kind === 'submitting' || this.state.kind === 'unresolved')
    ) {
      outcome = {
        kind: 'unresolved',
        recovery: outcome.recovery,
        transactionId: this.state.transactionId,
        error:
          outcome.error || 'The transaction outcome is unavailable. Check this transaction again.',
      };
    }
    this.settle(outcome, command.recovery);
    this.inFlight = null;
    return outcome;
  }

  private settle(outcome: OwnerNearOutcome, recovery: OwnerNearRecovery): void {
    switch (outcome.kind) {
      case 'completed':
        this.transition({ kind: 'completed', recovery, result: outcome.result });
        return;
      case 'reverted':
        this.transition({
          kind: 'reverted',
          recovery,
          transactionId: outcome.transactionId,
          error: outcome.error,
        });
        return;
      case 'cancelled':
        this.transition({ kind: 'cancelled', recovery });
        return;
      case 'expired':
        this.transition({ kind: 'expired', recovery });
        return;
      case 'unknown':
        this.transition({ kind: 'unknown', recovery: outcome.recovery });
        return;
      case 'unresolved':
        this.transition({
          kind: 'unresolved',
          recovery: outcome.recovery,
          transactionId: outcome.transactionId,
          error: outcome.error,
        });
        return;
      case 'recovery_unavailable':
        this.transition({
          kind: 'recovery_unavailable',
          recovery: outcome.recovery,
          error: outcome.error,
        });
        return;
      case 'not_submitted':
        this.transition({ kind: 'not_submitted', recovery, error: outcome.error });
        return;
      default:
        outcome satisfies never;
        throw new Error('Unsupported owner operation outcome.');
    }
  }
}

import { SigningSessionIds } from '@/core/signingEngine/session/operationState/types';
import { toAccountId } from '@/core/types/accountIds';
import { toActionArgsWasm, type TransactionInput } from '@/core/types/actions';
import type { ActionResult } from '@/core/types/seams';
import type { NearTransactionRejection } from '@/core/rpcClients/near/nearTransactionRejection';
import type { ExternalWalletAuthentication } from '@shared/auth/externalAuth';
import { secureRandomBase64Url } from '@shared/utils/secureRandomId';
import { safeErrorMessage } from '@shared/utils/errors';
import type { ReadonlyExclusiveUnion, Variant } from '@shared/utils/variant';
import {
  parseOwnerNearCommand,
  parseOwnerNearRecovery,
  type OwnerNearCommand,
  type OwnerNearOutcome,
  type OwnerNearRecovery,
  type OwnerNearRetirementProof,
  type OwnerNearRetirementWait,
  type OwnerNearShortfall,
  type OwnerNearUnverifiedExecutionProof,
} from '../walletIframe/shared/ownerNearOperation';

export type { NearTransactionRejection } from '@/core/rpcClients/near/nearTransactionRejection';
export type {
  OwnerNearOutcome,
  OwnerNearRecovery,
  OwnerNearReplacementProof,
  OwnerNearRetirementProof,
  OwnerNearRetirementWait,
  OwnerNearShortfall,
  OwnerNearSubmissionEvidence,
  OwnerNearUnverifiedExecutionProof,
} from '../walletIframe/shared/ownerNearOperation';

export type OwnerNearOperationState = Readonly<{ recovery: OwnerNearRecovery }> &
  ReadonlyExclusiveUnion<
    | {
        kind: 'prepared';
        /** A reviewed operation has no approval deadline yet, so this is its authentication expiry. */
        expiresAtMs: number;
      }
    | { kind: 'reviewing' }
    | { kind: 'approval'; expiresAtMs: number }
    | { kind: 'submitting'; transactionId: string }
    | { kind: 'unknown' }
    | {
        kind: 'unresolved';
        transactionId: string;
        error: string;
        retirementWait?: OwnerNearRetirementWait;
        rejection?: NearTransactionRejection;
        cancellationRejection?: NearTransactionRejection;
      }
    | { kind: 'cancellation_approval'; transactionId: string }
    | { kind: 'recovery_unavailable'; error: string }
    | { kind: 'completed'; result: Extract<ActionResult, { success: true }> }
    | { kind: 'reverted'; transactionId: string; error: string }
    | { kind: 'cancelled' }
    | { kind: 'expired' }
    | {
        kind: 'not_submitted';
        error: string;
        rejection?: NearTransactionRejection;
        shortfall?: OwnerNearShortfall;
      }
    | {
        kind: 'retirement_available' | 'retirement_approval';
        transactionId: string;
        proof: OwnerNearUnverifiedExecutionProof;
      }
    | { kind: 'retired'; transactionId: string; proof: OwnerNearRetirementProof }
  >;

export interface OwnerNearOperation {
  getState(): OwnerNearOperationState;
  subscribe(listener: () => void): () => void;
  approve(): Promise<OwnerNearOutcome>;
  cancel(): void;
  recover(): Promise<OwnerNearOutcome>;
  /** Ask the owner to release an expired transaction whose execution remains unverified. */
  retire(): Promise<OwnerNearOutcome>;
  /**
   * Ask the owner to cancel a submitted transaction that has not settled. The wallet signs a
   * 0-NEAR transfer to the account itself with the same key and nonce. When that cancel is
   * final, the operation ends as `retired` with proof that the transaction never executed,
   * and a new transaction can follow at once. A refused cancel stays `unresolved` with
   * `cancellationRejection`, such as `NotEnoughBalance`.
   */
  cancelTransaction(): Promise<OwnerNearOutcome>;
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

/**
 * Shows an application review before wallet approval. The review calls `dispatch` when the
 * owner continues to the wallet, with the executor that owns the review's surface.
 */
export type OwnerNearReview = (
  signal: AbortSignal,
  dispatch: (execute: ExecuteOwnerNearOperation) => Promise<OwnerNearOutcome>,
) => Promise<OwnerNearOutcome>;

type OwnerNearApprovalCommand = Variant<OwnerNearCommand, 'action', 'approve'>;

function ownerApprovalDeadline(authentication: ExternalWalletAuthentication): number {
  return Math.min(authentication.expiresAtMs, Date.now() + 120_000);
}

function ownerApprovalCommand(input: PrepareOwnerNearTransaction): OwnerNearApprovalCommand {
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
    expiresAtMs: ownerApprovalDeadline(input.authentication),
    transaction: {
      receiverId: input.transaction.receiverId,
      actions: input.transaction.actions.map(toActionArgsWasm),
    },
  });
  if (command.action !== 'approve') throw new Error('Invalid prepared owner operation.');
  return command;
}

export function prepareOwnerNearTransaction(
  execute: ExecuteOwnerNearOperation,
  input: PrepareOwnerNearTransaction,
): OwnerNearOperation {
  const command = ownerApprovalCommand(input);
  return new OwnerNearTransaction(execute, command, {
    kind: 'prepared',
    recovery: command.recovery,
    expiresAtMs: command.expiresAtMs,
  });
}

export function prepareReviewedOwnerNearTransaction(
  execute: ExecuteOwnerNearOperation,
  input: PrepareOwnerNearTransaction,
  review: OwnerNearReview,
): OwnerNearOperation {
  const command = ownerApprovalCommand(input);
  return new OwnerNearTransaction(
    execute,
    command,
    { kind: 'prepared', recovery: command.recovery, expiresAtMs: input.authentication.expiresAtMs },
    review,
  );
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
    private readonly review?: OwnerNearReview,
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
    if (this.state.expiresAtMs <= Date.now()) {
      this.transition({ kind: 'expired', recovery: this.command.recovery });
      return Promise.resolve({ kind: 'expired' });
    }
    if (this.review) {
      this.transition({ kind: 'reviewing', recovery: this.command.recovery });
      this.inFlight = this.run(
        this.command,
        this.openReview.bind(this, this.review, this.command),
      );
      return this.inFlight;
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
    } else if (this.state.kind === 'reviewing' || this.state.kind === 'approval') {
      this.controller.abort();
    }
  }

  recover(): Promise<OwnerNearOutcome> {
    if (this.inFlight) return this.inFlight;
    if (
      this.state.kind !== 'unknown' &&
      this.state.kind !== 'unresolved' &&
      this.state.kind !== 'recovery_unavailable' &&
      this.state.kind !== 'retirement_available'
    )
      throw new Error('Only an unresolved outcome requires recovery.');
    this.inFlight = this.run({
      action: 'recover',
      authentication: this.command.authentication,
      recovery: this.state.recovery,
    });
    return this.inFlight;
  }

  retire(): Promise<OwnerNearOutcome> {
    if (this.inFlight) return this.inFlight;
    if (this.state.kind !== 'retirement_available')
      throw new Error('Check the transaction before releasing it.');
    const { recovery, transactionId, proof } = this.state;
    this.transition({ kind: 'retirement_approval', recovery, transactionId, proof });
    this.inFlight = this.run({
      action: 'retire',
      authentication: this.command.authentication,
      recovery,
      transactionId,
    });
    return this.inFlight;
  }

  cancelTransaction(): Promise<OwnerNearOutcome> {
    if (this.inFlight) return this.inFlight;
    if (this.state.kind !== 'unresolved' && this.state.kind !== 'retirement_available')
      throw new Error('Only a submitted transaction that has not settled can be cancelled.');
    const { recovery, transactionId } = this.state;
    this.transition({ kind: 'cancellation_approval', recovery, transactionId });
    this.inFlight = this.run({
      action: 'cancel_submitted',
      authentication: this.command.authentication,
      recovery,
      transactionId,
    });
    return this.inFlight;
  }

  private openReview(
    review: OwnerNearReview,
    command: OwnerNearApprovalCommand,
    execution: Parameters<ExecuteOwnerNearOperation>[1],
  ): Promise<OwnerNearOutcome> {
    return review(execution.signal, this.dispatchReviewed.bind(this, command, execution));
  }

  private async dispatchReviewed(
    command: OwnerNearApprovalCommand,
    execution: Parameters<ExecuteOwnerNearOperation>[1],
    execute: ExecuteOwnerNearOperation,
  ): Promise<OwnerNearOutcome> {
    // The deadline starts when the owner continues, so review time cannot consume approval time.
    const expiresAtMs = ownerApprovalDeadline(command.authentication);
    if (expiresAtMs <= Date.now()) return { kind: 'expired' };
    this.transition({ kind: 'approval', recovery: command.recovery, expiresAtMs });
    return await execute(parseOwnerNearCommand({ ...command, expiresAtMs }), execution);
  }

  private submitted(recovery: OwnerNearRecovery, transactionId: string): void {
    this.transition({ kind: 'submitting', recovery, transactionId });
  }

  private async run(
    command: OwnerNearCommand,
    execute: (
      execution: Parameters<ExecuteOwnerNearOperation>[1],
    ) => Promise<OwnerNearOutcome> = this.execute.bind(null, command),
  ): Promise<OwnerNearOutcome> {
    let outcome: OwnerNearOutcome;
    try {
      outcome = await execute({
        // The owner ends a retirement review in the wallet surface.
        signal: command.action === 'approve' ? this.controller.signal : new AbortController().signal,
        onSubmission: this.submitted.bind(this, command.recovery),
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
      (this.state.kind === 'submitting' ||
        this.state.kind === 'unresolved' ||
        this.state.kind === 'retirement_approval' ||
        this.state.kind === 'cancellation_approval')
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
          ...(outcome.retirementWait ? { retirementWait: outcome.retirementWait } : {}),
          ...(outcome.rejection ? { rejection: outcome.rejection } : {}),
          ...(outcome.cancellationRejection
            ? { cancellationRejection: outcome.cancellationRejection }
            : {}),
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
        this.transition({
          kind: 'not_submitted',
          recovery,
          error: outcome.error,
          ...(outcome.rejection ? { rejection: outcome.rejection } : {}),
          ...(outcome.shortfall ? { shortfall: outcome.shortfall } : {}),
        });
        return;
      case 'retirement_available':
        this.transition({
          kind: 'retirement_available',
          recovery: outcome.recovery,
          transactionId: outcome.transactionId,
          proof: outcome.proof,
        });
        return;
      case 'retired':
        this.transition({
          kind: 'retired',
          recovery: outcome.recovery,
          transactionId: outcome.transactionId,
          proof: outcome.proof,
        });
        return;
      default:
        outcome satisfies never;
        throw new Error('Unsupported owner operation outcome.');
    }
  }
}

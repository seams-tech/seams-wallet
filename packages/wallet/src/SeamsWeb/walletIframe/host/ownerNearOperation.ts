import { resolvePrimaryNearRpcUrl } from '@/core/config/chains';
import { IndexedDBManager } from '@/core/indexedDB';
import { OwnerOperationNearClient } from '@/core/rpcClients/near/NearClient';
import {
  nearAccountRefFromAccountId,
  toWalletId,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { isUserCancelledUserConfirm } from '@/core/signingEngine/stepUpConfirmation/channel/confirmCommon';
import { type SigningFlowEvent } from '@/core/types/sdkSentEvents';
import { sendTransaction } from '@/SeamsWeb/operations/near/actions';
import type { SeamsWebContext } from '@/SeamsWeb/signingSurface/types';
import { alphabetizeStringify, sha256HexUtf8 } from '@shared/utils/digests';
import { safeErrorMessage } from '@shared/utils/errors';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import type { ReadonlyExclusiveUnion, Variant } from '@shared/utils/variant';
import {
  parseOwnerNearOutcome,
  parseOwnerNearRecovery,
  type OwnerNearCommand,
  type OwnerNearOutcome,
  type OwnerNearRecovery,
} from '../shared/ownerNearOperation';
import type { HostedExternalAuth } from './externalAuth';

type OwnerNearPorts = {
  readonly getContext: () => SeamsWebContext;
  readonly captureConnection: HostedExternalAuth['captureOwnerOperation'];
  readonly parentOrigin: string;
};

type SettledOwnerNearOutcome = Variant<
  OwnerNearOutcome,
  'kind',
  'completed' | 'reverted' | 'cancelled' | 'expired' | 'not_submitted'
>;

type OwnerNearReceipt = Readonly<{
  binding: string;
  requestDigest: string;
}> &
  ReadonlyExclusiveUnion<
    | { readonly kind: 'approving' }
    | { readonly kind: 'submitting'; readonly transactionId: string }
    | { readonly kind: 'settled'; readonly outcome: SettledOwnerNearOutcome }
  >;

export async function runOwnerNearOperation(
  ports: OwnerNearPorts,
  command: OwnerNearCommand,
  assertActive: () => void,
  onEvent: (event: SigningFlowEvent) => void,
  onSubmission: (transactionId: string) => void,
): Promise<OwnerNearOutcome> {
  let assertConnection: () => void;
  try {
    assertConnection = await ports.captureConnection(command.authentication);
    assertActive();
  } catch (error) {
    return admissionFailure(command, error);
  }
  const context = ports.getContext();
  const locks = globalThis.navigator.locks;
  if (!locks) {
    return admissionFailure(command, new Error('This browser cannot coordinate owner operations.'));
  }
  const binding = await sha256HexUtf8(
    alphabetizeStringify({
      walletId: command.authentication.walletId,
      associationId: command.authentication.associationId,
      environmentId: command.authentication.environmentId,
      nearAccountId: command.recovery.nearAccountId,
      parentOrigin: ports.parentOrigin,
      nearRpcUrl: resolvePrimaryNearRpcUrl(context.configs.network.chains),
    }),
  );
  const operation = new HostedOwnerNearOperation(
    context,
    command,
    binding,
    assertConnection,
    assertActive,
    onEvent,
    onSubmission,
  );
  return await locks.request(`seams:owner-near:${binding}`, operation.run.bind(operation));
}

class HostedOwnerNearOperation {
  private readonly key: string;
  private readonly pendingKey: string;
  private readonly broadcastContext: SeamsWebContext;
  private submission: ReadonlyExclusiveUnion<
    { kind: 'not_started' } | { kind: 'dispatched'; transactionId: string }
  > = { kind: 'not_started' };

  constructor(
    private readonly context: SeamsWebContext,
    private readonly command: OwnerNearCommand,
    private readonly binding: string,
    private readonly assertConnection: () => void,
    private readonly assertActive: () => void,
    private readonly onEvent: (event: SigningFlowEvent) => void,
    private readonly onSubmission: (transactionId: string) => void,
  ) {
    this.broadcastContext = {
      signingEngine: context.signingEngine,
      configs: context.configs,
      theme: context.theme,
      nearClient: new OwnerOperationNearClient(
        resolvePrimaryNearRpcUrl(context.configs.network.chains),
      ),
    };
    this.key = `owner-near:${command.recovery.operationId}`;
    this.pendingKey = `owner-near-pending:${binding}`;
  }

  assertCurrent(): void {
    this.assertActive();
    this.assertConnection();
    if (this.command.action === 'approve' && this.command.expiresAtMs <= Date.now()) {
      throw new OwnerNearExpired();
    }
  }

  async run(): Promise<OwnerNearOutcome> {
    try {
      return await this.execute();
    } catch (error) {
      if (this.submission.kind === 'dispatched')
        return unresolved(this.command.recovery, this.submission.transactionId, error);
      return recoveryUnavailable(this.command.recovery, error);
    }
  }

  private async execute(): Promise<OwnerNearOutcome> {
    const stored = await IndexedDBManager.getAppState(this.key);
    const receipt = stored === undefined ? null : parseReceipt(stored);
    if (receipt && receipt.binding !== this.binding)
      throw new Error('The owner operation belongs to another connection.');
    if (this.command.action === 'recover') return await this.recover(receipt);
    const pending = await this.readPending();
    if (pending && pending.operationId !== this.command.recovery.operationId) {
      return await this.pendingOutcome(pending);
    }
    const command = this.command;
    if (command.expiresAtMs > Date.now() + 120_000)
      throw new Error('The owner operation deadline is too long.');
    const requestDigest = await sha256HexUtf8(alphabetizeStringify(command.transaction));
    if (receipt) {
      if (receipt.requestDigest !== requestDigest)
        throw new Error('The owner operation contents changed.');
      return await this.recover(receipt);
    }
    await this.store({ kind: 'approving', binding: this.binding, requestDigest });
    let outcome: SettledOwnerNearOutcome;
    try {
      this.assertCurrent();
      const session = await this.context.signingEngine.signNearOwnerTransaction(
        command,
        this.assertCurrent.bind(this),
        this.onEvent,
      );
      this.assertCurrent();
      // Persist the hash before the first broadcast. Recovery only reads this transaction.
      await this.store({
        kind: 'submitting',
        binding: this.binding,
        requestDigest,
        transactionId: session.signedTransaction.transactionHash,
      });
      await IndexedDBManager.setAppState(this.pendingKey, {
        kind: 'pending',
        recovery: command.recovery,
      });
      this.assertCurrent();
      this.submission = {
        kind: 'dispatched',
        transactionId: session.signedTransaction.transactionHash,
      };
      try {
        this.onSubmission(session.signedTransaction.transactionHash);
      } catch {}
      const result = await sendTransaction({
        context: this.broadcastContext,
        walletSession: {
          walletId: toWalletId(command.authentication.walletId),
          walletSessionUserId: String(command.authentication.walletId),
        },
        nearAccountId: nearAccountRefFromAccountId(command.recovery.nearAccountId).accountId,
        signedTransaction: session.signedTransaction,
        options: { onEvent: this.onEvent },
      });
      if (!result.success) {
        if (result.kind !== 'not_submitted')
          return unresolved(
            command.recovery,
            session.signedTransaction.transactionHash,
            result.error,
          );
        outcome = { kind: 'not_submitted', error: result.error };
      } else {
        outcome = { kind: 'completed', result };
      }
    } catch (error) {
      if (this.submission.kind === 'dispatched')
        return unresolved(command.recovery, this.submission.transactionId, error);
      if (error instanceof OwnerNearExpired) outcome = { kind: 'expired' };
      else if (isUserCancelledUserConfirm(error)) outcome = { kind: 'cancelled' };
      else
        outcome = {
          kind: 'not_submitted',
          error:
            safeErrorMessage(error).trim() || 'The owner operation did not submit a transaction.',
        };
    }
    await this.store({ kind: 'settled', binding: this.binding, requestDigest, outcome });
    await this.clearPending();
    return outcome;
  }

  private async pendingOutcome(recovery: OwnerNearRecovery): Promise<OwnerNearOutcome> {
    try {
      this.assertActive();
      this.assertConnection();
      const raw = await IndexedDBManager.getAppState(`owner-near:${recovery.operationId}`);
      if (raw === undefined)
        return recoveryUnavailable(recovery, 'The pending operation receipt is missing.');
      const receipt = parseReceipt(raw);
      if (receipt.binding !== this.binding)
        throw new Error('The pending operation belongs to another connection.');
      if (receipt.kind === 'submitting') {
        return unresolved(
          recovery,
          receipt.transactionId,
          'A previous transaction requires recovery.',
        );
      }
      if (receipt.kind === 'settled') {
        if (receipt.outcome.kind === 'completed')
          return unresolved(
            recovery,
            receipt.outcome.result.transactionId,
            'Recover the previous transaction result.',
          );
        if (receipt.outcome.kind === 'reverted')
          return unresolved(
            recovery,
            receipt.outcome.transactionId,
            'Recover the previous transaction result.',
          );
      }
      return { kind: 'unknown', recovery };
    } catch (error) {
      return recoveryUnavailable(recovery, error);
    }
  }

  async recover(receipt: OwnerNearReceipt | null): Promise<OwnerNearOutcome> {
    this.assertActive();
    this.assertConnection();
    if (!receipt) {
      return recoveryUnavailable(
        this.command.recovery,
        'The operation receipt is missing. Its submission status is unavailable.',
      );
    }
    if (receipt.kind === 'approving') {
      const outcome: SettledOwnerNearOutcome = {
        kind: 'not_submitted',
        error:
          'This operation did not reach broadcast. Prepare a new operation for another approval.',
      };
      await this.store({
        kind: 'settled',
        binding: receipt.binding,
        requestDigest: receipt.requestDigest,
        outcome,
      });
      await this.clearPending();
      return outcome;
    }
    if (receipt.kind === 'settled') {
      await this.clearPending();
      return receipt.outcome;
    }
    try {
      const result = await this.context.nearClient.txStatus(
        receipt.transactionId,
        String(this.command.recovery.nearAccountId),
      );
      if (result.transaction.hash !== receipt.transactionId)
        throw new Error('Transaction recovery identity mismatch.');
      if (result.final_execution_status !== 'FINAL' || typeof result.status !== 'object')
        return unresolved(
          this.command.recovery,
          receipt.transactionId,
          'The transaction is not final. Check this transaction again.',
        );
      const outcome: SettledOwnerNearOutcome =
        'Failure' in result.status
          ? {
              kind: 'reverted',
              transactionId: receipt.transactionId,
              error: 'The transaction failed on NEAR.',
            }
          : {
              kind: 'completed',
              result: { success: true, transactionId: receipt.transactionId, result },
            };
      await this.store({
        kind: 'settled',
        binding: receipt.binding,
        requestDigest: receipt.requestDigest,
        outcome,
      });
      await this.clearPending();
      return outcome;
    } catch (error) {
      return unresolved(this.command.recovery, receipt.transactionId, error);
    }
  }

  async store(receipt: OwnerNearReceipt): Promise<void> {
    await IndexedDBManager.setAppState(this.key, receipt);
  }

  async readPending(): Promise<OwnerNearRecovery | null> {
    const raw = await IndexedDBManager.getAppState(this.pendingKey);
    if (raw === undefined) return null;
    const value = requireRecord(raw, 'pending owner transaction');
    if (value.kind === 'clear') return null;
    if (value.kind !== 'pending') throw new Error('Invalid pending owner transaction.');
    return parseOwnerNearRecovery(value.recovery);
  }

  async clearPending(): Promise<void> {
    try {
      const pending = await this.readPending();
      if (pending?.operationId === this.command.recovery.operationId) {
        await IndexedDBManager.setAppState(this.pendingKey, { kind: 'clear' });
      }
    } catch {
      // The durable terminal receipt remains authoritative. A later recovery can retry cleanup.
    }
  }
}

function parseReceipt(raw: unknown): OwnerNearReceipt {
  const value = requireRecord(raw, 'owner transaction receipt');
  const binding = requireCanonicalString(value.binding, 'binding');
  const requestDigest = requireCanonicalString(value.requestDigest, 'requestDigest');
  switch (value.kind) {
    case 'approving':
      return { kind: 'approving', binding, requestDigest };
    case 'submitting':
      return {
        kind: 'submitting',
        binding,
        requestDigest,
        transactionId: requireCanonicalString(value.transactionId, 'transactionId'),
      };
    case 'settled':
      return {
        kind: 'settled',
        binding,
        requestDigest,
        outcome: parseSettledOutcome(value.outcome),
      };
    default:
      throw new Error('Invalid owner transaction receipt.');
  }
}

function parseSettledOutcome(raw: unknown): SettledOwnerNearOutcome {
  const stored = requireRecord(raw, 'settled owner outcome');
  // Persisted failures predate the explicit non-submission outcome. Only settled
  // receipts used this branch, after the host proved that no broadcast occurred.
  const outcome =
    stored.kind === 'failed'
      ? parseOwnerNearOutcome({ kind: 'not_submitted', error: stored.error })
      : parseOwnerNearOutcome(stored);
  switch (outcome.kind) {
    case 'completed':
    case 'reverted':
    case 'cancelled':
    case 'expired':
    case 'not_submitted':
      return outcome;
    case 'unknown':
    case 'unresolved':
    case 'recovery_unavailable':
      throw new Error('A settled owner receipt requires a terminal outcome.');
    default:
      return assertNeverOutcome(outcome);
  }
}

function assertNeverOutcome(outcome: never): never {
  throw new Error(`Unsupported owner outcome: ${String(outcome)}`);
}

function admissionFailure(command: OwnerNearCommand, error: unknown): OwnerNearOutcome {
  if (command.action === 'recover') return recoveryUnavailable(command.recovery, error);
  if (isUserCancelledUserConfirm(error)) return { kind: 'cancelled' };
  return {
    kind: 'not_submitted',
    error: safeErrorMessage(error).trim() || 'The owner operation did not submit a transaction.',
  };
}

function recoveryUnavailable(recovery: OwnerNearRecovery, error: unknown): OwnerNearOutcome {
  return {
    kind: 'recovery_unavailable',
    recovery,
    error: safeErrorMessage(error).trim() || 'The operation recovery is unavailable.',
  };
}

function unresolved(
  recovery: OwnerNearRecovery,
  transactionId: string,
  error: unknown,
): OwnerNearOutcome {
  return {
    kind: 'unresolved',
    recovery,
    transactionId,
    error: safeErrorMessage(error).trim() || 'The transaction outcome is unavailable.',
  };
}

class OwnerNearExpired extends Error {
  constructor() {
    super('The owner operation expired.');
  }
}

import { parseNearSigningFailureCause, type NearSigningFailureCause } from '@shared/near/signingFailure';
import {
  SigningSessionIds,
  type SigningOperationId,
} from '@/core/signingEngine/session/operationState/types';
import { parseWalletId, type WalletId } from '@shared/utils/domainIds';
import { parseNearTransactionResult } from '@/core/signingEngine/nearTransactionSubmission';
import {
  parseNearTransactionRejection,
  type NearTransactionRejection,
} from '@/core/rpcClients/near/nearTransactionRejection';
import { toAccountId, type AccountId } from '@/core/types/accountIds';
import { ActionType, type ActionArgsWasm, type TransactionInputWasm } from '@/core/types/actions';
import type { ActionResult } from '@/core/types/seams';
import {
  parseExternalWalletAuthentication,
  type ExternalWalletAuthentication,
} from '@shared/auth/externalAuth';
import {
  parseThresholdEd25519NearTransaction,
  type ThresholdEd25519NearAction,
} from '@shared/threshold/ed25519OperationFingerprint';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import type { ReadonlyExclusiveUnion, Variant } from '@shared/utils/variant';

export type OwnerNearRecovery = Readonly<{
  operationId: SigningOperationId;
  walletId: WalletId;
  nearAccountId: AccountId;
}>;

export type OwnerNearCommand = Readonly<{
  authentication: ExternalWalletAuthentication;
  recovery: OwnerNearRecovery;
}> &
  ReadonlyExclusiveUnion<
    | { action: 'approve'; transaction: TransactionInputWasm; expiresAtMs: number }
    | { action: 'recover' }
    | { action: 'retire'; transactionId: string }
    // The owner signs a 0-NEAR transfer to the account itself at the same key and nonce.
    | { action: 'cancel_submitted'; transactionId: string }
  >;

/** What the wallet knows about a submitted transaction from its durable receipt. */
export type OwnerNearSubmissionEvidence = ReadonlyExclusiveUnion<
  | {
      kind: 'signed';
      signerPublicKey: string;
      signedNonce: string;
      referenceBlockHash: string;
      referenceBlockHeight: number;
    }
  | {
      // Older receipts keep only the hash. The reference block cannot be newer than this
      // first observation, because the receipt already held the signed transaction's hash.
      kind: 'hash_only';
      firstObservedBlockHeight: number;
    }
>;

type OwnerNearChainPosition = Readonly<{
  finalBlockHeight: number;
  finalBlockHash: string;
  /**
   * NEAR cannot accept the transaction after this block. It includes a safety margin.
   * For `hash_only` evidence it is a safety limit from the first observation, and the
   * transaction's own validity can end much earlier.
   */
  lastAcceptedBlockHeight: number;
}>;

/**
 * The transaction is still inside its validity limit. After `lastAcceptedBlockHeight`,
 * another `recover()` can end the operation or offer `retire()`. Nothing ends by itself.
 */
export type OwnerNearRetirementWait = Pick<
  OwnerNearChainPosition,
  'finalBlockHeight' | 'lastAcceptedBlockHeight'
> &
  Readonly<{ submission: OwnerNearSubmissionEvidence }>;

/** The transaction expired, and a finalized nonce shows that it never executed. */
export type OwnerNearNotExecutedProof = OwnerNearChainPosition &
  Readonly<{
    execution: 'not_executed';
    submission: Variant<OwnerNearSubmissionEvidence, 'kind', 'signed'>;
    accessKeyNonce: string;
  }>;

/** The transaction expired, but the chain facts cannot show whether it executed first. */
export type OwnerNearUnverifiedExecutionProof = OwnerNearChainPosition &
  Readonly<{
    execution: 'unverified';
    submission: OwnerNearSubmissionEvidence;
    /** `null` means the wallet has no nonce to compare, or the access key no longer exists. */
    accessKeyNonce: string | null;
  }>;

export type OwnerNearRetirementApproval = Readonly<{
  credentialIdB64u: string;
  challengeB64u: string;
  approvedAtMs: number;
}>;

/**
 * The owner's cancel is final on NEAR. It used the same access key and nonce, and NEAR
 * includes one transaction per nonce of a key, so the cancelled transaction never executed
 * and never can. This proof rests on the cancel's own final outcome, never on a missing hash.
 */
export type OwnerNearReplacementProof = Readonly<{
  execution: 'not_executed';
  submission: Variant<OwnerNearSubmissionEvidence, 'kind', 'signed'>;
  replacement: Readonly<{
    transactionId: string;
    /** A cancel takes the nonce whether its transfer succeeded or failed. */
    status: 'succeeded' | 'failed';
  }>;
}>;

export type OwnerNearRetirementProof =
  | OwnerNearNotExecutedProof
  | OwnerNearReplacementProof
  | (OwnerNearUnverifiedExecutionProof & Readonly<{ ownerApproval: OwnerNearRetirementApproval }>);

export type OwnerNearOutcome = ReadonlyExclusiveUnion<
  | { kind: 'completed'; result: Extract<ActionResult, { success: true }> }
  | { kind: 'reverted'; transactionId: string; error: string }
  | { kind: 'cancelled' }
  | { kind: 'expired' }
  | { kind: 'unknown'; recovery: OwnerNearRecovery }
  | {
      kind: 'unresolved';
      recovery: OwnerNearRecovery;
      transactionId: string;
      error: string;
      /** Absent when this check reached no validity limit, such as after an RPC failure. */
      retirementWait?: OwnerNearRetirementWait;
      /**
       * NEAR refused the transaction when it was sent, for a reason that depends on chain
       * state, such as `NotEnoughBalance`. A rejection alone never proves non-execution.
       */
      rejection?: NearTransactionRejection;
      /** NEAR refused the owner's cancel, such as `NotEnoughBalance`. The person can add NEAR and cancel again. */
      cancellationRejection?: NearTransactionRejection;
    }
  | {
      kind: 'not_submitted';
      error: string;
      cause: NearSigningFailureCause;
      /** NEAR refused the signed bytes themselves, so it can never include them. */
      rejection?: NearTransactionRejection;
      /** The account could not pay, so the wallet did not sign. Amounts are yoctoNEAR. */
      shortfall?: OwnerNearShortfall;
    }
  | { kind: 'recovery_unavailable'; recovery: OwnerNearRecovery; error: string }
  | {
      kind: 'retirement_available';
      recovery: OwnerNearRecovery;
      transactionId: string;
      proof: OwnerNearUnverifiedExecutionProof;
    }
  | {
      kind: 'retired';
      recovery: OwnerNearRecovery;
      transactionId: string;
      proof: OwnerNearRetirementProof;
    }
>;

export function parseOwnerNearRecovery(raw: unknown): OwnerNearRecovery {
  const value = requireRecord(raw, 'owner operation recovery');
  const operationId = requireCanonicalString(value.operationId, 'operationId');
  if (!/^owner-near:[A-Za-z0-9_-]{32,64}$/.test(operationId))
    throw new Error('Invalid owner operation ID.');
  const walletId = parseWalletId(value.walletId);
  if (!walletId.ok) throw new Error('Invalid owner operation wallet.');
  return {
    operationId: SigningSessionIds.signingOperation(operationId),
    walletId: walletId.value,
    nearAccountId: toAccountId(requireCanonicalString(value.nearAccountId, 'nearAccountId')),
  };
}

export function parseOwnerNearCommand(raw: unknown): OwnerNearCommand {
  const value = requireRecord(raw, 'owner operation command');
  const authentication = parseExternalWalletAuthentication(value.authentication);
  const recovery = parseOwnerNearRecovery(value.recovery);
  if (recovery.walletId !== String(authentication.walletId))
    throw new Error('Owner operation wallet mismatch.');
  switch (value.action) {
    case 'recover':
      return { action: 'recover', authentication, recovery };
    case 'retire':
    case 'cancel_submitted':
      return {
        action: value.action,
        authentication,
        recovery,
        transactionId: requireCanonicalString(value.transactionId, 'transactionId'),
      };
    case 'approve': {
      const rawTransaction = requireRecord(value.transaction, 'transaction');
      const transaction = parseThresholdEd25519NearTransaction(
        {
          nearAccountId: recovery.nearAccountId,
          receiverId: rawTransaction.receiverId,
          actions: rawTransaction.actions,
        },
        'transaction',
      );
      if (transaction.nearAccountId !== String(recovery.nearAccountId))
        throw new Error('Owner operation account mismatch.');
      const expiresAtMs = value.expiresAtMs;
      if (typeof expiresAtMs !== 'number' || !Number.isSafeInteger(expiresAtMs) || expiresAtMs <= 0)
        throw new Error('Invalid owner operation expiry.');
      return {
        action: 'approve',
        authentication,
        recovery,
        expiresAtMs,
        transaction: {
          receiverId: transaction.receiverId,
          actions: transaction.actions.map(ownerNearAction),
        },
      };
    }
    default:
      throw new Error('Invalid owner operation action.');
  }
}

export function parseOwnerNearOutcome(raw: unknown): OwnerNearOutcome {
  const value = requireRecord(raw, 'owner operation outcome');
  switch (value.kind) {
    case 'completed': {
      const result = parseNearTransactionResult(value.result);
      if (!result.success)
        throw new Error('A completed owner operation requires a successful transaction.');
      return { kind: 'completed', result };
    }
    case 'reverted':
      return {
        kind: 'reverted',
        transactionId: requireCanonicalString(value.transactionId, 'transactionId'),
        error: requireCanonicalString(value.error, 'error'),
      };
    case 'cancelled':
      return { kind: 'cancelled' };
    case 'expired':
      return { kind: 'expired' };
    case 'not_submitted':
      return {
        kind: 'not_submitted',
        error: requireCanonicalString(value.error, 'error'),
        cause: parseNearSigningFailureCause(value.cause),
        ...optionalRejection(value.rejection),
        ...(value.shortfall === undefined ? {} : { shortfall: parseShortfall(value.shortfall) }),
      };
    case 'recovery_unavailable':
      return {
        kind: 'recovery_unavailable',
        recovery: parseOwnerNearRecovery(value.recovery),
        error: requireCanonicalString(value.error, 'error'),
      };
    case 'unresolved':
      return {
        kind: 'unresolved',
        recovery: parseOwnerNearRecovery(value.recovery),
        transactionId: requireCanonicalString(value.transactionId, 'transactionId'),
        error: requireCanonicalString(value.error, 'error'),
        ...(value.retirementWait === undefined
          ? {}
          : { retirementWait: parseRetirementWait(value.retirementWait) }),
        ...optionalRejection(value.rejection),
        ...(value.cancellationRejection === undefined
          ? {}
          : { cancellationRejection: parseNearTransactionRejection(value.cancellationRejection) }),
      };
    case 'unknown':
      return { kind: 'unknown', recovery: parseOwnerNearRecovery(value.recovery) };
    case 'retirement_available': {
      const proof = parseRetirementProof(value.proof);
      if (proof.execution !== 'unverified' || proof.ownerApproval)
        throw new Error('An available retirement requires unverified execution.');
      return {
        kind: 'retirement_available',
        recovery: parseOwnerNearRecovery(value.recovery),
        transactionId: requireCanonicalString(value.transactionId, 'transactionId'),
        proof,
      };
    }
    case 'retired': {
      const proof = parseRetirementProof(value.proof);
      if (proof.execution === 'unverified' && !proof.ownerApproval)
        throw new Error('A retirement with unverified execution requires owner approval.');
      return {
        kind: 'retired',
        recovery: parseOwnerNearRecovery(value.recovery),
        transactionId: requireCanonicalString(value.transactionId, 'transactionId'),
        proof: proof as OwnerNearRetirementProof,
      };
    }
    default:
      throw new Error('Invalid owner operation outcome.');
  }
}

export function parseOwnerNearSubmissionEvidence(raw: unknown): OwnerNearSubmissionEvidence {
  const value = requireRecord(raw, 'owner submission evidence');
  switch (value.kind) {
    case 'signed':
      return {
        kind: 'signed',
        signerPublicKey: requireCanonicalString(value.signerPublicKey, 'signerPublicKey'),
        signedNonce: requireDecimalString(value.signedNonce, 'signedNonce'),
        referenceBlockHash: requireCanonicalString(value.referenceBlockHash, 'referenceBlockHash'),
        referenceBlockHeight: requirePositiveInteger(value.referenceBlockHeight, 'referenceBlockHeight'),
      };
    case 'hash_only':
      return {
        kind: 'hash_only',
        firstObservedBlockHeight: requirePositiveInteger(
          value.firstObservedBlockHeight,
          'firstObservedBlockHeight',
        ),
      };
    default:
      throw new Error('Invalid owner submission evidence.');
  }
}

export type OwnerNearShortfall = Readonly<{
  balance: string;
  /** Deposits plus all prepaid gas and fees at the current gas price. */
  maximumCost: string;
  /** The balance that the account's storage keeps locked. */
  storageReserve: string;
}>;

function parseShortfall(raw: unknown): OwnerNearShortfall {
  const value = requireRecord(raw, 'owner operation shortfall');
  return {
    balance: requireDecimalString(value.balance, 'balance'),
    maximumCost: requireDecimalString(value.maximumCost, 'maximumCost'),
    storageReserve: requireDecimalString(value.storageReserve, 'storageReserve'),
  };
}

function optionalRejection(raw: unknown): { rejection?: NearTransactionRejection } {
  return raw === undefined ? {} : { rejection: parseNearTransactionRejection(raw) };
}

function parseRetirementWait(raw: unknown): OwnerNearRetirementWait {
  const value = requireRecord(raw, 'owner retirement wait');
  return {
    finalBlockHeight: requirePositiveInteger(value.finalBlockHeight, 'finalBlockHeight'),
    lastAcceptedBlockHeight: requirePositiveInteger(
      value.lastAcceptedBlockHeight,
      'lastAcceptedBlockHeight',
    ),
    submission: parseOwnerNearSubmissionEvidence(value.submission),
  };
}

type ParsedRetirementProof =
  | OwnerNearNotExecutedProof
  | OwnerNearReplacementProof
  | (OwnerNearUnverifiedExecutionProof &
      Readonly<{ ownerApproval?: OwnerNearRetirementApproval }>);

function parseRetirementProof(raw: unknown): ParsedRetirementProof {
  const value = requireRecord(raw, 'owner retirement proof');
  if (value.replacement !== undefined) {
    const submission = parseOwnerNearSubmissionEvidence(value.submission);
    const replacement = requireRecord(value.replacement, 'owner cancel');
    if (
      value.execution !== 'not_executed' ||
      submission.kind !== 'signed' ||
      (replacement.status !== 'succeeded' && replacement.status !== 'failed')
    )
      throw new Error('Invalid owner cancel proof.');
    return {
      execution: 'not_executed',
      submission,
      replacement: {
        transactionId: requireCanonicalString(replacement.transactionId, 'transactionId'),
        status: replacement.status,
      },
    };
  }
  const position: OwnerNearChainPosition = {
    finalBlockHeight: requirePositiveInteger(value.finalBlockHeight, 'finalBlockHeight'),
    finalBlockHash: requireCanonicalString(value.finalBlockHash, 'finalBlockHash'),
    lastAcceptedBlockHeight: requirePositiveInteger(
      value.lastAcceptedBlockHeight,
      'lastAcceptedBlockHeight',
    ),
  };
  const submission = parseOwnerNearSubmissionEvidence(value.submission);
  if (value.execution === 'not_executed') {
    if (submission.kind !== 'signed') throw new Error('A nonce proof requires signed evidence.');
    return {
      ...position,
      execution: 'not_executed',
      submission,
      accessKeyNonce: requireDecimalString(value.accessKeyNonce, 'accessKeyNonce'),
    };
  }
  if (value.execution !== 'unverified') throw new Error('Invalid owner retirement proof.');
  const proof: OwnerNearUnverifiedExecutionProof = {
    ...position,
    execution: 'unverified',
    submission,
    accessKeyNonce:
      value.accessKeyNonce === null
        ? null
        : requireDecimalString(value.accessKeyNonce, 'accessKeyNonce'),
  };
  if (value.ownerApproval === undefined) return proof;
  const approval = requireRecord(value.ownerApproval, 'owner retirement approval');
  return {
    ...proof,
    ownerApproval: {
      credentialIdB64u: requireCanonicalString(approval.credentialIdB64u, 'credentialIdB64u'),
      challengeB64u: requireCanonicalString(approval.challengeB64u, 'challengeB64u'),
      approvedAtMs: requirePositiveInteger(approval.approvedAtMs, 'approvedAtMs'),
    },
  };
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new Error(`Invalid ${label}.`);
  return value;
}

function requireDecimalString(value: unknown, label: string): string {
  const text = requireCanonicalString(value, label);
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error(`Invalid ${label}.`);
  return text;
}

function ownerNearAction(action: ThresholdEd25519NearAction): ActionArgsWasm {
  switch (action.action_type) {
    case 'CreateAccount':
      return { action_type: ActionType.CreateAccount };
    case 'DeployContract':
      return { action_type: ActionType.DeployContract, code: [...action.code] };
    case 'FunctionCall':
      return {
        action_type: ActionType.FunctionCall,
        method_name: action.method_name,
        args: action.args,
        gas: action.gas,
        deposit: action.deposit,
      };
    case 'Transfer':
      return { action_type: ActionType.Transfer, deposit: action.deposit };
    case 'Stake':
      return { action_type: ActionType.Stake, stake: action.stake, public_key: action.public_key };
    case 'AddKey':
      return {
        action_type: ActionType.AddKey,
        public_key: action.public_key,
        access_key: action.access_key,
      };
    case 'DeleteKey':
      return { action_type: ActionType.DeleteKey, public_key: action.public_key };
    case 'DeleteAccount':
      return { action_type: ActionType.DeleteAccount, beneficiary_id: action.beneficiary_id };
    case 'DeployGlobalContract':
      return {
        action_type: ActionType.DeployGlobalContract,
        code: [...action.code],
        deploy_mode: action.deploy_mode,
      };
    case 'UseGlobalContract':
      if (action.account_id !== undefined)
        return { action_type: ActionType.UseGlobalContract, account_id: action.account_id };
      return { action_type: ActionType.UseGlobalContract, code_hash: action.code_hash };
    case 'SignedDelegate':
      throw new Error('Use the delegate API for delegated actions.');
    default:
      action satisfies never;
      throw new Error('Unsupported owner transaction action.');
  }
}

export type OwnerNearSubmissionProgress = Readonly<{
  event: 'owner_near_submitting';
  operationId: SigningOperationId;
  transactionId: string;
}>;

export function parseOwnerNearSubmissionProgress(raw: unknown): OwnerNearSubmissionProgress | null {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Reflect.get(raw, 'event') !== 'owner_near_submitting'
  )
    return null;
  const operationId = Reflect.get(raw, 'operationId');
  if (typeof operationId !== 'string' || !/^owner-near:[A-Za-z0-9_-]{32,64}$/.test(operationId))
    return null;
  return {
    event: 'owner_near_submitting',
    operationId: SigningSessionIds.signingOperation(operationId),
    transactionId: requireCanonicalString(Reflect.get(raw, 'transactionId'), 'transactionId'),
  };
}

import { resolveNearNetwork, resolvePrimaryNearRpcUrl } from '@/core/config/chains';
import { IndexedDBManager } from '@/core/indexedDB';
import { OwnerOperationNearClient } from '@/core/rpcClients/near/NearClient';
import { NearRpcError } from '@/core/rpcClients/near/NearRpcError';
import {
  parseNearTransactionRejection,
  type NearTransactionRejection,
} from '@/core/rpcClients/near/nearTransactionRejection';
import {
  nearAccountRefFromAccountId,
  toWalletId,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { isUserCancelledUserConfirm } from '@/core/signingEngine/stepUpConfirmation/channel/confirmCommon';
import { SigningEventPhase, type SigningFlowEvent } from '@/core/types/sdkSentEvents';
import { ActionType, type TransactionInputWasm } from '@/core/types/actions';
import { SigningSessionIds } from '@/core/signingEngine/session/operationState/types';
import { NearReplacementNonceUsedError } from '@/core/signingEngine/nonce/NonceCoordinator';
import { sendTransaction } from '@/SeamsWeb/operations/near/actions';
import { emitNearSigningEvent } from '@/SeamsWeb/operations/near/signingEventHelpers';
import { resolveOwnerPasskeyAuthority } from '@/SeamsWeb/signingSurface/nearOwnerOperation';
import type { SeamsWebContext } from '@/SeamsWeb/signingSurface/types';
import { base64UrlEncode } from '@shared/utils/base64';
import { alphabetizeStringify, sha256HexUtf8 } from '@shared/utils/digests';
import { safeErrorMessage } from '@shared/utils/errors';
import type { FinalExecutionOutcome } from '@near-js/types';
import { secureRandomBase64Url } from '@shared/utils/secureRandomId';
import { requireCanonicalString, requireRecord } from '@shared/utils/validation';
import type { ReadonlyExclusiveUnion, Variant } from '@shared/utils/variant';
import {
  parseOwnerNearOutcome,
  parseOwnerNearRecovery,
  parseOwnerNearSubmissionEvidence,
  type OwnerNearCommand,
  type OwnerNearOutcome,
  type OwnerNearRecovery,
  type OwnerNearRetirementApproval,
  type OwnerNearShortfall,
  type OwnerNearSubmissionEvidence,
} from '../shared/ownerNearOperation';
import { ownerNearOutcomeBeforeSigning } from '../shared/transactionReview';
import type { HostedExternalAuth } from './externalAuth';
import { approveWithOwnerPasskey, ExternalOwnerApprovalError } from './externalOwnerApproval';
import { ownerNearSignedEvidence } from './ownerNearSignedEvidence';
import { ownerNearShortfall } from './ownerNearAffordability';
import { startReviewTiming } from '../shared/reviewTiming';
import { resolveNearTokenMetadata } from '@/core/signingEngine/chains/near/tokenTransfers';

type OwnerNearPorts = {
  readonly getContext: () => SeamsWebContext;
  readonly captureConnection: HostedExternalAuth['captureOwnerOperation'];
  readonly parentOrigin: string;
};

type SettledOwnerNearOutcome = Variant<
  OwnerNearOutcome,
  'kind',
  'completed' | 'reverted' | 'cancelled' | 'expired' | 'not_submitted' | 'retired'
>;

type SignedEvidence = Variant<OwnerNearSubmissionEvidence, 'kind', 'signed'>;

/** What the wallet signed, without call arguments, so a stuck operation can be diagnosed. */
type OwnerNearSignedSummary = Readonly<{
  receiverId: string;
  actions: readonly Readonly<{
    type: string;
    methodName?: string;
    gas?: string;
    deposit?: string;
  }>[];
}>;

type OwnerNearReceipt = Readonly<{
  binding: string;
  requestDigest: string;
  /** Absent in receipts from SDK 0.45.0 and earlier. */
  signed?: OwnerNearSignedSummary;
}> &
  ReadonlyExclusiveUnion<
    | { readonly kind: 'approving' }
    // Signed but not handed to broadcast. The signed bytes exist only in this operation's memory.
    | { readonly kind: 'signed'; readonly transactionId: string; readonly evidence: SignedEvidence }
    // Handed to broadcast. `null` marks a hash-only receipt that recovery has not observed yet.
    | {
        readonly kind: 'submitting';
        readonly transactionId: string;
        readonly evidence: OwnerNearSubmissionEvidence | null;
        /** NEAR refused the broadcast for a state-dependent reason; later checks report it. */
        readonly rejection?: NearTransactionRejection;
        /** The owner's cancel at the same key and nonce, persisted before its broadcast. */
        readonly replacement?: Readonly<{ transactionId: string; evidence: SignedEvidence }>;
      }
    | { readonly kind: 'settled'; readonly outcome: SettledOwnerNearOutcome }
  >;

type SubmittingReceipt = Variant<OwnerNearReceipt, 'kind', 'submitting'>;

// About one hour of blocks. A lagging RPC can understate the first observation of a
// hash-only receipt, and a transaction can reach a block just after its validity check.
const RETIREMENT_MARGIN_BLOCKS = 3_600;
const RETIREMENT_APPROVAL_MS = 120_000;
const OWNER_CANCEL_APPROVAL_MS = 120_000;

export async function runOwnerNearOperation(
  ports: OwnerNearPorts,
  command: OwnerNearCommand,
  assertActive: () => void,
  onEvent: (event: SigningFlowEvent) => void,
  onSubmission: (transactionId: string) => void,
): Promise<OwnerNearOutcome> {
  const context = ports.getContext();
  const nearClient = new OwnerOperationNearClient(
    resolvePrimaryNearRpcUrl(context.configs.network.chains),
  );
  // The cost check reads only public chain state, so it runs while the connection check
  // runs. Its result is used at the same step as before, after the operation lock.
  const affordability =
    command.action === 'approve'
      ? ownerNearShortfall(nearClient, String(command.recovery.nearAccountId), command.transaction)
      : null;
  affordability?.catch(ignoreEarlyAffordabilityFailure);
  if (command.action === 'approve') {
    // The card waits for token metadata. This lookup is shared with the card's own lookup.
    void resolveNearTokenMetadata({
      nearClient,
      network: resolveNearNetwork(context.configs.network.chains),
      txSigningRequests: [command.transaction],
    });
  }
  let assertConnection: () => void;
  const connectionCheck = startReviewTiming('owner_connection_check');
  try {
    assertConnection = await ports.captureConnection(command.authentication);
    assertActive();
  } catch (error) {
    return admissionFailure(command, error);
  } finally {
    connectionCheck.end();
  }
  const locks = globalThis.navigator.locks;
  if (!locks) {
    return admissionFailure(command, new Error('This browser cannot coordinate owner operations.'));
  }
  const connection = {
    walletId: command.authentication.walletId,
    associationId: command.authentication.associationId,
    environmentId: command.authentication.environmentId,
    nearAccountId: command.recovery.nearAccountId,
    parentOrigin: ports.parentOrigin,
  };
  const { chains } = context.configs.network;
  const network = resolveNearNetwork(chains);
  // The network names the chain that holds the transaction. Another RPC for that chain
  // must find the same receipt and the same pending guard.
  const binding = await sha256HexUtf8(alphabetizeStringify({ ...connection, network }));
  // SDK 0.40.0 and earlier bound the RPC URL, so only the current URL can match their records.
  const legacyBinding = await sha256HexUtf8(
    alphabetizeStringify({ ...connection, nearRpcUrl: resolvePrimaryNearRpcUrl(chains) }),
  );
  const operation = new HostedOwnerNearOperation(
    context,
    command,
    binding,
    legacyBinding,
    network,
    nearClient,
    affordability,
    assertConnection,
    assertActive,
    onEvent,
    onSubmission,
  );
  return await locks.request(`seams:owner-near:${binding}`, operation.run.bind(operation));
}

/** `execute` awaits the same promise and handles its failure. */
function ignoreEarlyAffordabilityFailure(): void {}

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
    private readonly legacyBinding: string,
    private readonly network: 'testnet' | 'mainnet',
    private readonly nearClient: OwnerOperationNearClient,
    /** The approval's cost check, started before the connection check. */
    private readonly affordability: Promise<OwnerNearShortfall | null> | null,
    private readonly assertConnection: () => void,
    private readonly assertActive: () => void,
    private readonly onEvent: (event: SigningFlowEvent) => void,
    private readonly onSubmission: (transactionId: string) => void,
  ) {
    this.broadcastContext = {
      signingEngine: context.signingEngine,
      configs: context.configs,
      theme: context.theme,
      nearClient: this.nearClient,
    };
    this.key = `owner-near:${command.recovery.operationId}`;
    this.pendingKey = `owner-near-pending:${binding}`;
  }

  assertCurrent(): void {
    this.assertCurrentConnection();
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
    await this.adoptLegacyPending();
    const receipt = await this.readReceipt(this.key);
    if (this.command.action === 'recover') return await this.recover(receipt);
    if (this.command.action === 'retire') return await this.retire(receipt, this.command.transactionId);
    if (this.command.action === 'cancel_submitted')
      return await this.cancelSubmitted(receipt, this.command.transactionId);
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
    let outcome: SettledOwnerNearOutcome;
    try {
      await this.store({ kind: 'approving', binding: this.binding, requestDigest });
      this.assertCurrent();
      const affordabilityWait = startReviewTiming('owner_affordability');
      const shortfall = await (this.affordability ??
        ownerNearShortfall(
          this.nearClient,
          String(command.recovery.nearAccountId),
          command.transaction,
        ));
      affordabilityWait.end();
      if (shortfall) throw new OwnerNearUnaffordable(shortfall);
      this.assertCurrent();
      const signed = signedSummary(command.transaction);
      const session = await this.context.signingEngine.signNearOwnerTransaction(
        command,
        this.assertCurrent.bind(this),
        this.onEvent,
      );
      this.assertCurrent();
      const evidence = await ownerNearSignedEvidence(session);
      // Persist the hash and evidence before the first broadcast. Recovery only reads this
      // transaction, and the `signed` milestone proves that a broadcast never started.
      await this.store({
        kind: 'signed',
        binding: this.binding,
        requestDigest,
        signed,
        transactionId: session.signedTransaction.transactionHash,
        evidence,
      });
      await IndexedDBManager.setAppState(this.pendingKey, {
        kind: 'pending',
        recovery: command.recovery,
      });
      this.assertCurrent();
      await this.store({
        kind: 'submitting',
        binding: this.binding,
        requestDigest,
        signed,
        transactionId: session.signedTransaction.transactionHash,
        evidence,
      });
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
        options: { onEvent: this.broadcastProgress.bind(this), waitUntil: 'FINAL' },
      });
      if (!result.success) {
        const rejection = result.kind === 'unresolved' ? result.rejection : undefined;
        // Invalid signed bytes never reach a block, whatever the account state.
        if (rejection?.permanence === 'permanent') {
          outcome = { kind: 'not_submitted', error: result.error, rejection };
        } else if (result.kind !== 'not_submitted') {
          if (rejection) {
            await this.store({
              kind: 'submitting',
              binding: this.binding,
              requestDigest,
              signed,
              transactionId: session.signedTransaction.transactionHash,
              evidence,
              rejection,
            });
          }
          return {
            kind: 'unresolved',
            recovery: command.recovery,
            transactionId: session.signedTransaction.transactionHash,
            error: result.error,
            ...(rejection ? { rejection } : {}),
          };
        } else {
          outcome = { kind: 'not_submitted', error: result.error };
        }
      } else {
        return await this.settleTransaction(result.transactionId, result.result, requestDigest);
      }
    } catch (error) {
      if (this.submission.kind === 'dispatched')
        return unresolved(command.recovery, this.submission.transactionId, error);
      if (error instanceof OwnerNearExpired) outcome = { kind: 'expired' };
      else if (error instanceof OwnerNearUnaffordable)
        outcome = { kind: 'not_submitted', error: error.message, shortfall: error.shortfall };
      else if (isUserCancelledUserConfirm(error)) outcome = { kind: 'cancelled' };
      else outcome = ownerNearOutcomeBeforeSigning(error);
    }
    return await this.settle({ kind: 'settled', binding: this.binding, requestDigest, outcome });
  }

  private async readReceipt(key: string): Promise<OwnerNearReceipt | null> {
    const stored = await IndexedDBManager.getAppState(key);
    if (stored === undefined) return null;
    const receipt = parseReceipt(stored);
    if (receipt.binding === this.binding) return receipt;
    if (receipt.binding !== this.legacyBinding)
      throw new Error('The owner operation belongs to another connection.');
    const current: OwnerNearReceipt = { ...receipt, binding: this.binding };
    await IndexedDBManager.setAppState(key, current);
    return current;
  }

  /** Another operation's current guard stays first. Its settlement exposes this one. */
  private async adoptLegacyPending(): Promise<void> {
    const legacyKey = `owner-near-pending:${this.legacyBinding}`;
    const legacy = await this.readPending(legacyKey);
    if (!legacy || (await this.readPending())) return;
    await IndexedDBManager.setAppState(this.pendingKey, { kind: 'pending', recovery: legacy });
    await IndexedDBManager.setAppState(legacyKey, { kind: 'clear' });
  }

  private async pendingOutcome(recovery: OwnerNearRecovery): Promise<OwnerNearOutcome> {
    try {
      this.assertActive();
      this.assertConnection();
      const receipt = await this.readReceipt(`owner-near:${recovery.operationId}`);
      if (!receipt)
        return recoveryUnavailable(recovery, 'The pending operation receipt is missing.');
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
    if (receipt.kind === 'approving' || receipt.kind === 'signed') {
      const outcome: SettledOwnerNearOutcome = {
        kind: 'not_submitted',
        error:
          'This operation did not reach broadcast. Prepare a new operation for another approval.',
      };
      return await this.settle({
        kind: 'settled',
        binding: receipt.binding,
        requestDigest: receipt.requestDigest,
        outcome,
      });
    }
    if (receipt.kind === 'settled') {
      await this.clearPending();
      return receipt.outcome;
    }
    this.onSubmission(receipt.transactionId);
    if (receipt.replacement) {
      const cancelled = await this.reconcileReplacement(receipt, receipt.replacement);
      if (cancelled) return cancelled;
    }
    const outcome = await this.reconcile(receipt);
    // A later check still explains why NEAR refused the transaction when it was sent.
    if (outcome.kind === 'unresolved' && receipt.rejection && !outcome.rejection)
      return { ...outcome, rejection: receipt.rejection };
    return outcome;
  }

  private async reconcile(receipt: SubmittingReceipt): Promise<OwnerNearOutcome> {
    try {
      let result: FinalExecutionOutcome;
      try {
        result = await this.nearClient.txStatus(
          receipt.transactionId,
          String(this.command.recovery.nearAccountId),
          'NONE',
        );
      } catch (error) {
        if (error instanceof NearRpcError && error.causeName === 'UNKNOWN_TRANSACTION')
          return await this.assessUnknownTransaction(receipt, error);
        throw error;
      }
      return await this.settleTransaction(receipt.transactionId, result, receipt.requestDigest);
    } catch (error) {
      return unresolved(this.command.recovery, receipt.transactionId, error);
    }
  }

  /**
   * An unknown hash proves nothing by itself. Only chain facts can end the operation:
   * the validity period decides whether NEAR can still accept the transaction, and a
   * finalized nonce below the signed nonce shows that it never executed.
   */
  private async assessUnknownTransaction(
    receipt: SubmittingReceipt,
    unknown: NearRpcError,
  ): Promise<OwnerNearOutcome> {
    const submission = receipt.evidence ?? (await this.observeHashOnlyReceipt(receipt));
    const validity = await this.nearClient.transactionValidity();
    // The binding no longer pins the URL, so block heights must come from the bound chain.
    if (validity.chainId !== this.network)
      throw new Error(`The NEAR RPC serves ${validity.chainId}, not ${this.network}.`);
    const chain = await this.readChainPosition(submission);
    const lastAcceptedBlockHeight =
      (submission.kind === 'signed'
        ? submission.referenceBlockHeight
        : submission.firstObservedBlockHeight) +
      validity.validityPeriod +
      RETIREMENT_MARGIN_BLOCKS;
    if (chain.finalBlockHeight <= lastAcceptedBlockHeight) {
      return {
        kind: 'unresolved',
        recovery: this.command.recovery,
        transactionId: receipt.transactionId,
        error: retirementWaitMessage(unknown, submission, lastAcceptedBlockHeight),
        retirementWait: {
          finalBlockHeight: chain.finalBlockHeight,
          lastAcceptedBlockHeight,
          submission,
        },
      };
    }
    const position = {
      finalBlockHeight: chain.finalBlockHeight,
      finalBlockHash: chain.finalBlockHash,
      lastAcceptedBlockHeight,
    };
    if (
      submission.kind === 'signed' &&
      chain.accessKeyNonce !== null &&
      BigInt(chain.accessKeyNonce) < BigInt(submission.signedNonce)
    ) {
      return await this.settle({
        kind: 'settled',
        binding: receipt.binding,
        requestDigest: receipt.requestDigest,
        outcome: {
          kind: 'retired',
          recovery: this.command.recovery,
          transactionId: receipt.transactionId,
          proof: {
            ...position,
            execution: 'not_executed',
            submission,
            accessKeyNonce: chain.accessKeyNonce,
          },
        },
      });
    }
    return {
      kind: 'retirement_available',
      recovery: this.command.recovery,
      transactionId: receipt.transactionId,
      proof: {
        ...position,
        execution: 'unverified',
        submission,
        accessKeyNonce: chain.accessKeyNonce,
      },
    };
  }

  private async observeHashOnlyReceipt(
    receipt: SubmittingReceipt,
  ): Promise<OwnerNearSubmissionEvidence> {
    const block = await this.nearClient.viewBlock({ finality: 'final' });
    const evidence: OwnerNearSubmissionEvidence = {
      kind: 'hash_only',
      firstObservedBlockHeight: block.header.height,
    };
    await this.store({ ...receipt, evidence });
    return evidence;
  }

  /** A signed receipt reads its nonce and block height from one finalized state. */
  private async readChainPosition(submission: OwnerNearSubmissionEvidence): Promise<{
    finalBlockHeight: number;
    finalBlockHash: string;
    accessKeyNonce: string | null;
  }> {
    if (submission.kind === 'signed') {
      try {
        const accessKey = await this.nearClient.viewAccessKey(
          String(this.command.recovery.nearAccountId),
          submission.signerPublicKey,
          { finality: 'final' },
        );
        return {
          finalBlockHeight: accessKey.block_height,
          finalBlockHash: accessKey.block_hash,
          accessKeyNonce: String(accessKey.nonce),
        };
      } catch (error) {
        // A deleted key erases its nonce, so this branch cannot show non-execution.
        if (!/access key .* does not exist/i.test(safeErrorMessage(error))) throw error;
      }
    }
    const block = await this.nearClient.viewBlock({ finality: 'final' });
    return {
      finalBlockHeight: block.header.height,
      finalBlockHash: block.header.hash,
      accessKeyNonce: null,
    };
  }

  /**
   * The owner replaces a submitted transaction with a 0-NEAR transfer to the account itself,
   * signed with the same access key at the same nonce. NEAR includes one transaction per
   * nonce of a key, so a final cancel proves that the original can never execute. Nothing
   * here trusts a missing hash: only a final outcome of either transaction settles it.
   */
  private async cancelSubmitted(
    receipt: OwnerNearReceipt | null,
    transactionId: string,
  ): Promise<OwnerNearOutcome> {
    if (!receipt || receipt.kind !== 'submitting') return await this.recover(receipt);
    if (receipt.transactionId !== transactionId)
      throw new Error('The cancel names a different transaction.');
    const submission = receipt.evidence;
    if (submission?.kind !== 'signed') {
      return unresolved(
        this.command.recovery,
        transactionId,
        'This receipt has no nonce, so the wallet cannot cancel this transaction.',
      );
    }
    this.assertActive();
    this.assertConnection();
    // A final original or an earlier cancel settles the operation without another signature.
    const settled = await this.recover(receipt);
    if (settled.kind !== 'unresolved' && settled.kind !== 'retirement_available') return settled;
    const recovery = this.command.recovery;
    let session: Awaited<ReturnType<SeamsWebContext['signingEngine']['signNearOwnerTransaction']>>;
    try {
      session = await this.context.signingEngine.signNearOwnerTransaction(
        {
          action: 'approve',
          authentication: this.command.authentication,
          recovery,
          expiresAtMs: Date.now() + OWNER_CANCEL_APPROVAL_MS,
          transaction: {
            receiverId: String(recovery.nearAccountId),
            actions: [{ action_type: ActionType.Transfer, deposit: '0' }],
          },
        },
        this.assertCurrentConnection.bind(this),
        this.onEvent,
        {
          operationId: SigningSessionIds.signingOperation(
            `owner-near-cancel:${secureRandomBase64Url(32, 'owner NEAR cancel IDs')}`,
          ),
          replacementNonce: submission.signedNonce,
          title: 'Cancel the earlier transaction',
          body: `This replaces transaction ${transactionId} with a 0 NEAR transfer to your own account.`,
        },
      );
    } catch (error) {
      if (error instanceof NearReplacementNonceUsedError) {
        // The nonce is gone, so the original may have executed. Only its own outcome can tell.
        return unresolved(
          recovery,
          transactionId,
          'NEAR already used this nonce, so the earlier transaction may have executed. Check it again.',
        );
      }
      return unresolved(recovery, transactionId, error);
    }
    const evidence = await ownerNearSignedEvidence(session);
    if (
      evidence.signerPublicKey !== submission.signerPublicKey ||
      evidence.signedNonce !== submission.signedNonce
    )
      return unresolved(recovery, transactionId, 'The cancel did not use the same key and nonce.');
    const replacement = { transactionId: session.signedTransaction.transactionHash, evidence };
    // Persist the cancel before its broadcast, so a later check follows it.
    await this.store({ ...receipt, replacement });
    const result = await sendTransaction({
      context: this.broadcastContext,
      walletSession: {
        walletId: toWalletId(this.command.authentication.walletId),
        walletSessionUserId: String(this.command.authentication.walletId),
      },
      nearAccountId: nearAccountRefFromAccountId(recovery.nearAccountId).accountId,
      signedTransaction: session.signedTransaction,
      options: { waitUntil: 'FINAL' },
    });
    if (result.success) {
      const cancelled = await this.settleReplacement(receipt, replacement, result.result);
      if (cancelled) return cancelled;
      return unresolved(recovery, transactionId, 'The cancel is not final yet. Check it again.');
    }
    const rejection = result.kind === 'unresolved' ? result.rejection : undefined;
    // A refused cancel never reached a block, so the receipt no longer follows it.
    if (rejection?.permanence === 'permanent' || result.kind === 'not_submitted')
      await this.store(receipt);
    return {
      kind: 'unresolved',
      recovery,
      transactionId,
      error: rejection
        ? `NEAR refused the cancel: ${rejection.error}.`
        : 'The cancel outcome is unavailable. Check this transaction again.',
      ...(receipt.rejection ? { rejection: receipt.rejection } : {}),
      ...(rejection ? { cancellationRejection: rejection } : {}),
    };
  }

  /** Settles from the cancel's own final outcome. `null` means the cancel is not final. */
  private async reconcileReplacement(
    receipt: SubmittingReceipt,
    replacement: NonNullable<SubmittingReceipt['replacement']>,
  ): Promise<OwnerNearOutcome | null> {
    let result: FinalExecutionOutcome;
    try {
      result = await this.nearClient.txStatus(
        replacement.transactionId,
        String(this.command.recovery.nearAccountId),
        'NONE',
      );
    } catch {
      // An unknown or unreachable cancel proves nothing. The original's own check follows.
      return null;
    }
    return await this.settleReplacement(receipt, replacement, result);
  }

  private async settleReplacement(
    receipt: SubmittingReceipt,
    replacement: NonNullable<SubmittingReceipt['replacement']>,
    result: FinalExecutionOutcome,
  ): Promise<OwnerNearOutcome | null> {
    const submission = receipt.evidence;
    if (
      submission?.kind !== 'signed' ||
      result.transaction.hash !== replacement.transactionId ||
      result.final_execution_status !== 'FINAL' ||
      typeof result.status !== 'object'
    )
      return null;
    // A transaction that reached a block took its nonce, whatever its actions did.
    const status = result.status.Failure !== undefined ? 'failed' : 'succeeded';
    return await this.settle({
      kind: 'settled',
      binding: receipt.binding,
      requestDigest: receipt.requestDigest,
      outcome: {
        kind: 'retired',
        recovery: this.command.recovery,
        transactionId: receipt.transactionId,
        proof: {
          execution: 'not_executed',
          submission,
          replacement: {
            transactionId: replacement.transactionId,
            status,
          },
        },
      },
    });
  }

  /** Execution remains uncertain here, so the owner must accept the release with a passkey. */
  private async retire(
    receipt: OwnerNearReceipt | null,
    transactionId: string,
  ): Promise<OwnerNearOutcome> {
    if (!receipt || receipt.kind !== 'submitting') return await this.recover(receipt);
    if (receipt.transactionId !== transactionId)
      throw new Error('The retirement names a different transaction.');
    this.assertActive();
    this.assertConnection();
    let ownerApproval: OwnerNearRetirementApproval;
    try {
      ownerApproval = await this.approveRetirement(receipt);
    } catch (error) {
      if (error instanceof ExternalOwnerApprovalError)
        return unresolved(this.command.recovery, transactionId, error);
      throw error;
    }
    const outcome = await this.reconcile(receipt);
    if (outcome.kind !== 'retirement_available') return outcome;
    return await this.settle({
      kind: 'settled',
      binding: receipt.binding,
      requestDigest: receipt.requestDigest,
      outcome: {
        kind: 'retired',
        recovery: this.command.recovery,
        transactionId,
        proof: { ...outcome.proof, ownerApproval },
      },
    });
  }

  private async approveRetirement(
    receipt: SubmittingReceipt,
  ): Promise<OwnerNearRetirementApproval> {
    const { recovery } = this.command;
    const authority = await resolveOwnerPasskeyAuthority(recovery.walletId);
    this.assertActive();
    const challenge = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(
        alphabetizeStringify({
          purpose: 'owner-near-retirement:v1',
          binding: receipt.binding,
          operationId: recovery.operationId,
          walletId: recovery.walletId,
          nearAccountId: recovery.nearAccountId,
          transactionId: receipt.transactionId,
          freshness: secureRandomBase64Url(32, 'owner retirement challenges'),
        }),
      ),
    );
    const challengeB64u = base64UrlEncode(challenge);
    const approved = await approveWithOwnerPasskey(this.context, {
      title: 'Release this earlier transaction?',
      body: [
        `Transaction: ${receipt.transactionId}`,
        `Account: ${recovery.nearAccountId}`,
        '',
        'The wallet will confirm that NEAR can no longer execute it.',
        'It may have executed earlier. Check your balance before you make a new transaction.',
      ].join('\n'),
      confirmText: 'Release transaction',
      surfaceMarker: { name: 'seamsOwnerNearRetirement', value: 'release' },
      subjectId: recovery.walletId,
      challengeB64u,
      credentialIdB64u: authority.authMethod.credentialIdB64u,
      expiresAtMs: Date.now() + RETIREMENT_APPROVAL_MS,
      // The owner ends this review in the wallet surface, or its deadline ends it.
      signal: new AbortController().signal,
      assertCurrent: this.assertCurrentConnection.bind(this),
    });
    if (approved.credentialIdB64u !== authority.authMethod.credentialIdB64u)
      throw new Error('The approval must use the owner passkey on this device.');
    return {
      credentialIdB64u: approved.credentialIdB64u,
      challengeB64u,
      approvedAtMs: Date.now(),
    };
  }

  private assertCurrentConnection(): void {
    this.assertActive();
    this.assertConnection();
  }

  async store(receipt: OwnerNearReceipt): Promise<void> {
    await IndexedDBManager.setAppState(this.key, receipt);
  }

  private broadcastProgress(event: SigningFlowEvent): void {
    // Completion belongs to the owner's final outcome, including a confirmed revert.
    if (event.phase !== SigningEventPhase.STEP_15_COMPLETED) this.onEvent(event);
  }

  private async settleTransaction(
    transactionId: string,
    result: FinalExecutionOutcome,
    requestDigest: string,
  ): Promise<OwnerNearOutcome> {
    if (result.transaction.hash !== transactionId)
      return unresolved(
        this.command.recovery,
        transactionId,
        'Transaction recovery identity mismatch.',
      );
    if (result.final_execution_status !== 'FINAL' || typeof result.status !== 'object')
      return unresolved(
        this.command.recovery,
        transactionId,
        'The transaction is not final. Check this transaction again.',
      );
    let outcome: SettledOwnerNearOutcome;
    if (result.status.Failure !== undefined) {
      outcome = { kind: 'reverted', transactionId, error: 'The transaction failed on NEAR.' };
    } else if (typeof result.status.SuccessValue === 'string') {
      outcome = { kind: 'completed', result: { success: true, transactionId, result } };
    } else {
      return unresolved(
        this.command.recovery,
        transactionId,
        'The transaction outcome is unavailable.',
      );
    }
    emitNearSigningEvent(this.onEvent, this.command.recovery.nearAccountId, {
      phase:
        outcome.kind === 'completed'
          ? SigningEventPhase.STEP_15_COMPLETED
          : SigningEventPhase.STEP_13_RECEIPT_REVERTED,
      status: outcome.kind === 'completed' ? 'succeeded' : 'failed',
      interaction: { kind: 'none', overlay: 'none' },
      data: { txId: transactionId },
    });
    return await this.settle({ kind: 'settled', binding: this.binding, requestDigest, outcome });
  }

  private async settle(
    receipt: Variant<OwnerNearReceipt, 'kind', 'settled'>,
  ): Promise<SettledOwnerNearOutcome> {
    try {
      await this.store(receipt);
    } catch {
      // Storage cannot change an observed outcome. A submitting receipt can still be reconciled.
    }
    await this.clearPending();
    return receipt.outcome;
  }

  async readPending(key = this.pendingKey): Promise<OwnerNearRecovery | null> {
    const raw = await IndexedDBManager.getAppState(key);
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
  const signed = value.signed === undefined ? {} : { signed: parseSignedSummary(value.signed) };
  switch (value.kind) {
    case 'approving':
      return { kind: 'approving', binding, requestDigest };
    case 'signed': {
      const evidence = parseOwnerNearSubmissionEvidence(value.evidence);
      if (evidence.kind !== 'signed') throw new Error('Invalid owner transaction receipt.');
      return {
        kind: 'signed',
        binding,
        requestDigest,
        ...signed,
        transactionId: requireCanonicalString(value.transactionId, 'transactionId'),
        evidence,
      };
    }
    case 'submitting':
      return {
        kind: 'submitting',
        binding,
        requestDigest,
        ...signed,
        transactionId: requireCanonicalString(value.transactionId, 'transactionId'),
        evidence:
          value.evidence === undefined ? null : parseOwnerNearSubmissionEvidence(value.evidence),
        ...(value.rejection === undefined
          ? {}
          : { rejection: parseNearTransactionRejection(value.rejection) }),
        ...(value.replacement === undefined ? {} : { replacement: parseReplacement(value.replacement) }),
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

function parseReplacement(raw: unknown): NonNullable<SubmittingReceipt['replacement']> {
  const value = requireRecord(raw, 'owner cancel');
  const evidence = parseOwnerNearSubmissionEvidence(value.evidence);
  if (evidence.kind !== 'signed') throw new Error('Invalid owner cancel.');
  return {
    transactionId: requireCanonicalString(value.transactionId, 'transactionId'),
    evidence,
  };
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
    case 'retired':
      return outcome;
    case 'unknown':
    case 'unresolved':
    case 'recovery_unavailable':
    case 'retirement_available':
      throw new Error('A settled owner receipt requires a terminal outcome.');
    default:
      return assertNeverOutcome(outcome);
  }
}

function assertNeverOutcome(outcome: never): never {
  throw new Error(`Unsupported owner outcome: ${String(outcome)}`);
}

function admissionFailure(command: OwnerNearCommand, error: unknown): OwnerNearOutcome {
  if (command.action !== 'approve') return recoveryUnavailable(command.recovery, error);
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

function retirementWaitMessage(
  unknown: NearRpcError,
  submission: OwnerNearSubmissionEvidence,
  lastAcceptedBlockHeight: number,
): string {
  const status = safeErrorMessage(unknown).replace(/\.?$/, '.');
  if (submission.kind === 'signed')
    return `${status} NEAR cannot accept this transaction after block ${lastAcceptedBlockHeight}.`;
  return (
    `${status} This older receipt has no reference block, so this is a safety wait and not a NEAR limit. ` +
    `The wallet measures it from block ${submission.firstObservedBlockHeight}. Check again after block ${lastAcceptedBlockHeight}.`
  );
}

function signedSummary(transaction: TransactionInputWasm): OwnerNearSignedSummary {
  return {
    receiverId: transaction.receiverId,
    actions: transaction.actions.map((action) => {
      switch (action.action_type) {
        case ActionType.FunctionCall:
          return {
            type: action.action_type,
            methodName: action.method_name,
            gas: action.gas,
            deposit: action.deposit,
          };
        case ActionType.Transfer:
          return { type: action.action_type, deposit: action.deposit };
        default:
          return { type: action.action_type };
      }
    }),
  };
}

function parseSignedSummary(raw: unknown): OwnerNearSignedSummary {
  const value = requireRecord(raw, 'owner signed summary');
  if (!Array.isArray(value.actions)) throw new Error('Invalid owner signed summary.');
  return {
    receiverId: requireCanonicalString(value.receiverId, 'receiverId'),
    actions: value.actions.map((rawAction) => {
      const action = requireRecord(rawAction, 'owner signed action');
      return {
        type: requireCanonicalString(action.type, 'type'),
        ...(typeof action.methodName === 'string' ? { methodName: action.methodName } : {}),
        ...(typeof action.gas === 'string' ? { gas: action.gas } : {}),
        ...(typeof action.deposit === 'string' ? { deposit: action.deposit } : {}),
      };
    }),
  };
}

class OwnerNearUnaffordable extends Error {
  constructor(readonly shortfall: OwnerNearShortfall) {
    super(
      `This account holds ${shortfall.balance} yoctoNEAR, but this transaction can cost up to ` +
        `${shortfall.maximumCost} yoctoNEAR with ${shortfall.storageReserve} yoctoNEAR kept for storage.`,
    );
  }
}

class OwnerNearExpired extends Error {
  constructor() {
    super('The owner operation expired.');
  }
}

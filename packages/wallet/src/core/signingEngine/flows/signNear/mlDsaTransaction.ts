import {
  resolveMlDsaSigningOwner,
  prepareMlDsaEmailPrompt,
  mlDsaConfirmationProof,
} from './mlDsaSigningAuth';
import { mlDsaConfirmationRequest } from './mlDsaConfirmation';
import type { EmailOtpWalletSessionCoordinator } from '../../session/emailOtp/EmailOtpWalletSessionCoordinator';
import { assertSigningNotCancelled } from '../shared/cancellation';
import { SignedTransaction, type NearClient } from '@/core/rpcClients/near/NearClient';
import type {
  AddedMlDsaSignerCapability,
  SeamsConfigsReadonly,
  SignTransactionResult,
} from '@/core/types/seams';
import type { SignTransactionHooksOptions } from '@/core/types/sdkSentEvents';
import { SigningEventPhase } from '@/core/types/sdkSentEvents';
import { emitNearSigningEvent } from './shared/confirmationProgress';
import { toActionArgsWasm, type TransactionInput } from '@/core/types/actions';
import type { NearAccountRef, WalletSessionRef } from '../../interfaces/ecdsaChainTarget';
import type { UiConfirmRequestConfirmationPort } from '../../uiConfirm/uiConfirm.types';
import {
  prepareMlDsaTransactionApproval,
  authorizeMlDsaTransaction,
  forgetMlDsaTransactionApproval,
} from '../../walletCustody/mlDsaSigningSessions';
import { buildNearNonceLane, type NonceCoordinator } from '../../nonce/NonceCoordinator';
import { nonceLeaseToRef } from '../../nonce/nonceLaneKeys';
import { SigningSessionIds, SigningOperationIntent } from '../../session/operationState/types';
import { computeSigningOperationFingerprint } from '../../session/planning/operationFingerprint';
import {
  prepareMlDsaNearSigning,
  initializeMlDsaCodec,
} from '@/core/rpcClients/relayer/mlDsaSigning';
import { executeMlDsaSigningUntilSettled } from './mlDsaSigningExecution';
import { secureRandomBase64Url } from '@shared/utils/secureRandomId';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import { requireRecord, requireCanonicalString } from '@shared/utils/validation';
import { base64UrlDecode } from '@shared/utils/base64';
import {
  ml_dsa65_build_near_transaction,
  ml_dsa65_near_key_identifiers,
  threshold_ed25519_decode_signed_near_tx_borsh,
} from '../../../../../../../wasm/near_signer/pkg-ml-dsa/ml_dsa_signer.js';

export type MlDsaNearTransactionInput = {
  readonly walletSession: WalletSessionRef;
  readonly nearAccount: NearAccountRef;
  readonly signer: AddedMlDsaSignerCapability;
  readonly transaction: TransactionInput;
  readonly options: SignTransactionHooksOptions;
  readonly shouldAbort: () => boolean;
};
type Dependencies = {
  readonly configs: SeamsConfigsReadonly;
  readonly nearClient: NearClient;
  readonly nonceCoordinator: NonceCoordinator;
  readonly confirm: UiConfirmRequestConfirmationPort;
  readonly emailOtpSessions: Pick<
    EmailOtpWalletSessionCoordinator,
    'requestTransactionSigningChallenge'
  >;
};

type SigningDispatch = { kind: 'approved' | 'dispatched' };

function markDispatched(dispatch: SigningDispatch): void {
  dispatch.kind = 'dispatched';
}

export async function signMlDsaNearTransaction(
  deps: Dependencies,
  input: MlDsaNearTransactionInput,
): Promise<SignTransactionResult> {
  assertSigningNotCancelled(input.shouldAbort);
  if (input.options.signerSlot !== undefined)
    throw new Error('An ML-DSA signer reference already selects the exact key');
  const owner = await resolveMlDsaSigningOwner(input.walletSession.walletId);
  emitNearSigningEvent(input.options.onEvent, input.nearAccount.accountId, {
    phase: SigningEventPhase.STEP_01_STARTED,
    status: 'running',
    interaction: { kind: 'none', overlay: 'none' },
  });
  const relayerUrl = requireCanonicalString(
    deps.configs.network.relayer?.url,
    'ML-DSA Gateway URL',
  );
  const operationIdB64u = parseDigestB64u(secureRandomBase64Url(32, 'ML-DSA signing operation'));
  const operationId = SigningSessionIds.signingOperation(`ml-dsa:${operationIdB64u}`);
  const actions = input.transaction.actions.map(toActionArgsWasm);
  const transactionInput = {
    nearAccountId: String(input.nearAccount.accountId),
    receiverId: input.transaction.receiverId,
    actions,
  };
  const fingerprint = await computeSigningOperationFingerprint({
    kind: 'near_ml_dsa_65',
    payload: {
      walletId: input.walletSession.walletId,
      signer: input.signer,
      transaction: transactionInput,
    },
  });
  assertSigningNotCancelled(input.shouldAbort);
  await initializeMlDsaCodec();
  const identifiers = requireRecord(
    JSON.parse(ml_dsa65_near_key_identifiers(input.signer.publicKeyB64u)),
    'ML-DSA key identifiers',
  );
  assertSigningNotCancelled(input.shouldAbort);
  const reserved = await deps.nonceCoordinator.reserveNearContext({
    lane: buildNearNonceLane({
      chains: deps.configs.network.chains,
      walletId: String(input.walletSession.walletId),
      nearAccountId: String(input.nearAccount.accountId),
      nearPublicKeyStr: requireCanonicalString(identifiers.publicKey, 'ML-DSA public key'),
    }),
    operation: {
      operationId,
      intent: SigningOperationIntent.TransactionSign,
      operationFingerprint: fingerprint,
      accountId: String(input.nearAccount.accountId),
    },
    count: 1,
    nearClient: deps.nearClient,
  });
  const [lease, ...extra] = reserved.leases;
  if (!lease || extra.length !== 0 || lease.lane.family !== 'near')
    throw new Error('ML-DSA signing requires one reserved NEAR nonce');
  const nonceLease = nonceLeaseToRef(lease);
  const dispatch: SigningDispatch = { kind: 'approved' };
  try {
    assertSigningNotCancelled(input.shouldAbort);
    const unsignedTransactionBorshB64u = ml_dsa65_build_near_transaction(
      JSON.stringify({
        signerId: String(input.nearAccount.accountId),
        receiverId: transactionInput.receiverId,
        publicKeyB64u: input.signer.publicKeyB64u,
        nonce: String(lease.nonce),
        blockHash: reserved.context.txBlockHash,
        actions,
      }),
    );
    const prepared = await prepareMlDsaNearSigning({
      relayerUrl,
      publicKeyB64u: input.signer.publicKeyB64u,
      access: owner.access,
      request: {
        walletId: input.walletSession.walletId,
        signingKeyId: input.signer.signingKeyId,
        operationIdB64u,
        unsignedTransactionBorshB64u,
        actor: owner.actor,
      },
    });
    if (prepared.kind !== 'prepared') throw new Error(prepared.message);
    assertSigningNotCancelled(input.shouldAbort);
    const preparation = prepared.preparation;
    const approval = await prepareMlDsaTransactionApproval({
      relayerUrl,
      preparation,
      ownerDigestB64u: owner.ownerDigestB64u,
      materialEpoch: input.signer.materialEpoch,
      policy: input.options.mlDsaSigningSession ?? null,
    });
    assertSigningNotCancelled(input.shouldAbort);
    emitNearSigningEvent(input.options.onEvent, input.nearAccount.accountId, {
      phase: SigningEventPhase.STEP_05_CONFIRMATION_DISPLAYED,
      status: 'running',
      interaction: { kind: 'none', overlay: 'none' },
    });
    const authPrompt =
      owner.kind === 'email_otp' && approval.kind !== 'session'
        ? {
            kind: 'email_otp' as const,
            prompt: await prepareMlDsaEmailPrompt(
              deps.emailOtpSessions,
              input.walletSession,
              owner,
              approval.challengeB64u,
            ),
          }
        : { kind: 'none' as const };
    assertSigningNotCancelled(input.shouldAbort);
    const decision = await deps.confirm.requestUserConfirmation(
      mlDsaConfirmationRequest(input, preparation, approval, transactionInput, authPrompt),
    );
    if (!decision.confirmed)
      throw new Error(decision.error || 'ML-DSA transaction approval was cancelled');
    assertSigningNotCancelled(input.shouldAbort);
    const proof = mlDsaConfirmationProof(approval, decision);
    const authorization = authorizeMlDsaTransaction({ approval, proof });
    const request = { relayerUrl, preparation, authorization };
    const signingDeadline =
      approval.kind === 'fresh'
        ? preparation.expiresAtMs
        : Math.min(preparation.expiresAtMs, approval.session.expiresAtMs);
    emitNearSigningEvent(input.options.onEvent, input.nearAccount.accountId, {
      phase: SigningEventPhase.STEP_10_COMMIT_STARTED,
      status: 'running',
      interaction: { kind: 'none', overlay: 'none' },
    });
    const result = await executeMlDsaSigningUntilSettled({
      request,
      deadlineAtMs: signingDeadline,
      shouldAbort: input.shouldAbort,
      onDispatch: markDispatched.bind(null, dispatch),
    });
    if (result.kind === 'refused') {
      forgetMlDsaTransactionApproval(approval);
      throw new Error(result.message);
    }
    const decoded = requireRecord(
      threshold_ed25519_decode_signed_near_tx_borsh({
        signedTransactionBorshB64u: result.transaction.signedTransactionBorshB64u,
      }),
      'ML-DSA signed transaction',
    );
    const signed = requireRecord(decoded.signedTransaction, 'ML-DSA signed payload');
    const signedTransaction = SignedTransaction.fromPlain({
      transaction: signed.transaction,
      signature: signed.signature,
      borsh_bytes: Array.from(base64UrlDecode(result.transaction.signedTransactionBorshB64u)),
      nonceLease,
    });
    await deps.nonceCoordinator.markSigned({
      leaseId: nonceLease.leaseId,
      operationId,
      operationFingerprint: fingerprint,
    });
    assertSigningNotCancelled(input.shouldAbort);
    const signedResult = {
      signedTransaction,
      nearAccountId: String(input.nearAccount.accountId),
      nonceLease,
    };
    emitNearSigningEvent(input.options.onEvent, input.nearAccount.accountId, {
      phase: SigningEventPhase.STEP_11_TRANSACTION_SIGNED,
      status: 'succeeded',
      interaction: { kind: 'none', overlay: 'none' },
    });
    await input.options.afterCall?.(true, signedResult);
    return signedResult;
  } catch (error: unknown) {
    // An uncertain signature must keep its nonce reserved until reconciliation.
    if (dispatch.kind === 'approved')
      await deps.nonceCoordinator.release({
        leaseId: nonceLease.leaseId,
        operationId,
        operationFingerprint: fingerprint,
        reason: 'signing_failed',
      });
    throw error;
  }
}

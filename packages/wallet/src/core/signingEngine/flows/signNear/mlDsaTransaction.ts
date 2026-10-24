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
import { UserConfirmationType } from '../../stepUpConfirmation/channel/confirmTypes';
import { buildNearDisplayModel } from '../../chains/near/display';
import { resolveMlDsaPasskeyOwner } from '../../walletCustody/mlDsaOwner';
import {
  prepareMlDsaTransactionApproval,
  authorizeMlDsaTransaction,
  forgetMlDsaTransactionApproval,
  type MlDsaTransactionApproval,
} from '../../walletCustody/mlDsaSigningSessions';
import type { MlDsaSigningPreparation } from '@shared/near/mlDsaSigning';
import type { TransactionInputWasm } from '@/core/types/actions';
import type { UserConfirmRequest } from '../../stepUpConfirmation/channel/confirmTypes';
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
import { redactCredentialExtensionOutputs } from '../../webauthnAuth/credentials/credentialExtensions';
import { normalizeAuthenticationCredential } from '../../webauthnAuth/credentials/helpers';
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
  const owner = await resolveMlDsaPasskeyOwner(input.walletSession.walletId);
  if (owner.kind === 'refused')
    throw new Error('ML-DSA signing requires an unlocked full-owner passkey');
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
      request: {
        walletId: input.walletSession.walletId,
        signingKeyId: input.signer.signingKeyId,
        operationIdB64u,
        unsignedTransactionBorshB64u,
        rpId: owner.authMethod.rpId,
        credentialIdB64u: owner.authMethod.credentialIdB64u,
      },
    });
    if (prepared.kind !== 'prepared') throw new Error(prepared.message);
    assertSigningNotCancelled(input.shouldAbort);
    const preparation = prepared.preparation;
    const approval = await prepareMlDsaTransactionApproval({
      relayerUrl,
      preparation,
      ownerDigestB64u: owner.authority.authorityDigestB64u,
      materialEpoch: input.signer.materialEpoch,
      policy: input.options.mlDsaSigningSession ?? null,
    });
    assertSigningNotCancelled(input.shouldAbort);
    emitNearSigningEvent(input.options.onEvent, input.nearAccount.accountId, {
      phase: SigningEventPhase.STEP_05_CONFIRMATION_DISPLAYED,
      status: 'running',
      interaction: { kind: 'none', overlay: 'none' },
    });
    const decision = await deps.confirm.requestUserConfirmation(
      mlDsaConfirmationRequest(input, preparation, approval, transactionInput),
    );
    if (!decision.confirmed)
      throw new Error(decision.error || 'ML-DSA transaction approval was cancelled');
    assertSigningNotCancelled(input.shouldAbort);
    const credential = decision.credential
      ? redactCredentialExtensionOutputs(normalizeAuthenticationCredential(decision.credential))
      : null;
    if (credential !== null && credential.id !== owner.authMethod.credentialIdB64u)
      throw new Error('ML-DSA approval used a different owner');
    const authorization = authorizeMlDsaTransaction({ approval, credential });
    const request = { relayerUrl, preparation, authorization };
    const signingDeadline =
      approval.kind === 'passkey'
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

function mlDsaConfirmationRequest(
  input: MlDsaNearTransactionInput,
  preparation: MlDsaSigningPreparation,
  approval: MlDsaTransactionApproval,
  transactionInput: TransactionInputWasm,
): UserConfirmRequest {
  const signingSubject = {
    kind: 'near_ml_dsa_wallet' as const,
    walletId: String(input.walletSession.walletId),
    nearAccountId: String(input.nearAccount.accountId),
    credentialIdB64u: preparation.request.credentialIdB64u,
  };
  const displayModel = buildNearDisplayModel({
    txSigningRequests: [transactionInput],
    signerLabel: 'ML-DSA-65',
    signerAccount: String(input.nearAccount.accountId),
    intentDigest: approval.challengeB64u,
  });
  if (approval.kind === 'session') {
    return {
      type: UserConfirmationType.SIGN_INTENT_DIGEST,
      requestId: `ml-dsa:${preparation.request.operationIdB64u}`,
      intentDigest: approval.challengeB64u,
      confirmationConfig: input.options.confirmationConfig,
      summary: {
        title: input.options.confirmerText?.title ?? 'Sign NEAR transaction',
        body:
          input.options.confirmerText?.body ??
          'Approve this transaction with your ML-DSA signing session.',
      },
      payload: {
        signingSubject,
        challengeB64u: approval.challengeB64u,
        displayModel,
        signingAuthPlan: {
          kind: 'ml_dsa_session',
          method: 'passkey',
          sessionIdB64u: approval.session.sessionIdB64u,
          expiresAtMs: approval.session.expiresAtMs,
          remainingOperations: approval.session.remainingOperations,
        },
      },
    };
  }
  return {
    type: UserConfirmationType.SIGN_INTENT_DIGEST,
    requestId: `ml-dsa:${preparation.request.operationIdB64u}`,
    intentDigest: approval.challengeB64u,
    confirmationConfig: input.options.confirmationConfig,
    summary: {
      title: input.options.confirmerText?.title ?? 'Sign NEAR transaction',
      body:
        approval.kind === 'session_start'
          ? `This transaction uses one of ${approval.session.remainingOperations} permitted ML-DSA signing operations. The session expires at ${new Date(approval.session.expiresAtMs).toLocaleString()}. Failed operations consume one use.`
          : (input.options.confirmerText?.body ?? 'Approve this ML-DSA transaction.'),
    },
    payload: {
      signingSubject,
      challengeB64u: approval.challengeB64u,
      webauthnChallenge: { kind: 'intent_digest', challengeB64u: approval.challengeB64u },
      signingAuthPlan: { kind: 'passkeyReauth', method: 'passkey' },
      displayModel,
    },
  };
}

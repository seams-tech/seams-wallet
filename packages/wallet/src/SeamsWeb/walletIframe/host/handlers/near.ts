import { type PMRegistrationAuthMethodInput, type PMSendTxPayload } from '../../shared/messages';
import {
  nearAccountRefFromAccountId,
  toWalletId,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { SignedTransaction } from '@/core/rpcClients/near/NearClient';
import type { NonceLeaseRef } from '@/core/signingEngine/nonce/NonceCoordinator';
import {
  extractBorshBytesFromPlainSignedTx,
  isPlainSignedTransactionLike,
  requireCanonicalString,
  type PlainSignedTransactionLike,
} from '@shared/utils/validation';
import type { RegistrationAuthMethodInput } from '@shared/utils/registrationAuthMethodInput';
import type { HandlerDeps, HandlerMap, Req } from './walletIframeHandler.types';
import { respondOkResult, withProgress, withRegistrationProgress } from './shared';

function walletSessionFromWalletId(walletIdRaw: unknown) {
  const walletId = toWalletId(walletIdRaw);
  return {
    walletId,
    walletSessionUserId: String(walletId),
  };
}

function normalizeSignedTransaction(
  candidate: SignedTransaction | PlainSignedTransactionLike | undefined,
): SignedTransaction | PlainSignedTransactionLike | undefined {
  if (candidate && isPlainSignedTransactionLike(candidate)) {
    try {
      const borsh = extractBorshBytesFromPlainSignedTx(candidate);
      const nonceLease = (candidate as { nonceLease?: NonceLeaseRef }).nonceLease;
      const serverDispatch = (candidate as { serverDispatch?: SignedTransaction['serverDispatch'] })
        .serverDispatch;
      return SignedTransaction.fromPlain({
        transaction: candidate.transaction,
        signature: candidate.signature,
        borsh_bytes: borsh,
        transactionHash: requireCanonicalString(
          Reflect.get(candidate, 'transactionHash'),
          'transactionHash',
        ),
        ...(nonceLease ? { nonceLease } : {}),
        ...(serverDispatch ? { serverDispatch } : {}),
      });
    } catch {
      return candidate;
    }
  }
  return candidate;
}

function assertNeverRegistrationAuthMethod(value: never): never {
  throw new Error(`Unsupported registration auth method: ${String(value)}`);
}

function walletOriginRegistrationAuthMethod(
  authMethod: PMRegistrationAuthMethodInput,
): RegistrationAuthMethodInput {
  switch (authMethod.kind) {
    case 'passkey':
      return {
        kind: 'passkey',
        rpId: authMethod.rpId,
        ...(authMethod.authenticatorOptions === undefined
          ? {}
          : { authenticatorOptions: authMethod.authenticatorOptions }),
      };
    case 'email_otp': {
      switch (authMethod.proofKind) {
        case 'otp_challenge':
          return {
            kind: 'email_otp',
            proofKind: 'otp_challenge',
            email: authMethod.email,
            providerSubject: authMethod.providerSubject,
            otpCode: authMethod.otpCode,
            ...(authMethod.challengeId === undefined
              ? {}
              : { challengeId: authMethod.challengeId }),
          };
        case 'google_sso_registration':
          return {
            kind: 'email_otp',
            proofKind: 'google_sso_registration',
            email: authMethod.email,
            providerSubject: authMethod.providerSubject,
            googleEmailOtpRegistrationAttemptId: authMethod.googleEmailOtpRegistrationAttemptId,
            googleEmailOtpRegistrationOfferId: authMethod.googleEmailOtpRegistrationOfferId,
            googleEmailOtpRegistrationCandidateId: authMethod.googleEmailOtpRegistrationCandidateId,
          };
        default:
          return assertNeverRegistrationAuthMethod(authMethod);
      }
    }
    default:
      return assertNeverRegistrationAuthMethod(authMethod);
  }
}

export function createNearWalletIframeHandlers(deps: HandlerDeps): HandlerMap {
  return {
    PM_OWNER_NEAR_TRANSACTION: handleOwnerNearTransaction.bind(null, deps),
    PM_REGISTER_WALLET: async (req: Req<'PM_REGISTER_WALLET'>) => {
      const pm = deps.getWalletRuntime();
      const payload = req.payload!;
      if (deps.respondIfCancelled(req.requestId)) return;
      const hooksOptions = withRegistrationProgress(deps, req.requestId, payload.options || {});
      const result = await pm.registerWalletCommand({
        completion: payload.completion,
        authMethod: walletOriginRegistrationAuthMethod(payload.authMethod),
        wallet: payload.wallet,
        signerSelection: payload.signerSelection,
        options: {
          ...hooksOptions,
          ...(payload.confirmationConfig ? { confirmationConfig: payload.confirmationConfig } : {}),
        },
      });
      if (deps.respondIfCancelled(req.requestId)) return;
      // The parent receives the registered session before the result, so it
      // does not ask for it again.
      if (result.success && result.kind !== 'wallet_owner_registered') await deps.publishCurrentSession();
      if (deps.respondIfCancelled(req.requestId)) return;
      respondOkResult(deps, req.requestId, result);
    },

    PM_ADD_WALLET_SIGNER: async (req: Req<'PM_ADD_WALLET_SIGNER'>) => {
      const pm = deps.getWalletRuntime();
      const payload = req.payload!;
      if (deps.respondIfCancelled(req.requestId)) return;
      const hooksOptions = withProgress(deps, req.requestId, payload.options || {});
      const result = await pm.registration.addSigner({
        walletId: payload.walletId,
        rpId: payload.rpId,
        signerSelection: payload.signerSelection,
        options: {
          ...hooksOptions,
          ...(payload.confirmationConfig ? { confirmationConfig: payload.confirmationConfig } : {}),
        },
      });
      if (deps.respondIfCancelled(req.requestId)) return;
      respondOkResult(deps, req.requestId, result);
    },

    PM_ADD_PASSKEY: async (req: Req<'PM_ADD_PASSKEY'>) => {
      const pm = deps.getWalletRuntime();
      const payload = req.payload!;
      if (deps.respondIfCancelled(req.requestId)) return;
      const hooksOptions = withProgress(deps, req.requestId, payload.options || {});
      const result = await pm.registration.addPasskey({
        walletId: payload.walletId,
        rpId: payload.rpId,
        options: {
          ...hooksOptions,
          ...(payload.confirmationConfig ? { confirmationConfig: payload.confirmationConfig } : {}),
        },
      });
      if (deps.respondIfCancelled(req.requestId)) return;
      respondOkResult(deps, req.requestId, result);
    },

    PM_GET_AUTH_METHOD_AVAILABILITY: async (req: Req<'PM_GET_AUTH_METHOD_AVAILABILITY'>) => {
      if (!req.payload) throw new Error('Authentication method request is missing.');
      const result = await deps
        .getWalletRuntime()
        .registration.getAuthMethodAvailability(req.payload);
      if (!deps.respondIfCancelled(req.requestId)) respondOkResult(deps, req.requestId, result);
    },
    PM_SET_AUTH_METHOD_ENABLED: async (req: Req<'PM_SET_AUTH_METHOD_ENABLED'>) => {
      if (!req.payload) throw new Error('Authentication method request is missing.');
      const result = await deps.getWalletRuntime().registration.setAuthMethodEnabled(req.payload);
      await deps.publishCurrentSession();
      if (!deps.respondIfCancelled(req.requestId)) respondOkResult(deps, req.requestId, result);
    },
    PM_ACTIVATE_AUTH_METHOD: async (req: Req<'PM_ACTIVATE_AUTH_METHOD'>) => {
      const pm = deps.getWalletRuntime();
      if (deps.respondIfCancelled(req.requestId)) return;
      const payload = req.payload;
      if (!payload) throw new Error('Authentication method activation requires a wallet ID.');
      const result = await pm.registration.activateAuthMethod({
        walletId: payload.walletId,
        method: payload.method,
      });
      if (deps.respondIfCancelled(req.requestId)) return;
      respondOkResult(deps, req.requestId, result);
    },

    PM_ADD_EMAIL_OTP: async (req: Req<'PM_ADD_EMAIL_OTP'>) => {
      const pm = deps.getWalletRuntime();
      const payload = req.payload!;
      if (deps.respondIfCancelled(req.requestId)) return;
      const hooksOptions = withProgress(deps, req.requestId, payload.options || {});
      const result = await pm.registration.addEmail({
        walletId: payload.walletId,
        emailAddress: payload.emailAddress,
        options: hooksOptions,
      });
      if (deps.respondIfCancelled(req.requestId)) return;
      respondOkResult(deps, req.requestId, result);
    },

    PM_REVOKE_AUTH_METHOD: async (req: Req<'PM_REVOKE_AUTH_METHOD'>) => {
      const pm = deps.getWalletRuntime();
      const payload = req.payload!;
      if (deps.respondIfCancelled(req.requestId)) return;
      const result = await pm.registration.removeAuthMethod({
        walletId: payload.walletId,
        walletAuthMethodId: payload.walletAuthMethodId,
      });
      if (deps.respondIfCancelled(req.requestId)) return;
      respondOkResult(deps, req.requestId, result);
    },

    PM_GET_NEAR_PROVISIONING_STATE: async (req: Req<'PM_GET_NEAR_PROVISIONING_STATE'>) => {
      const pm = deps.getWalletRuntime();
      const walletId = toWalletId(req.payload?.walletId);
      const result = await pm.registration.getNearAccountState({ walletId });
      respondOkResult(deps, req.requestId, result);
    },

    PM_SIGN_TX_WITH_ACTIONS: async (req: Req<'PM_SIGN_TX_WITH_ACTIONS'>) => {
      const pm = deps.getWalletRuntime();
      const { walletId, nearAccountId, transaction, options } = req.payload!;
      const result = await pm.near.signTransaction({
        walletSession: walletSessionFromWalletId(walletId),
        nearAccount: nearAccountRefFromAccountId(nearAccountId),
        transaction,
        options: {
          ...withProgress(deps, req.requestId, options || {}),
        },
      });

      if (deps.respondIfCancelled(req.requestId)) return;
      respondOkResult(deps, req.requestId, result);
    },

    PM_SIGN_AND_SEND_TX: async (req: Req<'PM_SIGN_AND_SEND_TX'>) => {
      const pm = deps.getWalletRuntime();
      const { walletId, nearAccountId, transaction, options } = req.payload!;
      const result = await pm.near.signAndSendTransaction({
        walletSession: walletSessionFromWalletId(walletId),
        nearAccount: nearAccountRefFromAccountId(nearAccountId),
        receiverId: transaction.receiverId,
        actions: transaction.actions,
        options: {
          ...withProgress(deps, req.requestId, options || {}),
        },
      });

      respondOkResult(deps, req.requestId, result);
    },

    PM_SEND_TRANSACTION: async (req: Req<'PM_SEND_TRANSACTION'>) => {
      const pm = deps.getWalletRuntime();
      const { walletId, nearAccountId, signedTransaction, options } =
        req.payload || ({} as Partial<PMSendTxPayload>);
      const result = await pm.near.sendTransaction({
        walletSession: walletSessionFromWalletId(walletId),
        nearAccount: nearAccountRefFromAccountId(nearAccountId),
        signedTransaction: normalizeSignedTransaction(signedTransaction) as SignedTransaction,
        options: {
          ...withProgress(deps, req.requestId, options || {}),
        },
      });

      respondOkResult(deps, req.requestId, result);
    },

    PM_SIGN_DELEGATE_ACTION: async (req: Req<'PM_SIGN_DELEGATE_ACTION'>) => {
      const pm = deps.getWalletRuntime();
      const { walletId, nearAccountId, delegate, options } = req.payload!;
      const result = await pm.near.signDelegateAction({
        walletSession: walletSessionFromWalletId(walletId),
        nearAccount: nearAccountRefFromAccountId(nearAccountId),
        delegate,
        options: {
          ...withProgress(deps, req.requestId, options || {}),
        },
      });
      if (deps.respondIfCancelled(req.requestId)) return;
      respondOkResult(deps, req.requestId, result);
    },

    PM_SIGN_NEP413: async (req: Req<'PM_SIGN_NEP413'>) => {
      const pm = deps.getWalletRuntime();
      const { walletId, nearAccountId, params, options } = req.payload!;
      const result = await pm.near.signMessage({
        walletSession: walletSessionFromWalletId(walletId),
        nearAccount: nearAccountRefFromAccountId(nearAccountId),
        params,
        options: {
          ...withProgress(deps, req.requestId, options || {}),
        },
      });
      if (deps.respondIfCancelled(req.requestId)) return;
      respondOkResult(deps, req.requestId, result);
    },
  };
}

async function handleOwnerNearTransaction(deps: HandlerDeps, request: Req<'PM_OWNER_NEAR_TRANSACTION'>): Promise<void> {
  const result = await deps.getWalletRuntime().runOwnerNearOperation(request.payload, assertOwnerRequestActive.bind(null, deps, request.requestId), deps.postProgress.bind(deps, request.requestId), postOwnerNearSubmission.bind(null, deps, request));
  respondOkResult(deps, request.requestId, result);
}

function assertOwnerRequestActive(deps: HandlerDeps, requestId: string | undefined): void {
  if (deps.isCancelled(requestId)) throw new DOMException('The owner operation was cancelled.', 'AbortError');
}

function postOwnerNearSubmission(deps: HandlerDeps, request: Req<'PM_OWNER_NEAR_TRANSACTION'>): void {
  deps.postProgress(request.requestId, { event: 'owner_near_submitting', operationId: request.payload.recovery.operationId });
}

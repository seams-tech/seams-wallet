import type { MlDsaNearTransactionInput } from './mlDsaTransaction';
import type { MlDsaSigningPreparation } from '@shared/near/mlDsaSigning';
import type { MlDsaTransactionApproval } from '../../walletCustody/mlDsaSigningSessions';
import type { TransactionInputWasm } from '@/core/types/actions';
import type { ConfirmationConfig } from '@/core/types/signer-worker';
import type { Variant } from '@shared/utils/variant';
import {
  UserConfirmationType,
  type UserConfirmRequest,
  type SignIntentDigestPayload,
} from '../../stepUpConfirmation/channel/confirmTypes';
import type { EmailOtpConfirmPrompt } from '../../stepUpConfirmation/types';
import { buildNearDisplayModel } from '../../chains/near/display';
import type { NearTokenMetadataByContract } from '../../chains/near/tokenTransfers';

export function mlDsaConfirmationRequest(
  input: MlDsaNearTransactionInput,
  preparation: MlDsaSigningPreparation,
  approval: MlDsaTransactionApproval,
  transactionInput: TransactionInputWasm,
  authPrompt:
    | { readonly kind: 'none' }
    | { readonly kind: 'email_otp'; readonly prompt: EmailOtpConfirmPrompt },
  preferences: ConfirmationConfig,
  tokenMetadata: NearTokenMetadataByContract,
): UserConfirmRequest {
  const actor = approval.actor;
  const displayModel = buildNearDisplayModel({
    txSigningRequests: [transactionInput],
    signerLabel: 'ML-DSA-65',
    signerAccount: String(input.nearAccount.accountId),
    intentDigest: approval.challengeB64u,
    tokenMetadata,
  });
  const walletId = String(input.walletSession.walletId);
  const nearAccountId = String(input.nearAccount.accountId);
  let payload: SignIntentDigestPayload;
  if (actor.kind === 'email_otp') {
    const signingSubject = {
      kind: 'near_ml_dsa_email_wallet' as const,
      walletId,
      nearAccountId,
      walletAuthMethodId: actor.walletAuthMethodId,
    };
    if (approval.kind === 'session') {
      payload = {
        signingSubject,
        challengeB64u: approval.challengeB64u,
        displayModel,
        signingAuthPlan: {
          kind: 'ml_dsa_session',
          method: 'email_otp',
          sessionIdB64u: approval.session.sessionIdB64u,
          expiresAtMs: approval.session.expiresAtMs,
          remainingOperations: approval.session.remainingOperations,
        },
      };
    } else {
      if (authPrompt.kind !== 'email_otp')
        throw new Error('Email OTP signing requires an exact challenge');
      payload = {
        signingSubject,
        challengeB64u: approval.challengeB64u,
        displayModel,
        signingAuthPlan: {
          kind: 'emailOtpReauth',
          method: 'email_otp',
          emailOtpPrompt: authPrompt.prompt,
        },
      };
    }
  } else {
    const signingSubject = {
      kind: 'near_ml_dsa_wallet' as const,
      walletId,
      nearAccountId,
      credentialIdB64u: actor.credentialIdB64u,
    };
    if (approval.kind === 'session') {
      payload = {
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
      };
    } else {
      payload = {
        signingSubject,
        challengeB64u: approval.challengeB64u,
        displayModel,
        webauthnChallenge: { kind: 'intent_digest', challengeB64u: approval.challengeB64u },
        signingAuthPlan: { kind: 'passkeyReauth', method: 'passkey' },
      };
    }
  }
  let confirmationConfig = input.options.confirmationConfig;
  let body = input.options.confirmerText?.body ?? 'Approve this transaction.';
  switch (approval.kind) {
    case 'fresh':
    case 'session':
      break;
    case 'session_start': {
      let uiMode = confirmationConfig?.uiMode ?? preferences.uiMode;
      if (uiMode === 'none') uiMode = preferences.uiMode === 'drawer' ? 'drawer' : 'modal';
      confirmationConfig = { uiMode, behavior: 'requireClick', autoProceedDelay: 0 };
      body = sessionConsentBody(approval);
      break;
    }
    default:
      return assertNeverApproval(approval);
  }
  return {
    type: UserConfirmationType.SIGN_INTENT_DIGEST,
    requestId: `ml-dsa:${preparation.request.operationIdB64u}`,
    intentDigest: approval.challengeB64u,
    confirmationConfig,
    summary: {
      title: input.options.confirmerText?.title ?? 'Sign NEAR transaction',
      body,
    },
    payload,
  };
}

function sessionConsentBody(
  approval: Variant<MlDsaTransactionApproval, 'kind', 'session_start'>,
): string {
  const session = approval.session;
  const seconds = Math.ceil(
    Math.max(session.policy.durationMs, session.expiresAtMs - Date.now()) / 1000,
  );
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  let duration = `${minutes}m`;
  if (remainder > 0) duration += ` ${remainder}s`;
  let operations = `${session.policy.maxOperations} operations`;
  if (session.policy.maxOperations === 1) operations = '1 operation';
  return `Signing session: up to ${operations}, including this transaction · ${duration} maximum.`;
}

function assertNeverApproval(approval: never): never {
  throw new Error(`Unsupported ML-DSA approval: ${String(approval)}`);
}

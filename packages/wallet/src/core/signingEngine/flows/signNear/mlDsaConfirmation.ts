import type { MlDsaNearTransactionInput } from './mlDsaTransaction';
import type { MlDsaSigningPreparation } from '@shared/near/mlDsaSigning';
import type { MlDsaTransactionApproval } from '../../walletCustody/mlDsaSigningSessions';
import type { TransactionInputWasm } from '@/core/types/actions';
import {
  UserConfirmationType,
  type UserConfirmRequest,
  type SignIntentDigestPayload,
} from '../../stepUpConfirmation/channel/confirmTypes';
import type { EmailOtpConfirmPrompt } from '../../stepUpConfirmation/types';
import { buildNearDisplayModel } from '../../chains/near/display';

export function mlDsaConfirmationRequest(
  input: MlDsaNearTransactionInput,
  preparation: MlDsaSigningPreparation,
  approval: MlDsaTransactionApproval,
  transactionInput: TransactionInputWasm,
  authPrompt:
    | { readonly kind: 'none' }
    | { readonly kind: 'email_otp'; readonly prompt: EmailOtpConfirmPrompt },
): UserConfirmRequest {
  const actor = approval.actor;
  const displayModel = buildNearDisplayModel({
    txSigningRequests: [transactionInput],
    signerLabel: 'ML-DSA-65',
    signerAccount: String(input.nearAccount.accountId),
    intentDigest: approval.challengeB64u,
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
  return {
    type: UserConfirmationType.SIGN_INTENT_DIGEST,
    requestId: `ml-dsa:${preparation.request.operationIdB64u}`,
    intentDigest: approval.challengeB64u,
    confirmationConfig: input.options.confirmationConfig,
    summary: {
      title: input.options.confirmerText?.title ?? 'Sign NEAR transaction',
      body:
        approval.kind === 'session_start'
          ? `This transaction uses one of ${approval.session.remainingOperations} permitted signing operations. The session expires at ${new Date(approval.session.expiresAtMs).toLocaleString()}. Failed operations consume one use.`
          : (input.options.confirmerText?.body ?? 'Approve this transaction.'),
    },
    payload,
  };
}

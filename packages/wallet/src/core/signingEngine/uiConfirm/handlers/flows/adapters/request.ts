import {
  SigningAuthPlanKind,
  signingAuthModeFromSigningAuthPlan,
  type EmailOtpConfirmPrompt,
  type SigningAuthMode,
} from '../../../../stepUpConfirmation/types';
import {
  type RegisterAccountPayload,
  type UserConfirmRequest,
  type LocalOnlyExportSubject,
  type SignIntentDigestSubject,
  type SignTransactionPayload,
} from '@/core/signingEngine/stepUpConfirmation/channel/confirmTypes';
import { UserConfirmationType } from '@/core/signingEngine/stepUpConfirmation/channel/confirmTypes';
import type { TxDisplayModel } from '@/core/signingEngine/interfaces/display';

export function assertSigningRequestContext(request: UserConfirmRequest): void {
  if (request.type !== UserConfirmationType.SIGN_TRANSACTION) return;
  const payload = request.payload;
  if (payload.signingKind !== 'transaction') return;
  const { subject, operation, signatureUses } = payload.nearFundingRequest;
  if (
    subject.walletId !== payload.walletId ||
    subject.nearAccountId !== payload.rpcCall.nearAccountId ||
    subject.nearPublicKeyStr !== payload.nearPublicKeyStr
  ) {
    throw new Error('Invalid secure confirm request: NEAR funding subject mismatch');
  }
  if (operation.accountId !== subject.nearAccountId) {
    throw new Error('Invalid secure confirm request: NEAR funding operation account mismatch');
  }
  if (!Number.isInteger(signatureUses) || signatureUses < 1) {
    throw new Error('Invalid secure confirm request: invalid NEAR funding signature use count');
  }
}

export function assertNoForbiddenMainThreadSigningSecrets(request: UserConfirmRequest): void {
  if (
    request.type !== UserConfirmationType.SIGN_TRANSACTION &&
    request.type !== UserConfirmationType.SIGN_NEP413_MESSAGE
  ) {
    return;
  }

  const payload = request.payload;
  if (payload.prfOutput !== undefined) {
    throw new Error('Invalid secure confirm request: forbidden signing payload field prfOutput');
  }
  if (payload.wrapKeySeed !== undefined) {
    throw new Error('Invalid secure confirm request: forbidden signing payload field wrapKeySeed');
  }
  if (payload.wrapKeySalt !== undefined) {
    throw new Error('Invalid secure confirm request: forbidden signing payload field wrapKeySalt');
  }
}

export function getNearAccountId(request: UserConfirmRequest): string {
  switch (request.type) {
    case UserConfirmationType.SIGN_TRANSACTION:
      return getSignTransactionPayload(request).rpcCall.nearAccountId;
    case UserConfirmationType.SIGN_NEP413_MESSAGE:
      return request.payload.nearAccountId;
    case UserConfirmationType.SIGN_INTENT_DIGEST: {
      const subject = getSignIntentDigestSubject(request);
      return subject.kind === 'near_wallet' ? subject.nearAccountId : '';
    }
    case UserConfirmationType.REGISTER_ACCOUNT:
    case UserConfirmationType.LINK_DEVICE:
      return String(getRegisterAccountPayload(request).nearAccountId || '').trim();
    case UserConfirmationType.AUTHORIZE_KEY_EXPORT: {
      const subject = getLocalOnlyExportSubject(request);
      return subject.kind === 'near_wallet' ? subject.nearAccountId : '';
    }
    case UserConfirmationType.SHOW_SECURE_PRIVATE_KEY_UI: {
      const subject = getLocalOnlyExportSubject(request);
      return subject.kind === 'near_wallet' ? subject.nearAccountId : '';
    }
    default:
      return '';
  }
}

export function getLocalOnlyExportSubject(request: UserConfirmRequest): LocalOnlyExportSubject {
  if (
    request.type !== UserConfirmationType.AUTHORIZE_KEY_EXPORT &&
    request.type !== UserConfirmationType.SHOW_SECURE_PRIVATE_KEY_UI
  ) {
    throw new Error(`Expected local key export request, got ${request.type}`);
  }
  return request.payload.subject;
}

export function getLocalOnlyExportSubjectId(request: UserConfirmRequest): string {
  const subject = getLocalOnlyExportSubject(request);
  switch (subject.kind) {
    case 'near_wallet':
      return subject.nearAccountId;
    case 'evm_wallet':
      return subject.walletId;
    default: {
      const exhaustive: never = subject;
      throw new Error(`Unsupported local key export subject: ${String(exhaustive)}`);
    }
  }
}

export function getSignIntentDigestSubject(request: UserConfirmRequest): SignIntentDigestSubject {
  if (request.type !== UserConfirmationType.SIGN_INTENT_DIGEST) {
    throw new Error(`Expected SIGN_INTENT_DIGEST request, got ${request.type}`);
  }
  return request.payload.signingSubject;
}

export function getWalletId(request: UserConfirmRequest): string {
  switch (request.type) {
    case UserConfirmationType.SIGN_TRANSACTION:
      return String(getSignTransactionPayload(request).walletId || '').trim();
    case UserConfirmationType.SIGN_NEP413_MESSAGE:
      return String(request.payload.walletId || '').trim();
    case UserConfirmationType.REGISTER_ACCOUNT:
    case UserConfirmationType.LINK_DEVICE:
      return String(getRegisterAccountPayload(request).walletId || '').trim();
    case UserConfirmationType.SIGN_INTENT_DIGEST: {
      const subject = getSignIntentDigestSubject(request);
      return subject.walletId;
    }
    case UserConfirmationType.AUTHORIZE_KEY_EXPORT:
    case UserConfirmationType.SHOW_SECURE_PRIVATE_KEY_UI:
      return getLocalOnlyExportSubjectId(request);
    default:
      return getNearAccountId(request);
  }
}

export function getTxCount(request: UserConfirmRequest): number {
  return request.type === UserConfirmationType.SIGN_TRANSACTION
    ? getSignTransactionPayload(request).txSigningRequests?.length || 1
    : 1;
}

export function getIntentDigest(request: UserConfirmRequest): string | undefined {
  if (request.type === UserConfirmationType.SIGN_TRANSACTION) {
    return request.payload.intentDigest;
  }
  return request?.intentDigest;
}

export function getSignTransactionPayload(request: UserConfirmRequest): SignTransactionPayload {
  if (request.type !== UserConfirmationType.SIGN_TRANSACTION) {
    throw new Error(`Expected SIGN_TRANSACTION request, got ${request.type}`);
  }
  return request.payload;
}

export function getDisplayModel(request: UserConfirmRequest): TxDisplayModel | undefined {
  if (request.type === UserConfirmationType.SIGN_TRANSACTION) {
    return getSignTransactionPayload(request).displayModel;
  }
  if (request.type === UserConfirmationType.SIGN_NEP413_MESSAGE) {
    return request.payload.displayModel;
  }
  if (request.type === UserConfirmationType.SIGN_INTENT_DIGEST) {
    return request.payload.displayModel;
  }
  return undefined;
}

export function getSigningAuthMode(request: UserConfirmRequest): SigningAuthMode | undefined {
  if (request.type === UserConfirmationType.SIGN_TRANSACTION) {
    const payload = getSignTransactionPayload(request);
    return signingAuthModeFromSigningAuthPlan(payload.signingAuthPlan);
  }
  if (request.type === UserConfirmationType.SIGN_NEP413_MESSAGE) {
    const payload = request.payload;
    return signingAuthModeFromSigningAuthPlan(payload.signingAuthPlan);
  }
  if (request.type === UserConfirmationType.SIGN_INTENT_DIGEST) {
    const payload = request.payload;
    return signingAuthModeFromSigningAuthPlan(payload.signingAuthPlan);
  }
  return undefined;
}

export function getEmailOtpPrompt(request: UserConfirmRequest): EmailOtpConfirmPrompt | undefined {
  if (request.type === UserConfirmationType.SIGN_TRANSACTION) {
    const payload = getSignTransactionPayload(request);
    return payload.signingAuthPlan?.kind === SigningAuthPlanKind.EmailOtpReauth
      ? payload.signingAuthPlan.emailOtpPrompt
      : payload.emailOtpPrompt;
  }
  if (request.type === UserConfirmationType.SIGN_NEP413_MESSAGE) {
    const payload = request.payload;
    return payload.signingAuthPlan?.kind === SigningAuthPlanKind.EmailOtpReauth
      ? payload.signingAuthPlan.emailOtpPrompt
      : payload.emailOtpPrompt;
  }
  if (request.type === UserConfirmationType.SIGN_INTENT_DIGEST) {
    const payload = request.payload;
    return payload.signingAuthPlan?.kind === SigningAuthPlanKind.EmailOtpReauth
      ? payload.signingAuthPlan.emailOtpPrompt
      : payload.emailOtpPrompt;
  }
  return undefined;
}

export function getNearPublicKeyStr(request: UserConfirmRequest): string | undefined {
  if (request.type === UserConfirmationType.SIGN_TRANSACTION) {
    const value = getSignTransactionPayload(request).nearPublicKeyStr;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
  if (request.type === UserConfirmationType.SIGN_NEP413_MESSAGE) {
    const value = request.payload.nearPublicKeyStr;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }
  return undefined;
}

export function getRegisterAccountPayload(request: UserConfirmRequest): RegisterAccountPayload {
  if (
    request.type !== UserConfirmationType.REGISTER_ACCOUNT &&
    request.type !== UserConfirmationType.LINK_DEVICE
  ) {
    throw new Error(`Expected REGISTER_ACCOUNT or LINK_DEVICE request, got ${request.type}`);
  }
  return request.payload;
}

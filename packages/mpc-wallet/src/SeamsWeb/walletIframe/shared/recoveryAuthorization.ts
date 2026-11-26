import type { WalletRecoveryOwnerFactor } from '@/SeamsWeb/publicApi/types';
import { requireRecord, requireTrimmedString } from '@shared/utils/validation';

export function parseWalletRecoveryRequest(value: unknown): {
  readonly walletId: string;
  readonly authorization: WalletRecoveryOwnerFactor;
} {
  const record = requireRecord(value, 'Recovery request');
  if (Object.prototype.hasOwnProperty.call(record, 'walletSessionToken')) {
    throw new Error('wallet iframe requests must not carry walletSessionToken');
  }
  const walletId = requireTrimmedString(record.walletId, 'Recovery wallet ID');
  const rawAuthorization = requireRecord(record.authorization, 'Recovery authorization');
  switch (rawAuthorization.kind) {
    case 'passkey':
      return { walletId, authorization: { kind: 'passkey' } };
    case 'email_otp':
      return { walletId, authorization: { kind: 'email_otp' } };
    default:
      throw new Error('Recovery authorization is invalid');
  }
}

import type { LocalWalletAuthMethodRecord } from '@/core/indexedDB';
import {
  parseWalletAuthorityId,
  type WalletAuthorityId,
} from '@shared/utils/domainIds';
import {
  buildWalletAuthMethodRecordV2,
  type WalletAuthMethodRecordV2,
} from '@shared/utils/registrationIntent';
import { buildEmailOtpWalletAuthAuthority } from '@shared/utils/walletAuthAuthority';

function requireWalletAuthorityId(value: string): WalletAuthorityId {
  const parsed = parseWalletAuthorityId(value);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

export function buildActiveEmailOtpAuthMethodFixture(args: {
  walletId: string;
  emailAddress: string;
  emailHashHex: string;
}): {
  record: Extract<WalletAuthMethodRecordV2, { kind: 'email_otp'; status: 'active' }>;
  localRecord: Extract<LocalWalletAuthMethodRecord, { kind: 'email_otp'; status: 'active' }>;
} {
  const authority = buildEmailOtpWalletAuthAuthority({
    walletId: args.walletId,
    provider: 'email',
    providerUserId: args.emailAddress,
    emailHashHex: args.emailHashHex,
  });
  const registrationAuthorityId = 'email-registration-authority:test';
  const record = buildWalletAuthMethodRecordV2({
    version: 'wallet_auth_method_v2',
    walletAuthMethodId: authority.bindingId,
    walletId: authority.walletId,
    walletAuthorityId: requireWalletAuthorityId('wallet-authority:test'),
    kind: 'email_otp',
    status: 'active',
    emailHashHex: args.emailHashHex,
    registrationAuthorityId,
    createdAtMs: 1,
    updatedAtMs: 2,
    activatedAtMs: 2,
  });
  return {
    record,
    localRecord: {
      version: 'wallet_auth_method_v1',
      kind: 'email_otp',
      status: 'active',
      walletId: authority.walletId,
      emailHashHex: args.emailHashHex,
      registrationAuthorityId,
      createdAtMs: 1,
      updatedAtMs: 2,
      localStatus: 'synced',
      authority,
    },
  };
}

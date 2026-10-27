import { parseWalletAuthMethodId, type WalletAuthMethodId } from '@shared/utils/domainIds';
import { requireRecord } from '@shared/utils/validation';
import { rejectUnknownFields } from '@shared/utils/exactRecord';

export type AuthMethodAvailability =
  | { readonly kind: 'not_enrolled'; readonly walletAuthMethodId?: never }
  | { readonly kind: 'enabled'; readonly walletAuthMethodId: WalletAuthMethodId }
  | { readonly kind: 'disabled'; readonly walletAuthMethodId: WalletAuthMethodId };

export function parseAuthMethodAvailability(value: unknown): AuthMethodAvailability {
  const record = requireRecord(value, 'authentication method availability');
  if (record.kind === 'not_enrolled') {
    rejectUnknownFields(record, ['kind'], 'authentication method availability');
    return { kind: 'not_enrolled' };
  }
  rejectUnknownFields(record, ['kind', 'walletAuthMethodId'], 'authentication method availability');
  const method = parseWalletAuthMethodId(record.walletAuthMethodId);
  if (!method.ok) throw new Error('Authentication method identity is invalid.');
  switch (record.kind) {
    case 'enabled':
      return { kind: 'enabled', walletAuthMethodId: method.value };
    case 'disabled':
      return { kind: 'disabled', walletAuthMethodId: method.value };
    default:
      throw new Error('Authentication method availability is invalid.');
  }
}

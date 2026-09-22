import type { GetRecentUnlocksResult } from '@/core/types/seams';
import type { LocalLoginAuthMethod } from '@/SeamsWeb/operations/auth/login';
import { WALLET_AUTH_METHODS } from '@shared/utils';
import type { AuthMenuAccountOption } from './domain';

function accountOptionKey(option: AuthMenuAccountOption): string {
  return `${option.walletId}:${option.authMethod}`;
}

function localAuthMethodOption(
  method: LocalLoginAuthMethod,
  existingOption: AuthMenuAccountOption | undefined,
): AuthMenuAccountOption {
  const walletId = String(method.walletId);
  switch (method.authMethod) {
    case 'passkey':
      return { walletId, authMethod: 'passkey' };
    case 'email_otp':
      return {
        walletId,
        authMethod: 'email_otp',
        emailAddress:
          method.emailAddress ??
          (existingOption?.authMethod === 'email_otp' ? existingOption.emailAddress : null),
      };
  }
}

export function loginAccountOptions(
  recentUnlocks: GetRecentUnlocksResult | null,
  localAuthMethods: readonly LocalLoginAuthMethod[] = [],
): AuthMenuAccountOption[] {
  const byWalletAuthMethod = new Map<string, AuthMenuAccountOption>();
  for (const account of recentUnlocks?.accounts ?? []) {
    if (
      account.authMethod !== WALLET_AUTH_METHODS.passkey &&
      account.authMethod !== WALLET_AUTH_METHODS.emailOtp
    )
      continue;
    const walletId = String(account.walletId || '').trim();
    if (!walletId) continue;
    const option: AuthMenuAccountOption =
      account.authMethod === WALLET_AUTH_METHODS.passkey
        ? { walletId, authMethod: 'passkey' }
        : {
            walletId,
            authMethod: 'email_otp',
            emailAddress: null,
          };
    byWalletAuthMethod.set(accountOptionKey(option), option);
  }
  for (const localMethod of localAuthMethods) {
    const walletId = String(localMethod.walletId || '').trim();
    if (!walletId) continue;
    const key = `${walletId}:${localMethod.authMethod}`;
    const option = localAuthMethodOption(localMethod, byWalletAuthMethod.get(key));
    byWalletAuthMethod.set(key, option);
  }
  return [...byWalletAuthMethod.values()];
}

export function defaultLoginAccount(
  recentUnlocks: GetRecentUnlocksResult | null,
  options: readonly AuthMenuAccountOption[],
): AuthMenuAccountOption | null {
  const lastUsedAccount = recentUnlocks?.lastUsedAccount;
  if (
    lastUsedAccount?.authMethod === WALLET_AUTH_METHODS.passkey ||
    lastUsedAccount?.authMethod === WALLET_AUTH_METHODS.emailOtp
  ) {
    const lastUsedWalletId = String(lastUsedAccount.walletId || '').trim();
    const exactMatch = options.find(
      (option) =>
        option.walletId === lastUsedWalletId && option.authMethod === lastUsedAccount.authMethod,
    );
    if (exactMatch) return exactMatch;
  }
  return options[0] ?? null;
}

export function passkeyRecentWalletId(recentUnlocks: GetRecentUnlocksResult | null): string | null {
  const account = recentUnlocks?.lastUsedAccount;
  if (
    !account ||
    (account.authMethod !== WALLET_AUTH_METHODS.passkey && account.authMethod !== 'linked_device')
  )
    return null;
  const walletId = String(account.walletId || '').trim();
  return walletId || null;
}

import React, { useContext } from 'react';
import type { WalletLocale } from '@/core/ui/locale';
import { walletDisplayText, walletText, type WalletMessage } from '@/core/ui/messages';

export const WalletLocaleContext = React.createContext<WalletLocale>('en');

export function useWalletLocale(): WalletLocale {
  return useContext(WalletLocaleContext);
}

type WalletTextProps =
  | { message: WalletMessage; copy?: never; values?: Readonly<Record<string, string | number>> }
  | { copy: string; message?: never };

export function WalletText(props: WalletTextProps): React.ReactNode {
  const locale = useWalletLocale();
  return props.message === undefined
    ? walletDisplayText(locale, props.copy)
    : walletText(locale, props.message, props.values);
}

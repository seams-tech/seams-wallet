/** @jsxImportSource preact */
import { createContext, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { WalletLocale } from '@/core/ui/locale';
import { walletDisplayText, walletText, type WalletMessage } from '@/core/ui/messages';

export const WalletLocaleContext = createContext<WalletLocale>('en');

export function useWalletLocale(): WalletLocale {
  return useContext(WalletLocaleContext);
}

export function withWalletLocale(locale: WalletLocale, children: ComponentChildren) {
  return <WalletLocaleContext.Provider value={locale}>{children}</WalletLocaleContext.Provider>;
}

type WalletTextProps =
  | { message: WalletMessage; copy?: never; values?: Readonly<Record<string, string | number>> }
  | { copy: string; message?: never };

export function WalletText(props: WalletTextProps): string {
  const locale = useWalletLocale();
  return props.message === undefined
    ? walletDisplayText(locale, props.copy)
    : walletText(locale, props.message, props.values);
}

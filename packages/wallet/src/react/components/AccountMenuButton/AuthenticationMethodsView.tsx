import { useWalletLocale } from '@/react/context/WalletLocale';
import { walletText, walletDisplayText } from '@/core/ui/messages';
import React from 'react';
import { AccountMenuDeviceDetails } from './AccountMenuDeviceDetails';
import { WalletIcon } from './icons/WalletIcon';

/** Shared presentation; callers own enrollment data and authenticated actions. */
export function AuthenticationMethodsView({
  walletLabel,
  children,
}: {
  walletLabel: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const locale = useWalletLocale();
  return (
    <>
      <AccountMenuDeviceDetails
        title={walletDisplayText(locale, walletLabel)}
        description={walletText(locale, 'This wallet')}
        details={[]}
        icon={<WalletIcon size={26} strokeWidth={1.5} />}
      />
      {children}
    </>
  );
}

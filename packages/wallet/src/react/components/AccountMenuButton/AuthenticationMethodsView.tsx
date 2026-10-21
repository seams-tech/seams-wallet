import { useWalletLocale } from '@/react/context/WalletLocale';
import { walletText, walletDisplayText } from '@/core/ui/messages';
import React from 'react';
import { AccountMenuDeviceDetails } from './AccountMenuDeviceDetails';

/** Shared presentation; callers own enrollment data and authenticated actions. */
export function AuthenticationMethodsView({
  walletLabel,
  status,
  children,
}: {
  walletLabel: string;
  status: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const locale = useWalletLocale();
  return (
    <>
      <AccountMenuDeviceDetails
        title={walletDisplayText(locale, walletLabel)}
        description={walletText(locale, 'This wallet')}
        details={[{ label: 'Status', value: status }]}
      />
      {children}
    </>
  );
}

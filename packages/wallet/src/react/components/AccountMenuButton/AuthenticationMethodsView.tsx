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
  return (
    <>
      <AccountMenuDeviceDetails
        title={walletLabel}
        description="This wallet"
        details={[{ label: 'Status', value: status }]}
      />
      {children}
    </>
  );
}

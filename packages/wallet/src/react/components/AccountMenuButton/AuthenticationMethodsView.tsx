import React from 'react';
import { AccountMenuDeviceDetails } from './AccountMenuDeviceDetails';

/** Shared presentation; callers own enrollment data and authenticated actions. */
export function AuthenticationMethodsView({
  walletLabel,
  status,
  onLinkDevice,
  children,
}: {
  walletLabel: string;
  status: string;
  onLinkDevice?: () => void;
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
      {onLinkDevice ? (
        <button type="button" className="seams-account-action primary" onClick={onLinkDevice}>
          Link a device
        </button>
      ) : null}
    </>
  );
}

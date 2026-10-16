import React from 'react';
import { AccountMenuScreen } from './AccountMenuScreen';
import { ExportKeysSection } from './ExportKeysSection';

/** Shared key selection; the connected caller owns the authenticated export. */
export function ExportKeysScreen({
  onBack,
  ...selection
}: {
  onBack: () => void;
} & Pick<
  React.ComponentProps<typeof ExportKeysSection>,
  'loadingChain' | 'canExportNearKey' | 'canExportEvmKeys' | 'onSelectChain'
>): React.JSX.Element {
  return (
    <AccountMenuScreen title="Export keys" onBack={onBack}>
      <p className="seams-account-description">
        Choose the signing key to export. Your wallet will ask you to authenticate.
      </p>
      <ExportKeysSection {...selection} isOpen />
      <p className="seams-account-note">
        Keep exported keys private. Anyone with a signing key can control its accounts.
      </p>
    </AccountMenuScreen>
  );
}

import React, { useState, useEffect } from 'react';
import { Theme } from '../theme/ThemeProvider';
import type { ThemeMode } from '../theme/ThemeProvider';
import type { ConfirmationConfig, ConfirmationUIMode } from '../../../core/types/signer-worker';
import { AccountMenuMockScreens, type AccountPreviewScreen } from './AccountMenuMockScreens';
import { TransactionSettingsSection } from './TransactionSettingsSection';
import { AccountMenuButtonView } from './AccountMenuButtonView';
import { useProfileState } from './hooks/useProfileState';
import type { AccountsSectionRow, MenuItem } from './types';
import { GlobeIcon } from './icons/GlobeIcon';
import { SlidersIcon } from './icons/SlidersIcon';
import { KeyIcon } from './icons/KeyIcon';
import { RecoveryCodesIcon } from './icons/RecoveryCodesIcon';
import TouchIcon from './icons/TouchIcon';
import { ScanIcon } from './icons/ScanIcon';
import { LinkIcon } from './icons/LinkIcon';

export interface AccountMenuButtonMockProps {
  /** Display-only identity. No wallet session or credentials are created. */
  username?: string;
  walletId?: string;
  theme?: ThemeMode;
  defaultOpen?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const accounts: AccountsSectionRow[] = [
  {
    id: 'near',
    label: 'NEAR',
    address: 'alex.near',
    href: 'https://nearblocks.io/address/alex.near',
  },
  {
    id: 'evm',
    label: 'Base',
    address: '0x42010000000000000000000000000000000000891c',
    href: 'https://basescan.org/address/0x42010000000000000000000000000000000000891c',
  },
];

function selectMode(
  setConfig: React.Dispatch<React.SetStateAction<ConfirmationConfig>>,
  uiMode: ConfirmationUIMode,
): void {
  setConfig({ uiMode, behavior: uiMode === 'none' ? 'skipClick' : 'requireClick' });
}

function toggleClick(
  setConfig: React.Dispatch<React.SetStateAction<ConfirmationConfig>>,
  current: ConfirmationConfig,
): void {
  setConfig({
    uiMode: current.uiMode,
    behavior: current.behavior === 'requireClick' ? 'skipClick' : 'requireClick',
  });
}

function setDelay(
  setConfig: React.Dispatch<React.SetStateAction<ConfirmationConfig>>,
  current: ConfirmationConfig,
  autoProceedDelay: number,
): void {
  setConfig({ uiMode: current.uiMode, behavior: current.behavior, autoProceedDelay });
}

function lockPreview(
  setStatus: React.Dispatch<React.SetStateAction<'ready' | 'logged_out'>>,
  close: () => void,
): void {
  setStatus('logged_out');
  close();
}
function openPreview(
  setStatus: React.Dispatch<React.SetStateAction<'ready' | 'logged_out'>>,
  toggle: () => void,
): void {
  setStatus('ready');
  toggle();
}

function resetPreviewNavigation(
  isOpen: boolean,
  setScreen: React.Dispatch<React.SetStateAction<AccountPreviewScreen>>,
): void {
  if (!isOpen) setScreen({ kind: 'overview' });
}

function AccountMenuPreview({
  username = 'Alex Chen',
  walletId = 'alex.near',
  theme = 'light',
  defaultOpen = true,
  className,
  style,
}: AccountMenuButtonMockProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const [status, setStatus] = useState<'ready' | 'logged_out'>('ready');
  const [screen, setScreen] = useState<AccountPreviewScreen>({ kind: 'overview' });
  const [confirmation, setConfirmation] = useState<ConfirmationConfig>({
    uiMode: 'modal',
    behavior: 'requireClick',
  });
  const { refs, isOpen, handleToggle, handleClose } = useProfileState({
    open,
    onOpenChange: setOpen,
  });
  useEffect(resetPreviewNavigation.bind(null, isOpen, setScreen), [isOpen]);
  const menuItems: MenuItem[] = [
    {
      id: 'accounts',
      icon: <GlobeIcon />,
      label: 'Accounts',
      description: 'View accounts on block explorers',
      disabled: false,
      keepOpenOnClick: true,
      onClick: setScreen.bind(null, { kind: 'accounts' }),
    },
    {
      id: 'export-keys',
      icon: <KeyIcon />,
      label: 'Export keys',
      description: 'Export wallet signing keys',
      disabled: false,
      keepOpenOnClick: true,
      onClick: setScreen.bind(null, { kind: 'export-keys' }),
    },
    {
      id: 'recovery-codes',
      icon: <RecoveryCodesIcon />,
      label: 'Recovery codes',
      description: 'Back up wallet recovery codes',
      disabled: false,
      keepOpenOnClick: true,
      onClick: setScreen.bind(null, { kind: 'recovery', revealed: false }),
    },
    {
      id: 'authentication-methods',
      icon: <TouchIcon />,
      label: 'Authentication methods',
      description: 'Add or remove ways to unlock this device',
      disabled: false,
      keepOpenOnClick: true,
      onClick: setScreen.bind(null, { kind: 'methods' }),
    },
    {
      id: 'scan-link-device',
      icon: <ScanIcon />,
      label: 'Scan and link device',
      description: 'Scan QR to link a device',
      disabled: false,
      keepOpenOnClick: true,
      onClick: setScreen.bind(null, { kind: 'scanner' }),
    },
    {
      id: 'linked-devices',
      icon: <LinkIcon />,
      label: 'Linked devices',
      description: 'See devices using this wallet',
      disabled: false,
      keepOpenOnClick: true,
      onClick: setScreen.bind(null, { kind: 'linked' }),
    },
    {
      id: 'transaction-settings',
      icon: <SlidersIcon />,
      label: 'Transaction settings',
      description: 'Customize confirmation behavior',
      disabled: false,
      keepOpenOnClick: true,
      onClick: setScreen.bind(null, { kind: 'transactions' }),
    },
  ];
  return (
    <AccountMenuButtonView
      buttonRef={refs.buttonRef}
      dropdownRef={refs.dropdownRef}
      className={className}
      style={style}
      trigger={{
        label: status === 'logged_out' ? 'Logged out' : 'Settings',
        username,
        fullAccountId: walletId,
        hideUsername: false,
        isOpen,
        onClick: openPreview.bind(null, setStatus, handleToggle),
        theme,
      }}
      dropdown={{
        isOpen,
        menuItems,
        menuItemsRef: refs.menuItemsRef,
        onClose: handleClose,
        onLock: lockPreview.bind(null, setStatus, handleClose),
        theme,
      }}
    >
      {screen.kind === 'overview' ? null : (
        <AccountMenuMockScreens
          screen={screen}
          setScreen={setScreen}
          accounts={accounts}
          walletId={walletId}
          transactionSettings={
            <TransactionSettingsSection
              currentConfirmConfig={confirmation}
              onSetUiMode={selectMode.bind(null, setConfirmation)}
              onToggleSkipClick={toggleClick.bind(null, setConfirmation, confirmation)}
              onSetDelay={setDelay.bind(null, setConfirmation, confirmation)}
              isOpen
              theme={theme}
            />
          }
        />
      )}
    </AccountMenuButtonView>
  );
}

/** Provider-free interactive preview using the connected AccountMenuButton's renderer.
 * Navigation, confirmation preferences, devices, recovery and export previews stay local.
 * This component never opens a camera, signs, exports keys or accesses storage.
 */
export function AccountMenuButtonMock(props: AccountMenuButtonMockProps): React.JSX.Element {
  return (
    <Theme theme={props.theme ?? 'light'}>
      <AccountMenuPreview {...props} />
    </Theme>
  );
}

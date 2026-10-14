import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Theme } from '../theme/ThemeProvider';
import type { ThemeMode } from '../theme/ThemeProvider';
import type { ConfirmationConfig, ConfirmationUIMode } from '../../../core/types/signer-worker';
import { AccountMenuMockOverlay } from './AccountMenuMockOverlay';
import { AccountMenuButtonView } from './AccountMenuButtonView';
import { useProfileState } from './hooks/useProfileState';
import type { AccountsSectionRow, MenuItem, ProfileSettingsMenuItemId } from './types';
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
  /** Backdrop treatment for preview overlays. Defaults to dimmed. */
  backdrop?: 'dimmed' | 'none';
  className?: string;
  style?: React.CSSProperties;
  /** Optional preview navigation. Wallet-operation rows are disabled without this callback. */
  onAction?: (action: ProfileSettingsMenuItemId) => void;
}

type Section = 'menu' | 'accounts' | 'transactions';
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

function toggleSection(
  setSection: React.Dispatch<React.SetStateAction<Section>>,
  current: Section,
  next: Section,
): void {
  setSection(current === next ? 'menu' : next);
}

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

function previewAction(
  onAction: AccountMenuButtonMockProps['onAction'],
  action: ProfileSettingsMenuItemId,
): void {
  onAction?.(action);
}

function AccountMenuPreview({
  username = 'Alex Chen',
  walletId = 'alex.near',
  theme = 'light',
  defaultOpen = true,
  backdrop = 'dimmed',
  className,
  style,
  onAction,
}: AccountMenuButtonMockProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const [overlay, setOverlay] = useState<'none' | 'methods' | 'scanner'>('none');
  const [section, setSection] = useState<Section>('menu');
  const [confirmation, setConfirmation] = useState<ConfirmationConfig>({
    uiMode: 'modal',
    behavior: 'requireClick',
  });
  const { refs, isOpen, handleToggle, handleClose } = useProfileState({
    open,
    onOpenChange: setOpen,
  });
  const externalDisabled = onAction === undefined;
  const menuItems: MenuItem[] = [
    {
      id: 'accounts',
      icon: <GlobeIcon />,
      label: 'Accounts',
      description: 'View accounts on block explorers',
      disabled: false,
      keepOpenOnClick: true,
      onClick: toggleSection.bind(null, setSection, section, 'accounts'),
    },
    {
      id: 'export-keys',
      icon: <KeyIcon />,
      label: 'Export Keys',
      description: 'Export wallet signing keys',
      disabled: externalDisabled,
      keepOpenOnClick: true,
      onClick: previewAction.bind(null, onAction, 'export-keys'),
    },
    {
      id: 'recovery-codes',
      icon: <RecoveryCodesIcon />,
      label: 'Recovery Codes',
      description: 'Back up wallet recovery codes',
      disabled: externalDisabled,
      keepOpenOnClick: true,
      onClick: previewAction.bind(null, onAction, 'recovery-codes'),
    },
    {
      id: 'authentication-methods',
      icon: <TouchIcon />,
      label: 'Authentication Methods',
      description: 'Add or remove ways to unlock this device',
      disabled: false,
      keepOpenOnClick: true,
      onClick: setOverlay.bind(null, 'methods'),
    },
    {
      id: 'scan-link-device',
      icon: <ScanIcon />,
      label: 'Scan and Link Device',
      description: 'Scan QR to link a device',
      disabled: false,
      keepOpenOnClick: true,
      onClick: setOverlay.bind(null, 'scanner'),
    },
    {
      id: 'linked-devices',
      icon: <LinkIcon />,
      label: 'Linked Devices',
      description: 'See devices using this wallet',
      disabled: externalDisabled,
      keepOpenOnClick: true,
      onClick: previewAction.bind(null, onAction, 'linked-devices'),
    },
    {
      id: 'transaction-settings',
      icon: <SlidersIcon />,
      label: 'Transaction Settings',
      description: 'Customize confirmation behavior',
      disabled: false,
      keepOpenOnClick: true,
      onClick: toggleSection.bind(null, setSection, section, 'transactions'),
    },
  ];
  return (
    <AccountMenuButtonView
      buttonRef={refs.buttonRef}
      dropdownRef={refs.dropdownRef}
      className={className}
      style={style}
      trigger={{
        username,
        fullAccountId: walletId,
        hideUsername: false,
        isOpen,
        onClick: handleToggle,
        theme,
      }}
      dropdown={{
        isOpen,
        menuItems,
        menuItemsRef: refs.menuItemsRef,
        onClose: handleClose,
        onLock: handleClose,
        canExportNearKey: false,
        canExportEvmKeys: false,
        accountsRows: accounts,
        accountsOpen: section === 'accounts',
        transactionSettingsOpen: section === 'transactions',
        currentConfirmConfig: confirmation,
        onSetUiMode: selectMode.bind(null, setConfirmation),
        onToggleSkipClick: toggleClick.bind(null, setConfirmation, confirmation),
        onSetDelay: setDelay.bind(null, setConfirmation, confirmation),
        theme,
      }}
    >
      {overlay !== 'none' &&
        createPortal(
          <AccountMenuMockOverlay
            backdrop={backdrop}
            kind={overlay}
            onClose={setOverlay.bind(null, 'none')}
          />,
          document.body,
        )}
    </AccountMenuButtonView>
  );
}

/** Provider-free interactive preview using the connected AccountMenuButton's renderer.
 * Accounts, confirmation preferences, authentication methods, scanner preview, expansion and locking stay local. Other
 * rows emit onAction; this component never opens a camera, signs, exports keys or accesses storage.
 */
export function AccountMenuButtonMock(props: AccountMenuButtonMockProps): React.JSX.Element {
  return (
    <Theme theme={props.theme ?? 'light'}>
      <AccountMenuPreview {...props} />
    </Theme>
  );
}

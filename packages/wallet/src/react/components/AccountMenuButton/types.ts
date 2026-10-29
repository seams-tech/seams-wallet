import type { ToggleColorProps } from './Toggle';
import type { KeyExportFlowEvent, LinkDeviceFlowEvent } from '@/core/types/sdkSentEvents';
import type { ThemeMode } from '@/core/signingEngine/uiConfirm/ui/confirm-ui-types';
import type { ConfirmationConfig } from '@/core/types/signer-worker';

export interface ProfileDimensions {
  width: number;
  height: number;
}

export interface ProfileAnimationConfig {
  duration: number;
  delay: number;
  ease: string;
}

export const PROFILE_MENU_ITEM_IDS = {
  ACCOUNTS: 'accounts',
  EXPORT_KEYS: 'export-keys',
  AUTHENTICATION_METHODS: 'authentication-methods',
  RECOVERY_CODES: 'recovery-codes',
  SCAN_LINK_DEVICE: 'scan-link-device',
  LINKED_DEVICES: 'linked-devices',
  TRANSACTION_SETTINGS: 'transaction-settings',
  WALLET_REGION: 'wallet-region',
} as const;

/** Which threshold key set an Export Keys row exports. */
export type ExportChain = 'near' | 'evm';

/** One chain row in the expandable Accounts section: links out to the chain's
 * block explorer on the user's account page. */
export interface AccountsSectionRow {
  id: string;
  label: string;
  address: string;
  href: string;
}

export type ProfileSettingsMenuItemId =
  (typeof PROFILE_MENU_ITEM_IDS)[keyof typeof PROFILE_MENU_ITEM_IDS];

export interface MenuItem {
  id?: ProfileSettingsMenuItemId | (string & {});
  icon: React.ReactNode;
  label: string;
  description: string;
  disabled: boolean;
  onClick?: () => void;
  // When true, clicking this item will NOT close the dropdown
  keepOpenOnClick?: boolean;
}

export interface HighlightedProfileMenuItem {
  id: ProfileSettingsMenuItemId | (string & {});
  /**
   * When true (default), focus the highlighted button when the menu opens.
   */
  focus?: boolean;
}

export interface DeviceLinkingScannerParams {
  onError?: (error: Error) => void;
  onClose?: () => void;
  onEvent?: (event: LinkDeviceFlowEvent) => void;
  fundingAmount?: string;
}

type AccountMenuOpenChange = (open: boolean) => void;

type AccountMenuDropdownControl =
  | { isMenuOpen?: never; onMenuOpenChange?: AccountMenuOpenChange }
  | { isMenuOpen: boolean; onMenuOpenChange: AccountMenuOpenChange };

type AccountMenuDropdownPresentation = { presentation?: 'dropdown' } & AccountMenuDropdownControl;
type AccountMenuDialogPresentation = {
  presentation: 'modal' | 'drawer';
  isMenuOpen: boolean;
  onMenuOpenChange: AccountMenuOpenChange;
};
export type AccountMenuPresentation =
  | AccountMenuDropdownPresentation
  | AccountMenuDialogPresentation;

export type AccountMenuPresentationMode = NonNullable<AccountMenuPresentation['presentation']>;

export interface AccountMenuButtonOptions {
  /**
   * Null while the wallet has no NEAR account yet — its Ed25519 Yao ceremony
   * has not settled. The menu renders without NEAR rows in that state.
   */
  nearAccountId: string | null;
  nearExplorerBaseUrl?: string;
  username?: string | null;
  hideUsername?: boolean;
  onLock?: () => void;
  // Key-export failures surface here so the host can toast/log them;
  // the menu itself never renders error text inline
  onExportKeyError?: (error: Error) => void;
  onExportKeyEvent?: (event: KeyExportFlowEvent) => void;
  // QR Code Scanner parameters
  deviceLinkingScannerParams?: DeviceLinkingScannerParams;
  // styles
  toggleColors?: ToggleColorProps;
  style?: React.CSSProperties;
  className?: string;
  highlightedMenuItem?: HighlightedProfileMenuItem | null;
}

export type AccountMenuButtonProps = AccountMenuButtonOptions & AccountMenuPresentation;

export type ProfileSettingsButtonProps = AccountMenuButtonProps;

export interface UserAccountButtonProps {
  label?: string;
  username: string;
  hideUsername: boolean;
  fullAccountId?: string;
  emailAddress?: string;
  isOpen: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  theme?: ThemeMode;
  // Optional ARIA linkage
  menuId?: string;
  triggerId?: string;
}

export interface ProfileDropdownProps {
  isOpen: boolean;
  menuItems: MenuItem[];
  onLock: () => void;
  onClose: () => void;
  toggleColors?: ToggleColorProps;
  theme?: ThemeMode;
  menuItemsRef: React.MutableRefObject<(HTMLElement | null)[]>;
  // Optional ARIA linkage
  menuId?: string;
  triggerId?: string;
  highlightedMenuItemId?: string;
}

export interface MenuItemProps {
  item: MenuItem;
  onClose: () => void;
  className?: string;
  style?: React.CSSProperties;
  isHighlighted?: boolean;
}

export interface LockMenuItemProps {
  onLock: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export interface ProfileRelayerToggleSectionProps {
  toggleColors?: ToggleColorProps;
  className?: string;
  style?: React.CSSProperties;
}

export interface TransactionSettingsSectionProps {
  presentation?: 'menu' | 'page';
  currentConfirmConfig: ConfirmationConfig;
  onSetUiMode?: (mode: 'none' | 'modal' | 'drawer') => void;
  onToggleShowDetails?: () => void;
  onToggleSkipClick: () => void;
  onSetDelay: (delay: number) => void;
  className?: string;
  style?: React.CSSProperties;
  isOpen?: boolean;
  theme?: ThemeMode;
}

export interface ProfileStateRefs {
  buttonRef: React.RefObject<HTMLDivElement | null>;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  menuItemsRef: React.MutableRefObject<(HTMLElement | null)[]>;
}

export type { ToggleColorProps };

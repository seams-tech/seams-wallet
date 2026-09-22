import React, { Component, type ReactNode } from 'react';
import { SEAMS_STANDARD_WORDMARK_PATH } from '@/core/signingEngine/uiConfirm/ui/seamsWordmarkPaths';
import type { MenuItem, ProfileSettingsMenuItemId } from './types';
import { PROFILE_MENU_ITEM_IDS } from './types';
import { GlobeIcon } from './icons/GlobeIcon';
import { KeyIcon } from './icons/KeyIcon';
import { RecoveryCodesIcon } from './icons/RecoveryCodesIcon';
import TouchIcon from './icons/TouchIcon';
import { ScanIcon } from './icons/ScanIcon';
import { LinkIcon } from './icons/LinkIcon';
import { SlidersIcon } from './icons/SlidersIcon';
import { LockIcon } from './icons/LockIcon';
import './WalletSettingsLayout.css';

const SETTINGS_ITEMS = [
  {
    id: PROFILE_MENU_ITEM_IDS.ACCOUNTS,
    label: 'Accounts',
    description: 'View accounts on block explorers',
    icon: <GlobeIcon />,
  },
  {
    id: PROFILE_MENU_ITEM_IDS.EXPORT_KEYS,
    label: 'Export keys',
    description: 'Export wallet signing keys',
    icon: <KeyIcon />,
  },
  {
    id: PROFILE_MENU_ITEM_IDS.RECOVERY_CODES,
    label: 'Recovery codes',
    description: 'Back up your wallet recovery codes',
    icon: <RecoveryCodesIcon />,
  },
  {
    id: PROFILE_MENU_ITEM_IDS.AUTHENTICATION_METHODS,
    label: 'Authentication methods',
    description: 'Choose how you unlock this device',
    icon: <TouchIcon />,
  },
  {
    id: PROFILE_MENU_ITEM_IDS.SCAN_LINK_DEVICE,
    label: 'Scan and link device',
    description: 'Scan a QR code to link a device',
    icon: <ScanIcon />,
  },
  {
    id: PROFILE_MENU_ITEM_IDS.LINKED_DEVICES,
    label: 'Linked devices',
    description: 'See devices using this wallet',
    icon: <LinkIcon />,
  },
  {
    id: PROFILE_MENU_ITEM_IDS.TRANSACTION_SETTINGS,
    label: 'Transaction settings',
    description: 'Customize confirmation behavior',
    icon: <SlidersIcon />,
  },
] satisfies readonly {
  id: ProfileSettingsMenuItemId;
  label: string;
  description: string;
  icon: ReactNode;
}[];

export function WalletSettingsHeader() {
  return (
    <header className="seams-settings-header">
      <svg className="seams-settings-wordmark" viewBox="0 0 1428 285" role="img" aria-label="Seams">
        <path d={SEAMS_STANDARD_WORDMARK_PATH} fill="currentColor" fillRule="evenodd" />
      </svg>
      <span>Wallet</span>
    </header>
  );
}

interface WalletSettingsLayoutProps {
  readonly walletId: string;
  readonly menuItems: readonly MenuItem[];
  readonly sections: Readonly<Record<ProfileSettingsMenuItemId, ReactNode>>;
  readonly onLock: () => Promise<void>;
  readonly error: string | null;
}

type LayoutState = {
  readonly selected: ProfileSettingsMenuItemId;
  readonly mobileMenuOpen: boolean;
  readonly lock: { kind: 'idle' } | { kind: 'locking' } | { kind: 'failed'; message: string };
};

export class WalletSettingsLayout extends Component<WalletSettingsLayoutProps, LayoutState> {
  state: LayoutState = {
    selected: 'authentication-methods',
    mobileMenuOpen: false,
    lock: { kind: 'idle' },
  };
  private heading = React.createRef<HTMLHeadingElement>();

  private select = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const item = SETTINGS_ITEMS.find(
      this.matchesSelection.bind(null, event.currentTarget.dataset.section),
    );
    if (!item) return;
    this.setState({ selected: item.id, mobileMenuOpen: false }, this.focusHeading);
  };

  private matchesSelection(id: string | undefined, item: (typeof SETTINGS_ITEMS)[number]): boolean {
    return item.id === id;
  }

  private focusHeading = (): void => {
    this.heading.current?.focus();
  };
  private isAvailableSelection = (item: MenuItem): boolean => item.id === this.state.selected;
  private toggleMobileMenu = (): void => {
    this.setState({ mobileMenuOpen: !this.state.mobileMenuOpen });
  };

  private lock = async (): Promise<void> => {
    if (this.state.lock.kind === 'locking') return;
    this.setState({ lock: { kind: 'locking' } });
    try {
      await this.props.onLock();
    } catch (error) {
      this.setState({
        lock: {
          kind: 'failed',
          message:
            error instanceof Error ? error.message : 'Unable to lock your wallet. Try again.',
        },
      });
    }
  };

  private renderItem = (item: (typeof SETTINGS_ITEMS)[number]): ReactNode => (
    <button
      key={item.id}
      type="button"
      data-section={item.id}
      onClick={this.select}
      aria-current={this.state.selected === item.id ? 'page' : undefined}
    >
      <span className="seams-settings-nav-icon" aria-hidden="true">
        {item.icon}
      </span>
      <span>
        <strong>{item.label}</strong>
        <small>{item.description}</small>
      </span>
    </button>
  );

  render() {
    const selected = SETTINGS_ITEMS.find(this.matchesSelection.bind(null, this.state.selected))!;
    const available = this.props.menuItems.find(this.isAvailableSelection);
    return (
      <div className="seams-settings-page">
        <WalletSettingsHeader />
        <div className="seams-settings-shell">
          <aside className="seams-settings-sidebar">
            <div className="seams-settings-identity">
              <TouchIcon />
              <div>
                <strong>{this.props.walletId}</strong>
                <small>Unlocked on this device</small>
              </div>
            </div>
            <button
              className="seams-settings-mobile-toggle"
              type="button"
              onClick={this.toggleMobileMenu}
              aria-expanded={this.state.mobileMenuOpen}
              aria-controls="seams-settings-navigation"
            >
              All settings
            </button>
            <nav
              id="seams-settings-navigation"
              className="seams-settings-navigation"
              data-expanded={this.state.mobileMenuOpen}
              aria-label="Wallet settings"
            >
              {SETTINGS_ITEMS.map(this.renderItem)}
              <div className="seams-settings-lock">
                <button
                  type="button"
                  onClick={this.lock}
                  disabled={this.state.lock.kind === 'locking'}
                >
                  <LockIcon />
                  <strong>{this.state.lock.kind === 'locking' ? 'Locking…' : 'Lock wallet'}</strong>
                </button>
              </div>
            </nav>
          </aside>
          <main className="seams-settings-main">
            <p className="seams-settings-breadcrumb">Wallet settings</p>
            <h1 ref={this.heading} tabIndex={-1}>
              {selected.label}
            </h1>
            <p className="seams-settings-description">{selected.description}</p>
            {this.props.error ? <p role="alert">{this.props.error}</p> : null}
            {this.state.lock.kind === 'failed' ? (
              <p role="alert">{this.state.lock.message}</p>
            ) : null}
            <div className="seams-settings-content" key={selected.id}>
              {available && !available.disabled ? (
                this.props.sections[selected.id]
              ) : (
                <p role="status">This setting is unavailable for the current wallet or device.</p>
              )}
            </div>
            <footer>Your wallet. Your control.</footer>
          </main>
        </div>
      </div>
    );
  }
}

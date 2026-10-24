import { WalletText, WalletLocaleContext, useWalletLocale } from '@/react/context/WalletLocale';
import { walletText, walletDisplayText } from '@/core/ui/messages';
import type { WalletLocale } from '@/core/ui/locale';
import { WalletRegionSection } from './WalletRegionSection';
import type { WalletPlacementCapability } from '@/SeamsWeb/publicApi/placement';
import type { WalletId } from '@shared/utils/domainIds';
import React, { Component, type ReactNode } from 'react';
import { SEAMS_STANDARD_WORDMARK_PATH } from '@/core/signingEngine/uiConfirm/ui/seamsWordmarkPaths';
import { blinkMenuItem } from '@/utils/menuItemBlink';
import type { MenuItem, ProfileSettingsMenuItemId } from './types';
import { PROFILE_MENU_ITEM_IDS } from './types';
import { GlobeIcon } from './icons/GlobeIcon';
import { MapPinIcon } from './icons/MapPinIcon';
import { KeyIcon } from './icons/KeyIcon';
import { RecoveryCodesIcon } from './icons/RecoveryCodesIcon';
import TouchIcon from './icons/TouchIcon';
import { ScanIcon } from './icons/ScanIcon';
import { LinkIcon } from './icons/LinkIcon';
import { SlidersIcon } from './icons/SlidersIcon';
import { LockIcon } from './icons/LockIcon';
import { useSeams } from '../../context';
import { useTheme } from '../theme';
import { SunIcon } from './icons/SunIcon';
import { MoonIcon } from './icons/MoonIcon';
import './WalletSettingsLayout.css';

const SETTINGS_ITEMS = [
  {
    id: PROFILE_MENU_ITEM_IDS.ACCOUNTS,
    label: 'Accounts',
    description: 'View accounts on block explorers',
    icon: <GlobeIcon />,
  },
  {
    id: PROFILE_MENU_ITEM_IDS.TRANSACTION_SETTINGS,
    label: 'Transaction settings',
    description: 'Customize confirmation behavior',
    icon: <SlidersIcon />,
  },
  {
    id: PROFILE_MENU_ITEM_IDS.AUTHENTICATION_METHODS,
    label: 'Authentication methods',
    description: 'Choose how you unlock this device',
    icon: <TouchIcon />,
  },
  {
    id: PROFILE_MENU_ITEM_IDS.RECOVERY_CODES,
    label: 'Recovery codes',
    description: 'Back up your wallet recovery codes',
    icon: <RecoveryCodesIcon />,
  },
  {
    id: PROFILE_MENU_ITEM_IDS.LINKED_DEVICES,
    label: 'Linked devices',
    description: 'See devices using this wallet',
    icon: <LinkIcon />,
  },
  {
    id: PROFILE_MENU_ITEM_IDS.SCAN_LINK_DEVICE,
    label: 'Scan and link device',
    description: 'Scan a QR code to link a device',
    icon: <ScanIcon />,
  },
  {
    id: PROFILE_MENU_ITEM_IDS.WALLET_REGION,
    label: 'Wallet region',
    description: 'Choose where your wallet runs',
    icon: <MapPinIcon />,
  },
  {
    id: PROFILE_MENU_ITEM_IDS.EXPORT_KEYS,
    label: 'Export keys',
    description: 'Export wallet signing keys',
    icon: <KeyIcon />,
  },
] satisfies readonly {
  id: ProfileSettingsMenuItemId;
  label: string;
  description: string;
  icon: ReactNode;
}[];

export function WalletSettingsHeader() {
  const locale = useWalletLocale();
  const { theme } = useTheme();
  const { seams } = useSeams();
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  return (
    <header className="seams-settings-header">
      <svg className="seams-settings-wordmark" viewBox="0 0 1428 285" role="img" aria-label="Seams">
        <path d={SEAMS_STANDARD_WORDMARK_PATH} fill="currentColor" fillRule="evenodd" />
      </svg>
      <span>
        <WalletText message="Wallet" />
      </span>
      <button
        className="seams-settings-theme-toggle"
        type="button"
        aria-label={walletDisplayText(locale, `Switch to ${nextTheme} mode`)}
        onClick={seams.config.setTheme.bind(null, nextTheme)}
      >
        {theme === 'dark' ? (
          <SunIcon size={20} animate={false} />
        ) : (
          <MoonIcon size={20} animate={false} />
        )}
        <span>
          {theme === 'dark' ? (
            <WalletText message="Light mode" />
          ) : (
            <WalletText message="Dark mode" />
          )}
        </span>
      </button>
    </header>
  );
}

interface WalletSettingsLayoutProps {
  readonly walletId: WalletId;
  readonly placement: WalletPlacementCapability;
  readonly menuItems: readonly MenuItem[];
  readonly sections: Readonly<
    Record<Exclude<ProfileSettingsMenuItemId, 'wallet-region'>, ReactNode>
  >;
  readonly onLock: () => Promise<void>;
  readonly error: string | null;
}

type LayoutState = {
  readonly regionReady: boolean;
  readonly selected: ProfileSettingsMenuItemId;
  readonly mobileMenuOpen: boolean;
  readonly lock: { kind: 'idle' } | { kind: 'locking' } | { kind: 'failed'; message: string };
};

export class WalletSettingsLayout extends Component<WalletSettingsLayoutProps, LayoutState> {
  static contextType = WalletLocaleContext;
  declare context: WalletLocale;

  state: LayoutState = {
    regionReady: true,
    selected: 'authentication-methods',
    mobileMenuOpen: false,
    lock: { kind: 'idle' },
  };
  private regionAvailability = (regionReady: boolean): void => {
    this.setState({ regionReady });
  };

  private heading = React.createRef<HTMLHeadingElement>();

  private select = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const item = SETTINGS_ITEMS.find(
      this.matchesSelection.bind(null, event.currentTarget.dataset.section),
    );
    if (!item) return;
    const commit = (): void => {
      this.setState({ selected: item.id, mobileMenuOpen: false }, this.focusHeading);
    };
    // On mobile the list closes on a choice, so the chosen row blinks first.
    if (!this.state.mobileMenuOpen) {
      commit();
      return;
    }
    void blinkMenuItem(event.currentTarget)?.then(commit);
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
      disabled={!this.state.regionReady && item.id !== 'wallet-region'}
      onClick={this.select}
      aria-current={
        (this.state.regionReady ? this.state.selected : 'wallet-region') === item.id
          ? 'page'
          : undefined
      }
    >
      <span className="seams-settings-nav-icon" aria-hidden="true">
        {item.icon}
      </span>
      <span>
        <strong>
          <WalletText copy={item.label} />
        </strong>
        <small>
          <WalletText copy={item.description} />
        </small>
      </span>
    </button>
  );

  render() {
    const selectedId = this.state.regionReady ? this.state.selected : 'wallet-region';
    const selected = SETTINGS_ITEMS.find(this.matchesSelection.bind(null, selectedId))!;
    const regionAllowed = this.props.menuItems.some(regionSettingAvailable);
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
                <small>
                  <WalletText message="Unlocked on this device" />
                </small>
              </div>
            </div>
            <button
              className="seams-settings-mobile-toggle"
              type="button"
              onClick={this.toggleMobileMenu}
              aria-expanded={this.state.mobileMenuOpen}
              aria-controls="seams-settings-navigation"
            >
              <WalletText message="All settings" />
            </button>
            <nav
              id="seams-settings-navigation"
              className="seams-settings-navigation"
              data-expanded={this.state.mobileMenuOpen}
              aria-label={walletText(this.context, 'Wallet settings')}
            >
              {SETTINGS_ITEMS.map(this.renderItem)}
              <div className="seams-settings-lock">
                <button
                  type="button"
                  onClick={this.lock}
                  disabled={this.state.lock.kind === 'locking'}
                >
                  <LockIcon />
                  <strong>
                    {this.state.lock.kind === 'locking' ? (
                      <WalletText message="Locking…" />
                    ) : (
                      <WalletText message="Lock wallet" />
                    )}
                  </strong>
                </button>
              </div>
            </nav>
          </aside>
          <main className="seams-settings-main">
            <p className="seams-settings-breadcrumb">
              <WalletText message="Wallet settings" />
            </p>
            <h1 ref={this.heading} tabIndex={-1}>
              <WalletText copy={selected.label} />
            </h1>
            <p className="seams-settings-description">
              <WalletText copy={selected.description} />
            </p>
            {this.props.error ? (
              <p role="alert">
                <WalletText copy={this.props.error} />
              </p>
            ) : null}
            {this.state.lock.kind === 'failed' ? (
              <p role="alert">
                <WalletText copy={this.state.lock.message} />
              </p>
            ) : null}
            <div className="seams-settings-content" hidden={selected.id !== 'wallet-region'}>
              {regionAllowed ? (
                <WalletRegionSection
                  key={this.props.walletId}
                  walletId={this.props.walletId}
                  placement={this.props.placement}
                  onAvailability={this.regionAvailability}
                />
              ) : (
                <p>
                  <WalletText message="This setting is unavailable for the current wallet or device." />
                </p>
              )}
            </div>
            {selected.id !== 'wallet-region' ? (
              <div className="seams-settings-content" key={selected.id}>
                {available && !available.disabled ? (
                  this.props.sections[selected.id]
                ) : (
                  <p role="status">
                    <WalletText message="This setting is unavailable for the current wallet or device." />
                  </p>
                )}
              </div>
            ) : null}
            <footer>
              <WalletText message="Your wallet. Your control." />
            </footer>
          </main>
        </div>
      </div>
    );
  }
}

function regionSettingAvailable(item: MenuItem): boolean {
  return item.id === 'wallet-region' && !item.disabled;
}

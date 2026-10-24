import { WalletText, useWalletLocale } from '@/react/context/WalletLocale';
import { walletText } from '@/core/ui/messages';
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScanIcon } from './icons/ScanIcon';
import { KeyIcon } from './icons/KeyIcon';
import { LinkIcon } from './icons/LinkIcon';
import { GlobeIcon } from './icons/GlobeIcon';
import { MapPinIcon } from './icons/MapPinIcon';
import { SlidersIcon } from './icons/SlidersIcon';
import { RecoveryCodesIcon } from './icons/RecoveryCodesIcon';
import { SpinnerIcon } from './icons/SpinnerIcon';
import { AccountMenuScreen } from './AccountMenuScreen';
import { AccountMenuButtonView } from './AccountMenuButtonView';
import { profileOpenControl, useProfileState } from './hooks/useProfileState';
import { useSeams } from '../../context';
import type {
  AccountMenuButtonProps,
  AccountMenuButtonOptions,
  AccountsSectionRow,
  MenuItem,
} from './types';
import { PROFILE_MENU_ITEM_IDS } from './types';
import { QRCodeScanner } from '../QRCodeScanner';
import { LinkedDevicesModal } from './LinkedDevicesModal';
import { AuthenticationMethodsModal } from './AuthenticationMethodsModal';
import TouchIcon from './icons/TouchIcon';
import './Web3AuthProfileButton.css';
import { Theme, useTheme } from '../theme';
import { resolvePrimaryExplorerUrl } from '@/core/config/chains';
import type { ConfirmationBehavior, ConfirmationConfig } from '@/core/types/signer-worker';
import {
  toWalletId,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { accountMenuCapabilitiesForLoginState } from '../../context/reactLoginStateBuilders';
import type { StoredAccountOption } from '../../types';
import { parseVerifiedEmailAddress } from '@shared/utils/domainIds';
import { WALLET_AUTH_METHODS } from '@shared/utils/signerDomain';
import { WalletSettingsLayout, WalletSettingsHeader } from './WalletSettingsLayout';
import { AccountsSection } from './AccountsSection';
import { AddEvmAccount, useEvmAccountSetup } from './AddEvmAccount';
import { TransactionSettingsSection } from './TransactionSettingsSection';
import { HostedSeamsAuthMenu } from '../HostedSeamsAuthMenu/public';
import { WalletIcon } from './icons/WalletIcon';
import { AssetActions, AssetRows, BalancesCard, hasSendableBalance } from './assets/AssetViews';
import { ReceivePanel } from './assets/ReceivePanel';
import { SendPanel } from './assets/SendPanel';
import {
  AssetsPageSection,
  useWalletAssetsController,
  type AssetsPageView,
} from './assets/WalletAssets';
import { registerAssetScreens, type AssetScreenRequest } from '@/SeamsWeb/publicApi/assets';
import type { HostedAuthMenuOutcome, HostedSeamsAuthMenuProps } from '../HostedSeamsAuthMenu/types';

async function loadSigningKeysSection() {
  const module = await import('./SigningKeysSection');
  return { default: module.SigningKeysSection };
}
const SigningKeysSection = lazy(loadSigningKeysSection);

function SigningKeysLoading() {
  return (
    <p role="status">
      <WalletText copy="Loading signing keys…" />
    </p>
  );
}

type AccountMenuRoute =
  | 'overview'
  | 'assets'
  | 'receive'
  | 'send'
  | 'accounts'
  | 'signing-keys'
  | 'recovery-codes'
  | 'authentication-methods'
  | 'scan-link-device'
  | 'linked-devices'
  | 'transaction-settings';
function resetNavigation(
  isOpen: boolean,
  setScreen: React.Dispatch<React.SetStateAction<AccountMenuRoute>>,
): void {
  if (!isOpen) setScreen('overview');
}

function remainOnSettingsPage(): void {}

function showSettingsError(setError: (message: string) => void, error: Error): void {
  setError(error.message);
}

function closeSettingsScanner(
  setOpen: (open: boolean) => void,
  setError: (message: string) => void,
  error: Error,
): void {
  setOpen(false);
  showSettingsError(setError, error);
}

async function finishSettingsAuthentication(
  refreshSession: (walletId?: string) => Promise<void>,
  setError: (message: string) => void,
  outcome: HostedAuthMenuOutcome,
): Promise<void> {
  switch (outcome.kind) {
    case 'authenticated':
    case 'registered':
    case 'account_synced':
      try {
        await refreshSession(outcome.walletId);
      } catch (error) {
        setError(
          error instanceof Error ? error.message : 'Unable to refresh your wallet. Try again.',
        );
      }
      return;
    case 'failed':
      setError(outcome.message);
      return;
    case 'cancelled':
      return;
  }
}

function emailAddressForWallet(
  accountOptions: readonly StoredAccountOption[],
  walletId: string | null,
): string | null {
  if (!walletId) return null;
  for (const option of accountOptions) {
    if (option.walletId !== walletId || option.authMethod !== WALLET_AUTH_METHODS.emailOtp) {
      continue;
    }
    const emailAddress = parseVerifiedEmailAddress(option.displayName);
    if (emailAddress.ok) return String(emailAddress.value);
  }
  return null;
}

function formatExportKeyErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  const message = String(error || '').trim();
  return message || 'Key export is unavailable for this wallet.';
}

function isRecoveryCodeDialogDismissal(error: unknown): boolean {
  return error instanceof Error && error.message.includes('cancelled before acknowledgement');
}

/** Shared settings content for the menu, modal, and full-page layout. */
type AccountMenuButtonInnerProps =
  | (AccountMenuButtonProps & { layout: 'menu' })
  | (AccountMenuButtonOptions & {
      layout: 'page';
      presentation?: never;
      isMenuOpen?: never;
      onMenuOpenChange?: never;
    });

const AccountMenuButtonInner: React.FC<AccountMenuButtonInnerProps> = (props) => {
  const {
    layout,
    presentation = 'dropdown',
    nearAccountId: nearAccountIdProp,
    nearExplorerBaseUrl = 'https://nearblocks.io',
    username: usernameProp,
    hideUsername = false,
    onLock: onLock,
    onExportKeyError,
    onExportKeyEvent,
    deviceLinkingScannerParams,
    toggleColors,
    style,
    className,
    highlightedMenuItem,
  } = props;
  const locale = useWalletLocale();
  // Get values from context if not provided as props
  const { accountInputState, loginState, seams, lock } = useSeams();
  const recovery = useMemo(() => seams.recovery, [seams]);

  // Use props if provided, otherwise fall back to context
  const accountName =
    usernameProp ||
    nearAccountIdProp?.split('.')?.[0] ||
    loginState.nearAccountId?.split('.')?.[0] ||
    'User';
  const loggedInAccountId = loginState.nearAccountId;
  const nearAccountId = nearAccountIdProp || loggedInAccountId;
  const walletId = loginState.walletId;
  const emailAddress = useMemo(
    () => emailAddressForWallet(accountInputState.indexDBAccountOptions, walletId),
    [accountInputState.indexDBAccountOptions, walletId],
  );

  // Local state for modals/expanded sections
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [screen, setScreen] = useState<AccountMenuRoute>('overview');
  const accountSetup = useEvmAccountSetup();
  const accountSetupState = accountSetup.state;
  const accountSetupRunning = accountSetupState.kind === 'adding';
  const accountsWalletId =
    (accountSetupRunning || accountSetupState.kind === 'added') && walletId === null
      ? accountSetupState.walletId
      : walletId;
  const [recoveryCodesOpen, setRecoveryCodesOpen] = useState(false);
  const [currentConfirmConfig, setCurrentConfirmConfig] = useState<ConfirmationConfig | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // State management
  const { isOpen, refs, handleOpen, handleToggle, handleClose } = useProfileState(
    layout === 'page' ? 'page' : presentation,
    profileOpenControl(props, false),
  );

  useEffect(resetNavigation.bind(null, isOpen, setScreen), [isOpen]);

  const assets = useWalletAssetsController({
    seams,
    walletId: loginState.isLoggedIn ? walletId : null,
    nearAccount: loginState.isLoggedIn ? (nearAccountId ?? null) : null,
    evmAddress: loginState.isLoggedIn ? (loginState.thresholdEcdsaEthereumAddress ?? null) : null,
    active: loginState.isLoggedIn && (layout === 'page' || isOpen),
    poll: screen === 'assets',
  });
  // Receive and Send return to the screen that opened them.
  const [assetReturn, setAssetReturn] = useState<'overview' | 'assets'>('overview');
  // The asset that Receive or Send chooses first, from seams.assets.openScreen or a Send error.
  const [assetChoice, setAssetChoice] = useState<string | undefined>(undefined);
  const [pageAssetView, setPageAssetView] = useState<AssetsPageView>({ kind: 'list' });
  const settingsLayout = useRef<WalletSettingsLayout>(null);
  const openAssetFlow = (route: 'receive' | 'send') => {
    setAssetReturn(screen === 'assets' ? 'assets' : 'overview');
    setAssetChoice(undefined);
    setScreen(route);
  };
  const closeAssetFlow = () => {
    setScreen(assetReturn);
    assets.refresh();
  };
  const receiveAsset = (assetId: string) => {
    if (layout === 'page') {
      setPageAssetView({ kind: 'receive', assetId });
      return;
    }
    setAssetChoice(assetId);
    setScreen('receive');
  };
  const openRequestedScreen = (request: AssetScreenRequest) => {
    if (layout === 'page') {
      setPageAssetView(
        request.screen === 'assets'
          ? { kind: 'list' }
          : { kind: request.screen, assetId: request.assetId },
      );
      settingsLayout.current?.selectSection(PROFILE_MENU_ITEM_IDS.ASSETS);
      return;
    }
    setAssetReturn('overview');
    setAssetChoice(request.assetId);
    setScreen(request.screen);
    if (!isOpen) handleOpen();
  };
  const latestScreenOpener = useRef(openRequestedScreen);
  useEffect(() => {
    latestScreenOpener.current = openRequestedScreen;
  });
  useEffect(() => {
    if (!loginState.isLoggedIn) return;
    return registerAssetScreens(seams.assets, (request) => latestScreenOpener.current(request));
  }, [seams, loginState.isLoggedIn]);

  // Read current theme from Theme context (falls back to system preference)
  const { theme } = useTheme();
  const accountMenuCapabilities = accountMenuCapabilitiesForLoginState(loginState);
  const canShowRecoveryCodes = accountMenuCapabilities.kind === 'owner' && Boolean(walletId);
  const canManageLinkedDevices = accountMenuCapabilities.canManageLinkedDevices;
  const canReadSettings = loginState.isLoggedIn && loginState.access === 'external';
  const handleQrCodeScanned = useCallback(() => {
    setShowQRScanner(false);
    handleClose();
  }, [handleClose]);

  useEffect(() => {
    const switchedWallet =
      accountSetupState.kind !== 'idle' &&
      walletId !== null &&
      walletId !== accountSetupState.walletId;
    if (
      (!canManageLinkedDevices && !canReadSettings && !accountSetupRunning && accountSetupState.kind !== 'added') ||
      switchedWallet
    ) {
      setScreen('overview');
    }
  }, [canManageLinkedDevices, canReadSettings, accountSetupRunning, accountSetupState, walletId]);

  // Keep local view state in sync with SDK preferences (mirrors wallet host in iframe mode)
  useEffect(() => {
    if (!seams) return;
    if (!loginState.isLoggedIn || !walletId) {
      setCurrentConfirmConfig(null);
      return;
    }

    let cancelled = false;

    if (walletId) {
      seams.preferences.setCurrentWallet(toWalletId(walletId));
    }
    setCurrentConfirmConfig(seams.preferences.getConfirmationConfig());

    const unsubConfirmConfig = seams.preferences.onConfirmationConfigChange?.((cfg) => {
      if (cancelled) return;
      setCurrentConfirmConfig(cfg);
    });

    return () => {
      cancelled = true;
      unsubConfirmConfig?.();
    };
  }, [seams, loginState.isLoggedIn, walletId]);

  // Handlers for transaction settings
  const handleSetUiMode = (mode: 'none' | 'modal' | 'drawer') => {
    setCurrentConfirmConfig((current) => ({
      ...(current ?? seams.preferences.getConfirmationConfig()),
      uiMode: mode,
    }));
    seams.preferences.setConfirmationConfig({ uiMode: mode });
  };

  const handleToggleSkipClick = () => {
    if (!currentConfirmConfig) return;
    const newBehavior: ConfirmationBehavior =
      currentConfirmConfig.behavior === 'requireClick' ? 'skipClick' : 'requireClick';
    setCurrentConfirmConfig((current) => ({
      ...(current ?? seams.preferences.getConfirmationConfig()),
      behavior: newBehavior,
      autoProceedDelay: newBehavior === 'skipClick' ? 0 : (current?.autoProceedDelay ?? 0),
    }));
    seams.preferences.setConfirmationBehavior(newBehavior);
  };

  const handleSetDelay = (delay: number) => {
    setCurrentConfirmConfig((current) => ({
      ...(current ?? seams.preferences.getConfirmationConfig()),
      autoProceedDelay: delay,
    }));
    seams.preferences.setConfirmationConfig({ autoProceedDelay: delay });
  };

  const startRecoveryCodesFlow = useCallback(async () => {
    if (recoveryCodesOpen || !walletId) return;
    if (!loginState.isLoggedIn || loginState.currentAuthMethod.kind !== 'selected') {
      setSettingsError('Unlock this wallet to confirm its recovery-code backup.');
      return;
    }
    const authorization =
      loginState.currentAuthMethod.binding.kind === 'passkey'
        ? { kind: 'passkey' as const }
        : { kind: 'email_otp' as const };
    setRecoveryCodesOpen(true);
    setSettingsError(null);
    try {
      const result = await recovery.confirmBackup({
        walletId,
        authorization,
      });
      switch (result.kind) {
        case 'acknowledged':
          return;
        case 'no_recovery_set':
        case 'conflict':
        case 'unauthorized':
        case 'transport_failed':
          setSettingsError(result.message);
          console.error('[AccountMenuButton] Recovery-code backup failed:', result.message);
          return;
      }
    } catch (error: unknown) {
      if (!isRecoveryCodeDialogDismissal(error)) {
        setSettingsError(formatExportKeyErrorMessage(error));
        console.error('[AccountMenuButton] Recovery-code backup failed:', error);
      }
    } finally {
      setRecoveryCodesOpen(false);
    }
  }, [loginState, recovery, recoveryCodesOpen, walletId]);

  // Chain rows for the Accounts expander: one per configured chain with a
  // known account/address and explorer URL, linking to the account page.
  const accountsRows: AccountsSectionRow[] = useMemo(() => {
    const rows: AccountsSectionRow[] = [];
    const chains = seams?.configs.network.chains ?? [];
    const nearExplorer = resolvePrimaryExplorerUrl(chains, 'near') || nearExplorerBaseUrl;
    const tempoExplorer = resolvePrimaryExplorerUrl(chains, 'tempo');
    const evmExplorer = resolvePrimaryExplorerUrl(chains, 'evm');
    const completedSetup =
      accountSetupState.kind === 'added' && accountsWalletId === accountSetupState.walletId
        ? accountSetupState
        : null;
    const evmAddress = completedSetup?.evmAddress ?? loginState.thresholdEcdsaEthereumAddress;
    const accountNearId = nearAccountId ?? completedSetup?.nearAccountId;

    if (accountNearId && nearExplorer) {
      rows.push({
        id: 'near',
        label: 'NEAR',
        address: accountNearId,
        href: `${nearExplorer}/address/${accountNearId}`,
      });
    }
    if (evmAddress && tempoExplorer) {
      rows.push({
        id: 'tempo',
        label: 'Tempo',
        address: evmAddress,
        href: `${tempoExplorer}/address/${evmAddress}`,
      });
    }
    if (evmAddress && evmExplorer) {
      rows.push({
        id: 'arc',
        label: 'Arc',
        address: evmAddress,
        href: `${evmExplorer}/address/${evmAddress}`,
      });
    }
    return rows;
  }, [
    seams,
    nearAccountId,
    nearExplorerBaseUrl,
    loginState.thresholdEcdsaEthereumAddress,
    accountSetupState,
    accountsWalletId,
  ]);

  // Menu items configuration with context-aware handlers
  const MENU_ITEMS: MenuItem[] = useMemo(() => {
    const items: MenuItem[] = [];

    if (accountsRows.length > 0 || loginState.isLoggedIn) {
      items.push({
        id: PROFILE_MENU_ITEM_IDS.ACCOUNTS,
        icon: <GlobeIcon />,
        label: 'Accounts',
        description: 'View or add accounts',
        disabled: !loginState.isLoggedIn,
        onClick: setScreen.bind(null, 'accounts'),
        keepOpenOnClick: true,
      });
    }

    if (canShowRecoveryCodes) {
      items.push({
        id: PROFILE_MENU_ITEM_IDS.RECOVERY_CODES,
        icon: recoveryCodesOpen ? <SpinnerIcon /> : <RecoveryCodesIcon />,
        label: 'Recovery codes',
        description: 'Back up wallet recovery codes',
        disabled: recoveryCodesOpen,
        onClick: setScreen.bind(null, 'recovery-codes'),
        keepOpenOnClick: true,
      });
    }

    if (accountMenuCapabilities.kind !== 'signed_out') {
      const canManageLinkedDevices = accountMenuCapabilities.canManageLinkedDevices;
      items.push(
        {
          id: PROFILE_MENU_ITEM_IDS.AUTHENTICATION_METHODS,
          icon: <TouchIcon />,
          label: 'Authentication methods',
          description: 'Add or remove ways to unlock this device',
          disabled: !canManageLinkedDevices && !canReadSettings,
          onClick: setScreen.bind(null, 'authentication-methods'),
          keepOpenOnClick: true,
        },
        {
          id: PROFILE_MENU_ITEM_IDS.SCAN_LINK_DEVICE,
          icon: <ScanIcon />,
          label: 'Scan and link device',
          description: 'Scan QR to link a device',
          disabled: !canManageLinkedDevices,
          onClick: setScreen.bind(null, 'scan-link-device'),
          keepOpenOnClick: true,
        },
        {
          id: PROFILE_MENU_ITEM_IDS.LINKED_DEVICES,
          icon: <LinkIcon />,
          label: 'Linked devices',
          description: 'See devices using this wallet',
          disabled: !canManageLinkedDevices && !canReadSettings,
          onClick: setScreen.bind(null, 'linked-devices'),
          keepOpenOnClick: true,
        },
      );
    }

    // The menu shows assets as its balance card; the full page lists them as a section.
    if (layout === 'page') {
      items.push({
        id: PROFILE_MENU_ITEM_IDS.ASSETS,
        icon: <WalletIcon />,
        label: 'Assets',
        description: 'See balances, receive and send',
        disabled: !loginState.isLoggedIn,
      });
    }

    if (walletId && accountMenuCapabilities.kind === 'owner') {
      items.push({
        id: PROFILE_MENU_ITEM_IDS.SIGNING_KEYS,
        icon: <KeyIcon />,
        label: 'Signing keys',
        description: 'Manage wallet signing keys',
        disabled: false,
        onClick: setScreen.bind(null, 'signing-keys'),
        keepOpenOnClick: true,
      });
    }

    if (layout === 'page') {
      items.push({
        id: PROFILE_MENU_ITEM_IDS.WALLET_REGION,
        icon: <MapPinIcon />,
        label: 'Wallet region',
        description: 'Choose where your wallet runs',
        disabled: accountMenuCapabilities.kind !== 'owner',
      });
    }
    items.push({
      id: PROFILE_MENU_ITEM_IDS.TRANSACTION_SETTINGS,
      icon: <SlidersIcon />,
      label: 'Transaction settings',
      description: 'Customize confirmation behavior',
      disabled: !loginState.isLoggedIn,
      onClick: setScreen.bind(null, 'transaction-settings'),
      keepOpenOnClick: true,
    });
    return items;
  }, [
    accountsRows.length,
    walletId,
    nearAccountId,
    layout,
    accountMenuCapabilities,
    canReadSettings,
    canShowRecoveryCodes,
    loginState.isLoggedIn,
    recoveryCodesOpen,
    startRecoveryCodesFlow,
  ]);

  const highlightedMenuItemId = highlightedMenuItem?.id;
  const highlightShouldFocus = highlightedMenuItem?.focus ?? true;
  const highlightedIndex = useMemo(() => {
    if (!highlightedMenuItemId) return -1;
    return MENU_ITEMS.findIndex((item) => item.id === highlightedMenuItemId);
  }, [MENU_ITEMS, highlightedMenuItemId]);

  useEffect(() => {
    if (!isOpen || highlightedIndex < 0 || !highlightShouldFocus) return;
    const el = refs.menuItemsRef.current?.[highlightedIndex];
    if (!el) return;
    const focusItem = () => {
      if (typeof el.focus === 'function') {
        el.focus();
      }
    };
    if (typeof window === 'undefined') {
      focusItem();
      return;
    }
    const frame = window.requestAnimationFrame(focusItem);
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, highlightedIndex, highlightShouldFocus, refs.menuItemsRef]);

  // Handlers
  const handleLock = async () => {
    await lock();
    onLock?.();
    handleClose();
  };

  const backToMenu = setScreen.bind(null, 'overview');
  const screens: Record<typeof screen, React.ReactNode> = {
    overview: null,
    assets: (
      <AccountMenuScreen title={walletText(locale, 'Assets')} onBack={backToMenu}>
        <AssetRows state={assets.state} onRetry={assets.refresh} />
        <div className="seams-assets-screen-actions">
          <AssetActions
            onReceive={openAssetFlow.bind(null, 'receive')}
            onSend={openAssetFlow.bind(null, 'send')}
            canSend={hasSendableBalance(assets.state)}
          />
        </div>
      </AccountMenuScreen>
    ),
    receive: (
      <AccountMenuScreen title={walletText(locale, 'Receive')} onBack={closeAssetFlow}>
        <ReceivePanel
          key={assetChoice}
          assets={assets.receiveAssets}
          nearAccount={assets.nearAccount}
          evmAddress={assets.evmAddress}
          initialAssetId={assetChoice}
        />
      </AccountMenuScreen>
    ),
    send: (
      <AccountMenuScreen title={walletText(locale, 'Send')} onBack={closeAssetFlow}>
        <SendPanel
          key={assetChoice}
          {...assets.send}
          initialAssetId={assetChoice}
          onReceive={receiveAsset}
        />
      </AccountMenuScreen>
    ),
    'signing-keys':
      walletId ? (
        <AccountMenuScreen title="Signing keys" onBack={backToMenu}>
          <Suspense fallback={<SigningKeysLoading />}>
            <SigningKeysSection
              key={walletId}
              walletId={walletId}
              onExportKeyError={onExportKeyError}
              onExportKeyEvent={onExportKeyEvent}
            />
          </Suspense>
        </AccountMenuScreen>
      ) : null,
    'transaction-settings': (
      <AccountMenuScreen title={walletText(locale, 'Transaction settings')} onBack={backToMenu}>
        {currentConfirmConfig ? (
          <TransactionSettingsSection
            currentConfirmConfig={currentConfirmConfig}
            onSetUiMode={handleSetUiMode}
            onToggleSkipClick={handleToggleSkipClick}
            onSetDelay={handleSetDelay}
            isOpen
            theme={theme}
          />
        ) : (
          <p role="status">
            <WalletText message="Loading transaction settings…" />
          </p>
        )}
      </AccountMenuScreen>
    ),
    accounts: (
      <AccountMenuScreen title={walletText(locale, 'Accounts')} onBack={backToMenu}>
        <p className="seams-account-description">
          <WalletText message="Your addresses across networks." />
        </p>
        <AccountsSection rows={accountsRows} />
        {accountsWalletId ? (
          <AddEvmAccount key={accountsWalletId} walletId={accountsWalletId} setup={accountSetup} />
        ) : null}
      </AccountMenuScreen>
    ),
    'recovery-codes': (
      <AccountMenuScreen title={walletText(locale, 'Recovery codes')} onBack={backToMenu}>
        <p className="seams-account-description">
          <WalletText message="Keep a recovery code somewhere safe. Use it to restore access to your wallet." />
        </p>
        <div className="seams-account-inset">
          <WalletText message="Only you should have this code. Anyone with it can start recovering your wallet." />
        </div>
        <button
          type="button"
          className="seams-account-action primary"
          disabled={recoveryCodesOpen}
          onClick={startRecoveryCodesFlow}
        >
          {recoveryCodesOpen ? (
            <WalletText message="Opening recovery codes…" />
          ) : (
            <WalletText message="View recovery codes" />
          )}
        </button>
      </AccountMenuScreen>
    ),
    'authentication-methods': (
      <AuthenticationMethodsModal
        walletId={walletId ?? null}
        isOpen
        presentation="embedded"
        onClose={backToMenu}
      />
    ),
    'linked-devices': (
      <LinkedDevicesModal
        walletId={walletId ?? null}
        isOpen
        presentation="embedded"
        onClose={backToMenu}
      />
    ),
    'scan-link-device': (
      <QRCodeScanner
        presentation="embedded"
        isOpen
        onQRCodeScanned={backToMenu}
        onClose={backToMenu}
        onError={deviceLinkingScannerParams?.onError}
        onEvent={deviceLinkingScannerParams?.onEvent}
      />
    ),
  };

  if (layout === 'page' && loginState.isLoggedIn && walletId) {
    return (
      <>
        <WalletSettingsLayout
          ref={settingsLayout}
          access={loginState.access}
          walletId={toWalletId(walletId)}
          placement={seams.placement}
          menuItems={MENU_ITEMS}
          onLock={handleLock}
          error={settingsError}
          sections={{
            assets: (
              <AssetsPageSection
                controller={assets}
                view={pageAssetView}
                onView={setPageAssetView}
              />
            ),
            'signing-keys': (
              <Suspense fallback={<SigningKeysLoading />}>
                <SigningKeysSection
                  key={walletId}
                  walletId={walletId}
                  onExportKeyError={onExportKeyError}
                  onExportKeyEvent={onExportKeyEvent}
                />
              </Suspense>
            ),
            accounts: <AccountsSection rows={accountsRows} presentation="page" />,
            'recovery-codes': (
              <button
                type="button"
                className="seams-settings-action"
                disabled={recoveryCodesOpen}
                onClick={startRecoveryCodesFlow}
              >
                {recoveryCodesOpen ? (
                  <WalletText message="Opening recovery codes…" />
                ) : (
                  <WalletText message="View recovery codes" />
                )}
              </button>
            ),
            'authentication-methods': (
              <AuthenticationMethodsModal
                walletId={walletId}
                isOpen
                presentation="page"
                onClose={remainOnSettingsPage}
              />
            ),
            'scan-link-device': (
              <button
                type="button"
                className="seams-settings-action"
                onClick={setShowQRScanner.bind(null, true)}
              >
                <WalletText message="Scan QR code" />
              </button>
            ),
            'linked-devices': (
              <LinkedDevicesModal
                walletId={walletId}
                isOpen
                presentation="page"
                onClose={remainOnSettingsPage}
              />
            ),
            'transaction-settings': currentConfirmConfig ? (
              <TransactionSettingsSection
                presentation="page"
                currentConfirmConfig={currentConfirmConfig}
                onSetUiMode={handleSetUiMode}
                onToggleSkipClick={handleToggleSkipClick}
                onSetDelay={handleSetDelay}
                theme={theme}
              />
            ) : (
              <p role="status">
                <WalletText message="Loading transaction settings…" />
              </p>
            ),
          }}
        />
        <QRCodeScanner
          isOpen={showQRScanner}
          onQRCodeScanned={handleQrCodeScanned}
          onClose={setShowQRScanner.bind(null, false)}
          onError={closeSettingsScanner.bind(null, setShowQRScanner, setSettingsError)}
        />
      </>
    );
  }

  return (
    <AccountMenuButtonView
      presentation={presentation}
      buttonRef={refs.buttonRef}
      dropdownRef={refs.dropdownRef}
      className={className}
      style={style}
      overviewHeader={
        loginState.isLoggedIn ? (
          <BalancesCard
            state={assets.state}
            onRetry={assets.refresh}
            onOpenAssets={setScreen.bind(null, 'assets')}
            onReceive={openAssetFlow.bind(null, 'receive')}
            onSend={openAssetFlow.bind(null, 'send')}
          />
        ) : null
      }
      trigger={{
        label: loginState.isLoggedIn ? 'Settings' : 'Logged out',
        username: accountName,
        hideUsername,
        fullAccountId: walletId || undefined,
        emailAddress: emailAddress || undefined,
        isOpen,
        onClick: handleToggle,
        theme,
      }}
      dropdown={{
        isOpen,
        menuItems: MENU_ITEMS,
        onLock: handleLock,
        onClose: handleClose,
        menuItemsRef: refs.menuItemsRef,
        toggleColors,
        theme,
        highlightedMenuItemId,
      }}
    >
      {screen === 'overview' ? null : (
        <>
          {screens[screen]}
          {settingsError ? (
            <p className="seams-account-error" role="alert">
              <WalletText copy={settingsError} />
            </p>
          ) : null}
        </>
      )}
    </AccountMenuButtonView>
  );
};

export const AccountMenuButton: React.FC<AccountMenuButtonProps> = (props) => {
  const { theme, tokens } = useTheme();
  const scopedTokens = useMemo(
    () => (theme === 'dark' ? { dark: tokens } : { light: tokens }),
    [theme, tokens],
  );
  return (
    <Theme theme={theme} tokens={scopedTokens}>
      <AccountMenuButtonInner {...props} layout="menu" />
    </Theme>
  );
};

export const ProfileSettingsButton = AccountMenuButton;

/** Full-page wallet settings, mounted inside SeamsWebProvider. */
export function WalletSettingsPage(props: Pick<HostedSeamsAuthMenuProps, 'externalAuthBroker'>) {
  const { theme, tokens } = useTheme();
  return (
    <Theme theme={theme} tokens={{ [theme]: tokens }}>
      <WalletSettingsContent {...props} />
    </Theme>
  );
}

function WalletSettingsContent(props: Pick<HostedSeamsAuthMenuProps, 'externalAuthBroker'>) {
  const { loginState, refreshSession } = useSeams();
  const [error, setError] = useState('');
  if (loginState.isLoggedIn) {
    return <AccountMenuButtonInner layout="page" nearAccountId={loginState.nearAccountId} />;
  }
  return (
    <div className="seams-settings-page">
      <WalletSettingsHeader />
      <main className="seams-settings-sign-in">
        <h1>
          <WalletText message="Wallet settings" />
        </h1>
        <p>
          <WalletText message="Unlock your wallet to manage your accounts, security, and devices." />
        </p>
        {error ? (
          <p role="alert">
            <WalletText copy={error} />
          </p>
        ) : null}
        <HostedSeamsAuthMenu
          externalAuthBroker={props.externalAuthBroker}
          onOutcome={finishSettingsAuthentication.bind(null, refreshSession, setError)}
        />
      </main>
    </div>
  );
}

export { AccountMenuButtonMock } from './AccountMenuButtonMock';
export { WalletBalances } from './assets/WalletAssets';
export type { WalletBalancesProps } from './assets/WalletAssets';
export type { AccountMenuButtonMockProps } from './AccountMenuButtonMock';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ScanIcon } from './icons/ScanIcon';
import { KeyIcon } from './icons/KeyIcon';
import { LinkIcon } from './icons/LinkIcon';
import { GlobeIcon } from './icons/GlobeIcon';
import { SlidersIcon } from './icons/SlidersIcon';
import { RecoveryCodesIcon } from './icons/RecoveryCodesIcon';
import { SpinnerIcon } from './icons/SpinnerIcon';
import { UserAccountButton } from './UserAccountButton';
import { ProfileDropdown } from './ProfileDropdown';
import { useProfileState } from './hooks/useProfileState';
import { useSeams } from '../../context';
import type { AccountMenuButtonProps, AccountsSectionRow, ExportChain, MenuItem } from './types';
import { PROFILE_MENU_ITEM_IDS } from './types';
import { QRCodeScanner } from '../QRCodeScanner';
import { LinkedDevicesModal } from './LinkedDevicesModal';
import { AuthenticationMethodsModal } from './AuthenticationMethodsModal';
import TouchIcon from './icons/TouchIcon';
import './Web3AuthProfileButton.css';
import { Theme, useTheme } from '../theme';
import { requirePrimaryChainByFamily, resolvePrimaryExplorerUrl } from '@/core/config/chains';
import type { ConfirmationBehavior, ConfirmationConfig } from '@/core/types/signer-worker';
import {
  thresholdEcdsaChainTargetFromConfig,
  toWalletId,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { NearProvisioningState } from '@/core/types/seams';
import { accountMenuCapabilitiesForLoginState } from '../../context/reactLoginStateBuilders';
import type { StoredAccountOption } from '../../types';
import { parseVerifiedEmailAddress } from '@shared/utils/domainIds';
import { WALLET_AUTH_METHODS } from '@shared/utils/signerDomain';
import { WalletSettingsLayout, WalletSettingsHeader } from './WalletSettingsLayout';
import { AccountsSection } from './AccountsSection';
import { ExportKeysSection } from './ExportKeysSection';
import { TransactionSettingsSection } from './TransactionSettingsSection';
import { HostedSeamsAuthMenu } from '../HostedSeamsAuthMenu/public';
import type { HostedAuthMenuOutcome, HostedSeamsAuthMenuProps } from '../HostedSeamsAuthMenu/types';

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
  refreshLoginState: (walletId?: string) => Promise<void>,
  setError: (message: string) => void,
  outcome: HostedAuthMenuOutcome,
): Promise<void> {
  switch (outcome.kind) {
    case 'authenticated':
    case 'registered':
    case 'account_synced':
      try {
        await refreshLoginState(outcome.walletId);
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

async function resolveNearAccountIdForExport(input: {
  readonly walletId: string;
  readonly sessionNearAccountId: string | null | undefined;
  readonly getNearProvisioningState: (args: {
    walletId: string;
  }) => Promise<NearProvisioningState | null>;
}): Promise<string> {
  if (input.sessionNearAccountId) return input.sessionNearAccountId;
  const state = await input.getNearProvisioningState({ walletId: input.walletId });
  if (state?.status === 'near_ready') return state.nearAccountId;
  if (state?.status === 'near_pending' || state?.status === 'near_provisioning') {
    throw new Error('NEAR signer provisioning is still in progress. Try again shortly.');
  }
  if (state?.status === 'near_failed_retryable') {
    throw new Error(`NEAR signer provisioning must be retried (${state.errorCode}).`);
  }
  throw new Error('Ed25519 export requires an active NEAR signer.');
}

function resolveDefaultPortalTarget(
  explicit: HTMLElement | ShadowRoot | null | undefined,
  buttonRoot: HTMLDivElement | null,
): HTMLElement | ShadowRoot | null {
  if (explicit) return explicit;
  try {
    const root = buttonRoot?.getRootNode?.();
    if (root && typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) {
      return root;
    }
  } catch {}
  if (typeof document === 'undefined') return null;
  return document.body;
}

/**
 * Account Menu Button Component
 * Provides user settings, account management, and the device-link scanner shell.
 * **Important:** This component should be used inside a SeamsWeb context.
 * Wrap your app with PasskeyProvider or ensure SeamsWeb is available in context via useSeams.
 *
 * @example
 * ```tsx
 * import { PasskeyProvider } from '@seams/wallet/react';
 * import { AccountMenuButton } from '@seams/wallet/react';
 *
 * function App() {
 *   return (
 *     <PasskeyProvider configs={passkeyConfigs}>
 *       <AccountMenuButton
 *         username="alice"
 *         onLock={() => console.log('Wallet locked')}
 *         deviceLinkingScannerParams={{
 *           onError: (error) => console.error('Error:', error),
 *           onClose: () => console.log('Scanner closed'),
 *           // Flow events can carry sensitive data (e.g. demo OTP codes).
 *           // Forward phases, never whole event payloads.
 *           onEvent: (event) => trackScannerPhase(event.phase),
 *           fundingAmount: '0.05'
 *         }}
 *       />
 *     </PasskeyProvider>
 *   );
 * }
 * ```
 */
const AccountMenuButtonInner: React.FC<
  AccountMenuButtonProps & { presentation: 'menu' | 'page' }
> = ({
  presentation,
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
  portalTarget,
  isMenuOpen,
  onMenuOpenChange,
  highlightedMenuItem,
}) => {
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
  const canExportNearKey = Boolean(nearAccountId);
  const canExportEvmKeys = Boolean(loginState.thresholdEcdsaEthereumAddress);

  // Local state for modals/expanded sections
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [showLinkedDevices, setShowLinkedDevices] = useState(false);
  const [showAuthenticationMethods, setShowAuthenticationMethods] = useState(false);
  const [recoveryCodesOpen, setRecoveryCodesOpen] = useState(false);
  const [exportKeysOpen, setExportKeysOpen] = useState(false);
  const [exportLoadingChain, setExportLoadingChain] = useState<ExportChain | null>(null);
  const [transactionSettingsOpen, setTransactionSettingsOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [currentConfirmConfig, setCurrentConfirmConfig] = useState<ConfirmationConfig | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // State management
  const { isOpen, refs, handleToggle, handleClose } = useProfileState({
    open: typeof isMenuOpen === 'boolean' ? isMenuOpen : undefined,
    onOpenChange: onMenuOpenChange,
  });

  // Read current theme from Theme context (falls back to system preference)
  const { theme } = useTheme();
  const accountMenuCapabilities = accountMenuCapabilitiesForLoginState(loginState);
  const canShowRecoveryCodes = accountMenuCapabilities.kind === 'owner' && Boolean(walletId);
  const canManageLinkedDevices = accountMenuCapabilities.canManageLinkedDevices;
  const handleQrCodeScanned = useCallback(() => {
    setShowQRScanner(false);
    handleClose();
  }, [handleClose]);

  useEffect(() => {
    if (!canManageLinkedDevices) {
      setShowLinkedDevices(false);
      setShowAuthenticationMethods(false);
    }
  }, [canManageLinkedDevices]);

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
    seams.preferences.setConfirmBehavior(newBehavior);
  };

  const handleSetDelay = (delay: number) => {
    setCurrentConfirmConfig((current) => ({
      ...(current ?? seams.preferences.getConfirmationConfig()),
      autoProceedDelay: delay,
    }));
    seams.preferences.setConfirmationConfig({ autoProceedDelay: delay });
  };

  const startExportKeyFlow = useCallback(
    async (chain: ExportChain) => {
      if (exportLoadingChain) return;
      if (!loginState.isLoggedIn || !walletId) {
        onExportKeyError?.(new Error('Key export requires an unlocked wallet.'));
        return;
      }

      setExportLoadingChain(chain);
      setSettingsError(null);
      try {
        if (chain === 'near') {
          const exportNearAccountId = await resolveNearAccountIdForExport({
            walletId,
            sessionNearAccountId: nearAccountId,
            getNearProvisioningState: seams.registration.getNearProvisioningState,
          });
          const result = await seams.keys.exportKeypair({
            kind: 'ed25519',
            walletSession: walletId,
            nearAccount: exportNearAccountId,
            options: { onEvent: onExportKeyEvent },
          });
          if (result.kind === 'relink_required') {
            throw new Error(
              'Key export requires re-linking this device to a canonical owner credential.',
            );
          }
          return;
        }
        const chainTarget = thresholdEcdsaChainTargetFromConfig(
          requirePrimaryChainByFamily(seams.configs.network.chains, 'evm'),
        );
        const result = await seams.keys.exportKeypair({
          kind: 'ecdsa',
          walletSession: walletId,
          chainTarget,
          options: { onEvent: onExportKeyEvent },
        });
        if (result.kind === 'relink_required') {
          throw new Error(
            'Key export requires re-linking this device to a canonical owner credential.',
          );
        }
      } catch (error: unknown) {
        setSettingsError(formatExportKeyErrorMessage(error));
        console.error('[AccountMenuButton] Key export failed:', error);
        // Surface through the host (e.g. as a toast) instead of inline menu UI
        onExportKeyError?.(new Error(formatExportKeyErrorMessage(error)));
      } finally {
        setExportLoadingChain(null);
      }
    },
    [
      exportLoadingChain,
      loginState.isLoggedIn,
      nearAccountId,
      onExportKeyError,
      onExportKeyEvent,
      seams,
      walletId,
    ],
  );

  const startRecoveryCodesFlow = useCallback(async () => {
    if (recoveryCodesOpen || !walletId) return;
    setRecoveryCodesOpen(true);
    setSettingsError(null);
    try {
      const result = await recovery.acknowledgeWalletRecoveryCodeBackup({ walletId });
      switch (result.kind) {
        case 'acknowledged':
          return;
        case 'no_recovery_set':
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
  }, [recovery, recoveryCodesOpen, walletId]);

  // Chain rows for the Accounts expander: one per configured chain with a
  // known account/address and explorer URL, linking to the account page.
  const accountsRows: AccountsSectionRow[] = useMemo(() => {
    const rows: AccountsSectionRow[] = [];
    const chains = seams?.configs.network.chains ?? [];
    const nearExplorer = resolvePrimaryExplorerUrl(chains, 'near') || nearExplorerBaseUrl;
    const tempoExplorer = resolvePrimaryExplorerUrl(chains, 'tempo');
    const evmExplorer = resolvePrimaryExplorerUrl(chains, 'evm');
    const evmAddress = loginState.thresholdEcdsaEthereumAddress;

    if (nearAccountId && nearExplorer) {
      rows.push({
        id: 'near',
        label: 'NEAR',
        address: nearAccountId,
        href: `${nearExplorer}/address/${nearAccountId}`,
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
  }, [seams, nearAccountId, nearExplorerBaseUrl, loginState.thresholdEcdsaEthereumAddress]);

  // Menu items configuration with context-aware handlers
  const MENU_ITEMS: MenuItem[] = useMemo(() => {
    const items: MenuItem[] = [];

    if (accountsRows.length > 0) {
      items.push({
        id: PROFILE_MENU_ITEM_IDS.ACCOUNTS,
        icon: <GlobeIcon />,
        label: 'Accounts',
        description: 'View accounts on block explorers',
        disabled: !loginState.isLoggedIn,
        onClick: () => setAccountsOpen((v) => !v),
        keepOpenOnClick: true,
      });
    }

    if (accountMenuCapabilities.kind !== 'signed_out') {
      items.push({
        id: PROFILE_MENU_ITEM_IDS.EXPORT_KEYS,
        icon: exportLoadingChain ? <SpinnerIcon /> : <KeyIcon />,
        label: 'Export Keys',
        description: accountMenuCapabilities.canExportKeys
          ? 'Export wallet signing keys'
          : 'Owner key export is not available on this device yet',
        disabled: !accountMenuCapabilities.canExportKeys,
        onClick: () => {
          setExportKeysOpen((v) => !v);
        },
        keepOpenOnClick: true,
      });
    }

    if (canShowRecoveryCodes) {
      items.push({
        id: PROFILE_MENU_ITEM_IDS.RECOVERY_CODES,
        icon: recoveryCodesOpen ? <SpinnerIcon /> : <RecoveryCodesIcon />,
        label: 'Recovery Codes',
        description: 'Back up wallet recovery codes',
        disabled: recoveryCodesOpen,
        onClick: () => {
          void startRecoveryCodesFlow();
        },
        keepOpenOnClick: true,
      });
    }

    if (accountMenuCapabilities.kind !== 'signed_out') {
      const canManageLinkedDevices = accountMenuCapabilities.canManageLinkedDevices;
      items.push(
        {
          id: PROFILE_MENU_ITEM_IDS.AUTHENTICATION_METHODS,
          icon: <TouchIcon />,
          label: 'Authentication Methods',
          description: 'Add or remove ways to unlock this device',
          disabled: !canManageLinkedDevices,
          onClick: () => setShowAuthenticationMethods(true),
          keepOpenOnClick: true,
        },
        {
          id: PROFILE_MENU_ITEM_IDS.SCAN_LINK_DEVICE,
          icon: <ScanIcon />,
          label: 'Scan and Link Device',
          description: 'Scan QR to link a device',
          disabled: !canManageLinkedDevices,
          onClick: () => {
            setShowQRScanner(true);
          },
          keepOpenOnClick: true,
        },
        {
          id: PROFILE_MENU_ITEM_IDS.LINKED_DEVICES,
          icon: <LinkIcon />,
          label: 'Linked Devices',
          description: 'See devices using this wallet',
          disabled: !canManageLinkedDevices,
          onClick: () => setShowLinkedDevices(true),
          keepOpenOnClick: true,
        },
      );
    }

    items.push({
      id: PROFILE_MENU_ITEM_IDS.TRANSACTION_SETTINGS,
      icon: <SlidersIcon />,
      label: 'Transaction Settings',
      description: 'Customize confirmation behavior',
      disabled: !loginState.isLoggedIn,
      onClick: () => setTransactionSettingsOpen((v) => !v),
      keepOpenOnClick: true,
    });
    return items;
  }, [
    accountsRows.length,
    accountMenuCapabilities,
    canShowRecoveryCodes,
    exportLoadingChain,
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
      if (typeof (el as any).focus === 'function') {
        (el as any).focus();
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

  const portalHost = resolveDefaultPortalTarget(portalTarget, refs.buttonRef.current);
  const canPortal = !!portalHost;

  if (presentation === 'page' && loginState.isLoggedIn && walletId) {
    return (
      <>
        <WalletSettingsLayout
          walletId={walletId}
          menuItems={MENU_ITEMS}
          onLock={handleLock}
          error={settingsError}
          sections={{
            accounts: <AccountsSection rows={accountsRows} presentation="page" />,
            'export-keys': (
              <ExportKeysSection
                presentation="page"
                isOpen
                loadingChain={exportLoadingChain}
                canExportNearKey={canExportNearKey}
                canExportEvmKeys={canExportEvmKeys}
                onSelectChain={startExportKeyFlow}
              />
            ),
            'recovery-codes': (
              <button
                type="button"
                className="seams-settings-action"
                disabled={recoveryCodesOpen}
                onClick={startRecoveryCodesFlow}
              >
                {recoveryCodesOpen ? 'Opening recovery codes…' : 'View recovery codes'}
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
                Scan QR code
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
                currentConfirmConfig={currentConfirmConfig}
                onSetUiMode={handleSetUiMode}
                onToggleSkipClick={handleToggleSkipClick}
                onSetDelay={handleSetDelay}
                theme={theme}
              />
            ) : (
              <p role="status">Loading transaction settings…</p>
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
    <div
      ref={refs.buttonRef}
      className={`seams-profile-button-morphable ${isOpen ? 'open' : 'closed'}${className ? ` ${className}` : ''}`}
      style={style}
      data-state={isOpen ? 'open' : 'closed'}
    >
      <UserAccountButton
        username={accountName}
        hideUsername={hideUsername}
        // identity line under "Settings": the wallet id, not the chain account
        fullAccountId={walletId || undefined}
        emailAddress={emailAddress || undefined}
        isOpen={isOpen}
        onClick={handleToggle}
        theme={theme}
      />

      {/* Visible menu structure for actual interaction */}
      <ProfileDropdown
        ref={refs.dropdownRef}
        isOpen={isOpen}
        menuItems={MENU_ITEMS}
        onLock={handleLock}
        onClose={handleClose}
        menuItemsRef={refs.menuItemsRef}
        toggleColors={toggleColors}
        currentConfirmConfig={currentConfirmConfig}
        onSetUiMode={handleSetUiMode}
        onToggleSkipClick={handleToggleSkipClick}
        onSetDelay={handleSetDelay}
        transactionSettingsOpen={transactionSettingsOpen}
        accountsRows={accountsRows}
        accountsOpen={accountsOpen}
        exportKeysOpen={exportKeysOpen}
        exportLoadingChain={exportLoadingChain}
        canExportNearKey={canExportNearKey}
        canExportEvmKeys={canExportEvmKeys}
        onExportChain={startExportKeyFlow}
        walletId={walletId}
        nearAccountId={nearAccountId}
        theme={theme}
        highlightedMenuItemId={highlightedMenuItemId}
      />

      {/* QR Scanner Modal (portaled to nearest root for robustness) */}
      {canPortal &&
        createPortal(
          <QRCodeScanner
            key="profile-qr-scanner"
            isOpen={showQRScanner}
            onQRCodeScanned={handleQrCodeScanned}
            onError={(error) => {
              deviceLinkingScannerParams?.onError?.(error);
              setShowQRScanner(false);
              handleClose();
            }}
            onClose={() => {
              deviceLinkingScannerParams?.onClose?.();
              setShowQRScanner(false);
              handleClose();
            }}
            onEvent={(event) => deviceLinkingScannerParams?.onEvent?.(event)}
          />,
          portalHost!,
        )}

      {/* Linked Devices Modal (portaled alongside the other account-menu modals) */}
      {canPortal &&
        createPortal(
          <AuthenticationMethodsModal
            walletId={walletId ?? null}
            isOpen={showAuthenticationMethods}
            onClose={() => setShowAuthenticationMethods(false)}
          />,
          portalHost!,
        )}

      {canPortal &&
        createPortal(
          <LinkedDevicesModal
            walletId={walletId ?? null}
            isOpen={showLinkedDevices}
            onClose={() => setShowLinkedDevices(false)}
          />,
          portalHost!,
        )}
    </div>
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
      <AccountMenuButtonInner {...props} presentation="menu" />
    </Theme>
  );
};

export const ProfileSettingsButton = AccountMenuButton;

/** Full-page wallet settings, mounted inside SeamsWebProvider. */
export function WalletSettingsPage(
  props: Pick<HostedSeamsAuthMenuProps, 'externalAuthBroker' | 'onDemoEmailOtp'>,
) {
  const { loginState, refreshLoginState } = useSeams();
  const [error, setError] = useState('');
  if (loginState.isLoggedIn) {
    return <AccountMenuButtonInner presentation="page" nearAccountId={loginState.nearAccountId} />;
  }
  return (
    <div className="seams-settings-page">
      <WalletSettingsHeader />
      <main className="seams-settings-sign-in">
        <h1>Wallet settings</h1>
        <p>Unlock your wallet to manage your accounts, security, and devices.</p>
        {error ? <p role="alert">{error}</p> : null}
        <HostedSeamsAuthMenu
          externalAuthBroker={props.externalAuthBroker}
          onDemoEmailOtp={props.onDemoEmailOtp}
          onOutcome={finishSettingsAuthentication.bind(null, refreshLoginState, setError)}
        />
      </main>
    </div>
  );
}

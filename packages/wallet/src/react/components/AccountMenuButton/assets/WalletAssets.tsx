import React, { useCallback, useMemo, useState } from 'react';
import { WalletText } from '@/react/context/WalletLocale';
import type { SeamsWeb } from '@/SeamsWeb';
import type { WalletAsset } from '@/core/assets/assetList';
import { useSeams } from '../../../context';
import { Theme, useTheme } from '../../theme';
import { AssetActions, AssetRows, BalancesCard, hasWithdrawableBalance } from './AssetViews';
import { DepositPanel } from './DepositPanel';
import { WithdrawPanel } from './WithdrawPanel';
import { sendWithdrawal } from './liveWithdraw';
import { shownBalances, useAssetBalances, type AssetBalancesState } from './useAssetBalances';
import { visibleBalances } from './assetFormat';

export type WalletAssetsController = {
  readonly state: AssetBalancesState;
  readonly refresh: () => void;
  readonly nearAccount: string | null;
  readonly evmAddress: string | null;
  readonly depositAssets: readonly WalletAsset[];
  readonly withdraw: React.ComponentProps<typeof WithdrawPanel>;
};

/** Balances, addresses and the send path for the unlocked wallet. */
export function useWalletAssetsController(input: {
  readonly seams: SeamsWeb;
  readonly walletId: string | null;
  readonly nearAccount: string | null;
  readonly evmAddress: string | null;
  readonly active: boolean;
  readonly poll: boolean;
}): WalletAssetsController {
  const { seams, walletId, nearAccount, evmAddress } = input;
  const accounts = useMemo(() => ({ nearAccount, evmAddress }), [nearAccount, evmAddress]);
  const { state, refresh } = useAssetBalances(walletId ? seams.assets : null, accounts, {
    active: input.active && Boolean(walletId),
    poll: input.poll,
  });
  const balances = shownBalances(state)?.balances ?? [];
  const depositAssets = useMemo(
    () =>
      seams.assets
        .list()
        .filter((asset) => asset.primary)
        .filter((asset) =>
          asset.kind === 'near_native' || asset.kind === 'nep141' ? nearAccount : evmAddress,
        ),
    [seams, nearAccount, evmAddress],
  );
  const fromFor = useCallback(
    (asset: WalletAsset) =>
      asset.kind === 'near_native' || asset.kind === 'nep141' ? nearAccount : evmAddress,
    [nearAccount, evmAddress],
  );
  const withdraw: React.ComponentProps<typeof WithdrawPanel> = {
    balances: visibleBalances(balances),
    fromFor,
    prepare: seams.assets.prepareWithdrawal,
    send: (withdrawal) =>
      walletId
        ? sendWithdrawal(seams, { walletId, nearAccountId: nearAccount }, withdrawal)
        : Promise.resolve({ kind: 'not_sent', message: 'Unlock your wallet first.' }),
    onSent: refresh,
  };
  return { state, refresh, nearAccount, evmAddress, depositAssets, withdraw };
}

type PageView = { kind: 'list' } | { kind: 'deposit' } | { kind: 'withdraw' };

/** The Assets section of the full settings page: the list, then Deposit or Withdraw in place. */
export function AssetsPageSection({
  controller,
}: {
  controller: WalletAssetsController;
}): React.JSX.Element {
  const [view, setView] = useState<PageView>({ kind: 'list' });
  if (view.kind !== 'list') {
    return (
      <div className="seams-assets-page-flow">
        <button
          type="button"
          className="seams-assets-link seams-assets-page-back"
          onClick={() => {
            setView({ kind: 'list' });
            controller.refresh();
          }}
        >
          <WalletText message="Back" />
        </button>
        {view.kind === 'deposit' ? (
          <DepositPanel
            assets={controller.depositAssets}
            nearAccount={controller.nearAccount}
            evmAddress={controller.evmAddress}
          />
        ) : (
          <WithdrawPanel {...controller.withdraw} />
        )}
      </div>
    );
  }
  return (
    <>
      <AssetRows state={controller.state} onRetry={controller.refresh} />
      <div className="seams-assets-screen-actions">
        <AssetActions
          onDeposit={() => setView({ kind: 'deposit' })}
          onWithdraw={() => setView({ kind: 'withdraw' })}
          canWithdraw={hasWithdrawableBalance(controller.state)}
        />
      </div>
    </>
  );
}

function WalletBalancesContent({
  onDeposit,
  onWithdraw,
  onOpenAssets,
}: WalletBalancesProps): React.JSX.Element | null {
  const { seams, loginState } = useSeams();
  const controller = useWalletAssetsController({
    seams,
    walletId: loginState.isLoggedIn ? (loginState.walletId ?? null) : null,
    nearAccount: loginState.isLoggedIn ? (loginState.nearAccountId ?? null) : null,
    evmAddress: loginState.isLoggedIn ? (loginState.thresholdEcdsaEthereumAddress ?? null) : null,
    active: loginState.isLoggedIn,
    poll: false,
  });
  return (
    <BalancesCard
      state={controller.state}
      onRetry={controller.refresh}
      onOpenAssets={onOpenAssets ?? controller.refresh}
      onDeposit={onDeposit ?? controller.refresh}
      onWithdraw={onWithdraw ?? controller.refresh}
    />
  );
}

export type WalletBalancesProps = {
  /** Runs when the user chooses Deposit. Open the Settings Deposit screen or your own flow. */
  readonly onDeposit?: () => void;
  /** Runs when the user chooses Withdraw. */
  readonly onWithdraw?: () => void;
  /** Runs when the user chooses All assets. */
  readonly onOpenAssets?: () => void;
};

/**
 * The Settings balance card for an application's own panel, inside `SeamsWebProvider`. It shows
 * nothing until the wallet is unlocked.
 */
export function WalletBalances(props: WalletBalancesProps): React.JSX.Element {
  const { theme, tokens } = useTheme();
  return (
    <Theme theme={theme} tokens={{ [theme]: tokens }}>
      <WalletBalancesContent {...props} />
    </Theme>
  );
}

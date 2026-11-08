import React, { useCallback, useMemo } from 'react';
import { WalletText } from '@/react/context/WalletLocale';
import type { SeamsWeb } from '@/SeamsWeb';
import type { WalletAsset } from '@/core/assets/assetList';
import type { AssetScreenRequest } from '@/SeamsWeb/publicApi/assets';
import { useSeams } from '../../../context';
import { Theme, useTheme } from '../../theme';
import { AssetActions, AssetRows, BalancesCard, hasSendableBalance } from './AssetViews';
import { ReceivePanel } from './ReceivePanel';
import { SendPanel } from './SendPanel';
import { sendPrepared } from './liveSend';
import { shownBalances, useAssetBalances, type AssetBalancesState } from './useAssetBalances';
import { visibleBalances } from './assetFormat';

export type WalletAssetsController = {
  readonly state: AssetBalancesState;
  readonly refresh: () => void;
  readonly nearAccount: string | null;
  readonly evmAddress: string | null;
  readonly receiveAssets: readonly WalletAsset[];
  readonly send: React.ComponentProps<typeof SendPanel>;
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
  const receiveAssets = useMemo(
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
  const send: React.ComponentProps<typeof SendPanel> = {
    balances: visibleBalances(balances),
    fromFor,
    prepare: seams.assets.prepareSend,
    send: (prepared) =>
      walletId
        ? sendPrepared(seams, { walletId, nearAccountId: nearAccount }, prepared)
        : Promise.resolve({ kind: 'not_sent', message: 'Unlock your wallet first.' }),
    onSent: refresh,
  };
  return { state, refresh, nearAccount, evmAddress, receiveAssets, send };
}

export type AssetsPageView =
  | { readonly kind: 'list' }
  | { readonly kind: 'receive' | 'send'; readonly assetId?: string };

/** The Assets section of the full settings page: the list, then Receive or Send in place. */
export function AssetsPageSection({
  controller,
  view,
  onView,
}: {
  controller: WalletAssetsController;
  view: AssetsPageView;
  onView: (view: AssetsPageView) => void;
}): React.JSX.Element {
  if (view.kind !== 'list') {
    return (
      <div className="seams-assets-page-flow">
        <button
          type="button"
          className="seams-assets-link seams-assets-page-back"
          onClick={() => {
            onView({ kind: 'list' });
            controller.refresh();
          }}
        >
          <WalletText message="Back" />
        </button>
        {view.kind === 'receive' ? (
          <ReceivePanel
            key={view.assetId}
            assets={controller.receiveAssets}
            nearAccount={controller.nearAccount}
            evmAddress={controller.evmAddress}
            initialAssetId={view.assetId}
          />
        ) : (
          <SendPanel
            key={view.assetId}
            {...controller.send}
            initialAssetId={view.assetId}
            onReceive={(assetId) => onView({ kind: 'receive', assetId })}
          />
        )}
      </div>
    );
  }
  return (
    <>
      <AssetRows state={controller.state} onRetry={controller.refresh} />
      <div className="seams-assets-screen-actions">
        <AssetActions
          onReceive={() => onView({ kind: 'receive' })}
          onSend={() => onView({ kind: 'send' })}
          canSend={hasSendableBalance(controller.state)}
        />
      </div>
    </>
  );
}

function WalletBalancesContent({
  onReceive,
  onSend,
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
  const open = (screen: AssetScreenRequest['screen']) => () => {
    seams.assets.openScreen({ screen });
  };
  return (
    <BalancesCard
      state={controller.state}
      onRetry={controller.refresh}
      onOpenAssets={onOpenAssets ?? open('assets')}
      onReceive={onReceive ?? open('receive')}
      onSend={onSend ?? open('send')}
    />
  );
}

export type WalletBalancesProps = {
  /**
   * Runs when the user chooses Receive. Without it, the button opens the Receive screen of the
   * mounted Settings panel (`seams.assets.openScreen`).
   */
  readonly onReceive?: () => void;
  /** Runs when the user chooses Send. Without it, the button opens the Settings Send screen. */
  readonly onSend?: () => void;
  /** Runs when the user chooses All assets. Without it, the link opens the Settings Assets screen. */
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

import React from 'react';
import { WalletText, useWalletLocale } from '@/react/context/WalletLocale';
import { walletDisplayText, walletText } from '@/core/ui/messages';
import type { AssetBalance } from '@/core/assets/readAssetBalances';
import { TokenArtwork } from './TokenArtwork';
import { formatAssetAmount, leadingBalances, networkLabel, visibleBalances } from './assetFormat';
import { shownBalances, type AssetBalancesState } from './useAssetBalances';
import './Assets.css';

const CARD_ROWS = 3;

function ReceiveIcon(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4v11m-5-5 5 5 5-5M5 20h14" />
    </svg>
  );
}

function SendIcon(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 15V4m-5 5 5-5 5 5M5 20h14" />
    </svg>
  );
}

function ChevronIcon(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function AssetActions({
  onReceive,
  onSend,
  canSend,
}: {
  onReceive: () => void;
  onSend: () => void;
  canSend: boolean;
}): React.JSX.Element {
  return (
    <div className="seams-assets-actions">
      <button type="button" className="seams-account-action primary" onClick={onReceive}>
        <ReceiveIcon />
        <WalletText message="Receive" />
      </button>
      <button type="button" className="seams-assets-secondary" onClick={onSend} disabled={!canSend}>
        <SendIcon />
        <WalletText message="Send" />
      </button>
    </div>
  );
}

function AmountCell({ balance }: { balance: AssetBalance }): React.JSX.Element {
  if (balance.kind === 'unavailable') {
    return (
      <span className="seams-assets-amount is-unavailable">
        <WalletText message="Unavailable" />
      </span>
    );
  }
  const zero = BigInt(balance.available) === 0n;
  return (
    <span className={`seams-assets-amount${zero ? ' is-zero' : ''}`}>
      {formatAssetAmount(balance.available, balance.asset.decimals)}
    </span>
  );
}

function allUnavailable(balances: readonly AssetBalance[]): boolean {
  return balances.length > 0 && balances.every((balance) => balance.kind === 'unavailable');
}

export function hasSendableBalance(state: AssetBalancesState): boolean {
  const balances = shownBalances(state)?.balances ?? [];
  return balances.some((balance) => balance.kind === 'read' && BigInt(balance.available) > 0n);
}

/** The overview card: the leading balances, a link to every asset, Receive and Send. */
export function BalancesCard({
  state,
  onRetry,
  onOpenAssets,
  onReceive,
  onSend,
}: {
  state: AssetBalancesState;
  onRetry: () => void;
  onOpenAssets: () => void;
  onReceive: () => void;
  onSend: () => void;
}): React.JSX.Element | null {
  const locale = useWalletLocale();
  if (state.kind === 'idle') return null;
  const balances = shownBalances(state)?.balances ?? [];
  const visible = visibleBalances(balances);
  const failed = state.kind === 'ready' && allUnavailable(balances);
  const rows = leadingBalances(balances, CARD_ROWS);
  // A network label helps only when the rows span more than one network.
  const mixedNetworks = new Set(rows.map((balance) => balance.asset.network)).size > 1;
  return (
    <section className="seams-assets-card" aria-label={walletText(locale, 'Balances')}>
      <h3 className="seams-assets-card-title">
        <WalletText message="Balances" />
        {/* The live region stays in the page, so a screen reader announces the text when it comes. */}
        <span className="seams-assets-card-status" role="status">
          {state.kind === 'loading' ? <WalletText message="Updating…" /> : null}
        </span>
      </h3>
      {failed ? (
        <div className="seams-assets-card-failed" role="alert">
          <span>
            <WalletText message="Balances are unavailable." />
          </span>
          <button type="button" className="seams-assets-link" onClick={onRetry}>
            <WalletText message="Try again" />
          </button>
        </div>
      ) : balances.length === 0 ? (
        <p className="seams-assets-card-empty">
          <WalletText message="Loading balances…" />
        </p>
      ) : (
        <ul className="seams-assets-card-rows">
          {rows.map((balance) => (
            <li key={balance.asset.id} className="seams-assets-card-row">
              <TokenArtwork artwork={balance.asset.artwork} size={24} />
              <span className="seams-assets-card-symbol">
                {balance.asset.symbol}
                {mixedNetworks ? (
                  <span className="seams-assets-card-network">
                    {walletDisplayText(locale, networkLabel(balance.asset))}
                  </span>
                ) : null}
              </span>
              <AmountCell balance={balance} />
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="seams-assets-all" onClick={onOpenAssets}>
        <span>
          <WalletText message="All assets · {value0}" values={{ value0: visible.length }} />
        </span>
        <ChevronIcon />
      </button>
      <AssetActions onReceive={onReceive} onSend={onSend} canSend={hasSendableBalance(state)} />
    </section>
  );
}

function AssetSubline({ balance }: { balance: AssetBalance }): React.JSX.Element {
  const locale = useWalletLocale();
  const { asset } = balance;
  if (asset.kind === 'near_native' && balance.kind === 'read' && balance.reserved) {
    return (
      <span className="seams-assets-sub">
        <WalletText
          message="{value0} kept for storage"
          values={{ value0: formatAssetAmount(balance.reserved, asset.decimals) }}
        />
      </span>
    );
  }
  if (asset.bridge) {
    return (
      <span className="seams-assets-sub">
        <WalletText
          message="{value0} · bridged by {value1}"
          values={{ value0: walletDisplayText(locale, asset.name), value1: asset.bridge }}
        />
      </span>
    );
  }
  return <span className="seams-assets-sub">{walletDisplayText(locale, asset.name)}</span>;
}

/** Every listed asset with its network and amount. */
export function AssetRows({
  state,
  onRetry,
}: {
  state: AssetBalancesState;
  onRetry: () => void;
}): React.JSX.Element {
  const locale = useWalletLocale();
  const balances = shownBalances(state)?.balances ?? [];
  const visible = visibleBalances(balances);
  const testnet = visible.some((balance) => balance.asset.network === 'near-testnet');
  if (state.kind === 'idle') {
    return (
      <p className="seams-account-description">
        <WalletText message="Unlock your wallet to see its balances." />
      </p>
    );
  }
  if (visible.length === 0) {
    return (
      <p className="seams-account-description" role="status">
        <WalletText message="Loading balances…" />
      </p>
    );
  }
  return (
    <>
      <ul className="seams-assets-rows" aria-label={walletText(locale, 'Assets')}>
        {visible.map((balance) => (
          <li key={balance.asset.id} className="seams-assets-row">
            <TokenArtwork artwork={balance.asset.artwork} size={32} />
            <span className="seams-assets-meta">
              <span className="seams-assets-name">
                {balance.asset.symbol}
                <span className="seams-assets-chip">
                  {walletDisplayText(locale, networkLabel(balance.asset))}
                </span>
              </span>
              <AssetSubline balance={balance} />
            </span>
            <AmountCell balance={balance} />
          </li>
        ))}
      </ul>
      {state.kind === 'ready' && balances.some((balance) => balance.kind === 'unavailable') ? (
        <p className="seams-assets-note" role="alert">
          <WalletText message="Some balances are unavailable." />{' '}
          <button type="button" className="seams-assets-link" onClick={onRetry}>
            <WalletText message="Try again" />
          </button>
        </p>
      ) : null}
      {testnet ? (
        <p className="seams-assets-note">
          <WalletText message="On testnet, only NEAR, stNEAR and USDC are listed." />
        </p>
      ) : null}
    </>
  );
}

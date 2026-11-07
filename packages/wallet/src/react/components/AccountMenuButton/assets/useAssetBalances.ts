import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssetAccounts, AssetBalances } from '@/core/assets/readAssetBalances';
import type { AssetsCapability } from '@/SeamsWeb/publicApi/assets';

export type AssetBalancesState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly previous: AssetBalances | null }
  | { readonly kind: 'ready'; readonly balances: AssetBalances };

// The Assets screen refreshes on this interval while it is open. Nothing polls while closed.
export const ASSET_REFRESH_INTERVAL_MS = 15_000;

/**
 * Balances for the open panel. It reads when `active` turns true, on `refresh`, and on an
 * interval while `poll` is true. A read for other accounts replaces an older one.
 */
export function useAssetBalances(
  assets: Pick<AssetsCapability, 'read'> | null,
  accounts: AssetAccounts,
  options: { readonly active: boolean; readonly poll: boolean },
): { readonly state: AssetBalancesState; readonly refresh: () => void } {
  const [state, setState] = useState<AssetBalancesState>({ kind: 'idle' });
  const generation = useRef(0);
  const nearAccount = accounts.nearAccount ?? null;
  const evmAddress = accounts.evmAddress ?? null;
  const hasAccount = Boolean(nearAccount || evmAddress);

  const refresh = useCallback(() => {
    if (!assets || !hasAccount) {
      setState({ kind: 'idle' });
      return;
    }
    const current = ++generation.current;
    setState((previous) => ({
      kind: 'loading',
      previous:
        previous.kind === 'ready'
          ? previous.balances
          : previous.kind === 'loading'
            ? previous.previous
            : null,
    }));
    void assets.read({ nearAccount, evmAddress }).then((balances) => {
      if (current === generation.current) setState({ kind: 'ready', balances });
    });
  }, [assets, hasAccount, nearAccount, evmAddress]);

  useEffect(() => {
    if (options.active) refresh();
  }, [options.active, refresh]);

  useEffect(() => {
    if (!options.active || !options.poll) return;
    const timer = setInterval(refresh, ASSET_REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [options.active, options.poll, refresh]);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  return { state, refresh };
}

/** The newest balances in a state, if any read has finished. */
export function shownBalances(state: AssetBalancesState): AssetBalances | null {
  if (state.kind === 'ready') return state.balances;
  if (state.kind === 'loading') return state.previous;
  return null;
}

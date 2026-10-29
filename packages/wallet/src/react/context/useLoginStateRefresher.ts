import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { SeamsWeb } from '@/SeamsWeb';
import { toWalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { LoginState, SeamsContextType } from '../types';
import { isWalletSessionReadyForUi } from './walletSessionReadiness';
import {
  buildReactLoggedInLoginStateFromSession,
  buildReactLoggedOutLoginState,
} from './reactLoginStateBuilders';

function syncAccountNameFromWalletId(
  setAccountName: SeamsContextType['setAccountName'],
  walletId: string | null | undefined,
): void {
  const value = String(walletId || '').trim();
  if (value) setAccountName(value);
}

async function resolveExactReactLoginWalletId(
  seams: SeamsWeb,
  requestedWalletId: string | undefined,
): Promise<string | null> {
  const walletId = String(requestedWalletId || seams.preferences.getCurrentWalletId() || '').trim();
  if (walletId) return walletId;

  // The preferences manager hydrates IndexedDB asynchronously during runtime
  // construction. Resolve the persisted last account as a fallback so the
  // first React mount can restore the authenticated session without a later
  // navigation or login event.
  const recentUnlocks = await seams.auth.getRecentUnlocks().catch(() => null);
  const lastUsedWalletId = String(recentUnlocks?.lastUsedAccount?.walletId || '').trim();
  if (lastUsedWalletId) return lastUsedWalletId;
  const persistedWalletIds = recentUnlocks?.walletIds ?? [];
  return persistedWalletIds.length === 1 ? String(persistedWalletIds[0]) : null;
}

export function useLoginStateRefresher(args: {
  seams: SeamsWeb;
  setLoginState: Dispatch<SetStateAction<LoginState>>;
  setAccountName: SeamsContextType['setAccountName'];
}) {
  const { seams, setLoginState, setAccountName } = args;
  const refreshGeneration = useRef(0);

  const refreshSession: SeamsContextType['refreshSession'] = useCallback(
    async (walletId?: string) => {
      const generation = ++refreshGeneration.current;
      const selectedWallet = seams.preferences.getCurrentWalletId();
      try {
        let exactWalletId: string | null;
        if (seams.configs.wallet.mode === 'iframe') {
          const requestedWalletId = String(walletId || '').trim();
          if (requestedWalletId) {
            exactWalletId = requestedWalletId;
          } else {
            const state = await seams.getWalletIframeExactSessionState();
            if (
              generation !== refreshGeneration.current ||
              selectedWallet !== seams.preferences.getCurrentWalletId()
            )
              return;
            switch (state.kind) {
              case 'external_read':
              case 'active_session':
              case 'expired_session':
              case 'wallet_authenticated_identity_unresolvable':
              case 'wallet_unlocked_without_signing_session':
                exactWalletId = state.walletId;
                break;
              case 'wallet_locked':
                setLoginState(buildReactLoggedOutLoginState());
                return;
              default:
                state satisfies never;
                return;
            }
          }
        } else {
          exactWalletId = await resolveExactReactLoginWalletId(seams, walletId);
          if (
            generation !== refreshGeneration.current ||
            selectedWallet !== seams.preferences.getCurrentWalletId()
          )
            return;
        }
        if (!exactWalletId) {
          setLoginState(buildReactLoggedOutLoginState());
          return;
        }

        const session = await seams.auth.getSession(exactWalletId);
        // A newer refresh or wallet selection supersedes this asynchronous read.
        if (
          generation !== refreshGeneration.current ||
          selectedWallet !== seams.preferences.getCurrentWalletId()
        )
          return;
        if (
          session.authentication.kind === 'authenticated' &&
          session.appIdentity.kind !== 'resolved'
        ) {
          return;
        }
        if (!isWalletSessionReadyForUi({ session })) {
          setLoginState(buildReactLoggedOutLoginState());
          return;
        }
        if (session.appIdentity.kind !== 'resolved') {
          setLoginState(buildReactLoggedOutLoginState());
          return;
        }
        const resolvedWalletId = session.appIdentity.walletId;
        if (resolvedWalletId) {
          seams.preferences.setCurrentWallet(toWalletId(resolvedWalletId));
          syncAccountNameFromWalletId(setAccountName, resolvedWalletId);
        }
        const nextLoginState = buildReactLoggedInLoginStateFromSession(session);
        setLoginState(nextLoginState ?? buildReactLoggedOutLoginState());
      } catch (error) {
        console.error('Error refreshing login state:', error);
      }
    },
    [setAccountName, setLoginState, seams],
  );

  useEffect(() => {
    if (seams.configs.wallet.mode === 'iframe') return;
    void refreshSession();
  }, [refreshSession, seams]);

  return refreshSession;
}

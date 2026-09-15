import { toWalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { IndexedDBManager } from '@/core/indexedDB';
import type { HandlerDeps, HandlerMap, Req } from './walletIframeHandler.types';
import { respondOk, respondOkResult } from './shared';

export function createPreferencesWalletIframeHandlers(deps: HandlerDeps): HandlerMap {
  return {
    PM_SET_CONFIRM_BEHAVIOR: async (req: Req<'PM_SET_CONFIRM_BEHAVIOR'>) => {
      const pm = deps.getSeamsWeb();
      const { behavior, walletId } = req.payload!;
      if (walletId) {
        pm.preferences.setCurrentWallet(toWalletId(walletId));
      }
      pm.preferences.setConfirmBehavior(behavior);
      respondOk(deps, req.requestId);
    },

    PM_SET_CONFIRMATION_CONFIG: async (req: Req<'PM_SET_CONFIRMATION_CONFIG'>) => {
      const pm = deps.getSeamsWeb();
      const { walletId } = req.payload || {};
      const incoming = (req.payload?.config || {}) as Record<string, unknown>;
      let patch: Record<string, unknown> = { ...incoming };
      if (walletId) {
        pm.preferences.setCurrentWallet(toWalletId(walletId));
        const preferences = await IndexedDBManager.getWalletPreferences(walletId).catch(() => null);
        patch = { ...preferences?.confirmationConfig, ...incoming };
      }
      const base = pm.preferences.getConfirmationConfig();
      pm.preferences.setConfirmationConfig({ ...base, ...patch });
      respondOk(deps, req.requestId);
    },

    PM_GET_CONFIRMATION_CONFIG: async (req: Req<'PM_GET_CONFIRMATION_CONFIG'>) => {
      const pm = deps.getSeamsWeb();
      const result = pm.preferences.getConfirmationConfig();
      respondOkResult(deps, req.requestId, result);
    },
  };
}

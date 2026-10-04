import { toWalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { HandlerDeps, HandlerMap, Req } from './walletIframeHandler.types';
import { respondOkResult } from './shared';

export function createPreferencesWalletIframeHandlers(deps: HandlerDeps): HandlerMap {
  return {
    PM_SET_CONFIRM_BEHAVIOR: async (req: Req<'PM_SET_CONFIRM_BEHAVIOR'>) => {
      const pm = deps.getWalletRuntime();
      const { behavior, walletId } = req.payload!;
      if (walletId) {
        pm.preferences.setCurrentWallet(toWalletId(walletId));
      }
      await pm.preferences.setConfirmBehavior(behavior);
      respondOkResult(deps, req.requestId, deps.readPreferences());
    },

    PM_SET_CONFIRMATION_CONFIG: async (req: Req<'PM_SET_CONFIRMATION_CONFIG'>) => {
      const pm = deps.getWalletRuntime();
      const { walletId } = req.payload || {};
      if (walletId) pm.preferences.setCurrentWallet(toWalletId(walletId));
      await pm.preferences.setConfirmationConfig(req.payload?.config || {});
      respondOkResult(deps, req.requestId, deps.readPreferences());
    },

    PM_GET_CONFIRMATION_CONFIG: async (req: Req<'PM_GET_CONFIRMATION_CONFIG'>) => {
      const result = deps.readPreferences();
      respondOkResult(deps, req.requestId, result);
    },
  };
}

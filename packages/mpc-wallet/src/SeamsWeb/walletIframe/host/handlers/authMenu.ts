import { parseWalletConnectionResolution } from '../../shared/walletAlternatives';
import type { HandlerDeps, HandlerMap, Req } from './walletIframeHandler.types';
import { respondOkResult } from './shared';
import {
  parseHostedAuthMenuCancelPayload,
  parseHostedAuthMenuExternalAuthResolution,
  parseHostedAuthMenuOpenRequest,
} from '../../shared/messages';
import { AuthMenuController } from '../auth-menu/controller';

export function createHostedAuthMenuHandlers(
  deps: HandlerDeps,
  controller = new AuthMenuController({
    getWalletRuntime: deps.getWalletRuntime,
    getAppearance: () => deps.getWalletRuntime().configs.ui.appearance,
    send: deps.post,
  }),
): HandlerMap {
  return {
    PM_RESOLVE_WALLET_CONNECTION: async (req: Req<'PM_RESOLVE_WALLET_CONNECTION'>) => {
      const payload = parseWalletConnectionResolution(req.payload);
      if (!payload) throw new Error('Invalid wallet connection resolution');
      respondOkResult(deps, req.requestId, {
        accepted: controller.resolveWalletConnection(payload),
      });
    },
    PM_OPEN_AUTH_MENU: async (req: Req<'PM_OPEN_AUTH_MENU'>) => {
      const payload = parseHostedAuthMenuOpenRequest(req.payload);
      if (!payload) throw new Error('Hosted auth-menu open request is invalid');
      const outcome = await controller.open({ request: payload, requestId: req.requestId });
      if (
        outcome.kind === 'authenticated' ||
        outcome.kind === 'registered' ||
        outcome.kind === 'account_synced'
      ) {
        await deps.publishCurrentSession();
      }
      if (deps.respondIfCancelled(req.requestId)) return;
      respondOkResult(deps, req.requestId, outcome);
    },
    PM_CANCEL_AUTH_MENU: async (req: Req<'PM_CANCEL_AUTH_MENU'>) => {
      const payload = parseHostedAuthMenuCancelPayload(req.payload);
      if (!payload) throw new Error('Hosted auth-menu cancellation is invalid');
      const cancelled = controller.cancel(payload);
      respondOkResult(deps, req.requestId, { cancelled });
    },
    PM_RESOLVE_AUTH_MENU_EXTERNAL_AUTH: async (req: Req<'PM_RESOLVE_AUTH_MENU_EXTERNAL_AUTH'>) => {
      const payload = parseHostedAuthMenuExternalAuthResolution(req.payload);
      if (!payload) throw new Error('Hosted auth-menu external-auth resolution is invalid');
      const accepted = controller.resolveExternalAuth(payload);
      respondOkResult(deps, req.requestId, { accepted });
    },
  };
}

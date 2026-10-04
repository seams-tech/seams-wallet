import type { LoginHooksOptions } from '@/core/types/sdkSentEvents';
import type { WalletSession } from '@/core/types/seams';
import type { HandlerDeps, HandlerMap, Req } from './walletIframeHandler.types';
import { respondOk, respondOkResult, withProgress } from './shared';
import {
  exactSessionIdentitiesMatch,
  parseWalletIframeExactSessionIdentity,
  type WalletIframeExactSessionSnapshot,
} from '../../shared/exactSessionState';
import {
  pmUnlockPayloadToLoginHooksOptions,
  requirePMUnlockPayload,
  type PMUnlockLoginHooksOptions,
} from '../../shared/unlockOptions';
import type { PMGetExactWalletSessionStatePayload } from '../../shared/messages';
import {
  activeHostedWalletSessionOperationCredential,
  clearHostedWalletSessions,
} from '../hostedWalletSeamsSession';
import { createHostedAuthMenuHandlers } from './authMenu';
import { resolveExactWalletSessionState } from '../sessionObserver';

function assertUnlockPayloadHasNoParentBearer(payload: unknown): void {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  const record = payload as Record<string, unknown>;
  const options =
    record.options && typeof record.options === 'object' && !Array.isArray(record.options)
      ? (record.options as Record<string, unknown>)
      : null;
  const inventoryOption =
    options?.ecdsaKeyFactsInventory &&
    typeof options.ecdsaKeyFactsInventory === 'object' &&
    !Array.isArray(options.ecdsaKeyFactsInventory)
      ? (options.ecdsaKeyFactsInventory as Record<string, unknown>)
      : null;
  const inventory =
    inventoryOption?.value &&
    typeof inventoryOption.value === 'object' &&
    !Array.isArray(inventoryOption.value)
      ? (inventoryOption.value as Record<string, unknown>)
      : null;
  if (
    inventory &&
    (Object.prototype.hasOwnProperty.call(inventory, 'walletSessionToken') ||
      Object.prototype.hasOwnProperty.call(inventory, 'operationCredential'))
  ) {
    throw new Error('wallet iframe unlock requests must not carry a Wallet Session bearer');
  }
}

function walletOriginUnlockOptions(
  options: PMUnlockLoginHooksOptions,
  relayUrl: string,
): LoginHooksOptions {
  const inventory = options.ecdsaKeyFactsInventory;
  const { ecdsaKeyFactsInventory: _inventory, ...optionsWithoutInventory } = options;
  if (!inventory) return optionsWithoutInventory;
  if (inventory.mode === 'webauthn') {
    return { ...optionsWithoutInventory, ecdsaKeyFactsInventory: inventory };
  }
  const operationCredential = activeHostedWalletSessionOperationCredential(relayUrl);
  if (!operationCredential) {
    throw new Error('Hosted-wallet Wallet Session is required for opaque key-facts lookup');
  }
  return {
    ...optionsWithoutInventory,
    ecdsaKeyFactsInventory: {
      mode: 'wallet_session_operation_credential_v1',
      operationCredential,
    },
  };
}

function walletSessionRequestWalletId(
  pm: Pick<ReturnType<HandlerDeps['getWalletRuntime']>, 'preferences'>,
  payload: Req<'PM_GET_WALLET_SESSION'>['payload'],
): string | undefined {
  const requestedWalletId = String(payload?.walletId || '').trim();
  if (requestedWalletId) return requestedWalletId;
  const currentWalletId = String(pm.preferences.getCurrentWalletId() || '').trim();
  return currentWalletId || undefined;
}

function reportRestoredSessionPresignaturePrefillFailure(error: unknown): void {
  console.warn('[WalletIframeHost] Restored-session presignature prefill failed:', error);
}

function publishSessionResponse(
  deps: HandlerDeps,
  pm: ReturnType<HandlerDeps['getWalletRuntime']>,
  requestId: string | undefined,
  payload: PMGetExactWalletSessionStatePayload,
  snapshot: WalletIframeExactSessionSnapshot,
): void {
  if (deps.respondIfCancelled(requestId)) return;
  respondOkResult(deps, requestId, snapshot);
  if (payload.authenticationRead === 'restore') {
    void pm
      .prefillRestoredWalletSession(snapshot.state)
      .catch(reportRestoredSessionPresignaturePrefillFailure);
  }
}

export function createAuthWalletIframeHandlers(deps: HandlerDeps): HandlerMap {
  return {
    ...createHostedAuthMenuHandlers(deps),
    PM_UNLOCK: async (req: Req<'PM_UNLOCK'>) => {
      const pm = deps.getWalletRuntime();
      assertUnlockPayloadHasNoParentBearer(req.payload);
      const payload = requirePMUnlockPayload(req.payload);
      const requestedOptions = pmUnlockPayloadToLoginHooksOptions(payload);
      const options = walletOriginUnlockOptions(requestedOptions, pm.configs.network.relayer.url);
      if (deps.respondIfCancelled(req.requestId)) return;
      const result = await pm.auth.unlock(
        payload.walletId,
        withProgress(deps, req.requestId, options) as LoginHooksOptions,
      );
      if (deps.respondIfCancelled(req.requestId)) return;
      if (!result.success) clearHostedWalletSessions();
      await deps.publishCurrentSession();
      if (deps.respondIfCancelled(req.requestId)) return;
      respondOkResult(deps, req.requestId, result);
    },

    PM_LOCK: async (req: Req<'PM_LOCK'>) => {
      const pm = deps.getWalletRuntime();
      clearHostedWalletSessions();
      await pm.auth.lock();
      respondOk(deps, req.requestId);
    },

    PM_LOGOUT: async (req: Req<'PM_LOGOUT'>) => {
      const pm = deps.getWalletRuntime();
      clearHostedWalletSessions();
      await pm.auth.logout();
      respondOk(deps, req.requestId);
    },

    PM_LOCK_EXACT_WALLET_SESSION: async (req: Req<'PM_LOCK_EXACT_WALLET_SESSION'>) => {
      const pm = deps.getWalletRuntime();
      const expected = parseWalletIframeExactSessionIdentity(req.payload);
      const current = await resolveExactWalletSessionState(pm, {
        authenticationRead: 'current',
        wallet: { kind: 'current' },
      });
      if (
        (current.kind !== 'active_session' && current.kind !== 'expired_session') ||
        !exactSessionIdentitiesMatch(current, expected)
      ) {
        respondOkResult(deps, req.requestId, { kind: 'stale_session', expected, current });
        return;
      }
      clearHostedWalletSessions();
      await pm.auth.lock();
      respondOkResult(deps, req.requestId, { kind: 'locked', identity: expected });
    },

    PM_GET_WALLET_SESSION: async (req: Req<'PM_GET_WALLET_SESSION'>) => {
      const pm = deps.getWalletRuntime();
      const walletId = walletSessionRequestWalletId(pm, req.payload);
      const result: WalletSession = await pm.auth.getWalletSession(walletId);
      respondOkResult(deps, req.requestId, result);
    },

    PM_GET_EXACT_WALLET_SESSION_STATE: async (req: Req<'PM_GET_EXACT_WALLET_SESSION_STATE'>) => {
      const pm = deps.getWalletRuntime();
      const payload = req.payload;
      if (
        !payload ||
        (payload.authenticationRead !== 'restore' && payload.authenticationRead !== 'current') ||
        !payload.wallet ||
        (payload.wallet.kind !== 'current' && payload.wallet.kind !== 'exact') ||
        (payload.authenticationRead === 'restore' && payload.wallet.kind !== 'current')
      ) {
        throw new Error('Wallet iframe exact session read mode is invalid');
      }
      await deps.observeSession(
        payload,
        publishSessionResponse.bind(null, deps, pm, req.requestId, payload),
      );
    },

    PM_GET_RECENT_UNLOCKS: async (req: Req<'PM_GET_RECENT_UNLOCKS'>) => {
      const pm = deps.getWalletRuntime();
      const result = await pm.auth.getRecentUnlocks();
      respondOkResult(deps, req.requestId, result);
    },
  };
}

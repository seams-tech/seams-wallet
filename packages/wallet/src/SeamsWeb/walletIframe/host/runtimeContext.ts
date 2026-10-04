import type { TransactionReviewAdmission } from '@/core/signingEngine/uiConfirm/transactionReviewAdmission';
import type {
  ChildToParentEnvelope,
  ParentToChildEnvelope,
  ParentToChildType,
  PreferencesChangedPayload,
  ProgressPayload,
  WalletIframeSurfaceMeasurement,
} from '../shared/messages';
import { WalletHostRuntime } from '@/SeamsWeb/walletIframe/host/WalletHostRuntime';
import type { WalletHostConfigurationState } from '../shared/configuration';
import {
  applyWalletConfig,
  createHostContext,
  ensureWalletRuntime,
  ensureWalletHostLifecycleSubscription,
  setWalletHostLifecycleListener,
  type HostContext,
} from './context';
import type { HandlerDeps, HandlerMap } from './handlers/walletIframeHandler.types';
import type { SdkLifecycleEvent } from '@/core/types/sdkSentEvents';
import {
  walletIframeRequestIdFromBoundary,
  type WalletIframeRequestId,
} from '@/core/types/walletIframeIdentity';
import type { UiConfirmSurfaceMeasurementBinding } from '@/core/signingEngine/uiConfirm/uiConfirm.types';
import { recordAdoptedWalletIframeParentOrigin } from './hostedWalletSeamsSession';
import {
  beginTransactionActivity,
  observeTransactionActivity,
  observeTransactionLifecycleReport,
  failTransactionActivity,
} from '@/core/signingEngine/uiConfirm/ui/transaction-activity';

export type WalletHostRuntimeState = {
  parentOrigin: string | null;
  port: MessagePort | null;
  configuration: WalletHostConfigurationState;
  executionGeneration: number;
  onConfigurationChanged: (() => void) | null;
};

export type WalletHostRuntimeRequest = {
  transactionReview: TransactionReviewAdmission | null;
  state: WalletHostRuntimeState;
  readonly executionGeneration: number;
  req: ParentToChildEnvelope;
  post(msg: ChildToParentEnvelope): void;
  isCancelled(requestId: string | undefined): boolean;
  respondIfCancelled(requestId: string | undefined): boolean;
};

type HandlerFactory = (deps: HandlerDeps) => HandlerMap;

let runtimeContext: HostContext | null = null;
const handlerMaps = new Map<HandlerFactory, HandlerMap>();
let handlerExecutionGeneration: number | null = null;

const FOREGROUND_CONFIRMATION_REQUEST_TYPES: ReadonlySet<ParentToChildType> = new Set([
  'PM_REGISTER_WALLET',
  'PM_ADD_WALLET_SIGNER',
  'PM_ADD_PASSKEY',
  'PM_ADD_EMAIL_OTP',
  'PM_REVOKE_AUTH_METHOD',
  'PM_UNLOCK_ADDED_EMAIL_OTP_WALLET',
  'PM_SIGN_TX_WITH_ACTIONS',
  'PM_SIGN_AND_SEND_TX',
  'PM_EXECUTE_ACTION',
  'PM_SIGN_DELEGATE_ACTION',
  'PM_SIGN_NEP413',
  'PM_UNLOCK',
  'PM_SIGN_TEMPO',
  'PM_ENROLL_EMAIL_OTP',
  'PM_LOGIN_EMAIL_OTP_ECDSA_CAPABILITY',
  'PM_ROTATE_WALLET_RECOVERY_CODES',
  'PM_ACKNOWLEDGE_WALLET_RECOVERY_CODE_BACKUP',
  'PM_SYNC_ACCOUNT_FLOW',
  'PM_EXPORT_KEYPAIR_UI',
  'PM_SCAN_AND_LINK_DEVICE',
  'PM_START_DEVICE2_LINKING_FLOW',
]);

function postSurfaceMeasurement(
  input: WalletHostRuntimeRequest,
  measurement: WalletIframeSurfaceMeasurement,
): void {
  input.post({ type: 'SURFACE_MEASUREMENT', payload: measurement });
}

/**
 * The variant the parent pinned the host box to for a whole request, when it is
 * NOT simply the variant of whatever confirmation renders inside it.
 *
 * Key export is the only such request. Its box is always a full-viewport drawer
 * because the key viewer is always a bottom drawer, but the Email OTP prompt
 * that runs first inside that same box still follows the Confirmer UI setting.
 * The parent reads this exact field to dress the dialog
 * (confirmationUiModeForRequest in client/router.ts), so reading it here is what
 * keeps the two sides describing the same box.
 */
function pinnedHostSurfaceVariantForRequest(
  req: ParentToChildEnvelope,
): 'modal' | 'drawer' | undefined {
  if (req.type !== 'PM_EXPORT_KEYPAIR_UI') return undefined;
  const payload = req.payload;
  const variant = payload?.options?.variant;
  return variant === 'modal' || variant === 'drawer' ? variant : 'drawer';
}

function surfaceMeasurementBindingForRequest(
  input: WalletHostRuntimeRequest,
): { requestId: WalletIframeRequestId; binding: UiConfirmSurfaceMeasurementBinding } | null {
  let requestId: WalletIframeRequestId;
  try {
    requestId = walletIframeRequestIdFromBoundary(input.req.requestId);
  } catch {
    return null;
  }
  const hostSurfaceVariant = pinnedHostSurfaceVariantForRequest(input.req);
  return {
    requestId,
    binding: {
      kind: 'wallet_iframe',
      ...(input.transactionReview ? { transactionReview: input.transactionReview } : {}),
      requestId,
      postMeasurement: postSurfaceMeasurement.bind(null, input),
      ...(hostSurfaceVariant ? { hostSurfaceVariant } : {}),
    },
  };
}

function isForegroundConfirmationRequest(input: WalletHostRuntimeRequest): boolean {
  return FOREGROUND_CONFIRMATION_REQUEST_TYPES.has(input.req.type);
}

function clearSurfaceMeasurementBindingForRequest(
  ctx: HostContext,
  requestId: WalletIframeRequestId,
): void {
  const binding = ctx.surfaceMeasurementBinding;
  if (binding.kind !== 'wallet_iframe' || binding.requestId !== requestId) return;
  ctx.surfaceMeasurementBinding = { kind: 'disabled' };
  ctx.walletRuntime?.setWalletIframeSurfaceMeasurementBinding({ kind: 'disabled' });
}

/**
 * This binding says where surface measurements are routed. It does NOT decide
 * whether two requests may be in flight at once — the parent's surface reducer
 * does, and it rejects a second surface up front, before the message is ever
 * posted.
 *
 * It used to throw here instead, and it was keyed on the wrong lifetime: the
 * binding is set for a whole request and released in its `finally`, while a
 * confirmation surface only lives until the user answers it. A transaction that
 * has been confirmed and is off doing MPC and broadcast still held the binding,
 * so a key export raised meanwhile was refused for the entire tail of a request
 * whose UI was long gone. Worse, a request that never settled wedged every
 * later foreground request until reload, with no way back.
 *
 * So hand the binding over. The newest foreground request is the one whose UI
 * is about to mount, and therefore the one whose measurements matter.
 */
function takeForegroundSurfaceBinding(
  ctx: HostContext,
  binding: UiConfirmSurfaceMeasurementBinding,
): void {
  ctx.surfaceMeasurementBinding = binding;
  ensureWalletRuntime(ctx).setWalletIframeSurfaceMeasurementBinding(binding);
}

function syncRuntimeContext(state: WalletHostRuntimeState): HostContext {
  if (handlerExecutionGeneration !== state.executionGeneration) {
    handlerMaps.clear();
    handlerExecutionGeneration = state.executionGeneration;
  }
  if (!runtimeContext) {
    runtimeContext = createHostContext();
  }
  state.onConfigurationChanged = syncActiveWalletHostRuntimeConfig.bind(null, state);
  runtimeContext.parentOrigin = state.parentOrigin;
  runtimeContext.port = state.port;
  if (state.parentOrigin !== null) {
    recordAdoptedWalletIframeParentOrigin(state.parentOrigin);
  }
  setWalletHostLifecycleListener(runtimeContext, postLifecycleEvent.bind(null, runtimeContext));
  if (state.configuration.kind === 'configured') {
    applyWalletConfig(runtimeContext, state.configuration);
  }
  return runtimeContext;
}

function syncActiveWalletHostRuntimeConfig(state: WalletHostRuntimeState): void {
  if (!runtimeContext || state.configuration.kind === 'unconfigured') return;
  syncRuntimeContext(state);
}

function ensureRequestWalletRuntime(ctx: HostContext): WalletHostRuntime {
  const previous = ctx.walletRuntime;
  const walletRuntime = ensureWalletRuntime(ctx);
  ensureWalletHostLifecycleSubscription(ctx, walletRuntime);
  if (previous === walletRuntime) return walletRuntime;

  const preferences = walletRuntime.preferences;
  ctx.prefsUnsubscribe?.();
  const emitPreferencesChanged = publishPreferences.bind(null, ctx, walletRuntime);
  const unsubscribeConfirmationConfig =
    preferences.onConfirmationConfigChange?.(emitPreferencesChanged) || null;
  const unsubscribeCurrentWallet =
    preferences.onCurrentWalletChange?.(emitPreferencesChanged) || null;
  ctx.prefsUnsubscribe = (): void => {
    try {
      unsubscribeConfirmationConfig?.();
    } catch {}
    try {
      unsubscribeCurrentWallet?.();
    } catch {}
  };
  Promise.resolve()
    .then(emitPreferencesChanged)
    .catch(() => {});
  return walletRuntime;
}

function preferencesSnapshot(
  ctx: HostContext,
  runtime: WalletHostRuntime,
): PreferencesChangedPayload {
  return {
    walletId: runtime.preferences.getCurrentWalletId(),
    confirmationConfig: runtime.preferences.getConfirmationConfig(),
    revision: ctx.preferencesRevision,
  };
}

function publishPreferences(ctx: HostContext, runtime: WalletHostRuntime): void {
  if (ctx.walletRuntime !== runtime) return;
  ctx.preferencesRevision += 1;
  ctx.port?.postMessage({
    type: 'PREFERENCES_CHANGED',
    payload: preferencesSnapshot(ctx, runtime),
  });
}

function getRequestWalletRuntime(
  ctx: HostContext,
  input: WalletHostRuntimeRequest,
): WalletHostRuntime {
  if (input.executionGeneration !== input.state.executionGeneration) {
    throw new Error('Wallet configuration changed during request');
  }
  return ensureRequestWalletRuntime(ctx);
}

function readPreferences(
  ctx: HostContext,
  input: WalletHostRuntimeRequest,
): PreferencesChangedPayload {
  return preferencesSnapshot(ctx, getRequestWalletRuntime(ctx, input));
}

function buildHandlerDeps(ctx: HostContext, input: WalletHostRuntimeRequest): HandlerDeps {
  const postProgress = (requestId: string | undefined, payload: ProgressPayload): void => {
    if (!requestId) return;
    postActivityMessage(input, { type: 'PROGRESS', requestId, payload });
  };

  return {
    getWalletRuntime: getRequestWalletRuntime.bind(null, ctx, input),
    readPreferences: readPreferences.bind(null, ctx, input),
    post: postActivityMessage.bind(null, input),
    postProgress,
    isCancelled: input.isCancelled,
    respondIfCancelled: input.respondIfCancelled,
  };
}

function postActivityMessage(
  input: WalletHostRuntimeRequest,
  message: ChildToParentEnvelope,
): void {
  if (input.executionGeneration !== input.state.executionGeneration) return;
  observeTransactionActivity(message);
  input.post(message);
}

function postLifecycleEvent(ctx: HostContext, event: SdkLifecycleEvent): void {
  ctx.port?.postMessage({ type: 'SDK_LIFECYCLE_EVENT', payload: event });
}

export async function handleWalletHostRuntimeRequestWithHandlers(
  input: WalletHostRuntimeRequest,
  createHandlers: HandlerFactory,
): Promise<void> {
  if (input.respondIfCancelled(input.req.requestId)) return;
  const ctx = syncRuntimeContext(input.state);
  beginTransactionActivity(input.req, input.post);
  const foregroundBinding = isForegroundConfirmationRequest(input)
    ? surfaceMeasurementBindingForRequest(input)
    : null;
  if (foregroundBinding) {
    takeForegroundSurfaceBinding(ctx, foregroundBinding.binding);
  }

  try {
    let handlers = handlerMaps.get(createHandlers);
    if (!handlers) {
      handlers = createHandlers(buildHandlerDeps(ctx, input));
      handlerMaps.set(createHandlers, handlers);
    }

    const handler = handlers[input.req.type] as unknown as
      | ((r: ParentToChildEnvelope) => Promise<void>)
      | undefined;
    if (!handler) {
      throw new Error(`Unsupported wallet iframe request type: ${input.req.type}`);
    }
    await handler(input.req);
    if (input.executionGeneration === input.state.executionGeneration) {
      observeTransactionLifecycleReport(input.req);
    }
  } catch (error) {
    if (input.executionGeneration === input.state.executionGeneration) {
      failTransactionActivity(input.req.requestId, error);
    }
    throw error;
  } finally {
    if (foregroundBinding && input.executionGeneration === input.state.executionGeneration) {
      clearSurfaceMeasurementBindingForRequest(ctx, foregroundBinding.requestId);
    }
  }
}

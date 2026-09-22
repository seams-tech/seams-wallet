import {
  TransactionReviewAdmission,
  transactionReviewAdmission,
  cancelTransactionReviews,
} from '@/core/signingEngine/uiConfirm/transactionReviewAdmission';
import {
  parseTransactionReviewWire,
  transactionReviewCancellationCode,
  parseTransactionReviewState,
  sameTransactionReviewIdentity,
  assertTransactionReviewValid,
  TransactionReviewError,
} from '../shared/transactionReview';
import { bootstrapTransparentHost } from './bootstrap';
import type {
  ChildToParentEnvelope,
  ParentToChildEnvelope,
  PMSetConfigPayload,
  WalletIframeProtocolVersionMismatchDetails,
} from '../shared/messages';
import {
  WALLET_IFRAME_PROTOCOL_VERSION_MISMATCH,
  WALLET_PROTOCOL_VERSION,
} from '../shared/messages';
import type { SeamsConfigsInput } from '@/core/types/seams';
import { WalletIframeDomEvents } from '@/core/browser/walletIframe/events';
import { isObject, isPlainObject } from '@shared/utils/validation';
import { errorMessage } from '@shared/utils/errors';
import type { WalletHostRuntimeState } from './runtimeContext';
import { loadWalletHostRuntime, preloadWalletHostRecoveryCodeSurface } from './runtimeLoader';
import {
  type RuntimeWalletHostRoute,
  routeRequiresRuntime,
  routeWalletHostRequest,
} from './requestRouter';

let initialized = false;

const CONFIRM_UI_SURFACES = [
  { selector: '.seams-auth-menu-surface', cancellationKind: 'native_cancel' },
  { selector: '.seams-confirmation-surface', cancellationKind: 'native_cancel' },
  { selector: '.seams-export-surface', cancellationKind: 'wallet_iframe_cancel' },
  {
    selector: '[data-seams-wallet-recovery-backup-dialog]',
    cancellationKind: 'native_cancel',
  },
] as const;

export type WalletHostRuntimeKind = RuntimeWalletHostRoute['kind'];

export type WalletHostEntryOptions = {
  supportedRuntimeRouteKinds?: ReadonlySet<WalletHostRuntimeKind>;
};

type WalletIframeConnectBoundaryMessage = {
  readonly type: 'CONNECT';
  readonly payload: { readonly protocolVersion: string };
};

function hasOnlyKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const expectedKeys = new Set(expected);
  const actualKeys = Object.keys(record);
  return actualKeys.length === expected.length && actualKeys.every((key) => expectedKeys.has(key));
}

function parseWalletIframeConnectMessage(
  value: unknown,
): WalletIframeConnectBoundaryMessage | null {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['type', 'payload'])) return null;
  if (value.type !== 'CONNECT' || !isPlainObject(value.payload)) return null;
  if (!hasOnlyKeys(value.payload, ['protocolVersion'])) return null;
  return typeof value.payload.protocolVersion === 'string'
    ? { type: 'CONNECT', payload: { protocolVersion: value.payload.protocolVersion } }
    : null;
}

function isAuthenticatedParentOrigin(origin: string): boolean {
  if (origin === 'null') return true;
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.origin === origin
    );
  } catch {
    return false;
  }
}

function closePort(port: MessagePort): void {
  try {
    port.close();
  } catch {}
}

function rejectProtocolVersionMismatch(
  port: MessagePort,
  receivedProtocolVersion: string | null,
): boolean {
  if (receivedProtocolVersion === WALLET_PROTOCOL_VERSION) return false;
  const details: WalletIframeProtocolVersionMismatchDetails = {
    expectedProtocolVersion: WALLET_PROTOCOL_VERSION,
    receivedProtocolVersion,
  };
  try {
    port.postMessage({
      type: 'ERROR',
      payload: {
        code: WALLET_IFRAME_PROTOCOL_VERSION_MISMATCH,
        message: `Wallet iframe protocol version mismatch: expected ${WALLET_PROTOCOL_VERSION}, received ${receivedProtocolVersion ?? 'missing'}`,
        details,
      },
    } satisfies ChildToParentEnvelope);
  } catch {}
  closePort(port);
  return true;
}

function routeIsSupported(
  route: RuntimeWalletHostRoute,
  supported: ReadonlySet<WalletHostRuntimeKind> | undefined,
): boolean {
  return !supported || supported.has(route.kind);
}

export function initWalletIFrame(options: WalletHostEntryOptions = {}): void {
  if (initialized) return;
  initialized = true;

  bootstrapTransparentHost();
  if (!options.supportedRuntimeRouteKinds || options.supportedRuntimeRouteKinds.has('email_otp')) {
    void preloadWalletHostRecoveryCodeSurface().catch(() => undefined);
  }

  const cancelledRequests = new Set<string>();
  const state: WalletHostRuntimeState = {
    parentOrigin: null,
    port: null,
    walletConfigs: null,
  };

  const post = (msg: ChildToParentEnvelope): void => {
    try {
      state.port?.postMessage(msg);
    } catch {}
  };

  const markCancelled = (rid?: string): void => {
    if (rid) cancelledRequests.add(rid);
  };
  const isCancelled = (rid?: string): boolean =>
    !!rid && (cancelledRequests.has(rid) || transactionReviewAdmission(rid)?.cancelled === true);
  const clearCancelled = (rid?: string): void => {
    if (rid) cancelledRequests.delete(rid);
  };
  const emitCancellationPayload = (requestId: string | undefined): void => {
    if (!requestId) return;
    post({
      type: 'ERROR',
      requestId,
      payload: { code: 'cancelled', message: 'Request cancelled' },
    });
  };
  const respondIfCancelled = (requestId: string | undefined): boolean => {
    if (!requestId || !isCancelled(requestId)) return false;
    if (transactionReviewAdmission(requestId)?.cancelled) return true;
    emitCancellationPayload(requestId);
    clearCancelled(requestId);
    return true;
  };

  const cancelOpenConfirmers = (): void => {
    for (const surface of CONFIRM_UI_SURFACES) {
      const elements = document.querySelectorAll<HTMLElement>(surface.selector);
      for (const element of elements) {
        try {
          if (surface.cancellationKind === 'native_cancel') {
            element.dispatchEvent(new Event('cancel', { cancelable: true }));
          } else {
            element.dispatchEvent(
              new CustomEvent(WalletIframeDomEvents.TX_CONFIRMER_CANCEL, {
                bubbles: true,
                composed: true,
              }),
            );
          }
        } catch {}
      }
    }
  };

  const onPortMessage = async (e: MessageEvent<ParentToChildEnvelope>) => {
    const req = e.data as ParentToChildEnvelope;
    if (!req || !isObject(req)) return;
    const requestId = req.requestId;

    let reviewAdmission: TransactionReviewAdmission | null = null;
    try {
      if ('transactionReview' in req) {
        if (
          req.type !== 'PM_SIGN_AND_SEND_TX' &&
          req.type !== 'PM_EXECUTE_ACTION' &&
          req.type !== 'PM_SIGN_TEMPO'
        ) {
          throw new TransactionReviewError(
            'review_invalid_input',
            'Review is unsupported for this request',
          );
        }
        const metadata = parseTransactionReviewWire(req.transactionReview);
        if (metadata.requestId !== requestId)
          throw new TransactionReviewError(
            'review_invalid_input',
            'Review request identity mismatch',
          );
        const config = req.payload?.options?.confirmationConfig;
        if (config?.uiMode !== 'modal' || config.behavior !== 'requireClick') {
          throw new TransactionReviewError(
            'review_unsupported_mode',
            'Review requires modal presentation and explicit approval',
          );
        }
        reviewAdmission = new TransactionReviewAdmission(
          metadata,
          req.type === 'PM_SIGN_TEMPO' &&
            req.payload?.request.senderSignatureAlgorithm !== 'secp256k1'
            ? 'credential'
            : 'mpc',
          (payload) => post({ type: 'TRANSACTION_REVIEW_STATE', requestId, payload }),
          (error) =>
            post({
              type: 'ERROR',
              requestId,
              payload: {
                code: error instanceof TransactionReviewError ? error.code : 'cancelled',
                message: error.message,
              },
            }),
        );
      }
      if (
        req.type === 'PM_LOCK' ||
        req.type === 'PM_LOGOUT' ||
        req.type === 'PM_LOCK_EXACT_WALLET_SESSION'
      ) {
        cancelTransactionReviews(
          new TransactionReviewError('review_identity_changed', 'The wallet session changed'),
        );
      }
      const route = routeWalletHostRequest(req);

      if (!routeRequiresRuntime(route)) {
        switch (route.type) {
          case 'PING':
            post({ type: 'PONG', requestId });
            return;
          case 'PM_SET_CONFIG':
            state.walletConfigs = {
              ...(state.walletConfigs || ({} as SeamsConfigsInput)),
              ...(route.request.payload as PMSetConfigPayload),
            } as SeamsConfigsInput;
            if (CONFIRM_UI_SURFACES.some(({ selector }) => document.querySelector(selector))) {
              const runtimeContext = await import('./runtimeContext');
              runtimeContext.syncActiveWalletHostRuntimeConfig(state);
            }
            post({ type: 'PONG', requestId });
            return;
          case 'PM_ACTIVATE_TRANSACTION_REVIEW': {
            const identity = parseTransactionReviewState(route.request.payload);
            if (identity) transactionReviewAdmission(identity.requestId)?.activate(identity);
            return;
          }
          case 'PM_CANCEL': {
            const rid = (route.request.payload as { requestId?: string } | undefined)?.requestId;
            const cancelPayload = route.request.payload;
            const rawReview =
              cancelPayload && typeof cancelPayload === 'object'
                ? Reflect.get(cancelPayload, 'transactionReview')
                : undefined;
            if (rawReview !== undefined) {
              const identity = parseTransactionReviewWire(rawReview);
              const reviewed = transactionReviewAdmission(identity.requestId);
              if (
                identity.requestId === rid &&
                reviewed &&
                sameTransactionReviewIdentity(identity, reviewed.metadata)
              ) {
                let error: Error = new TransactionReviewError(
                  transactionReviewCancellationCode(
                    cancelPayload && typeof cancelPayload === 'object'
                      ? Reflect.get(cancelPayload, 'reviewErrorCode')
                      : undefined,
                  ),
                  'Reviewed request cancelled',
                );
                try {
                  assertTransactionReviewValid(reviewed.metadata.validity);
                } catch (expired) {
                  if (expired instanceof Error) error = expired;
                }
                reviewed.cancel(error);
              }
              post({ type: 'PONG', requestId });
              return;
            }
            const reviewed = rid ? transactionReviewAdmission(rid) : undefined;
            if (reviewed) {
              reviewed.cancel(new TransactionReviewError('cancelled', 'Request cancelled'));
              post({ type: 'PONG', requestId });
              return;
            }
            markCancelled(rid);
            cancelOpenConfirmers();
            if (rid) emitCancellationPayload(rid);
            post({ type: 'PONG', requestId });
            return;
          }
          case 'PM_SET_TRANSACTION_VIEW': {
            const payload = route.request.payload;
            const target =
              payload && typeof payload === 'object' ? Reflect.get(payload, 'requestId') : null;
            const view =
              payload && typeof payload === 'object' ? Reflect.get(payload, 'view') : null;
            if (typeof target === 'string' && (view === 'toast' || view === 'closed')) {
              const activity =
                await import('@/core/signingEngine/uiConfirm/ui/transaction-activity');
              activity.setTransactionActivityView(target, view);
            }
            return;
          }
          case 'PM_TRANSACTION_BROADCAST_STARTED': {
            const payload = route.request.payload;
            const signedTransaction: unknown =
              payload && typeof payload === 'object'
                ? Reflect.get(payload, 'signedTransaction')
                : null;
            if (typeof signedTransaction === 'string') {
              const activity =
                await import('@/core/signingEngine/uiConfirm/ui/transaction-activity');
              activity.transactionBroadcastStarted(signedTransaction);
            }
            return;
          }
        }
      }

      if (!routeIsSupported(route, options.supportedRuntimeRouteKinds)) {
        post({
          type: 'ERROR',
          requestId,
          payload: {
            code: 'unsupported_request',
            message: `Unsupported wallet iframe request type: ${route.type}`,
          },
        });
        return;
      }

      const runtime = await loadWalletHostRuntime(route);
      await runtime.handleWalletHostRuntimeRequest({
        transactionReview: reviewAdmission,
        state,
        req: route.request,
        post,
        isCancelled,
        respondIfCancelled,
      });
    } catch (err: unknown) {
      if (reviewAdmission?.cancelled) return;
      const canonicalSignerErrors = await import('./canonicalSignerErrorCode');
      const codeRaw =
        err && typeof err === 'object' && 'code' in err
          ? (err as { code?: unknown }).code
          : undefined;
      const message = errorMessage(err);
      const code = canonicalSignerErrors.resolveWalletBoundaryErrorCode({
        requestType: req.type,
        rawCode: codeRaw,
        message,
        defaultCode: 'HOST_ERROR',
      });
      const canonicalMessage = canonicalSignerErrors.resolveWalletBoundaryErrorMessage({
        requestType: req.type,
        rawCode: codeRaw,
        code,
        message,
      });
      const signerKind = canonicalSignerErrors.resolveWalletBoundarySignerKind(req.type);
      post({
        type: 'ERROR',
        requestId,
        payload: {
          code,
          message: canonicalMessage,
          ...(canonicalSignerErrors.isWalletSignerBoundaryRequestType(req.type) &&
          canonicalSignerErrors.isCanonicalSignerSessionBoundaryCode(code) &&
          signerKind
            ? { signerKind }
            : {}),
        },
      });
    } finally {
      reviewAdmission?.finish();
    }
  };

  const onWindowMessage = (e: MessageEvent): void => {
    const connect = parseWalletIframeConnectMessage(e.data);
    const port = e.ports[0];
    if (!connect || !port || state.port) return;
    if (e.source !== window.parent || !isAuthenticatedParentOrigin(e.origin)) {
      closePort(port);
      return;
    }
    if (rejectProtocolVersionMismatch(port, connect.payload.protocolVersion)) return;
    if (typeof e.origin === 'string' && e.origin.length && e.origin !== 'null') {
      state.parentOrigin = e.origin;
    }
    state.port = port;
    try {
      state.port.onmessage = onPortMessage;
      state.port.start?.();
    } catch {}
    post({ type: 'READY', payload: { protocolVersion: WALLET_PROTOCOL_VERSION } });
  };

  window.addEventListener('message', onWindowMessage);
}

try {
  initWalletIFrame();
} catch (e) {
  console.error('[WalletHost] init failed', e);
}

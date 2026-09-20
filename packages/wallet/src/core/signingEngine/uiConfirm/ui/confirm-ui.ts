import { __isWalletIframeHostMode } from '@/core/browser/walletIframe/host-mode';
import type { UserConfirmSecurityContext, TransactionInputWasm } from '@/core/types';
import type { AppearanceConfig, ThemeMode } from '@/core/types/seams';
import {
  isActionArgsWasm,
  toActionArgsWasm,
  type ActionArgs,
  type ActionArgsWasm,
} from '@/core/types/actions';
import { resolveExplorerUrlForChainFamily } from '@/core/config/chains';
import type { TxDisplayModel } from '@/core/signingEngine/interfaces/display';
import { computeUiIntentDigestFromTxs, orderActionForDigest } from '@/utils/intentDigest';

import type { UiConfirmContext, UiConfirmSurfaceMeasurementBinding } from '../uiConfirm.types';
import type { TransactionSummary } from '@/core/signingEngine/stepUpConfirmation/channel/confirmTypes';
import type { EmailOtpConfirmPrompt, SigningAuthMode } from '../../stepUpConfirmation/types';
import { buildConfirmationTree } from './transaction-display/confirmation-tree';
import {
  createConfirmationSurfaceController,
  type ConfirmationSurfaceController,
} from './preact/confirmation-controller';
import type {
  ConfirmUIHandle,
  ConfirmUIPromptDiagnostics,
  ConfirmUISurfaceDecision,
  ConfirmUISurfaceSource,
  ConfirmUIUpdate,
  ConfirmationUIMode,
  MountedConfirmUIHandle,
} from './confirm-ui-types';
import { SEAMS_CONFIRM_PORTAL_ID } from './registry';
import {
  createWalletIframeSurfaceMeasurementReporter,
  type WalletIframeSurfaceMeasurementReporter,
} from '@/SeamsWeb/walletIframe/host/surface-measurement-reporter';
import {
  attachConfirmSurfaceResizeChoreographer,
  CONFIRM_SURFACE_MODE_ATTR,
  type ConfirmSurfaceResizeChoreographer,
} from './confirm-surface-resize';

export type {
  ConfirmUIHandle,
  ConfirmUIPromptDiagnostics,
  ConfirmUISurfaceDecision,
  ConfirmUISurfaceSource,
  ConfirmUIUpdate,
  ConfirmationUIMode,
  MountedConfirmUIHandle,
} from './confirm-ui-types';

function roundConfirmUiDurationMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

type ConfirmDecisionResult = {
  confirmed: boolean;
  error?: string;
  otpCode?: string;
  emailOtpChallengeId?: string;
};

type ConfirmationHost = ConfirmationSurfaceController;

const confirmSurfaceMeasurementReporters = new WeakMap<
  HTMLElement,
  WalletIframeSurfaceMeasurementReporter
>();
// Lives exactly as long as the reporter: while the parent hugs this host, tree
// nodes inside it hand their height motion over so the box grows first.
const confirmSurfaceResizeChoreographers = new WeakMap<
  HTMLElement,
  ConfirmSurfaceResizeChoreographer
>();
const confirmSurfaceMeasurementBindings = new WeakMap<
  HTMLElement,
  UiConfirmSurfaceMeasurementBinding
>();
const confirmationHosts = new WeakMap<HTMLElement, ConfirmationHost>();
const confirmationChannels = new WeakMap<HTMLElement, ConfirmationDecisionChannel>();

export type ConfirmUIRenderContext = {
  userPreferencesManager: Pick<UiConfirmContext['userPreferencesManager'], 'getCurrentWalletId'>;
  chains?: UiConfirmContext['chains'];
  getAppearance?: UiConfirmContext['getAppearance'];
  nearExplorerUrl?: string;
  tempoExplorerUrl?: string;
  evmExplorerUrl?: string;
  surfaceMeasurementBinding: UiConfirmSurfaceMeasurementBinding;
};

async function ensureConfirmationSurfaceModule(): Promise<void> {
  await import('./preact/mountConfirmationSurface');
}

export async function prewarmTxConfirmerUi(): Promise<void> {
  await ensureConfirmationSurfaceModule();
}

const DEFAULT_CONFIRM_APPEARANCE: AppearanceConfig = {
  theme: {
    id: 'default',
    mode: 'dark',
    colors: {},
  },
  palette: 'default',
};

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

function withAppearanceMode(appearance: AppearanceConfig, mode?: ThemeMode): AppearanceConfig {
  if (!isThemeMode(mode) || mode === appearance.theme.mode) return appearance;
  return {
    ...appearance,
    theme: {
      ...appearance.theme,
      mode,
    },
  };
}

function resolveAppearance(args: {
  ctx: ConfirmUIRenderContext;
  requestedAppearance?: AppearanceConfig;
  requestedMode?: ThemeMode;
}): AppearanceConfig {
  const base = args.requestedAppearance ?? args.ctx.getAppearance?.() ?? DEFAULT_CONFIRM_APPEARANCE;
  return withAppearanceMode(base, args.requestedMode);
}

function postWalletUiMessage(type: 'WALLET_UI_OPENED' | 'WALLET_UI_CLOSED'): void {
  try {
    if (!__isWalletIframeHostMode()) return;
    if (typeof window === 'undefined') return;
    if (window.parent === window) return;
    window.parent?.postMessage({ type }, '*');
  } catch {}
}

function uiModeToVariant(uiMode: ConfirmationUIMode): 'modal' | 'drawer' {
  return uiMode === 'drawer' ? 'drawer' : 'modal';
}

function normalizeTxSigningRequestsForDigest(
  txSigningRequests?: TransactionInputWasm[],
): TransactionInputWasm[] {
  return (txSigningRequests || []).map((tx) => ({
    receiverId: tx.receiverId,
    actions: (tx.actions || [])
      .map((action) =>
        isActionArgsWasm(action) ? action : toActionArgsWasm(action as unknown as ActionArgs),
      )
      .map((action) => orderActionForDigest(action as ActionArgsWasm) as ActionArgsWasm),
  }));
}

async function checkIntentDigestGuard(
  expectedIntentDigest: string | undefined,
  txSigningRequests?: TransactionInputWasm[],
): Promise<string | undefined> {
  const hasTxs = (txSigningRequests?.length || 0) > 0;
  if (!hasTxs || !expectedIntentDigest) return undefined;

  try {
    const normalizedTxs = normalizeTxSigningRequestsForDigest(txSigningRequests);
    const uiDigest = await computeUiIntentDigestFromTxs(normalizedTxs);
    return uiDigest === expectedIntentDigest ? undefined : 'INTENT_DIGEST_MISMATCH';
  } catch {
    return 'UI_DIGEST_VALIDATION_FAILED';
  }
}

function updateConfirmPortalState(portal: HTMLElement): void {
  if (portal.childElementCount > 0) {
    portal.classList.add('seams-portal--visible');
  } else {
    portal.classList.remove('seams-portal--visible');
  }
}

function mountedConfirmerHosts(): HTMLElement[] {
  const hosts: HTMLElement[] = [];
  for (const candidate of document.querySelectorAll<HTMLElement>('.seams-confirmation-surface')) {
    if (candidate.parentElement?.closest('.seams-confirmation-surface')) continue;
    hosts.push(candidate);
  }
  return hosts;
}

function cleanupExistingConfirmers(): void {
  for (const element of mountedConfirmerHosts()) {
    confirmationChannels.get(element)?.callbacks.cancel();
    confirmationHosts.get(element)?.dispose();
    disconnectConfirmSurfaceMeasurementReporter(element);
    element.remove();
  }
  const portal = document.getElementById(SEAMS_CONFIRM_PORTAL_ID) as HTMLElement | null;
  if (portal) updateConfirmPortalState(portal);
}

function ensureConfirmPortal(): HTMLElement {
  let portal = document.getElementById(SEAMS_CONFIRM_PORTAL_ID) as HTMLElement | null;
  if (!portal) {
    portal = document.createElement('div');
    portal.id = SEAMS_CONFIRM_PORTAL_ID;
    portal.classList.add('seams-portal');
    const root = document.body ?? document.documentElement;
    if (root) root.appendChild(portal);
  }
  return portal;
}

function removeHostConfirmerElement(element: HTMLElement): void {
  confirmationHosts.delete(element);
  disconnectConfirmSurfaceMeasurementReporter(element);
  element.remove();
  const portal = document.getElementById(SEAMS_CONFIRM_PORTAL_ID) as HTMLElement | null;
  if (portal) updateConfirmPortalState(portal);
}

function postWalletUiClosedIfPortalEmpty(): void {
  const portal = document.getElementById(SEAMS_CONFIRM_PORTAL_ID);
  if ((portal?.childElementCount ?? 0) > 0) return;
  postWalletUiMessage('WALLET_UI_CLOSED');
}

const DRAWER_CLOSE_FALLBACK_MS = 250;

function closeConfirmationHost(
  host: ConfirmationHost,
  _confirmed: boolean,
  onClose: () => void,
): void {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    removeHostConfirmerElement(host.element);
    onClose();
  };

  if (host.variant !== 'drawer') {
    host.close();
    finish();
    return;
  }

  const timeoutId = window.setTimeout(() => finish(), DRAWER_CLOSE_FALLBACK_MS);
  host.close();
}

function resolveExplorerUrlsFromModel(
  ctx: ConfirmUIRenderContext,
  model?: TxDisplayModel,
): Pick<ConfirmUIUpdate, 'nearExplorerUrl' | 'tempoExplorerUrl' | 'evmExplorerUrl'> {
  const chain = model?.chain;
  if (chain !== 'near' && chain !== 'tempo' && chain !== 'evm') return {};

  const explorerUrl = resolveExplorerUrlForChainFamily({
    chains: ctx.chains,
    family: chain,
    chainId: model?.chainId,
  });
  if (!explorerUrl) return {};

  if (chain === 'near') return { nearExplorerUrl: explorerUrl };
  if (chain === 'tempo') return { tempoExplorerUrl: explorerUrl };
  return { evmExplorerUrl: explorerUrl };
}

function applyHostElementProps(
  _ctx: ConfirmUIRenderContext,
  host: ConfirmationHost,
  props?: ConfirmUIUpdate,
): void {
  if (!props) return;
  host.update(props);
}

function sameConfirmSurfaceMeasurementBinding(
  left: UiConfirmSurfaceMeasurementBinding | undefined,
  right: UiConfirmSurfaceMeasurementBinding,
): boolean {
  if (!left || left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'disabled':
      return right.kind === 'disabled';
    case 'wallet_iframe':
      return (
        right.kind === 'wallet_iframe' &&
        left.requestId === right.requestId &&
        left.postMeasurement === right.postMeasurement &&
        left.hostSurfaceVariant === right.hostSurfaceVariant
      );
  }
}

function disconnectConfirmSurfaceMeasurementReporter(element: HTMLElement): void {
  confirmSurfaceMeasurementReporters.get(element)?.disconnect();
  confirmSurfaceMeasurementReporters.delete(element);
  confirmSurfaceResizeChoreographers.get(element)?.dispose();
  confirmSurfaceResizeChoreographers.delete(element);
  confirmSurfaceMeasurementBindings.delete(element);
}

function createConfirmSurfaceMeasurementReporter(
  binding: UiConfirmSurfaceMeasurementBinding,
  element: HTMLElement,
): WalletIframeSurfaceMeasurementReporter | null {
  switch (binding.kind) {
    case 'disabled':
      return null;
    case 'wallet_iframe':
      return createWalletIframeSurfaceMeasurementReporter({
        kind: 'request_surface',
        element,
        requestId: binding.requestId,
        postMeasurement: binding.postMeasurement,
      });
    default: {
      const exhaustive: never = binding;
      throw new Error(`Unhandled confirmation measurement binding: ${String(exhaustive)}`);
    }
  }
}

/**
 * Two independent values decide how a confirmation is laid out, and conflating
 * them is what once stranded the Email OTP export prompt in the top-left corner:
 *
 * - `data-seams-confirm-variant` is what THIS confirmation renders (modal card or
 *   bottom sheet). It comes from the Confirmer UI setting.
 * - `data-seams-confirm-surface` is the shape of the HOST BOX it renders into.
 *   `wallet-iframe` means the parent measured the card and sized the box to hug
 *   it, so the card must not position itself. `standalone` means the card owns a
 *   full-viewport canvas and centres (modal) or bottom-anchors (drawer) itself.
 *
 * They are usually the same value, so the box shape is inferred from the
 * variant. Key export is the exception: its box is pinned to a full-viewport
 * drawer for the whole request (the key viewer is always a drawer), while the
 * OTP prompt inside that box still follows the Confirmer UI setting. A modal
 * prompt in a full-viewport box must self-centre, so the box shape wins.
 */
function applyConfirmSurfaceMode(
  element: HTMLElement,
  variant: 'modal' | 'drawer',
  binding: UiConfirmSurfaceMeasurementBinding,
): void {
  const hostBoxVariant =
    binding.kind === 'wallet_iframe' ? (binding.hostSurfaceVariant ?? variant) : variant;
  const surface =
    binding.kind === 'wallet_iframe' && hostBoxVariant === 'modal' ? 'wallet-iframe' : 'standalone';
  element.setAttribute(CONFIRM_SURFACE_MODE_ATTR, surface);
  if (variant) element.setAttribute('data-seams-confirm-variant', variant);
}

function bindConfirmSurfaceMeasurementReporter(
  element: HTMLElement,
  variant: 'modal' | 'drawer',
  binding: UiConfirmSurfaceMeasurementBinding,
): void {
  applyConfirmSurfaceMode(element, variant, binding);
  if (
    sameConfirmSurfaceMeasurementBinding(confirmSurfaceMeasurementBindings.get(element), binding)
  ) {
    return;
  }
  disconnectConfirmSurfaceMeasurementReporter(element);
  confirmSurfaceMeasurementBindings.set(element, binding);
  const reporter = createConfirmSurfaceMeasurementReporter(binding, element);
  if (!reporter) return;
  confirmSurfaceMeasurementReporters.set(element, reporter);
  confirmSurfaceResizeChoreographers.set(element, attachConfirmSurfaceResizeChoreographer(element));
}

type ConfirmationDecisionChannel = {
  readonly cancelListeners: Set<(detail: { error?: string }) => void>;
  readonly callbacks: {
    confirm: () => void;
    cancel: () => void;
    submitEmail: (code: string, challengeId: string) => void;
  };
  publish(decision: ConfirmUISurfaceDecision): void;
  takeDecision(): Promise<ConfirmUISurfaceDecision>;
};

function createConfirmationDecisionChannel(): ConfirmationDecisionChannel {
  const queuedDecisions: ConfirmUISurfaceDecision[] = [];
  const decisionWaiters: Array<(decision: ConfirmUISurfaceDecision) => void> = [];
  const cancelListeners = new Set<(detail: { error?: string }) => void>();
  const publishDecision = (decision: ConfirmUISurfaceDecision): void => {
    const waiter = decisionWaiters.shift();
    if (waiter) {
      waiter(decision);
      return;
    }
    queuedDecisions.push(decision);
  };
  const cancel = (error?: string): void => {
    publishDecision({ kind: 'cancelled', error: error ?? null });
    for (const listener of cancelListeners) listener({ ...(error ? { error } : {}) });
  };
  return {
    cancelListeners,
    callbacks: {
      confirm: () => {
        publishDecision({ kind: 'confirmed', emailOtp: { kind: 'absent' } });
      },
      cancel: () => cancel(),
      submitEmail: (code, challengeId) => {
        const otpCode = code.trim();
        const emailOtpChallengeId = challengeId.trim();
        if (!otpCode || !emailOtpChallengeId) {
          cancel('Email OTP challenge is missing.');
          return;
        }
        publishDecision({
          kind: 'confirmed',
          emailOtp: { kind: 'provided', code: otpCode, challengeId: emailOtpChallengeId },
        });
      },
    },
    publish: publishDecision,
    takeDecision: async () => {
      const queued = queuedDecisions.shift();
      if (queued) return queued;
      return await new Promise<ConfirmUISurfaceDecision>((resolve) => {
        decisionWaiters.push(resolve);
      });
    },
  };
}

function createHostConfirmHandle(
  ctx: ConfirmUIRenderContext,
  host: ConfirmationHost,
  onClose: () => void,
  channel: ConfirmationDecisionChannel,
): MountedConfirmUIHandle {
  let closed = false;
  return {
    element: host.element,
    close: (confirmed: boolean) => {
      if (closed) return;
      closed = true;
      if (!confirmed) channel.callbacks.cancel();
      channel.cancelListeners.clear();
      disconnectConfirmSurfaceMeasurementReporter(host.element);
      closeConfirmationHost(host, confirmed, onClose);
    },
    update: (props: ConfirmUIUpdate) => applyHostElementProps(ctx, host, props),
    onCancel: (listener) => {
      channel.cancelListeners.add(listener);
      return () => channel.cancelListeners.delete(listener);
    },
    takeDecision: () => channel.takeDecision(),
  };
}

export async function mountConfirmUI({
  ctx,
  summary,
  txSigningRequests,
  model,
  securityContext,
  loading,
  theme,
  appearance,
  uiMode,
  nearAccountIdOverride,
  signingAuthMode,
  emailOtpPrompt,
}: {
  ctx: ConfirmUIRenderContext;
  summary: TransactionSummary;
  txSigningRequests?: TransactionInputWasm[];
  model?: TxDisplayModel;
  securityContext?: Partial<UserConfirmSecurityContext>;
  loading?: boolean;
  theme?: ThemeMode;
  appearance?: AppearanceConfig;
  uiMode: ConfirmationUIMode;
  nearAccountIdOverride?: string;
  signingAuthMode?: SigningAuthMode;
  emailOtpPrompt?: EmailOtpConfirmPrompt;
}): Promise<MountedConfirmUIHandle> {
  await ensureConfirmationSurfaceModule();

  const variant = uiModeToVariant(uiMode);
  const { handle } = mountHostElement({
    ctx,
    summary,
    txSigningRequests,
    model,
    securityContext,
    loading,
    theme,
    appearance,
    variant,
    nearAccountIdOverride,
    signingAuthMode,
    emailOtpPrompt,
  });
  return handle;
}

type ResolveDecisionSurfaceArgs = {
  ctx: ConfirmUIRenderContext;
  summary: TransactionSummary;
  txSigningRequests: TransactionInputWasm[];
  model?: TxDisplayModel;
  securityContext?: Partial<UserConfirmSecurityContext>;
  loading?: boolean;
  theme: ThemeMode;
  appearance?: AppearanceConfig;
  variant: 'modal' | 'drawer';
  nearAccountIdOverride: string;
  signingAuthMode?: SigningAuthMode;
  emailOtpPrompt?: EmailOtpConfirmPrompt;
  surface: ConfirmUISurfaceSource;
};

function reuseMountedDecisionSurface(
  args: ResolveDecisionSurfaceArgs & {
    surface: Extract<ConfirmUISurfaceSource, { kind: 'reuse_mounted' }>;
  },
): {
  el: HTMLElement;
  handle: MountedConfirmUIHandle;
  reused: true;
} {
  const handle = args.surface.handle;
  const el = handle.element;
  if (!el.isConnected) {
    throw new Error('Cannot reuse a detached confirmation surface');
  }
  const host = confirmationHosts.get(el);
  if (!host) throw new Error('Cannot reuse an unmanaged confirmation surface');
  bindConfirmSurfaceMeasurementReporter(el, args.variant, args.ctx.surfaceMeasurementBinding);
  const resolvedAppearance = resolveAppearance({
    ctx: args.ctx,
    requestedAppearance: args.appearance,
    requestedMode: args.theme,
  });
  const explorerOverrides = resolveExplorerUrlsFromModel(args.ctx, args.model);
  host.update({
    model: args.model,
    securityContext: args.securityContext,
    loading: args.loading ?? false,
    appearance: resolvedAppearance,
    title: args.summary.title ?? '',
    body: args.summary.body ?? '',
    signingAuthMode: args.signingAuthMode,
    emailOtpPrompt: args.emailOtpPrompt,
    errorMessage: '',
    ...explorerOverrides,
  });
  host.setTree(
    buildConfirmationTree({ txSigningRequests: args.txSigningRequests, model: args.model }),
  );
  return { el, handle, reused: true };
}

function assertNeverConfirmationSurface(value: never): never {
  throw new Error(`Unhandled confirmation surface: ${JSON.stringify(value)}`);
}

function resolveDecisionSurface(args: ResolveDecisionSurfaceArgs): {
  el: HTMLElement;
  handle: MountedConfirmUIHandle;
  reused: boolean;
} {
  switch (args.surface.kind) {
    case 'mount_new': {
      const mounted = mountHostElement({
        ctx: args.ctx,
        summary: args.summary,
        txSigningRequests: args.txSigningRequests,
        model: args.model,
        securityContext: args.securityContext,
        loading: args.loading,
        theme: args.theme,
        appearance: args.appearance,
        variant: args.variant,
        nearAccountIdOverride: args.nearAccountIdOverride,
        signingAuthMode: args.signingAuthMode,
        emailOtpPrompt: args.emailOtpPrompt,
      });
      return { ...mounted, reused: false };
    }
    case 'reuse_mounted':
      return reuseMountedDecisionSurface({
        ...args,
        surface: args.surface,
      });
    case 'preparation_cancelled':
      throw new Error('A cancelled preparation surface cannot be mounted');
    default:
      return assertNeverConfirmationSurface(args.surface);
  }
}

export async function prepareConfirmUISurface(args: {
  ctx: ConfirmUIRenderContext;
  summary: TransactionSummary;
  txSigningRequests: TransactionInputWasm[];
  model?: TxDisplayModel;
  securityContext?: Partial<UserConfirmSecurityContext>;
  loading?: boolean;
  theme: ThemeMode;
  appearance?: AppearanceConfig;
  uiMode: ConfirmationUIMode;
  nearAccountIdOverride: string;
  signingAuthMode?: SigningAuthMode;
  emailOtpPrompt?: EmailOtpConfirmPrompt;
  surface: ConfirmUISurfaceSource;
}): Promise<MountedConfirmUIHandle> {
  await ensureConfirmationSurfaceModule();
  const resolved = resolveDecisionSurface({
    ctx: args.ctx,
    summary: args.summary,
    txSigningRequests: args.txSigningRequests,
    model: args.model,
    securityContext: args.securityContext,
    loading: args.loading,
    theme: args.theme,
    appearance: args.appearance,
    variant: uiModeToVariant(args.uiMode),
    nearAccountIdOverride: args.nearAccountIdOverride,
    signingAuthMode: args.signingAuthMode,
    emailOtpPrompt: args.emailOtpPrompt,
    surface: args.surface,
  });
  return resolved.handle;
}

export async function awaitConfirmUIDecision({
  ctx,
  summary,
  txSigningRequests,
  model,
  securityContext,
  loading,
  theme,
  appearance,
  uiMode,
  nearAccountIdOverride,
  onMounted,
  signingAuthMode,
  emailOtpPrompt,
  surface,
}: {
  ctx: ConfirmUIRenderContext;
  summary: TransactionSummary;
  txSigningRequests: TransactionInputWasm[];
  model?: TxDisplayModel;
  securityContext?: Partial<UserConfirmSecurityContext>;
  loading?: boolean;
  theme: ThemeMode;
  appearance?: AppearanceConfig;
  uiMode: ConfirmationUIMode;
  nearAccountIdOverride: string;
  onMounted?: (handle: ConfirmUIHandle) => void;
  signingAuthMode?: SigningAuthMode;
  emailOtpPrompt?: EmailOtpConfirmPrompt;
  surface: ConfirmUISurfaceSource;
}): Promise<
  ConfirmDecisionResult & {
    handle: ConfirmUIHandle;
    diagnostics: ConfirmUIPromptDiagnostics;
  }
> {
  const elementDefineStartedAt = performance.now();
  await ensureConfirmationSurfaceModule();
  const elementDefineMs = roundConfirmUiDurationMs(elementDefineStartedAt);

  const variant = uiModeToVariant(uiMode);
  const resolvedVariant: 'modal' | 'drawer' = variant || 'modal';

  return new Promise((resolve) => {
    const mountStartedAt = performance.now();
    const { el, handle, reused } = resolveDecisionSurface({
      ctx,
      summary,
      txSigningRequests,
      model,
      securityContext,
      loading,
      theme,
      appearance,
      variant: resolvedVariant,
      nearAccountIdOverride,
      signingAuthMode,
      emailOtpPrompt,
      surface,
    });
    const mountMs = roundConfirmUiDurationMs(mountStartedAt);
    const decisionWaitStartedAt = performance.now();
    let hostFirstUpdateMs = 0;
    let hostInteractiveMs = reused ? mountMs : 0;
    let confirmEventMs = 0;
    const markDecisionWaitOffset = (currentValue: number): number =>
      currentValue > 0 ? currentValue : roundConfirmUiDurationMs(decisionWaitStartedAt);

    void Promise.resolve().then(() => {
      hostFirstUpdateMs = markDecisionWaitOffset(hostFirstUpdateMs);
      if (!reused) hostInteractiveMs = markDecisionWaitOffset(hostInteractiveMs);
    });

    try {
      onMounted?.(handle);
    } catch {}

    const finalize = (result: ConfirmDecisionResult) => {
      const diagnostics: ConfirmUIPromptDiagnostics = {
        kind: 'confirm_ui_prompt_diagnostics_v1',
        elementDefineMs,
        mountMs,
        hostFirstUpdateMs,
        hostInteractiveMs,
        confirmEventMs,
        decisionWaitMs: roundConfirmUiDurationMs(decisionWaitStartedAt),
      };
      cleanup();
      resolve({ ...result, handle, diagnostics });
    };

    const onDecision = async (decision: ConfirmUISurfaceDecision) => {
      confirmEventMs = markDecisionWaitOffset(confirmEventMs);
      if (decision.kind === 'cancelled') {
        const error = decision.error || undefined;
        handle.update({
          ...(error ? { errorMessage: error } : {}),
          loading: false,
        });
        finalize({ confirmed: false, error });
        return;
      }

      let error: string | undefined;

      const expectedIntentDigest = String(
        model?.intentDigest || summary?.intentDigest || '',
      ).trim();
      const guardError = await checkIntentDigestGuard(expectedIntentDigest, txSigningRequests);
      if (guardError) {
        error = guardError;
      }

      if (error) {
        handle.update({
          errorMessage: error,
          loading: false,
        });
        finalize({ confirmed: false, error });
        return;
      }

      finalize({
        confirmed: true,
        ...(decision.emailOtp.kind === 'provided'
          ? {
              otpCode: decision.emailOtp.code,
              emailOtpChallengeId: decision.emailOtp.challengeId,
            }
          : {}),
      });
    };

    const cleanup = () => {
      hostFirstUpdateMs = Math.max(hostFirstUpdateMs, 0);
    };
    void (async () => {
      let decision = await handle.takeDecision();
      if (
        signingAuthMode === 'emailOtp' &&
        decision.kind === 'confirmed' &&
        decision.emailOtp.kind === 'absent'
      ) {
        handle.update({ loading: false });
        decision = await handle.takeDecision();
      }
      await onDecision(decision);
    })();
  });
}

function mountHostElement({
  ctx,
  summary,
  txSigningRequests,
  model,
  securityContext,
  loading,
  theme,
  appearance,
  variant,
  nearAccountIdOverride,
  signingAuthMode,
  emailOtpPrompt,
}: {
  ctx: ConfirmUIRenderContext;
  summary: TransactionSummary;
  txSigningRequests?: TransactionInputWasm[];
  model?: TxDisplayModel;
  securityContext?: Partial<UserConfirmSecurityContext>;
  loading?: boolean;
  theme?: ThemeMode;
  appearance?: AppearanceConfig;
  variant?: 'modal' | 'drawer';
  nearAccountIdOverride?: string;
  signingAuthMode?: SigningAuthMode;
  emailOtpPrompt?: EmailOtpConfirmPrompt;
}): { el: HTMLElement; handle: MountedConfirmUIHandle } {
  const resolvedVariant: 'modal' | 'drawer' = variant || 'modal';
  cleanupExistingConfirmers();
  const resolvedAppearance = resolveAppearance({
    ctx,
    requestedAppearance: appearance,
    requestedMode: theme,
  });
  const portal = ensureConfirmPortal();
  const explorerOverrides = resolveExplorerUrlsFromModel(ctx, model);
  const channel = createConfirmationDecisionChannel();
  const host = createConfirmationSurfaceController({
    parent: portal,
    variant: resolvedVariant,
    context: confirmationSurfaceContext(ctx.surfaceMeasurementBinding, resolvedVariant),
    appearance: resolvedAppearance,
    presentation: {
      model,
      securityContext,
      loading,
      title: summary?.title ?? (summary?.delegate ? 'Sign Delegate Action' : undefined),
      body: summary?.body,
      signingAuthMode,
      emailOtpPrompt,
      nearExplorerUrl: ctx.nearExplorerUrl ?? explorerOverrides.nearExplorerUrl,
      tempoExplorerUrl: ctx.tempoExplorerUrl ?? explorerOverrides.tempoExplorerUrl,
      evmExplorerUrl: ctx.evmExplorerUrl ?? explorerOverrides.evmExplorerUrl,
    },
    tree: buildConfirmationTree({ txSigningRequests, model }),
    callbacks: channel.callbacks,
    onClosed: postWalletUiClosedIfPortalEmpty,
  });
  confirmationHosts.set(host.element, host);
  confirmationChannels.set(host.element, channel);
  applyConfirmSurfaceMode(host.element, resolvedVariant, ctx.surfaceMeasurementBinding);
  updateConfirmPortalState(portal);
  bindConfirmSurfaceMeasurementReporter(
    host.element,
    resolvedVariant,
    ctx.surfaceMeasurementBinding,
  );

  portal.classList.remove('seams-portal--visible');
  requestAnimationFrame(() => {
    portal.classList.add('seams-portal--visible');
  });

  postWalletUiMessage('WALLET_UI_OPENED');

  const handle = createHostConfirmHandle(ctx, host, postWalletUiClosedIfPortalEmpty, channel);

  return { el: host.element, handle };
}

function confirmationSurfaceContext(
  binding: UiConfirmSurfaceMeasurementBinding,
  variant: 'modal' | 'drawer',
): 'standalone' | 'wallet-iframe' {
  const hostVariant =
    binding.kind === 'wallet_iframe' ? (binding.hostSurfaceVariant ?? variant) : variant;
  return binding.kind === 'wallet_iframe' && hostVariant === 'modal'
    ? 'wallet-iframe'
    : 'standalone';
}

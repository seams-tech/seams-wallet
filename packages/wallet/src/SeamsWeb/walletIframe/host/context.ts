import { MinimalNearClient } from '@/core/rpcClients/near/NearClient';
import { WalletHostRuntime } from '@/SeamsWeb/walletIframe/host/WalletHostRuntime';
import { __setWalletIframeHostMode } from '@/core/browser/walletIframe/host-mode';
import type { AppearanceConfig } from '@/core/types/seams';
import type { SdkLifecycleEvent, SdkLifecycleEventListener } from '@/core/types/sdkSentEvents';
import type { UiConfirmSurfaceMeasurementBinding } from '@/core/signingEngine/uiConfirm/uiConfirm.types';
import type { WalletSessionId } from '@/core/types/sdkSentEvents';
import type { WalletId } from '@shared/utils/domainIds';
import { setEmbeddedBase } from '@/core/walletRuntimePaths';
import { resolvePrimaryNearRpcUrl } from '@/core/config/chains';
import type {
  WalletHostConfig,
  ConfiguredWalletHost,
  WalletHostConfigurationState,
} from '../shared/configuration';
import {
  createCspStylesheetManager,
  getDefaultCspNonce,
} from '@/core/browser/walletIframe/csp-stylesheet';

const SEAMS_THEME_OVERRIDE_RULE_ID = 'seams-theme-overrides';
const SEAMS_THEME_HOST_SELECTORS = [
  '.seams-wallet-ui',
  '.seams-auth-menu-surface',
  /* Host-document dialogs must follow the app palette. */
  '.seams-host-themed-dialog',
] as const;
const SEAMS_THEME_DARK_SELECTOR = SEAMS_THEME_HOST_SELECTORS.join(',\n');
const SEAMS_THEME_LIGHT_SELECTOR = SEAMS_THEME_HOST_SELECTORS.map(
  (selector) =>
    `${selector}[theme="light"],\n:root[data-seams-theme="light"] ${selector}:not([theme="dark"])`,
).join(',\n');
let themeOverrideStyleManager: ReturnType<typeof createCspStylesheetManager> | null = null;

function getThemeOverrideStyleManager(): ReturnType<typeof createCspStylesheetManager> {
  if (!themeOverrideStyleManager) {
    themeOverrideStyleManager = createCspStylesheetManager({
      doc: document,
      baseCss: '',
      dynamicStyleDataAttr: 'data-seams-theme-overrides',
      nonce: () => getDefaultCspNonce(),
    });
  }
  return themeOverrideStyleManager;
}

function normalizeForStableSerialize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForStableSerialize(entry));
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      normalized[key] = normalizeForStableSerialize(record[key]);
    }
    return normalized;
  }
  return value;
}

function stableSerialize(value: unknown): string {
  try {
    return JSON.stringify(normalizeForStableSerialize(value));
  } catch {
    return '';
  }
}

function buildWalletRuntimeResetFingerprint(config: WalletHostConfig | null): string {
  return stableSerialize({
    network: config?.network,
    registration: config?.registration,
    signing: config?.signing,
    webauthn: config?.webauthn,
    rpId: config?.wallet.rpId,
  });
}

function sanitizeTokenName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(trimmed) ? trimmed : null;
}

function sanitizeTokenValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 1024) return null;
  if (/[{};\n\r]/.test(trimmed)) return null;
  return trimmed;
}

function serializeTokenOverrides(
  record: Record<string, string>,
  group: 'colors' | 'shape',
): string[] {
  const lines: string[] = [];
  for (const [rawName, rawValue] of Object.entries(record)) {
    const tokenName = sanitizeTokenName(rawName);
    if (!tokenName) continue;
    const tokenValue = sanitizeTokenValue(rawValue);
    if (!tokenValue) continue;
    // Use !important so app-provided token overrides keep precedence over the
    // generated wallet-ui.css stylesheet.
    lines.push(`  --seams-${group}-${tokenName}: ${tokenValue} !important;`);
  }
  return lines;
}

function upsertThemeOverrideStyle(appearance: AppearanceConfig): void {
  const mode = appearance.theme.mode;
  const colors = appearance.theme.colors;
  const lines = [
    ...serializeTokenOverrides(colors, 'colors'),
    ...serializeTokenOverrides(appearance.theme.shape ?? {}, 'shape'),
  ];
  const cssBlocks: string[] = [];

  if (lines.length > 0) {
    const selector = mode === 'light' ? SEAMS_THEME_LIGHT_SELECTOR : SEAMS_THEME_DARK_SELECTOR;
    cssBlocks.push(`${selector} {\n${lines.join('\n')}\n}`);
  }

  const cssText = cssBlocks.join('\n\n').trim();
  if (!cssText) {
    getThemeOverrideStyleManager().deleteDynamicRule(SEAMS_THEME_OVERRIDE_RULE_ID);
    return;
  }
  getThemeOverrideStyleManager().setDynamicRule(SEAMS_THEME_OVERRIDE_RULE_ID, cssText);
}

export interface HostContext {
  parentOrigin: string | null;
  port: MessagePort | null;
  configuration: WalletHostConfigurationState;
  preferencesRevision: number;
  nearClient: MinimalNearClient | null;
  walletRuntime: WalletHostRuntime | null;
  prefsUnsubscribe?: (() => void) | null;
  lifecycleSource: WalletHostRuntime | null;
  lifecycleUnsubscribe: (() => void) | null;
  lifecycleListener: SdkLifecycleEventListener | null;
  expiredSessionsByWallet: Map<WalletId, Set<WalletSessionId>>;
  surfaceMeasurementBinding: UiConfirmSurfaceMeasurementBinding;
}
export function createHostContext(): HostContext {
  return {
    parentOrigin: null,
    port: null,
    configuration: { kind: 'unconfigured' },
    preferencesRevision: 0,
    nearClient: null,
    walletRuntime: null,
    prefsUnsubscribe: null,
    lifecycleSource: null,
    lifecycleUnsubscribe: null,
    lifecycleListener: null,
    expiredSessionsByWallet: new Map(),
    surfaceMeasurementBinding: { kind: 'disabled' },
  };
}

export function ensureWalletRuntime(ctx: HostContext): WalletHostRuntime {
  const { configuration } = ctx;
  if (configuration.kind === 'unconfigured') {
    throw new Error('Wallet service not configured. Call PM_SET_CONFIG first.');
  }
  const nearRpcUrl = resolvePrimaryNearRpcUrl(configuration.config.network.chains);
  if (!ctx.nearClient) {
    ctx.nearClient = new MinimalNearClient(nearRpcUrl);
  }
  if (!ctx.walletRuntime) {
    __setWalletIframeHostMode(true);
    ctx.walletRuntime = new WalletHostRuntime(configuration.config, ctx.nearClient);
    updateThemeBridge(ctx);
  }
  return ctx.walletRuntime;
}

function updateThemeBridge(ctx: HostContext): void {
  try {
    const pm = ctx.walletRuntime;
    if (!pm) return;
    const theme = pm.theme;
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-seams-theme', theme);
    }
  } catch {}
}

export function applyWalletConfig(ctx: HostContext, configuration: ConfiguredWalletHost): void {
  const previous = ctx.configuration.kind === 'configured' ? ctx.configuration.config : null;
  const prevRuntimeResetFingerprint = buildWalletRuntimeResetFingerprint(previous);
  const nextRuntimeResetFingerprint = buildWalletRuntimeResetFingerprint(configuration.config);
  ctx.configuration = configuration;
  const nextAppearance = configuration.config.ui.appearance;
  const nextTheme = nextAppearance.theme.mode;

  // Keep wallet-host theme and dynamic appearance tokens in sync with app config.
  try {
    document.documentElement.setAttribute('data-seams-theme', nextTheme);
    upsertThemeOverrideStyle(nextAppearance);
  } catch {}

  if (ctx.walletRuntime && nextRuntimeResetFingerprint === prevRuntimeResetFingerprint) {
    try {
      ctx.walletRuntime.setAppearance(nextAppearance);
    } catch {}
  }

  setEmbeddedBase(resolveHostAssetBase(configuration.assetsBaseUrl));

  // Reset runtime instances only when signing/runtime config changes. Cosmetic config updates
  // (theme, tokens, and asset base) must not drop warm signing session state.
  if (nextRuntimeResetFingerprint !== prevRuntimeResetFingerprint) {
    ctx.walletRuntime?.dispose();
    ctx.prefsUnsubscribe?.();
    ctx.lifecycleUnsubscribe?.();
    ctx.prefsUnsubscribe = null;
    ctx.lifecycleSource = null;
    ctx.lifecycleUnsubscribe = null;
    ctx.nearClient = null;
    ctx.walletRuntime = null;
  }
}

function resolveHostAssetBase(value: string): string {
  const origin = window.location.origin;
  try {
    const url = new URL(value, origin);
    if (url.origin === origin) return url.href.endsWith('/') ? url.href : `${url.href}/`;
  } catch {}
  return new URL('/sdk/', origin).href;
}

export function ensureWalletHostLifecycleSubscription(
  ctx: HostContext,
  pm: WalletHostRuntime,
): void {
  if (ctx.lifecycleSource === pm) return;
  ctx.lifecycleUnsubscribe?.();
  ctx.lifecycleSource = pm;
  ctx.lifecycleUnsubscribe = pm.onSdkLifecycleEvent(handleWalletHostLifecycleEvent.bind(null, ctx));
}

export function setWalletHostLifecycleListener(
  ctx: HostContext,
  listener: SdkLifecycleEventListener,
): void {
  ctx.lifecycleListener = listener;
  if (ctx.walletRuntime) ensureWalletHostLifecycleSubscription(ctx, ctx.walletRuntime);
}

function assertNeverSdkLifecycleEvent(value: never): never {
  throw new Error(`Unhandled SDK lifecycle event: ${String(value)}`);
}

function handleWalletHostLifecycleEvent(ctx: HostContext, event: SdkLifecycleEvent): void {
  switch (event.event) {
    case 'signing_session.expired': {
      const sessions = ctx.expiredSessionsByWallet.get(event.walletId);
      if (sessions?.has(event.walletSessionId)) return;
      if (sessions) sessions.add(event.walletSessionId);
      else ctx.expiredSessionsByWallet.set(event.walletId, new Set([event.walletSessionId]));
      ctx.lifecycleListener?.(event);
      return;
    }
    case 'registration.near_provisioning_changed':
      ctx.lifecycleListener?.(event);
      return;
    default:
      return assertNeverSdkLifecycleEvent(event);
  }
}

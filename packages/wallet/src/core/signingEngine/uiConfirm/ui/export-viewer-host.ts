import type { AppearanceConfig } from '@/core/types/seams';
import type {
  ExportGuidance,
  ExportPrivateKeyDisplayEntry,
} from '@/core/signingEngine/stepUpConfirmation/channel/confirmTypes';
import type { UiConfirmSurfaceMeasurementBinding } from '../uiConfirm.types';
import type {
  ExportKeyViewModel,
  ExportPrivateKeyViewModel,
} from './preact/ExportPrivateKeySurface';
import type {
  ExportSurfaceHandle,
  ExportSurfaceModel,
  mountExportPrivateKeySurface,
} from './preact/mountExportPrivateKeySurface';
import {
  createWalletIframeSurfaceMeasurementReporter,
  type WalletIframeSurfaceMeasurementReporter,
} from '@/SeamsWeb/walletIframe/host/surface-measurement-reporter';
import { sameSurfaceMeasurementBinding } from './surface-measurement-binding';
import { resolveUiAppearance } from './appearance';

export type UpsertExportViewerHostArgs = {
  theme: 'dark' | 'light';
  variant: 'drawer' | 'modal';
  accountId: string;
  sessionId?: string;
  publicKey?: string;
  privateKey?: string;
  keys?: ExportPrivateKeyDisplayEntry[];
  guidance?: ExportGuidance;
  appearance?: AppearanceConfig;
  loading?: boolean;
  errorMessage?: string;
  onLifecycle?: (event: 'opened' | 'closed') => void;
  surfaceMeasurementBinding: UiConfirmSurfaceMeasurementBinding;
};

type ExportSession = { kind: 'tracked'; id: string } | { kind: 'untracked'; id?: never };
type ExportContext = 'standalone' | 'wallet-iframe';
type ExportLifecycle = NonNullable<UpsertExportViewerHostArgs['onLifecycle']>;
type HostState =
  | {
      kind: 'mounted';
      lifecycle: ExportLifecycle | null;
      binding: UiConfirmSurfaceMeasurementBinding;
      reporter: WalletIframeSurfaceMeasurementReporter | null;
    }
  | { kind: 'disposed' };

let mountedHost: ExportViewerHost | null = null;
let mountVersion = 0;

class ExportViewerHost {
  readonly surface: ExportSurfaceHandle;
  private state: HostState;

  constructor(
    readonly session: ExportSession,
    readonly context: ExportContext,
    model: ExportSurfaceModel,
    binding: UiConfirmSurfaceMeasurementBinding,
    lifecycle: ExportLifecycle | null,
    mount: typeof mountExportPrivateKeySurface,
  ) {
    this.state = {
      kind: 'mounted',
      lifecycle,
      binding,
      reporter: null,
    };
    this.surface = mount({ parent: document.body, context, model, onClosed: this.closed });
  }

  start(): void {
    if (this.state.kind === 'disposed') return;
    notifyLifecycle(this.state.lifecycle, 'opened');
    if (this.state.kind === 'mounted') this.bindMeasurement(this.state.binding);
  }

  matches(session: ExportSession, context: ExportContext): boolean {
    return (
      this.surface.element.isConnected &&
      this.context === context &&
      this.session.kind === session.kind &&
      this.session.id === session.id
    );
  }

  update(
    model: ExportSurfaceModel,
    binding: UiConfirmSurfaceMeasurementBinding,
    lifecycle?: ExportLifecycle,
  ): void {
    if (this.state.kind === 'disposed') return;
    if (lifecycle) this.state.lifecycle = lifecycle;
    this.surface.update(model);
    if (!sameSurfaceMeasurementBinding(this.state.binding, binding)) {
      this.bindMeasurement(binding);
    }
  }

  dispose(): void {
    if (mountedHost === this) mountedHost = null;
    this.surface.dispose();
  }

  private closed = (): void => {
    const state = this.state;
    if (state.kind === 'disposed') return;
    this.state = { kind: 'disposed' };
    if (mountedHost === this) {
      mountedHost = null;
      mountVersion += 1;
    }
    state.reporter?.disconnect();
    notifyLifecycle(state.lifecycle, 'closed');
  };

  private bindMeasurement(binding: UiConfirmSurfaceMeasurementBinding): void {
    const state = this.state;
    if (state.kind === 'disposed') return;
    state.reporter?.disconnect();
    state.binding = binding;
    state.reporter = null;
    if (binding.kind === 'disabled') return;
    const reporter = createWalletIframeSurfaceMeasurementReporter({
      kind: 'request_surface',
      element: this.surface.element,
      requestId: binding.requestId,
      postMeasurement: binding.postMeasurement,
    });
    if (this.state === state) state.reporter = reporter;
    else reporter.disconnect();
  }
}

function notifyLifecycle(listener: ExportLifecycle | null, event: 'opened' | 'closed'): void {
  try {
    listener?.(event);
  } catch {}
}

function exportContext(args: UpsertExportViewerHostArgs): ExportContext {
  const binding = args.surfaceMeasurementBinding;
  if (binding.kind !== 'wallet_iframe') return 'standalone';
  return (binding.hostSurfaceVariant ?? args.variant) === 'modal' ? 'wallet-iframe' : 'standalone';
}

function normalizeGuidance(guidance: ExportGuidance | undefined): ExportGuidance | undefined {
  if (!guidance) return undefined;
  const title = guidance.title.trim();
  const body = guidance.body?.trim();
  const steps = guidance.steps?.map(trimText).filter(nonemptyText);
  if (!title && !body && !steps?.length) return undefined;
  return { title, body, steps };
}

function trimText(value: string): string {
  return value.trim();
}
function nonemptyText(value: string): boolean {
  return value.length > 0;
}
function hasKey(entry: ExportPrivateKeyDisplayEntry): boolean {
  return !!entry.publicKey.trim() || !!entry.privateKey.trim();
}

function keyMetadata(
  entry: ExportPrivateKeyDisplayEntry,
  index: number,
): Omit<ExportKeyViewModel, 'material'> {
  return {
    id: `${entry.scheme}-${index}`,
    scheme: entry.scheme,
    label: entry.label.trim(),
    publicKey: entry.publicKey.trim(),
    address: entry.address?.trim() ?? '',
  };
}

function normalizeExportContent(args: UpsertExportViewerHostArgs): ExportPrivateKeyViewModel {
  const accountId = args.accountId.trim();
  const guidance = normalizeGuidance(args.guidance);
  const message = args.errorMessage?.trim();
  if (message) return { kind: 'failed', accountId, guidance, message };
  const entries = args.keys?.filter(hasKey) ?? [];
  if (entries.length === 0) {
    const publicKey = args.publicKey?.trim() ?? '';
    const privateKey = args.privateKey?.trim() ?? '';
    if (publicKey || privateKey)
      entries.push({ scheme: 'ed25519', label: 'NEAR Ed25519', publicKey, privateKey });
  }
  if (args.loading) {
    const loading: Extract<ExportPrivateKeyViewModel, { kind: 'loading' }> = {
      kind: 'loading',
      accountId,
      guidance,
      entries: [],
    };
    for (const [index, entry] of entries.entries()) {
      loading.entries.push({ ...keyMetadata(entry, index), material: { kind: 'loading' } });
    }
    return loading;
  }
  const ready: Extract<ExportPrivateKeyViewModel, { kind: 'ready' }> = {
    kind: 'ready',
    accountId,
    guidance,
    entries: [],
  };
  for (const [index, entry] of entries.entries()) {
    const privateKey = entry.privateKey.trim();
    ready.entries.push({
      ...keyMetadata(entry, index),
      material: privateKey ? { kind: 'ready', value: privateKey } : { kind: 'unavailable' },
    });
  }
  return ready;
}

export function isExportViewerSessionOpen(sessionId: string): boolean {
  const id = sessionId.trim();
  return (
    !!id &&
    mountedHost?.session.kind === 'tracked' &&
    mountedHost.session.id === id &&
    mountedHost.surface.element.isConnected
  );
}

export async function upsertExportViewerHost(args: UpsertExportViewerHostArgs): Promise<void> {
  if (typeof document === 'undefined')
    throw new Error('Export viewer host requires a DOM environment');
  const version = ++mountVersion;
  const model: ExportSurfaceModel = {
    appearance: resolveUiAppearance({
      requestedAppearance: args.appearance,
      requestedMode: args.theme,
    }),
    content: normalizeExportContent(args),
  };
  const id = args.sessionId?.trim();
  const session: ExportSession = id ? { kind: 'tracked', id } : { kind: 'untracked' };
  const context = exportContext(args);
  const { mountExportPrivateKeySurface } = await import('./preact/mountExportPrivateKeySurface');
  if (version !== mountVersion) return;
  if (mountedHost?.matches(session, context)) {
    mountedHost.update(model, args.surfaceMeasurementBinding, args.onLifecycle);
    return;
  }
  mountedHost?.dispose();
  if (version !== mountVersion) return;
  const host = new ExportViewerHost(
    session,
    context,
    model,
    args.surfaceMeasurementBinding,
    args.onLifecycle ?? null,
    mountExportPrivateKeySurface,
  );
  mountedHost = host;
  try {
    host.start();
  } catch (error) {
    host.dispose();
    throw error;
  }
}

export function removeExportViewerHostIfPresent(): void {
  mountVersion += 1;
  mountedHost?.dispose();
}

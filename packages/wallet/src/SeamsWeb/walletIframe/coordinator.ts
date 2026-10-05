import { buildAnonymousWalletSession } from '@/SeamsWeb/publicApi/session';
import type { ClientConnectionState } from '@/SeamsWeb/publicApi/types';
import type { PreferenceState } from './client/preferenceState';
import { toWalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { AppearanceConfig, SeamsClientConfig, WalletSession } from '@/core/types/seams';
import type { WalletIframeRouter } from '@/SeamsWeb/walletIframe/client/router';
import type { WalletIframeTransportDiagnostics } from '@/SeamsWeb/walletIframe/client/transport/IframeTransport';
import type {
  HostedAuthMenuExternalAuthRequest,
  HostedAuthMenuExternalAuthResolutionInput,
  HostedAuthMenuOpenRequest,
  HostedAuthMenuOutcome,
  HostedAuthMenuSessionId,
} from '@/SeamsWeb/walletIframe/shared/messages';
import { createWalletIframeRouter } from '@/SeamsWeb/assembly/createWalletIframeRouter';
import type { WalletId } from '@shared/utils/domainIds';
import type { SdkLifecycleEventListener } from '@/core/types/sdkSentEvents';
import type { SdkLifecycleEvent } from '@/core/types/sdkSentEvents';
import type {
  WalletIframeExactSessionIdentity,
  WalletIframeExactSessionLockResult,
  WalletIframeExactSessionState,
} from './shared/exactSessionState';

type Connecting = {
  readonly kind: 'connecting';
  readonly generation: number;
  readonly completion: Promise<void>;
  readonly abort: AbortController;
};
type ConnectionLifecycle = Exclude<ClientConnectionState, { kind: 'connecting' }> | Connecting;

function assertNeverConnection(state: never): never {
  throw new Error(`Unsupported connection state: ${String(state)}`);
}

function noSubscription(): void {}

function rejectAbortedConnection(
  signal: AbortSignal,
  _resolve: (value: never) => void,
  reject: (reason: unknown) => void,
): void {
  signal.addEventListener('abort', reject.bind(null, new Error('Wallet connection interrupted')), {
    once: true,
  });
}

interface WalletIframeCoordinatorDeps {
  configs: SeamsClientConfig;
  userPreferences: PreferenceState;
  getAppearance: () => AppearanceConfig;
}

/**
 * Coordinates wallet-iframe lifecycle and preference mirroring.
 * This keeps `SeamsWeb` focused on business flows while preserving one cohesive iframe domain module.
 */
export class WalletIframeCoordinator {
  private readonly configs: SeamsClientConfig;
  private readonly userPreferences: PreferenceState;
  private readonly getAppearance: () => AppearanceConfig;

  private iframeRouter: WalletIframeRouter | null = null;
  private connection: ConnectionLifecycle = { kind: 'idle' };
  private connectionGeneration = 0;
  private readonly connectionListeners = new Set<(state: ClientConnectionState) => void>();
  private walletIframeCloseUnsubscribe: (() => void) | null = null;
  private walletIframePrefsUnsubscribe: (() => void) | null = null;
  private sessionDeliveryRevision = 0;
  private walletIframeSessionUnsubscribe: (() => void) | null = null;
  private readonly sessionListeners = new Set<
    (session: WalletSession) => void
  >();
  private walletIframeLifecycleUnsubscribe: (() => void) | null = null;
  private walletIframeAuthMenuUnsubscribe: (() => void) | null = null;
  private readonly sdkLifecycleEventListeners = new Set<SdkLifecycleEventListener>();
  private readonly hostedAuthMenuExternalAuthRequestListeners = new Set<
    (request: HostedAuthMenuExternalAuthRequest) => void
  >();
  private readonly forwardSdkLifecycleEventListener: SdkLifecycleEventListener;
  private readonly forwardHostedAuthMenuExternalAuthRequestListener: (
    request: HostedAuthMenuExternalAuthRequest,
  ) => void;

  constructor(deps: WalletIframeCoordinatorDeps) {
    this.configs = deps.configs;
    this.userPreferences = deps.userPreferences;
    this.getAppearance = deps.getAppearance;
    this.forwardSdkLifecycleEventListener = this.forwardSdkLifecycleEvent.bind(this);
    this.forwardHostedAuthMenuExternalAuthRequestListener =
      this.forwardHostedAuthMenuExternalAuthRequest.bind(this);
  }

  getConnectionState(): ClientConnectionState {
    const state = this.connection;
    if (state.kind === 'connecting') return { kind: 'connecting', generation: state.generation };
    return state;
  }

  onConnectionChange(listener: (state: ClientConnectionState) => void): () => void {
    if (this.connection.kind !== 'disposed') this.connectionListeners.add(listener);
    this.deliverConnectionState(listener);
    return this.connectionListeners.delete.bind(this.connectionListeners, listener);
  }

  private deliverConnectionState(listener: (state: ClientConnectionState) => void): void {
    try {
      listener(this.getConnectionState());
    } catch {}
  }

  private setConnection(state: ConnectionLifecycle): void {
    this.connection = state;
    for (const listener of Array.from(this.connectionListeners)) {
      if (this.connection !== state) break;
      this.deliverConnectionState(listener);
    }
  }

  getTransportDiagnosticsSnapshot(): WalletIframeTransportDiagnostics | null {
    return this.iframeRouter?.getTransportDiagnosticsSnapshot() ?? null;
  }

  dispose(): void {
    const previous = this.connection;
    if (previous.kind === 'disposed') return;
    this.setConnection({ kind: 'disposed' });
    if (previous.kind === 'connecting') previous.abort.abort();
    this.releaseRouter();
    this.connectionListeners.clear();
    this.sdkLifecycleEventListeners.clear();
    this.sessionListeners.clear();
    this.hostedAuthMenuExternalAuthRequestListeners.clear();
  }

  private releaseRouter(): void {
    this.sessionDeliveryRevision += 1;
    this.walletIframeCloseUnsubscribe?.();
    this.walletIframePrefsUnsubscribe?.();
    this.walletIframeLifecycleUnsubscribe?.();
    this.walletIframeSessionUnsubscribe?.();
    this.walletIframeAuthMenuUnsubscribe?.();
    this.walletIframeCloseUnsubscribe = null;
    this.walletIframePrefsUnsubscribe = null;
    this.walletIframeLifecycleUnsubscribe = null;
    this.walletIframeSessionUnsubscribe = null;
    this.walletIframeAuthMenuUnsubscribe = null;
    const router = this.iframeRouter;
    this.iframeRouter = null;
    router?.dispose();
  }

  private connectionClosed(): void {
    const previous = this.connection;
    if (previous.kind === 'disposed' || previous.kind === 'failed') return;
    const error = new Error('Wallet connection closed');
    if (previous.kind === 'connecting') previous.abort.abort();
    this.releaseRouter();
    this.setConnection({ kind: 'failed', generation: this.connectionGeneration, error });
  }

  onSessionChange(listener: (session: WalletSession) => void): () => void {
    if (this.connection.kind === 'disposed') return noSubscription;
    this.sessionListeners.add(listener);
    if (this.connection.kind === 'ready') this.refreshSession();
    return this.sessionListeners.delete.bind(this.sessionListeners, listener);
  }

  private refreshSession(): void {
    const revision = ++this.sessionDeliveryRevision;
    const router = this.iframeRouter;
    if (!router || this.sessionListeners.size === 0) return;
    const state = router.getMirroredExactSessionState();
    if (state.kind === 'wallet_locked') {
      this.deliverSession(router, revision, buildAnonymousWalletSession());
      return;
    }
    void this.publishSession(router, revision, state.walletId).catch(this.reportSessionFailure.bind(this, revision));
  }

  private reportSessionFailure(revision: number, error: unknown): void {
    if (revision === this.sessionDeliveryRevision && this.connection.kind !== 'disposed') {
      console.warn('[WalletIframeClient] Session reconciliation failed:', error);
    }
  }

  private async publishSession(
    router: WalletIframeRouter,
    revision: number,
    walletId: WalletId,
  ): Promise<void> {
    const session = await router.getWalletSession(walletId);
    this.deliverSession(router, revision, session);
  }

  private deliverSession(router: WalletIframeRouter, revision: number, session: WalletSession): void {
    for (const listener of Array.from(this.sessionListeners)) {
      if (revision !== this.sessionDeliveryRevision || router !== this.iframeRouter) return;
      if (!this.sessionListeners.has(listener)) continue;
      try {
        listener(session);
      } catch {}
    }
  }

  onSdkLifecycleEvent(listener: SdkLifecycleEventListener): () => void {
    if (this.connection.kind === 'disposed') return noSubscription;
    this.sdkLifecycleEventListeners.add(listener);
    if (this.iframeRouter) {
      this.ensureWalletIframeLifecycleMirror(this.iframeRouter);
    }
    return this.removeSdkLifecycleEventListener.bind(this, listener);
  }

  connect(): Promise<void> {
    const current = this.connection;
    switch (current.kind) {
      case 'disposed':
        return Promise.reject(new Error('Wallet client is disposed'));
      case 'ready':
        return Promise.resolve();
      case 'connecting':
        return current.completion;
      case 'idle':
      case 'failed': {
        const generation = ++this.connectionGeneration;
        const abort = new AbortController();
        const interrupted = new Promise<never>(rejectAbortedConnection.bind(null, abort.signal));
        const completion = Promise.race([
          Promise.resolve().then(this.initializeConnection.bind(this, generation)),
          interrupted,
        ]).finally(abort.abort.bind(abort));
        this.setConnection({ kind: 'connecting', generation, completion, abort });
        return completion;
      }
      default:
        return assertNeverConnection(current);
    }
  }

  private async initializeConnection(generation: number): Promise<void> {
    try {
      this.assertConnecting(generation);
      const router = await createWalletIframeRouter({
        configs: this.configs,
        walletOrigin: this.configs.wallet.iframe.origin,
        getAppearance: this.getAppearance,
      });
      if (this.connection.kind !== 'connecting' || this.connection.generation !== generation) {
        router.dispose();
        throw new Error('Wallet router creation was interrupted');
      }
      this.iframeRouter = router;
      this.walletIframeCloseUnsubscribe = router.onConnectionClosed(
        this.connectionClosed.bind(this),
      );
      this.ensureWalletIframePreferencesMirror(router);
      this.ensureWalletIframeLifecycleMirror(router);
      this.walletIframeSessionUnsubscribe = router.onSessionChange(
        this.refreshSession.bind(this),
      );
      this.ensureWalletIframeAuthMenuMirror(router);
      await router.init();
      this.assertConnecting(generation);
      router.getMirroredExactSessionState();
      this.setConnection({ kind: 'ready', generation });
    } catch (cause) {
      if (this.connection.kind === 'connecting' && this.connection.generation === generation) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        this.releaseRouter();
        this.setConnection({ kind: 'failed', generation, error });
      }
      throw cause;
    }
  }

  private assertConnecting(generation: number): void {
    if (this.connection.kind !== 'connecting' || this.connection.generation !== generation) {
      throw new Error('Wallet connection attempt is no longer current');
    }
  }

  async getExactSessionState(): Promise<WalletIframeExactSessionState> {
    const router = await this.requireRouter();
    return await router.getExactSessionState();
  }

  async openHostedAuthMenu(
    request: HostedAuthMenuOpenRequest,
    anchorElement?: HTMLElement,
  ): Promise<HostedAuthMenuOutcome> {
    const router = await this.requireRouter();
    return await router.openHostedAuthMenu(request, anchorElement);
  }

  async cancelHostedAuthMenu(args: { authMenuSessionId: HostedAuthMenuSessionId }): Promise<void> {
    const router = await this.requireRouter();
    await router.cancelHostedAuthMenu(args);
  }

  onHostedAuthMenuExternalAuthRequest(
    listener: (request: HostedAuthMenuExternalAuthRequest) => void,
  ): () => void {
    if (this.connection.kind === 'disposed') return noSubscription;
    this.hostedAuthMenuExternalAuthRequestListeners.add(listener);
    if (this.iframeRouter) this.ensureWalletIframeAuthMenuMirror(this.iframeRouter);
    return this.removeHostedAuthMenuExternalAuthRequestListener.bind(this, listener);
  }


  async resolveHostedAuthMenuExternalAuth(
    resolution: HostedAuthMenuExternalAuthResolutionInput,
  ): Promise<void> {
    const router = await this.requireRouter();
    await router.resolveHostedAuthMenuExternalAuth(resolution);
  }

  async lockExactSession(
    identity: WalletIframeExactSessionIdentity,
  ): Promise<WalletIframeExactSessionLockResult> {
    const router = await this.requireRouter();
    return await router.lockExactSession(identity);
  }

  async requireRouter(): Promise<WalletIframeRouter> {
    await this.connect();
    if (!this.iframeRouter) {
      throw new Error('[SeamsWeb] Wallet iframe is configured but unavailable.');
    }
    return this.iframeRouter;
  }

  private ensureWalletIframePreferencesMirror(router: WalletIframeRouter): void {
    if (this.walletIframePrefsUnsubscribe) {
      return;
    }
    const unsubscribe = router.onPreferencesChanged?.((payload) => {
      const id = payload?.walletId;
      const walletId = id ? toWalletId(id) : null;
      this.userPreferences.applyWalletHostConfirmationConfig({
        walletId,
        confirmationConfig: payload?.confirmationConfig,
      });
    });
    this.walletIframePrefsUnsubscribe = unsubscribe ?? null;
  }

  private ensureWalletIframeLifecycleMirror(router: WalletIframeRouter): void {
    if (this.walletIframeLifecycleUnsubscribe) return;
    this.walletIframeLifecycleUnsubscribe = router.onSdkLifecycleEvent(
      this.forwardSdkLifecycleEventListener,
    );
  }

  private ensureWalletIframeAuthMenuMirror(router: WalletIframeRouter): void {
    if (!this.walletIframeAuthMenuUnsubscribe) {
      this.walletIframeAuthMenuUnsubscribe = router.onHostedAuthMenuExternalAuthRequest(
        this.forwardHostedAuthMenuExternalAuthRequestListener,
      );
    }

  }

  private forwardSdkLifecycleEvent(event: SdkLifecycleEvent): void {
    for (const listener of Array.from(this.sdkLifecycleEventListeners)) {
      listener(event);
    }
  }

  private removeSdkLifecycleEventListener(listener: SdkLifecycleEventListener): void {
    this.sdkLifecycleEventListeners.delete(listener);
  }

  private forwardHostedAuthMenuExternalAuthRequest(
    request: HostedAuthMenuExternalAuthRequest,
  ): void {
    for (const listener of Array.from(this.hostedAuthMenuExternalAuthRequestListeners)) {
      try {
        listener(request);
      } catch {}
    }
  }

  private removeHostedAuthMenuExternalAuthRequestListener(
    listener: (request: HostedAuthMenuExternalAuthRequest) => void,
  ): void {
    this.hostedAuthMenuExternalAuthRequestListeners.delete(listener);
  }

}

import { resolveWalletRpId } from './shared/configuration';
import type { PreferenceState } from './client/preferenceState';
import { toWalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { AppearanceConfig, SeamsClientConfig } from '@/core/types/seams';
import type { WalletIframeRouter } from '@/SeamsWeb/walletIframe/client/router';
import type { WalletIframeTransportDiagnostics } from '@/SeamsWeb/walletIframe/client/transport/IframeTransport';
import type {
  HostedAuthMenuExternalAuthRequest,
  HostedAuthMenuDemoEmailOtpDelivery,
  HostedAuthMenuExternalAuthResolutionInput,
  HostedAuthMenuOpenRequest,
  HostedAuthMenuOutcome,
  HostedAuthMenuSessionId,
  PreferencesChangedPayload,
} from '@/SeamsWeb/walletIframe/shared/messages';
import { createWalletIframeRouter } from '@/SeamsWeb/assembly/createWalletIframeRouter';
import type { WebAuthnRpId } from '@shared/utils/domainIds';
import type { SdkLifecycleEventListener } from '@/core/types/sdkSentEvents';
import type { SdkLifecycleEvent } from '@/core/types/sdkSentEvents';
import type {
  WalletIframeExactSessionIdentity,
  WalletIframeExactSessionLockResult,
  WalletIframeExactSessionState,
} from './shared/exactSessionState';

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
  private walletIframeRouterCreationInFlight: Promise<WalletIframeRouter> | null = null;
  private walletIframeInitInFlight: Promise<void> | null = null;
  private walletIframeDisposed = false;
  private walletIframePrefsUnsubscribe: (() => void) | null = null;
  private walletIframeLifecycleUnsubscribe: (() => void) | null = null;
  private walletIframeAuthMenuUnsubscribe: (() => void) | null = null;
  private walletIframeAuthMenuDemoOtpUnsubscribe: (() => void) | null = null;
  private readonly sdkLifecycleEventListeners = new Set<SdkLifecycleEventListener>();
  private readonly hostedAuthMenuExternalAuthRequestListeners = new Set<
    (request: HostedAuthMenuExternalAuthRequest) => void
  >();
  private readonly hostedAuthMenuDemoEmailOtpDeliveryListeners = new Set<
    (delivery: HostedAuthMenuDemoEmailOtpDelivery) => void
  >();
  private readonly forwardSdkLifecycleEventListener: SdkLifecycleEventListener;
  private readonly forwardHostedAuthMenuExternalAuthRequestListener: (
    request: HostedAuthMenuExternalAuthRequest,
  ) => void;
  private readonly forwardHostedAuthMenuDemoEmailOtpDeliveryListener: (
    delivery: HostedAuthMenuDemoEmailOtpDelivery,
  ) => void;

  constructor(deps: WalletIframeCoordinatorDeps) {
    this.configs = deps.configs;
    this.userPreferences = deps.userPreferences;
    this.getAppearance = deps.getAppearance;
    this.forwardSdkLifecycleEventListener = this.forwardSdkLifecycleEvent.bind(this);
    this.forwardHostedAuthMenuExternalAuthRequestListener =
      this.forwardHostedAuthMenuExternalAuthRequest.bind(this);
    this.forwardHostedAuthMenuDemoEmailOtpDeliveryListener =
      this.forwardHostedAuthMenuDemoEmailOtpDelivery.bind(this);
  }

  resolveRegistrationRpId(): WebAuthnRpId {
    return resolveWalletRpId(this.configs);
  }

  isReady(): boolean {
    return !!this.iframeRouter?.isReady();
  }

  getTransportDiagnosticsSnapshot(): WalletIframeTransportDiagnostics | null {
    return this.iframeRouter?.getTransportDiagnosticsSnapshot() ?? null;
  }

  dispose(): void {
    if (this.walletIframeDisposed) return;
    this.walletIframeDisposed = true;
    this.iframeRouter?.dispose();
  }

  onReady(listener: () => void): () => void {
    const router = this.iframeRouter;
    if (!router) return () => {};
    return router.onReady(listener);
  }

  onLoginStatusChanged(
    listener: (status: { isLoggedIn: boolean; walletId: string | null }) => void,
  ): () => void {
    const router = this.iframeRouter;
    if (!router) return () => {};
    return router.onLoginStatusChanged(listener);
  }

  onSdkLifecycleEvent(listener: SdkLifecycleEventListener): () => void {
    this.sdkLifecycleEventListeners.add(listener);
    if (this.iframeRouter) {
      this.ensureWalletIframeLifecycleMirror(this.iframeRouter);
    }
    return this.removeSdkLifecycleEventListener.bind(this, listener);
  }

  onPreferencesChanged(listener: (payload: PreferencesChangedPayload) => void): () => void {
    const router = this.iframeRouter;
    if (!router) return () => {};
    return router.onPreferencesChanged(listener);
  }

  async init(_walletId?: string): Promise<WalletIframeExactSessionState> {
    const walletOrigin = this.configs.wallet.iframe.origin;

    // Initialize iframe router once (and prevent concurrent calls from mounting multiple iframes).
    if (!this.iframeRouter) {
      if (!this.walletIframeInitInFlight) {
        this.walletIframeInitInFlight = (async () => {
          const router = await this.getOrCreateRouter(walletOrigin);
          await router.init();
          // Opportunistically warm remote nonce context.
          try {
            await router.prefetchBlockheight();
          } catch {}
        })();
      }

      try {
        await this.walletIframeInitInFlight;
      } finally {
        this.walletIframeInitInFlight = null;
      }
    } else {
      this.ensureWalletIframePreferencesMirror(this.iframeRouter);
      this.ensureWalletIframeLifecycleMirror(this.iframeRouter);
      this.ensureWalletIframeAuthMenuMirror(this.iframeRouter);
      await this.iframeRouter.init();
      // Opportunistically warm remote nonce context.
      try {
        await this.iframeRouter.prefetchBlockheight();
      } catch {}
    }

    if (this.iframeRouter) {
      return this.iframeRouter.getMirroredExactSessionState();
    }
    return { kind: 'wallet_locked' };
  }

  async getExactSessionState(): Promise<WalletIframeExactSessionState> {
    const router = await this.requireRouter();
    return await router.getExactSessionState();
  }

  async openHostedAuthMenu(
    request: HostedAuthMenuOpenRequest,
    anchorElement?: HTMLElement,
  ): Promise<HostedAuthMenuOutcome> {
    const router = await this.requireTransportRouter();
    return await router.openHostedAuthMenu(request, anchorElement);
  }

  async cancelHostedAuthMenu(args: { authMenuSessionId: HostedAuthMenuSessionId }): Promise<void> {
    const router = await this.requireRouter();
    await router.cancelHostedAuthMenu(args);
  }

  onHostedAuthMenuExternalAuthRequest(
    listener: (request: HostedAuthMenuExternalAuthRequest) => void,
  ): () => void {
    this.hostedAuthMenuExternalAuthRequestListeners.add(listener);
    if (this.iframeRouter) this.ensureWalletIframeAuthMenuMirror(this.iframeRouter);
    return this.removeHostedAuthMenuExternalAuthRequestListener.bind(this, listener);
  }

  onHostedAuthMenuDemoEmailOtpDelivery(
    listener: (delivery: HostedAuthMenuDemoEmailOtpDelivery) => void,
  ): () => void {
    this.hostedAuthMenuDemoEmailOtpDeliveryListeners.add(listener);
    if (this.iframeRouter) this.ensureWalletIframeAuthMenuMirror(this.iframeRouter);
    return this.removeHostedAuthMenuDemoEmailOtpDeliveryListener.bind(this, listener);
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
    const router = await this.requireRouter(String(identity.walletId));
    return await router.lockExactSession(identity);
  }

  async requireRouter(walletId?: string): Promise<WalletIframeRouter> {
    if (!this.iframeRouter) {
      await this.init(walletId);
    }
    if (!this.iframeRouter) {
      throw new Error('[SeamsWeb] Wallet iframe is configured but unavailable.');
    }
    return this.iframeRouter;
  }

  async requireTransportRouter(): Promise<WalletIframeRouter> {
    const walletOrigin = this.configs.wallet.iframe.origin;
    return await this.getOrCreateRouter(walletOrigin);
  }

  private async getOrCreateRouter(walletOrigin: string): Promise<WalletIframeRouter> {
    if (this.iframeRouter) return this.iframeRouter;
    this.walletIframeRouterCreationInFlight ??= createWalletIframeRouter({
      configs: this.configs,
      walletOrigin,
      getAppearance: this.getAppearance,
    });
    try {
      const router = await this.walletIframeRouterCreationInFlight;
      this.iframeRouter = router;
      this.ensureWalletIframePreferencesMirror(router);
      this.ensureWalletIframeLifecycleMirror(router);
      this.ensureWalletIframeAuthMenuMirror(router);
      return router;
    } finally {
      this.walletIframeRouterCreationInFlight = null;
    }
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
    if (!this.walletIframeAuthMenuDemoOtpUnsubscribe) {
      this.walletIframeAuthMenuDemoOtpUnsubscribe = router.onHostedAuthMenuDemoEmailOtpDelivery(
        this.forwardHostedAuthMenuDemoEmailOtpDeliveryListener,
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

  private forwardHostedAuthMenuDemoEmailOtpDelivery(
    delivery: HostedAuthMenuDemoEmailOtpDelivery,
  ): void {
    for (const listener of Array.from(this.hostedAuthMenuDemoEmailOtpDeliveryListeners)) {
      try {
        listener(delivery);
      } catch {}
    }
  }

  private removeHostedAuthMenuDemoEmailOtpDeliveryListener(
    listener: (delivery: HostedAuthMenuDemoEmailOtpDelivery) => void,
  ): void {
    this.hostedAuthMenuDemoEmailOtpDeliveryListeners.delete(listener);
  }
}

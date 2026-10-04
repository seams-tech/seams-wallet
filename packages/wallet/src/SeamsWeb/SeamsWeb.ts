import { resolvePrimaryNearRpcUrl } from '@/core/config/chains';
import { buildConfigsFromEnv } from '@/core/config/defaultConfigs';
import { IndexedDBManager } from '@/core/indexedDB';
import { MinimalNearClient, type NearClient } from '@/core/rpcClients/near/NearClient';
import { requestWalletCustodyEmailOtpChallenge } from '@/core/rpcClients/relayer/walletRecoveryRotate';
import type { SigningEngineExportKeypairWithUIInput } from '@/core/signingEngine/flows/recovery/public';
import {
  configuredThresholdEcdsaChainTargets,
  type ThresholdEcdsaChainTarget,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { SdkLifecycleEventListener } from '@/core/types/sdkSentEvents';
import type {
  AppearanceConfig,
  AppearanceConfigInput,
  RegistrationResult,
  SeamsConfigsInput,
  SeamsConfigsReadonly,
  ThemeMode,
} from '@/core/types/seams';
import { resolveBrowserWorkerWarmupPolicy } from '@/SeamsWeb/assembly/browserWorkerWarmupPolicy';
import { configureBrowserIndexedDB } from '@/SeamsWeb/assembly/configureBrowserIndexedDB';
import { createBrowserSigningRuntime } from '@/SeamsWeb/assembly/createBrowserSigningRuntime';
import { createBrowserSigningStores } from '@/SeamsWeb/assembly/createBrowserSigningStores';
import { initializeBrowserSigningRuntime } from '@/SeamsWeb/assembly/initializeBrowserSigningRuntime';
import {
  buildNearWalletRegistrationSignerSetSelection,
  resolvePasskeyRegistrationAccountProvisioning,
} from '@/SeamsWeb/operations/registration/registrationSignerSet';
import {
  createPublicApi,
  createWalletIframeLinkedDeviceManagementPortV1,
  type WalletIframeControlCapability,
} from '@/SeamsWeb/publicApi';
import {
  resolveConfiguredChainTarget,
  type EcdsaChainSelector,
} from '@/SeamsWeb/publicApi/chainTargets';
import { BrowserSigningSurface } from '@/SeamsWeb/signingSurface/BrowserSigningSurface';
import type {
  AuthCapability,
  DevicesCapability,
  EvmSignerCapability,
  KeyExportCapability,
  NearSignerCapability,
  PreferencesCapability,
  RecoveryCapability,
  RegistrationCapability,
  SeamsWebContext,
  SeamsWebSigningSurface,
  TempoSignerCapability,
} from '@/SeamsWeb/signingSurface/types';
import { createApplicationEmailOtpCommands } from '@/SeamsWeb/walletIframe/client/emailOtpCommands';
import { createApplicationRegistrationCommands } from '@/SeamsWeb/walletIframe/client/registrationCommands';
import { createApplicationSessionCommands } from '@/SeamsWeb/walletIframe/client/sessionCommands';
import { WalletIframeCoordinator } from '@/SeamsWeb/walletIframe/coordinator';
import type {
  EmailOtpUnlockPrewarmRecord,
  EmailOtpUnlockPrewarmStatus,
} from '@/SeamsWeb/walletIframe/shared/emailOtpLifecycle';
import {
  parseWalletIframeExactSessionIdentity,
  type WalletIframeExactSessionIdentity,
  type WalletIframeExactSessionIdentityInput,
  type WalletIframeExactSessionLockResult,
  type WalletIframeExactSessionState,
} from '@/SeamsWeb/walletIframe/shared/exactSessionState';
import {
  deliverNearProvisioningStateChanged,
  emailOtpUnlockPrewarmRequestFromOptions,
  emailOtpUnlockPrewarmScopeFromBinding,
  normalizeExportKeypairWithUIInput,
  normalizeResolveExactKeyExportLaneInput,
  normalizeResolveExactKeyExportLaneResult,
  resolvePrewarmNearAccountBinding,
  resolveRuntimeAppearance,
  SeamsWebPrewarmOptions,
} from '@/SeamsWeb/walletIframe/shared/facadeBoundary';
import type {
  HostedAuthMenuDemoEmailOtpDelivery,
  HostedAuthMenuExternalAuthRequest,
  HostedAuthMenuExternalAuthResolutionInput,
  HostedAuthMenuOpenRequest,
  HostedAuthMenuOutcome,
  HostedAuthMenuSessionId,
  PreferencesChangedPayload,
} from '@/SeamsWeb/walletIframe/shared/messages';
import { createServerAllocatedWalletId } from '@shared/utils/registrationIds';
/**
 * Main SeamsWeb class that provides framework-agnostic passkey operations
 * with flexible event-based callbacks for custom UX implementation
 */
export class SeamsWeb {
  private readonly signingEngine: SeamsWebSigningSurface;
  private readonly nearClient: NearClient;
  readonly configs: SeamsConfigsReadonly;
  private appearance: AppearanceConfig;
  theme: ThemeMode;
  private readonly walletIframe: WalletIframeCoordinator;
  readonly recovery: RecoveryCapability;
  readonly devices: DevicesCapability;
  readonly keys: KeyExportCapability;
  readonly preferences: PreferencesCapability;
  readonly auth: AuthCapability;
  readonly registration: RegistrationCapability;
  readonly near: NearSignerCapability;
  readonly tempo: TempoSignerCapability;
  readonly evm: EvmSignerCapability;
  private readonly walletIframeControls: WalletIframeControlCapability;
  private emailOtpUnlockPrewarmRecord: EmailOtpUnlockPrewarmRecord = { kind: 'none' };
  constructor(configs: SeamsConfigsInput, nearClient?: NearClient) {
    this.configs = buildConfigsFromEnv(configs, {});
    configureBrowserIndexedDB(this.configs);
    // Use provided client or create default one
    this.nearClient =
      nearClient || new MinimalNearClient(resolvePrimaryNearRpcUrl(this.configs.network.chains));
    const browserSigningStores = createBrowserSigningStores(IndexedDBManager);
    const browserSigningSurface = new BrowserSigningSurface(this.configs, this.nearClient, {
      managerStores: browserSigningStores.managerStores,
      signingEngineStores: browserSigningStores.signingEngineStores,
      sealedSigningSessionStore: browserSigningStores.sealedSigningSessionStore,
      ed25519YaoPublicCapabilityReferences:
        browserSigningStores.ed25519YaoPublicCapabilityReferences,
      createRuntime: createBrowserSigningRuntime,
      initializeRuntime: initializeBrowserSigningRuntime,
      workerWarmupPolicy: resolveBrowserWorkerWarmupPolicy(this.configs),
    });
    this.signingEngine = browserSigningSurface;
    this.appearance = this.configs.ui.appearance;
    this.theme = this.appearance.theme.mode;
    try {
      this.signingEngine.setAppearance(this.appearance);
    } catch {}
    const userPreferences = this.signingEngine.getUserPreferences();
    this.walletIframe = new WalletIframeCoordinator({
      configs: this.configs,
      signingEngine: this.signingEngine,
      userPreferences: userPreferences,
      getAppearance: this.getAppearance.bind(this),
    });
    const deviceDomain = {
      kind: 'iframe' as const,
      linkedDeviceManagement: createWalletIframeLinkedDeviceManagementPortV1({
        walletIframe: this.walletIframe,
      }),
    };
    const registrationCommands = createApplicationRegistrationCommands(this.walletIframe);
    const sessionCommands = createApplicationSessionCommands(this.walletIframe);
    const emailOtpCommands = createApplicationEmailOtpCommands(
      this.walletIframe,
      this.getEmailOtpUnlockPrewarmRecord.bind(this),
    );
    const publicApi = createPublicApi({
      signingEngine: this.signingEngine,
      nearClient: this.nearClient,
      configs: this.configs,
      getTheme: this.getTheme.bind(this),
      userPreferences,
      getWalletIframe: this.getWalletIframe.bind(this),
      auth: {
        ...sessionCommands,
        ...emailOtpCommands.auth,
      },
      registration: {
        ...registrationCommands,
        ...emailOtpCommands.registration,
        onNearProvisioningStateChanged: this.onNearProvisioningStateChanged.bind(this),
        registerPasskey: this.registerPasskeyDomain.bind(this),
      },
      recovery: {
        getWalletRecoveryCodeStatus: this.getWalletRecoveryCodeStatusDomain.bind(this),
        acknowledgeWalletRecoveryCodeBackup:
          this.acknowledgeWalletRecoveryCodeBackupDomain.bind(this),
        requestWalletCustodyEmailOtpChallenge:
          this.requestWalletCustodyEmailOtpChallengeDomain.bind(this),
        rotateWalletRecoveryCodes: this.rotateWalletRecoveryCodesDomain.bind(this),
      },
      devices: {
        ...deviceDomain,
      },
      keys: {
        resolveExactKeyExportLane: this.resolveExactKeyExportLaneDomain.bind(this),
        exportKeypairWithUI: this.exportKeypairWithUIDomain.bind(this),
      },
    });
    this.walletIframeControls = publicApi.walletIframeControls;
    this.preferences = publicApi.preferences;
    this.auth = publicApi.auth;
    this.registration = publicApi.registration;
    this.recovery = publicApi.recovery;
    this.devices = publicApi.devices;
    this.keys = publicApi.keys;
    this.near = publicApi.near;
    this.tempo = publicApi.tempo;
    this.evm = publicApi.evm;
  }
  /**
   * Initialize the hidden wallet service iframe client (optional) and warm critical resources.
   * Always warms local resources; initializes iframe when wallet mode is `iframe`.
   * Idempotent and safe to call multiple times.
   */
  async initWalletIframe(walletId?: string): Promise<WalletIframeExactSessionState> {
    return await this.walletIframe.init(walletId);
  }
  async getWalletIframeExactSessionState(): Promise<WalletIframeExactSessionState> {
    return await this.walletIframe.getExactSessionState();
  }
  async openHostedAuthMenu(
    request: HostedAuthMenuOpenRequest,
    anchorElement?: HTMLElement,
  ): Promise<HostedAuthMenuOutcome> {
    return await this.walletIframe.openHostedAuthMenu(request, anchorElement);
  }
  async cancelHostedAuthMenu(args: { authMenuSessionId: HostedAuthMenuSessionId }): Promise<void> {
    await this.walletIframe.cancelHostedAuthMenu(args);
  }
  onHostedAuthMenuExternalAuthRequest(
    listener: (request: HostedAuthMenuExternalAuthRequest) => void,
  ): () => void {
    return this.walletIframe.onHostedAuthMenuExternalAuthRequest(listener);
  }
  onHostedAuthMenuDemoEmailOtpDelivery(
    listener: (delivery: HostedAuthMenuDemoEmailOtpDelivery) => void,
  ): () => void {
    return this.walletIframe.onHostedAuthMenuDemoEmailOtpDelivery(listener);
  }
  async resolveHostedAuthMenuExternalAuth(
    resolution: HostedAuthMenuExternalAuthResolutionInput,
  ): Promise<void> {
    await this.walletIframe.resolveHostedAuthMenuExternalAuth(resolution);
  }
  async lockWalletIframeExactSession(
    identity: WalletIframeExactSessionIdentityInput,
  ): Promise<WalletIframeExactSessionLockResult> {
    const parsedIdentity: WalletIframeExactSessionIdentity =
      parseWalletIframeExactSessionIdentity(identity);
    return await this.walletIframe.lockExactSession(parsedIdentity);
  }
  /** True when the wallet iframe client is connected and ready. */
  isWalletIframeReady(): boolean {
    return this.walletIframeControls.isWalletIframeReady();
  }
  /** Subscribe to wallet iframe ready state transitions. */
  onWalletIframeReady(listener: () => void): () => void {
    return this.walletIframeControls.onWalletIframeReady(listener);
  }
  /** Subscribe to wallet-host login status updates. */
  onWalletIframeLoginStatusChanged(
    listener: (status: { isLoggedIn: boolean; walletId: string | null }) => void,
  ): () => void {
    return this.walletIframeControls.onWalletIframeLoginStatusChanged(listener);
  }
  /** Subscribe to typed lifecycle events emitted by the wallet boundary. */
  onSdkLifecycleEvent(listener: SdkLifecycleEventListener): () => void {
    return this.walletIframe.onSdkLifecycleEvent(listener);
  }
  /** Subscribe to wallet-host preference updates. */
  onWalletIframePreferencesChanged(
    listener: (payload: PreferencesChangedPayload) => void,
  ): () => void {
    return this.walletIframeControls.onWalletIframePreferencesChanged(listener);
  }
  getContext(): SeamsWebContext {
    return {
      signingEngine: this.signingEngine,
      nearClient: this.nearClient,
      configs: this.configs,
      theme: this.theme,
    };
  }
  dispose(): void {
    this.walletIframe.dispose();
    this.signingEngine.dispose();
  }
  setTheme(next: ThemeMode): void {
    if (next !== 'light' && next !== 'dark') return;
    this.setAppearance({
      theme: {
        ...this.appearance.theme,
        mode: next,
      },
    });
  }
  /**
   * Resolve one configured ECDSA chain target by network slug, chain id, or
   * family — the value every EVM-family signing and export call takes.
   *
   * Throws when the selector matches no configured chain, or more than one.
   * Every configured chain is named in the error, so an ambiguous selector is
   * a clear failure rather than a silent first-match pick.
   *
   * @example seams.chainTarget('tempo-testnet')
   */
  chainTarget(selector: EcdsaChainSelector): ThresholdEcdsaChainTarget {
    return resolveConfiguredChainTarget(this.configs.network.chains, selector);
  }
  /** Every ECDSA chain target this client is configured for. */
  configuredChainTargets(): readonly ThresholdEcdsaChainTarget[] {
    return configuredThresholdEcdsaChainTargets(this.configs.network.chains);
  }
  /**
   * Update resolved appearance at runtime.
   * This is the canonical internal propagation path for local signing UI,
   * wallet-host documents, and app-origin wallet iframe mode. Appearance is
   * excluded from the runtime-reset fingerprint, so warm signing-session state
   * is preserved. Fire-and-forget; never throws.
   */
  setAppearance(appearance: AppearanceConfigInput): void {
    const normalizedAppearance = resolveRuntimeAppearance(this.appearance, appearance);
    this.appearance = normalizedAppearance;
    this.theme = normalizedAppearance.theme.mode;
    try {
      this.signingEngine.setAppearance(normalizedAppearance);
    } catch {}
    void this.synchronizeAppearance(normalizedAppearance);
  }
  private async synchronizeAppearance(appearance: AppearanceConfig): Promise<void> {
    try {
      const router = await this.walletIframe.requireRouter();
      await router.setAppearance(appearance);
    } catch {}
  }

  /**
   * Pre-warm resources on a best-effort basis without changing visible state.
   * - When iframe=true, initializes the wallet iframe client.
   * Worker preparation belongs to the wallet host and follows the selected operation.
   */
  async prewarm(opts?: SeamsWebPrewarmOptions): Promise<void> {
    const iframe = !!opts?.iframe;
    const nearAccountBinding = resolvePrewarmNearAccountBinding(opts);
    const prewarmRequest = emailOtpUnlockPrewarmRequestFromOptions(opts);
    const prewarmScope = emailOtpUnlockPrewarmScopeFromBinding(nearAccountBinding);
    const tasks: Promise<unknown>[] = [];
    if (iframe) {
      tasks.push(this.initWalletIframe(nearAccountBinding?.wallet.walletId));
    }
    if (tasks.length === 0) return;
    let status: EmailOtpUnlockPrewarmStatus = 'succeeded';
    try {
      await Promise.all(tasks);
    } catch {
      status = 'failed';
    }
    if (prewarmRequest) {
      this.emailOtpUnlockPrewarmRecord = {
        kind: 'attempted',
        status,
        completedAtMs: Date.now(),
        request: prewarmRequest,
        scope: prewarmScope,
      };
    }
  }
  private getAppearance(): AppearanceConfig {
    return this.appearance;
  }

  private getTheme(): ThemeMode {
    return this.theme;
  }

  private getWalletIframe(): WalletIframeCoordinator {
    return this.walletIframe;
  }

  private onNearProvisioningStateChanged(
    listener: Parameters<RegistrationCapability['onNearProvisioningStateChanged']>[0],
  ): () => void {
    return this.onSdkLifecycleEvent(deliverNearProvisioningStateChanged.bind(null, listener));
  }

  private getEmailOtpUnlockPrewarmRecord(): EmailOtpUnlockPrewarmRecord {
    return this.emailOtpUnlockPrewarmRecord;
  }
  private async registerPasskeyDomain(
    options: Parameters<RegistrationCapability['registerPasskey']>[0] = {},
  ): Promise<RegistrationResult> {
    if (typeof options === 'string') {
      throw new Error(
        '[SeamsWeb] registration.registerPasskey no longer accepts a NEAR account id; call registration.registerPasskey(options) for implicit NEAR registration or registerWallet(...) with explicit sponsored accountProvisioning.',
      );
    }
    const { wallet, nearAccountProvisioning, ...registrationOptions } = options || {};
    const rpId = this.walletIframe.resolveRegistrationRpId(this.signingEngine.getRpId());
    const provisioningPreference =
      nearAccountProvisioning ?? this.configs.registration.nearAccountProvisioning;
    const resolvedWallet =
      wallet ||
      (provisioningPreference.kind === 'relayer_named_subaccount'
        ? { kind: 'provided' as const, walletId: createServerAllocatedWalletId() }
        : { kind: 'server_allocated' as const });
    const accountProvisioning = resolvePasskeyRegistrationAccountProvisioning({
      configs: this.configs,
      wallet: resolvedWallet,
      preference: provisioningPreference,
    });
    return await this.registration.registerWallet({
      wallet: resolvedWallet,
      authMethod: { kind: 'passkey', rpId },
      signerSelection: buildNearWalletRegistrationSignerSetSelection({
        configs: this.configs,
        accountProvisioning,
        options: registrationOptions,
      }),
      options: registrationOptions,
    });
  }
  private async getWalletRecoveryCodeStatusDomain(args: { walletId: string }) {
    {
      const router = await this.walletIframe.requireRouter(args.walletId);
      return await router.getWalletRecoveryCodeStatus({
        walletId: args.walletId,
      });
    }
  }
  private async acknowledgeWalletRecoveryCodeBackupDomain(args: { walletId: string }) {
    {
      const router = await this.walletIframe.requireTransportRouter();
      return await router.acknowledgeWalletRecoveryCodeBackup({
        walletId: args.walletId,
      });
    }
  }
  private async requestWalletCustodyEmailOtpChallengeDomain(
    args: Parameters<RecoveryCapability['requestWalletCustodyEmailOtpChallenge']>[0],
  ) {
    const relayUrl = String(this.configs.network.relayer.url || '').trim();
    return await requestWalletCustodyEmailOtpChallenge({ relayUrl, ...args });
  }
  private async rotateWalletRecoveryCodesDomain(
    args: Parameters<RecoveryCapability['rotateWalletRecoveryCodes']>[0],
  ) {
    {
      const router = await this.walletIframe.requireRouter(args.walletId);
      return await router.rotateWalletRecoveryCodes(args);
    }
  }
  ///////////////////////////////////////
  // === User Settings ===
  ///////////////////////////////////////
  /**
   * Prefetch latest block height/hash (and nonce if context missing) to reduce
   * perceived latency when the user initiates a signing flow.
   */
  async prefetchBlockheight(): Promise<void> {
    {
      const router = await this.walletIframe.requireRouter();
      await router.prefetchBlockheight();
      return;
    }
  }
  ///////////////////////////////////////
  // === KEY MANAGEMENT ===
  ///////////////////////////////////////
  /**
   * Canonical entrypoint to show secure key export UI (wallet-origin only) without
   * returning private keys to the caller.
   */
  private async resolveExactKeyExportLaneDomain(
    input: Parameters<KeyExportCapability['resolveExactKeyExportLane']>[0],
  ): Promise<Awaited<ReturnType<KeyExportCapability['resolveExactKeyExportLane']>>> {
    const resolvedInput = normalizeResolveExactKeyExportLaneInput(input);
    const routerAccountId = String(resolvedInput.walletSession.walletId || '').trim();
    if (!routerAccountId) {
      throw new Error('[SeamsWeb] key export lane resolution requires wallet session context');
    }
    {
      const router = await this.walletIframe.requireRouter(routerAccountId);
      const result = await router.resolveExactKeyExportLane(resolvedInput);
      return normalizeResolveExactKeyExportLaneResult(result);
    }
  }
  private async exportKeypairWithUIDomain(
    input: SigningEngineExportKeypairWithUIInput,
  ): Promise<void> {
    const resolvedInput = normalizeExportKeypairWithUIInput(input, this.theme);
    const routerAccountId = String(resolvedInput.walletSession.walletId || '').trim();
    if (!routerAccountId) {
      throw new Error('[SeamsWeb] key export requires wallet session user context');
    }
    {
      const router = await this.walletIframe.requireRouter(routerAccountId);
      await router.exportKeypairWithUI(resolvedInput);
      return;
    }
  }
}

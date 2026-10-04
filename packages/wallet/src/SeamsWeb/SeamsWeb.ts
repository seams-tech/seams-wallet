import { ClientPreferenceState } from '@/SeamsWeb/walletIframe/client/preferenceState';
import { createApplicationPreferences } from '@/SeamsWeb/walletIframe/client/preferences';
import { createApplicationDeviceCommands } from '@/SeamsWeb/walletIframe/client/deviceCommands';
import { createApplicationNearCommands } from '@/SeamsWeb/walletIframe/client/nearCommands';
import { createApplicationEvmFamilyCommands } from '@/SeamsWeb/walletIframe/client/evmFamilyCommands';
import { resolvePrimaryNearRpcUrl } from '@/core/config/chains';
import { buildConfigsFromEnv } from '@/core/config/defaultConfigs';
import { MinimalNearClient, type NearClient } from '@/core/rpcClients/near/NearClient';
import { requestWalletCustodyEmailOtpChallenge } from '@/core/rpcClients/relayer/walletRecoveryRotate';
import type { SigningEngineExportKeypairWithUIInput } from '@/core/signingEngine/flows/recovery/public';
import { configuredThresholdEcdsaChainTargets } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type {
  AppearanceConfig,
  AppearanceConfigInput,
  RegistrationResult,
  SeamsConfigsInput,
  SeamsClientConfig,
  ThemeMode,
} from '@/core/types/seams';
import {
  buildNearWalletRegistrationSignerSetSelection,
  resolvePasskeyRegistrationAccountProvisioning,
} from '@/SeamsWeb/operations/registration/registrationSignerSet';
import { createApplicationPublicApi } from '@/SeamsWeb/publicApi';
import type { AuthMenuCapability, ConfigCapability, EventsCapability } from '@/SeamsWeb/publicApi/types';
import { resolveConfiguredChainTarget } from '@/SeamsWeb/publicApi/chainTargets';
import type {
  AuthCapability,
  DevicesCapability,
  EvmSignerCapability,
  KeyExportCapability,
  NearSignerCapability,
  PreferencesCapability,
  RecoveryCapability,
  RegistrationCapability,
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
  PreferencesChangedPayload,
} from '@/SeamsWeb/walletIframe/shared/messages';
import { createServerAllocatedWalletId, walletIdFromString } from '@shared/utils/registrationIds';
/**
 * Main SeamsWeb class that provides framework-agnostic passkey operations
 * with flexible event-based callbacks for custom UX implementation
 */
export class SeamsWeb {
  private readonly disposePreferences: () => void;
  private readonly preferenceState = new ClientPreferenceState();
  private readonly nearClient: NearClient;
  readonly configs: SeamsClientConfig;
  private appearance: AppearanceConfig;
  readonly config: ConfigCapability;
  readonly events: EventsCapability;
  readonly authMenu: AuthMenuCapability;
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
  private emailOtpUnlockPrewarmRecord: EmailOtpUnlockPrewarmRecord = { kind: 'none' };
  constructor(configs: SeamsConfigsInput, nearClient?: NearClient) {
    this.configs = buildConfigsFromEnv(configs);
    // Use provided client or create default one
    this.nearClient =
      nearClient || new MinimalNearClient(resolvePrimaryNearRpcUrl(this.configs.network.chains));
    this.appearance = this.configs.ui.appearance;
    this.config = {
      setTheme: this.updateTheme.bind(this),
      setAppearance: this.updateAppearance.bind(this),
      chainTarget: resolveConfiguredChainTarget.bind(null, this.configs.network.chains),
      configuredChainTargets: configuredThresholdEcdsaChainTargets.bind(
        null,
        this.configs.network.chains,
      ),
    };
    const userPreferences = this.preferenceState;
    this.walletIframe = new WalletIframeCoordinator({
      configs: this.configs,
      userPreferences: userPreferences,
      getAppearance: this.getAppearance.bind(this),
    });
    this.events = {
      subscribe: this.walletIframe.onSdkLifecycleEvent.bind(this.walletIframe),
    };
    this.authMenu = {
      open: this.walletIframe.openHostedAuthMenu.bind(this.walletIframe),
      cancel: this.walletIframe.cancelHostedAuthMenu.bind(this.walletIframe),
      onExternalAuthRequest: this.walletIframe.onHostedAuthMenuExternalAuthRequest.bind(
        this.walletIframe,
      ),
      resolveExternalAuth: this.walletIframe.resolveHostedAuthMenuExternalAuth.bind(
        this.walletIframe,
      ),
    };
    const preferences = createApplicationPreferences(userPreferences, this.walletIframe);
    this.disposePreferences = preferences.dispose;
    const deviceDomain = createApplicationDeviceCommands(this.walletIframe);
    const registrationCommands = createApplicationRegistrationCommands(this.walletIframe);
    const sessionCommands = createApplicationSessionCommands(this.walletIframe);
    const emailOtpCommands = createApplicationEmailOtpCommands(
      this.walletIframe,
      this.getEmailOtpUnlockPrewarmRecord.bind(this),
    );
    const publicApi = createApplicationPublicApi({
      createNearCommands: createApplicationNearCommands.bind(
        null,
        this.walletIframe,
        this.configs,
        preferences.beforeSigning,
      ),
      createEvmFamilyCommands: createApplicationEvmFamilyCommands.bind(
        null,
        this.walletIframe,
        preferences.beforeSigning,
      ),
      nearClient: this.nearClient,
      configs: this.configs,
      preferences: preferences.capability,
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
        syncAccount: this.syncAccountDomain.bind(this),
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
   * Connect to the configured wallet service iframe.
   * Idempotent and safe to call multiple times.
   */
  async initWalletIframe(walletId?: string): Promise<WalletIframeExactSessionState> {
    return await this.walletIframe.init(walletId);
  }
  async getWalletIframeExactSessionState(): Promise<WalletIframeExactSessionState> {
    return await this.walletIframe.getExactSessionState();
  }
  onHostedAuthMenuDemoEmailOtpDelivery(
    listener: (delivery: HostedAuthMenuDemoEmailOtpDelivery) => void,
  ): () => void {
    return this.walletIframe.onHostedAuthMenuDemoEmailOtpDelivery(listener);
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
    return this.walletIframe.isReady();
  }
  /** Subscribe to wallet iframe ready state transitions. */
  onWalletIframeReady(listener: () => void): () => void {
    return this.walletIframe.onReady(listener);
  }
  /** Subscribe to wallet-host login status updates. */
  onWalletIframeLoginStatusChanged(
    listener: (status: { isLoggedIn: boolean; walletId: string | null }) => void,
  ): () => void {
    return this.walletIframe.onLoginStatusChanged(listener);
  }
  /** Subscribe to wallet-host preference updates. */
  onWalletIframePreferencesChanged(
    listener: (payload: PreferencesChangedPayload) => void,
  ): () => void {
    return this.walletIframe.onPreferencesChanged(listener);
  }
  dispose(): void {
    this.disposePreferences();
    this.walletIframe.dispose();
  }
  get theme(): ThemeMode {
    return this.appearance.theme.mode;
  }
  private updateTheme(next: ThemeMode): void {
    if (next !== 'light' && next !== 'dark') return;
    this.updateAppearance({
      theme: {
        ...this.appearance.theme,
        mode: next,
      },
    });
  }
  /**
   * Update resolved appearance at runtime.
   * Forward appearance to the wallet-host document. Appearance is
   * excluded from the runtime-reset fingerprint, so warm signing-session state
   * is preserved. Fire-and-forget; never throws.
   */
  private updateAppearance(appearance: AppearanceConfigInput): void {
    const normalizedAppearance = resolveRuntimeAppearance(this.appearance, appearance);
    this.appearance = normalizedAppearance;
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

  private async syncAccountDomain(
    args: Parameters<RecoveryCapability['syncAccount']>[0],
  ): ReturnType<RecoveryCapability['syncAccount']> {
    const walletId = args.walletId ? walletIdFromString(args.walletId) : null;
    const router = await this.walletIframe.requireRouter(args.walletId);
    return await router.syncAccount({
      ...(walletId ? { walletId: String(walletId) } : {}),
      onEvent: args.options?.onEvent,
    });
  }

  private getWalletIframe(): WalletIframeCoordinator {
    return this.walletIframe;
  }

  private onNearProvisioningStateChanged(
    listener: Parameters<RegistrationCapability['onNearProvisioningStateChanged']>[0],
  ): () => void {
    return this.events.subscribe(deliverNearProvisioningStateChanged.bind(null, listener));
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
    const rpId = this.walletIframe.resolveRegistrationRpId();
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

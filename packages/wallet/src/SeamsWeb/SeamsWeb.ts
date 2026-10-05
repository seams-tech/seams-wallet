import type { KeyExportDomainMethods } from '@/SeamsWeb/publicApi/keyExport';
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
  SeamsConfigsInput,
  SeamsClientConfig,
  ThemeMode,
} from '@/core/types/seams';
import { createApplicationPublicApi } from '@/SeamsWeb/publicApi';
import type { AuthMenuCapability, ConfigCapability, ConnectionCapability, EventsCapability } from '@/SeamsWeb/publicApi/types';
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
import {
  parseWalletIframeExactSessionIdentity,
  type WalletIframeExactSessionIdentity,
  type WalletIframeExactSessionIdentityInput,
  type WalletIframeExactSessionLockResult,
  type WalletIframeExactSessionState,
} from '@/SeamsWeb/walletIframe/shared/exactSessionState';
import {
  deliverNearProvisioningStateChanged,
  normalizeExportKeypairWithUIInput,
  normalizeResolveExactKeyExportLaneInput,
  normalizeResolveExactKeyExportLaneResult,
  resolveRuntimeAppearance,
} from '@/SeamsWeb/walletIframe/shared/facadeBoundary';
import type {
} from '@/SeamsWeb/walletIframe/shared/messages';
import { walletIdFromString } from '@shared/utils/registrationIds';
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
  readonly connection: ConnectionCapability;
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
    this.connection = {
      connect: this.walletIframe.connect.bind(this.walletIframe),
      getState: this.walletIframe.getConnectionState.bind(this.walletIframe),
      onChange: this.walletIframe.onConnectionChange.bind(this.walletIframe),
      dispose: this.disposeClient.bind(this),
    };
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
    const emailOtpCommands = createApplicationEmailOtpCommands(this.walletIframe);
    const publicApi = createApplicationPublicApi({
      createNearCommands: createApplicationNearCommands.bind(
        null,
        this.walletIframe,
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
        onNearAccountChange: this.onNearAccountChange.bind(this),
      },
      recovery: {
        syncAccount: this.syncAccountDomain.bind(this),
        getCodeStatus: this.getCodeStatusDomain.bind(this),
        confirmBackup:
          this.confirmBackupDomain.bind(this),
        requestWalletCustodyEmailOtpChallenge:
          this.requestWalletCustodyEmailOtpChallengeDomain.bind(this),
        rotateCodes: this.rotateCodesDomain.bind(this),
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
  async getWalletIframeExactSessionState(): Promise<WalletIframeExactSessionState> {
    return await this.walletIframe.getExactSessionState();
  }
  async lockWalletIframeExactSession(
    identity: WalletIframeExactSessionIdentityInput,
  ): Promise<WalletIframeExactSessionLockResult> {
    const parsedIdentity: WalletIframeExactSessionIdentity =
      parseWalletIframeExactSessionIdentity(identity);
    return await this.walletIframe.lockExactSession(parsedIdentity);
  }
  private disposeClient(): void {
    try {
      this.walletIframe.dispose();
    } finally {
      this.disposePreferences();
    }
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

  private getAppearance(): AppearanceConfig {
    return this.appearance;
  }

  private async syncAccountDomain(
    args: Parameters<RecoveryCapability['syncAccount']>[0],
  ): ReturnType<RecoveryCapability['syncAccount']> {
    const walletId = args.walletId ? walletIdFromString(args.walletId) : null;
    const router = await this.walletIframe.requireRouter();
    return await router.syncAccount({
      ...(walletId ? { walletId: String(walletId) } : {}),
      onEvent: args.options?.onEvent,
    });
  }

  private getWalletIframe(): WalletIframeCoordinator {
    return this.walletIframe;
  }

  private onNearAccountChange(
    listener: Parameters<RegistrationCapability['onNearAccountChange']>[0],
  ): () => void {
    return this.events.subscribe(deliverNearProvisioningStateChanged.bind(null, listener));
  }

  private async getCodeStatusDomain(args: { walletId: string }) {
    const router = await this.walletIframe.requireRouter();
    return await router.getCodeStatus({
      walletId: args.walletId,
    });
  }
  private async confirmBackupDomain(args: { walletId: string }) {
    const router = await this.walletIframe.requireRouter();
    return await router.confirmBackup({
      walletId: args.walletId,
    });
  }
  private async requestWalletCustodyEmailOtpChallengeDomain(
    args: Parameters<RecoveryCapability['requestWalletCustodyEmailOtpChallenge']>[0],
  ) {
    const relayUrl = String(this.configs.network.relayer.url || '').trim();
    return await requestWalletCustodyEmailOtpChallenge({ relayUrl, ...args });
  }
  private async rotateCodesDomain(
    args: Parameters<RecoveryCapability['rotateCodes']>[0],
  ) {
    const router = await this.walletIframe.requireRouter();
    return await router.rotateCodes(args);
  }

  ///////////////////////////////////////
  // === KEY MANAGEMENT ===
  ///////////////////////////////////////
  /**
   * Canonical entrypoint to show secure key export UI (wallet-origin only) without
   * returning private keys to the caller.
   */
  private async resolveExactKeyExportLaneDomain(
    input: Parameters<KeyExportDomainMethods['resolveExactKeyExportLane']>[0],
  ): Promise<Awaited<ReturnType<KeyExportDomainMethods['resolveExactKeyExportLane']>>> {
    const resolvedInput = normalizeResolveExactKeyExportLaneInput(input);
    const routerAccountId = String(resolvedInput.walletSession.walletId || '').trim();
    if (!routerAccountId) {
      throw new Error('[SeamsWeb] key export lane resolution requires wallet session context');
    }
    {
      const router = await this.walletIframe.requireRouter();
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
      const router = await this.walletIframe.requireRouter();
      await router.exportKeypairWithUI(resolvedInput);
      return;
    }
  }
}

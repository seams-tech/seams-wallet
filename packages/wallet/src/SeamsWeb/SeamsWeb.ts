import type {
  EmailOtpUnlockPrewarmScope,
  EmailOtpUnlockPrewarmRequest,
  EmailOtpUnlockPrewarmRecord,
} from '@/SeamsWeb/walletIframe/shared/emailOtpLifecycle';
import { createApplicationEmailOtpCommands } from './walletIframe/client/emailOtpCommands';
import { createWalletHostEmailOtpCommands } from './walletIframe/host/createEmailOtpCommands';
import { BrowserSigningSurface } from '@/SeamsWeb/signingSurface/BrowserSigningSurface';
import { resumePendingNearRegistrations } from '@/SeamsWeb/operations/registration/pendingRegistrationRecovery';
import {
  resumePendingWalletRecoveries,
  type WalletRecoveryResumeResult,
} from '@/SeamsWeb/operations/recovery/walletRecoveryCommit';
import { MinimalNearClient, type NearClient } from '@/core/rpcClients/near/NearClient';
import type {
  RegistrationResult,
  ThemeMode,
  AppearanceConfig,
  AppearanceConfigInput,
  SeamsConfigsReadonly,
  SeamsConfigsInput,
} from '@/core/types/seams';
import type {
  NearProvisioningStateChangedEvent,
  SdkLifecycleEvent,
  SdkLifecycleEventListener,
  SigningFlowEvent,
} from '@/core/types/sdkSentEvents';
import { IndexedDBManager } from '@/core/indexedDB';
import type {
  HostedAuthMenuExternalAuthRequest,
  HostedAuthMenuDemoEmailOtpDelivery,
  HostedAuthMenuExternalAuthResolutionInput,
  HostedAuthMenuOpenRequest,
  HostedAuthMenuOutcome,
  HostedAuthMenuSessionId,
  PreferencesChangedPayload,
} from '@/SeamsWeb/walletIframe/shared/messages';
import { __isWalletIframeHostMode } from '@/core/browser/walletIframe/host-mode';
import { parseMpcMaterialActivationRef } from '@shared/utils/domainIds';
import { buildConfigsFromEnv } from '@/core/config/defaultConfigs';
import { resolvePrimaryNearRpcUrl } from '@/core/config/chains';
import { resolveAppearanceTheme, resolveThemePalette } from '@/core/config/configHelpers';
import { WalletIframeCoordinator } from '@/SeamsWeb/walletIframe/coordinator';
import {
  parseWalletIframeExactSessionIdentity,
  type WalletIframeExactSessionIdentity,
  type WalletIframeExactSessionIdentityInput,
  type WalletIframeExactSessionLockResult,
  type WalletIframeExactSessionState,
} from '@/SeamsWeb/walletIframe/shared/exactSessionState';
import { resolveBrowserWorkerWarmupPolicy } from './assembly/browserWorkerWarmupPolicy';
import { configureBrowserIndexedDB } from './assembly/configureBrowserIndexedDB';
import { createBrowserSigningRuntime } from './assembly/createBrowserSigningRuntime';
import {
  type RestoredSessionPresignaturePrefill,
  scheduleRestoredSessionPresignaturePrefills,
} from './walletIframe/host/restoredSessionPresignaturePrefill';
import { createBrowserSigningStores } from './assembly/createBrowserSigningStores';
import { initializeBrowserSigningRuntime } from './assembly/initializeBrowserSigningRuntime';
import { createApplicationSessionCommands } from './walletIframe/client/sessionCommands';
import {
  createWalletHostSessionCommands,
  prefillWalletHostPresignatures,
} from './walletIframe/host/createSessionCommands';
import {
  createPublicApi,
  createWalletIframeLinkedDeviceManagementPortV1,
  type DevicesCapabilityDomainMethods,
  type WalletIframeControlCapability,
} from './publicApi';
import { createApplicationRegistrationCommands } from './walletIframe/client/registrationCommands';
import { createWalletHostRegistrationCommands } from './walletIframe/host/createRegistrationCommands';
import { createWalletHostDeviceDomain } from './walletIframe/host/createDeviceDomain';
import type {
  AuthCapability,
  DevicesCapability,
  EvmSignerCapability,
  KeyExportCapability,
  NearSignerCapability,
  SeamsWebContext,
  SeamsWebSigningSurface,
  PreferencesCapability,
  RegistrationCapability,
  RecoveryCapability,
  TempoSignerCapability,
} from '@/SeamsWeb/signingSurface/types';
import type { UiConfirmSurfaceMeasurementBinding } from '@/core/signingEngine/uiConfirm/uiConfirm.types';
import {
  thresholdEcdsaChainTargetsEqual,
  configuredThresholdEcdsaChainTargets,
  nearAccountRefFromAccountId,
  thresholdEcdsaChainTargetFromRequest,
  walletSessionRefFromSession,
  type ThresholdEcdsaChainTarget,
  type WalletSessionRef,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import {
  resolveConfiguredChainTarget,
  type EcdsaChainSelector,
} from '@/SeamsWeb/publicApi/chainTargets';
import type { SigningEngineExportKeypairWithUIInput } from '@/core/signingEngine/flows/recovery/public';
import type { TempoChainTarget } from '@/core/platform/types';
import type { EvmSignedResult } from '@/core/signingEngine/chains/evm/evmAdapter';
import type { ConfirmationConfig } from '@/core/types/signer-worker';
import type { WalletRecoveryCodeBackupRequestV1 } from '@/core/types/sdkSentEvents';
import {
  requireTempoFeeTokenPreferenceSigningRequest,
  type TempoFeeTokenPreferenceSigningRequest,
} from '@/core/signingEngine/chains/tempo/feeToken';
import {
  parseExactEcdsaSigningLaneIdentity,
  parseExactEd25519ExportMaterialIdentity,
} from '@/core/signingEngine/session/identity/exactSigningLaneIdentity';
import { rotateWalletRecoveryCodes } from '@/SeamsWeb/operations/recovery/walletRecoveryRotation';
import { showWalletRecoveryCodesUi } from '@/SeamsWeb/operations/recovery/walletRecoveryCodeBackup';
import { pendingWalletRecoveryCodeBackupRepository } from '@/core/indexedDB/seamsWalletDB/pendingWalletRecoveryCodeBackup';
import {
  acknowledgeWalletRecoveryBackup,
  requestWalletCustodyEmailOtpChallenge,
  readWalletRecoveryCodeStatus,
} from '@/core/rpcClients/relayer/walletRecoveryRotate';
import {
  nearAccountBindingFromRaw,
  type NearAccountBinding,
} from '@shared/utils/walletCapabilityBindings';
import {
  buildNearWalletRegistrationSignerSetSelection,
  resolvePasskeyRegistrationAccountProvisioning,
} from '@/SeamsWeb/operations/registration/registrationSignerSet';
import { createServerAllocatedWalletId } from '@shared/utils/registrationIds';

///////////////////////////////////////
// PASSKEY MANAGER
///////////////////////////////////////

function emailOtpUnlockPrewarmScopeFromBinding(
  nearAccountBinding: NearAccountBinding | undefined,
): EmailOtpUnlockPrewarmScope {
  if (!nearAccountBinding) return { kind: 'global' };
  return {
    kind: 'near_account_bound',
    walletId: String(nearAccountBinding.wallet.walletId),
    nearAccountId: String(nearAccountBinding.nearAccountId),
  };
}

function emailOtpUnlockPrewarmRequestFromOptions(
  opts: SeamsWebPrewarmOptions | undefined,
): EmailOtpUnlockPrewarmRequest | null {
  if (opts?.iframe) return { kind: 'iframe_and_local_resources' };
  if (opts?.workers) return { kind: 'local_worker_resources' };
  return null;
}

type SeamsWebPrewarmOptions =
  | {
      iframe?: boolean;
      workers?: boolean;
      walletId?: never;
      nearAccountId?: never;
    }
  | {
      iframe?: boolean;
      workers?: boolean;
      walletId: string;
      nearAccountId: string;
    };

function nearAccountBindingKindFromId(nearAccountId: string): NearAccountBinding['kind'] {
  return nearAccountId.length === 64 && /^[0-9a-f]+$/i.test(nearAccountId)
    ? 'implicit_near_account'
    : 'named_near_account';
}

function requireNearAccountBindingForOperation(args: {
  walletId: string;
  nearAccountId: string;
  operation: string;
}): NearAccountBinding {
  const walletId = String(args.walletId || '').trim();
  const nearAccountId = String(args.nearAccountId || '').trim();
  if (!walletId || !nearAccountId) {
    throw new Error(`[SeamsWeb] ${args.operation} requires walletId and nearAccountId`);
  }
  const parsed = nearAccountBindingFromRaw({
    kind: nearAccountBindingKindFromId(nearAccountId),
    wallet: { walletId },
    nearAccountId,
  });
  if (!parsed.ok) {
    throw new Error(`[SeamsWeb] ${args.operation} requires a valid NEAR account binding`);
  }
  return parsed.value;
}

function resolvePrewarmNearAccountBinding(
  opts: SeamsWebPrewarmOptions | undefined,
): NearAccountBinding | undefined {
  const walletId = String(opts?.walletId || '').trim();
  const nearAccountId = String(opts?.nearAccountId || '').trim();
  if (!walletId && !nearAccountId) return undefined;
  return requireNearAccountBindingForOperation({
    walletId,
    nearAccountId,
    operation: 'prewarm',
  });
}

// The public `options` bag is optional; it is normalized before it reaches the
// boundary, so everything below always sees a resolved one.
type ExportKeypairWithUIBoundaryInput = SigningEngineExportKeypairWithUIInput;

type ResolveExactKeyExportLaneBoundaryInput = Parameters<
  KeyExportCapability['resolveExactKeyExportLane']
>[0];

type ResolveExactKeyExportLaneBoundaryResult = Awaited<
  ReturnType<KeyExportCapability['resolveExactKeyExportLane']>
>;

function normalizeResolveExactKeyExportLaneInput(
  input: ResolveExactKeyExportLaneBoundaryInput,
): ResolveExactKeyExportLaneBoundaryInput {
  switch (input.kind) {
    case 'ecdsa':
      return {
        kind: 'ecdsa',
        walletSession: walletSessionRefFromSession(input.walletSession),
        chainTarget: thresholdEcdsaChainTargetFromRequest(input.chainTarget),
      };
    case 'ed25519':
      return {
        kind: 'ed25519',
        walletSession: walletSessionRefFromSession(input.walletSession),
        nearAccount: nearAccountRefFromAccountId(input.nearAccount.accountId),
      };
  }
}

function normalizeResolveExactKeyExportLaneResult(
  result: ResolveExactKeyExportLaneBoundaryResult,
): ResolveExactKeyExportLaneBoundaryResult {
  switch (result.kind) {
    case 'relink_required':
      return {
        kind: 'relink_required',
        reason: result.reason,
      };
    case 'ecdsa':
      return {
        kind: 'ecdsa',
        laneIdentity: parseExactEcdsaSigningLaneIdentity(result.laneIdentity),
      };
    case 'ed25519': {
      const materialActivation = parseMpcMaterialActivationRef(result.materialActivation);
      if (!materialActivation.ok) throw new Error(materialActivation.error.message);
      return {
        kind: 'ed25519',
        laneIdentity: parseExactEd25519ExportMaterialIdentity(result.laneIdentity),
        materialActivation: materialActivation.value,
      };
    }
  }
}

function normalizeExportKeypairWithUIInput(
  input: ExportKeypairWithUIBoundaryInput,
  theme: ThemeMode,
): ExportKeypairWithUIBoundaryInput {
  const resolvedOptions = {
    ...input.options,
    theme: input.options.theme ?? theme,
  };
  switch (input.kind) {
    case 'ecdsa': {
      const laneIdentity = parseExactEcdsaSigningLaneIdentity(input.laneIdentity);
      if (String(laneIdentity.signer.walletId) !== String(input.walletSession.walletId)) {
        throw new Error('[SeamsWeb] key export lane wallet does not match wallet session');
      }
      if (!thresholdEcdsaChainTargetsEqual(laneIdentity.signer.chainTarget, input.chainTarget)) {
        throw new Error('[SeamsWeb] key export lane chain target does not match request target');
      }
      return {
        kind: 'ecdsa',
        chainTarget: input.chainTarget,
        walletSession: input.walletSession,
        laneIdentity,
        options: resolvedOptions,
      };
    }
    case 'ed25519': {
      const laneIdentity = parseExactEd25519ExportMaterialIdentity(input.laneIdentity);
      const materialActivation = parseMpcMaterialActivationRef(input.materialActivation);
      if (!materialActivation.ok) throw new Error(materialActivation.error.message);
      if (
        String(laneIdentity.signer.account.wallet.walletId) !== String(input.walletSession.walletId)
      ) {
        throw new Error('[SeamsWeb] Ed25519 export lane wallet does not match wallet session');
      }
      if (
        String(laneIdentity.signer.account.nearAccountId) !== String(input.nearAccount.accountId)
      ) {
        throw new Error('[SeamsWeb] Ed25519 export lane does not match the NEAR account');
      }
      return {
        kind: 'ed25519',
        nearAccount: nearAccountRefFromAccountId(input.nearAccount.accountId),
        walletSession: input.walletSession,
        laneIdentity,
        materialActivation: materialActivation.value,
        options: resolvedOptions,
      };
    }
  }
}

function resolveRuntimeAppearance(
  current: AppearanceConfig,
  input: AppearanceConfigInput,
): AppearanceConfig {
  const rawInput = input as Record<string, unknown>;
  return {
    theme: resolveAppearanceTheme({
      value: rawInput.theme,
      fallback: current.theme,
      legacyTokens: rawInput.tokens,
    }),
    palette: resolveThemePalette({
      value: rawInput.palette,
      fallback: current.palette,
    }),
  };
}

type SeamsWebRuntimeMode = 'application' | 'wallet_host';

export type SeamsWebInternalOptions =
  | {
      readonly kind: 'application';
    }
  | {
      readonly kind: 'wallet_host';
    };

type SeamsWebLifecycleEventSource =
  | {
      readonly kind: 'signing_engine';
      readonly source: Pick<SeamsWebSigningSurface, 'onSdkLifecycleEvent'>;
    }
  | {
      readonly kind: 'wallet_iframe';
      readonly source: WalletIframeCoordinator;
    };

function resolveSeamsWebRuntimeMode(
  internalOptions: SeamsWebInternalOptions | undefined,
): SeamsWebRuntimeMode {
  if (internalOptions?.kind === 'wallet_host') return 'wallet_host';
  return 'application';
}

function resolveSeamsWebLifecycleEventSource(args: {
  readonly mode: SeamsWebRuntimeMode;
  readonly signingEngine: SeamsWebSigningSurface;
  readonly walletIframe: WalletIframeCoordinator;
}): SeamsWebLifecycleEventSource {
  switch (args.mode) {
    case 'wallet_host':
      return { kind: 'signing_engine', source: args.signingEngine };
    case 'application':
      return { kind: 'wallet_iframe', source: args.walletIframe };
  }
}

function subscribeToSeamsWebLifecycleEvents(
  eventSource: SeamsWebLifecycleEventSource,
  listener: SdkLifecycleEventListener,
): () => void {
  switch (eventSource.kind) {
    case 'signing_engine':
    case 'wallet_iframe':
      return eventSource.source.onSdkLifecycleEvent(listener);
  }
}

function deliverNearProvisioningStateChanged(
  listener: (event: NearProvisioningStateChangedEvent) => void,
  event: SdkLifecycleEvent,
): void {
  if (event.event === 'registration.near_provisioning_changed') listener(event);
}

function reportWalletRecoveryStartupResult(result: WalletRecoveryResumeResult): void {
  switch (result.kind) {
    case 'completed':
      return;
    case 'pending':
      console.warn(
        '[SeamsWeb] pending wallet recovery replay remains pending:',
        result.recoveryOperationId,
        result.failure,
      );
      return;
    case 'discarded':
      console.warn(
        '[SeamsWeb] pending wallet recovery was refused and discarded:',
        result.recoveryOperationId,
      );
      return;
    case 'corrupt':
      console.warn(
        '[SeamsWeb] pending wallet recovery replay record is corrupt:',
        result.recoveryOperationId,
      );
      return;
  }
}

type SeamsWebDeviceDomain = {
  readonly domain: DevicesCapabilityDomainMethods;
  readonly resumePendingAcknowledgementsV1: () => Promise<void>;
  readonly dispose: () => void;
};

type SeamsWebContextWithDeviceLinkingResumeV1 = SeamsWebContext & {
  readonly resumePendingAcknowledgementsV1: () => void;
};

function createApplicationDeviceDomain(
  walletIframe: WalletIframeCoordinator,
): SeamsWebDeviceDomain {
  return {
    domain: {
      kind: 'iframe',
      linkedDeviceManagement: createWalletIframeLinkedDeviceManagementPortV1({ walletIframe }),
    },
    resumePendingAcknowledgementsV1: noopDeviceLinkingAcknowledgementResumeV1,
    dispose: noopDeviceLinkingDisposeV1,
  };
}

function noopDeviceLinkingDisposeV1(): void {}

async function noopDeviceLinkingAcknowledgementResumeV1(): Promise<void> {}

function resumeDeviceLinkingAcknowledgementsInBackgroundV1(resume: () => Promise<void>): void {
  void resume().catch(reportDeviceLinkingAcknowledgementResumeFailureV1);
}

function reportDeviceLinkingAcknowledgementResumeFailureV1(error: unknown): void {
  console.warn(
    '[SeamsWeb] pending linked-device acknowledgement replay failed:',
    error instanceof Error ? error.message : String(error || 'unknown error'),
  );
}

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
  private readonly prefillRestoredSession: RestoredSessionPresignaturePrefill;
  private readonly lifecycleEventSource: SeamsWebLifecycleEventSource;
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
  private readonly deviceLinkingDispose: () => void;
  private readonly resumePendingAcknowledgementsV1: () => Promise<void>;
  private emailOtpUnlockPrewarmRecord: EmailOtpUnlockPrewarmRecord = { kind: 'none' };

  constructor(
    configs: SeamsConfigsInput,
    nearClient?: NearClient,
    internalOptions?: SeamsWebInternalOptions,
  ) {
    this.configs = buildConfigsFromEnv(configs, {
      ...(internalOptions?.kind === 'wallet_host' ? { allowDirectWalletMode: 'wallet_host' } : {}),
    });
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
      getAppearance: () => this.appearance,
    });
    const runtimeMode = resolveSeamsWebRuntimeMode(internalOptions);
    const deviceDomain =
      runtimeMode === 'wallet_host'
        ? createWalletHostDeviceDomain({
            configs: this.configs,
            signingEngine: browserSigningSurface,
          })
        : createApplicationDeviceDomain(this.walletIframe);
    this.deviceLinkingDispose = deviceDomain.dispose;
    this.resumePendingAcknowledgementsV1 = deviceDomain.resumePendingAcknowledgementsV1;
    this.lifecycleEventSource = resolveSeamsWebLifecycleEventSource({
      mode: runtimeMode,
      signingEngine: this.signingEngine,
      walletIframe: this.walletIframe,
    });
    const registrationCommands =
      runtimeMode === 'wallet_host'
        ? createWalletHostRegistrationCommands(this.getContext.bind(this))
        : createApplicationRegistrationCommands(this.walletIframe);
    const sessionCommands =
      runtimeMode === 'wallet_host'
        ? createWalletHostSessionCommands(this.getContext.bind(this))
        : createApplicationSessionCommands(this.walletIframe);
    this.prefillRestoredSession =
      runtimeMode === 'wallet_host'
        ? prefillWalletHostPresignatures.bind(null, this.getContext.bind(this))
        : sessionCommands.prefillRouterAbEcdsaDerivationPresignaturePool;
    const emailOtpCommands =
      runtimeMode === 'wallet_host'
        ? createWalletHostEmailOtpCommands({
            getContext: this.getContext.bind(this),
            getPrewarmRecord: this.getEmailOtpUnlockPrewarmRecord.bind(this),
            registerWallet: registrationCommands.registerWallet,
            getWalletSession: sessionCommands.getWalletSession,
            resumePendingAcknowledgements:
              this.resumePendingAcknowledgementsAfterExactUnlockV1.bind(this),
          })
        : createApplicationEmailOtpCommands(
            this.walletIframe,
            this.getEmailOtpUnlockPrewarmRecord.bind(this),
          );
    const publicApi = createPublicApi({
      signingEngine: this.signingEngine,
      nearClient: this.nearClient,
      configs: this.configs,
      getTheme: () => this.theme,
      userPreferences,
      getWalletIframe: () => this.walletIframe,
      auth: {
        ...sessionCommands,
        ...emailOtpCommands.auth,
      },
      registration: {
        ...registrationCommands,
        ...emailOtpCommands.registration,
        onNearProvisioningStateChanged: (listener) =>
          subscribeToSeamsWebLifecycleEvents(
            this.lifecycleEventSource,
            deliverNearProvisioningStateChanged.bind(null, listener),
          ),
        registerPasskey: async (options) => await this.registerPasskeyDomain(options),
      },
      recovery: {
        getWalletRecoveryCodeStatus: async (args) =>
          await this.getWalletRecoveryCodeStatusDomain(args),
        acknowledgeWalletRecoveryCodeBackup: async (args) =>
          await this.acknowledgeWalletRecoveryCodeBackupDomain(args),
        requestWalletCustodyEmailOtpChallenge: async (args) =>
          await this.requestWalletCustodyEmailOtpChallengeDomain(args),
        rotateWalletRecoveryCodes: async (args) => await this.rotateWalletRecoveryCodesDomain(args),
      },
      devices: {
        ...deviceDomain.domain,
      },
      keys: {
        resolveExactKeyExportLane: async (input) =>
          await this.resolveExactKeyExportLaneDomain(input),
        exportKeypairWithUI: async (input) => await this.exportKeypairWithUIDomain(input),
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

    void this.resumePendingRegistrationOnStartup();
    resumeDeviceLinkingAcknowledgementsInBackgroundV1(deviceDomain.resumePendingAcknowledgementsV1);

    // UserConfirm worker initializes automatically in the constructor
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

  /** @internal One wallet-host restore owns all configured-chain prefills. */
  async prefillRestoredWalletSession(state: WalletIframeExactSessionState): Promise<void> {
    await scheduleRestoredSessionPresignaturePrefills({
      state,
      chainTargets: this.configuredChainTargets(),
      prefill: this.prefillRestoredSession,
    });
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
    return subscribeToSeamsWebLifecycleEvents(this.lifecycleEventSource, listener);
  }

  /** Subscribe to wallet-host preference updates. */
  onWalletIframePreferencesChanged(
    listener: (payload: PreferencesChangedPayload) => void,
  ): () => void {
    return this.walletIframeControls.onWalletIframePreferencesChanged(listener);
  }

  getContext(): SeamsWebContextWithDeviceLinkingResumeV1 {
    return {
      signingEngine: this.signingEngine,
      nearClient: this.nearClient,
      configs: this.configs,
      theme: this.theme,
      resumePendingAcknowledgementsV1:
        this.resumePendingAcknowledgementsAfterExactUnlockV1.bind(this),
    };
  }

  private resumePendingAcknowledgementsAfterExactUnlockV1(): void {
    resumeDeviceLinkingAcknowledgementsInBackgroundV1(this.resumePendingAcknowledgementsV1);
  }

  private async resumePendingRegistrationOnStartup(): Promise<void> {
    if (IndexedDBManager.isDisabled()) return;
    const relayerUrl = String(this.configs.network.relayer?.url || '').trim();
    if (!relayerUrl) return;
    try {
      const results = await resumePendingNearRegistrations({ relayerUrl });
      for (const result of results) {
        if (result.kind === 'failed') {
          console.warn(
            '[SeamsWeb] pending registration replay remains pending:',
            result.registrationCeremonyId,
            result.error,
          );
        }
      }
    } catch (error: unknown) {
      console.warn(
        '[SeamsWeb] pending registration startup replay failed:',
        error instanceof Error ? error.message : String(error || 'unknown error'),
      );
    }
    try {
      const recoveryResults = await resumePendingWalletRecoveries({
        relayUrl: relayerUrl,
      });
      for (const result of recoveryResults) reportWalletRecoveryStartupResult(result);
    } catch (error: unknown) {
      console.warn(
        '[SeamsWeb] pending wallet recovery startup replay failed:',
        error instanceof Error ? error.message : String(error || 'unknown error'),
      );
    }
  }

  dispose(): void {
    this.deviceLinkingDispose();
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
    if (__isWalletIframeHostMode()) {
      try {
        document.documentElement.setAttribute('data-seams-theme', this.theme);
      } catch {}
    }

    if (this.walletIframe.shouldUseWalletIframe()) {
      void (async () => {
        try {
          const router = await this.walletIframe.requireRouter();
          await router.setAppearance(normalizedAppearance);
        } catch {}
      })();
    }
  }

  setWalletIframeSurfaceMeasurementBinding(binding: UiConfirmSurfaceMeasurementBinding): void {
    this.signingEngine.setWalletIframeSurfaceMeasurementBinding(binding);
  }

  /**
   * Pre-warm resources on a best-effort basis without changing visible state.
   * - When iframe=true, initializes the wallet iframe client.
   * - When workers=true, warms local critical resources only outside app-origin iframe mode.
   * - When both are false/omitted, does nothing.
   */
  async prewarm(opts?: SeamsWebPrewarmOptions): Promise<void> {
    const iframe = !!opts?.iframe;
    const workers = !!opts?.workers;
    const nearAccountBinding = resolvePrewarmNearAccountBinding(opts);
    const prewarmRequest = emailOtpUnlockPrewarmRequestFromOptions(opts);
    const prewarmScope = emailOtpUnlockPrewarmScopeFromBinding(nearAccountBinding);

    const tasks: Promise<unknown>[] = [];

    if (iframe) {
      // initWalletIframe also calls the browser signing surface warmup internally.
      tasks.push(this.initWalletIframe(nearAccountBinding?.wallet.walletId));
    } else if (workers && !this.walletIframe.shouldUseWalletIframe()) {
      // Warm local-only resources without touching the iframe.
      const accountContext = nearAccountBinding
        ? { kind: 'near_account_bound' as const, account: nearAccountBinding }
        : { kind: 'none' as const };
      tasks.push(this.signingEngine.warmCriticalResources(accountContext));
    }

    if (tasks.length === 0) return;
    let status: Extract<EmailOtpUnlockPrewarmRecord, { kind: 'attempted' }>['status'] = 'succeeded';
    try {
      await Promise.all(tasks);
    } catch {
      status = 'failed';
      // Best-effort: swallow errors so prewarm never breaks app flows
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
    const relayUrl = String(this.configs.network.relayer.url || '').trim();
    if (this.walletIframe.shouldUseWalletIframe()) {
      const router = await this.walletIframe.requireRouter(args.walletId);
      return await router.getWalletRecoveryCodeStatus({
        walletId: args.walletId,
      });
    }
    const status = await readWalletRecoveryCodeStatus({
      relayUrl,
      walletId: args.walletId,
    });
    return status.kind === 'ready'
      ? {
          ...status,
          pendingLocalBackup: await pendingWalletRecoveryCodeBackupRepository.has(args.walletId),
        }
      : status;
  }

  private async acknowledgeWalletRecoveryCodeBackupDomain(args: { walletId: string }) {
    const relayUrl = String(this.configs.network.relayer.url || '').trim();
    if (this.walletIframe.shouldUseWalletIframe()) {
      const router = await this.walletIframe.requireTransportRouter();
      return await router.acknowledgeWalletRecoveryCodeBackup({
        walletId: args.walletId,
      });
    }
    const acknowledgement = await showWalletRecoveryCodesUi(
      {
        walletId: args.walletId,
        loadStatus: this.getWalletRecoveryCodeStatusDomain.bind(this, args),
        loadPendingBackup: this.loadPendingWalletRecoveryCodeBackupRequest.bind(
          this,
          args.walletId,
        ),
      },
      this.signingEngine.getWalletIframeSurfaceMeasurementBinding(),
      { appearance: this.appearance },
    );
    if (acknowledgement.kind !== 'wallet_recovery_codes_backed_up_v1') {
      throw new Error('Pending wallet recovery-code backup was not completed');
    }
    const result = await acknowledgeWalletRecoveryBackup({
      relayUrl,
      walletId: args.walletId,
    });
    if (result.kind === 'acknowledged') {
      await pendingWalletRecoveryCodeBackupRepository.delete(args.walletId);
    }
    return result;
  }

  private async loadPendingWalletRecoveryCodeBackupRequest(
    walletId: string,
  ): Promise<WalletRecoveryCodeBackupRequestV1 | null> {
    const pending = await pendingWalletRecoveryCodeBackupRepository.read(walletId);
    return pending
      ? {
          kind: 'wallet_recovery_code_backup_request_v1',
          walletId: pending.walletId,
          recoveryCodes: pending.recoveryCodes,
          continuation: 'pending_backup_must_finish',
        }
      : null;
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
    const relayUrl = String(this.configs.network.relayer.url || '').trim();
    if (this.walletIframe.shouldUseWalletIframe()) {
      const router = await this.walletIframe.requireRouter(args.walletId);
      return await router.rotateWalletRecoveryCodes(args);
    }
    return await rotateWalletRecoveryCodes({
      context: this.getContext(),
      relayUrl,
      walletId: args.walletId,
      authorization: args.authorization,
    });
  }

  ///////////////////////////////////////
  // === User Settings ===
  ///////////////////////////////////////

  /**
   * Prefetch latest block height/hash (and nonce if context missing) to reduce
   * perceived latency when the user initiates a signing flow.
   */
  async prefetchBlockheight(): Promise<void> {
    if (this.walletIframe.shouldUseWalletIframe()) {
      const router = await this.walletIframe.requireRouter();
      await router.prefetchBlockheight();
      return;
    }
    try {
      await this.signingEngine.getNonceCoordinator().prefetchNearContext({
        kind: 'initialized_state',
        nearClient: this.nearClient,
      });
    } catch {}
  }

  /** Wallet-host entrypoint for the exact FeeManager preference operation. */
  async signTempoFeeTokenPreferenceInternal(args: {
    walletSession: WalletSessionRef;
    request: TempoFeeTokenPreferenceSigningRequest;
    chainTarget: TempoChainTarget;
    confirmationConfigOverride?: Partial<ConfirmationConfig>;
    shouldAbort?: () => boolean;
    onEvent?: (event: SigningFlowEvent) => void;
  }): Promise<EvmSignedResult> {
    if (!__isWalletIframeHostMode()) {
      throw new Error('[SeamsWeb][tempo] fee-token preference signing requires wallet-host mode');
    }
    const request = requireTempoFeeTokenPreferenceSigningRequest(args);
    const result = await this.signingEngine.signEvmFamily({
      ...args,
      request,
    });
    if (result.chain !== 'evm' || result.kind !== 'eip1559') {
      throw new Error(`[SeamsWeb][tempo] expected EVM FeeManager result, received ${result.chain}`);
    }
    return result;
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

    if (this.walletIframe.shouldUseWalletIframe()) {
      const router = await this.walletIframe.requireRouter(routerAccountId);
      const result = await router.resolveExactKeyExportLane(resolvedInput);
      return normalizeResolveExactKeyExportLaneResult(result);
    }

    const result = await this.signingEngine.resolveExactKeyExportLane(resolvedInput);
    return normalizeResolveExactKeyExportLaneResult(result);
  }

  private async exportKeypairWithUIDomain(
    input: SigningEngineExportKeypairWithUIInput,
  ): Promise<void> {
    const resolvedInput = normalizeExportKeypairWithUIInput(input, this.theme);
    const routerAccountId = String(resolvedInput.walletSession.walletId || '').trim();
    if (!routerAccountId) {
      throw new Error('[SeamsWeb] key export requires wallet session user context');
    }

    if (this.walletIframe.shouldUseWalletIframe()) {
      const router = await this.walletIframe.requireRouter(routerAccountId);
      await router.exportKeypairWithUI(resolvedInput);
      return;
    }

    await this.signingEngine.exportKeypairWithUI(resolvedInput);
  }
}

import { clearHostedWalletSessions } from './hostedWalletSeamsSession';
import { createWalletHostPlacementCommands } from './createPlacementCommands';
import type { WalletPlacementCapability } from '@/SeamsWeb/publicApi/placement';
import { createBrowserHostPlatformRuntime } from '@/SeamsWeb/assembly/createBrowserSigningRuntime';
import { createWalletHostOwnerAuthoritiesV1 } from '@/SeamsWeb/operations/devices/walletHostOwnerAuthority';
import { walletSessionAuthorizations } from '@/core/indexedDB/seamsWalletDB/walletSessionAuthorizationStore';
import { readUnlockedEd25519ExportRootLinkingCapabilityV1 } from '@/core/signingEngine/walletCustody/unlockedEd25519ExportRootCapability';
import {
  requireKeyExportCapability,
  type KeyExportDomainMethods,
} from '@/SeamsWeb/publicApi/keyExport';
import type { WalletAuthCommands } from '@/SeamsWeb/publicApi/auth';
import type { UserPreferencesManager } from '@/core/signingEngine/session/userPreferences';
import { syncAccount } from '@/SeamsWeb/operations/recovery/syncAccount';
import { createWalletHostNearCommands } from '@/SeamsWeb/walletIframe/host/createNearCommands';
import { createWalletHostEvmFamilyCommands } from '@/SeamsWeb/walletIframe/host/createEvmFamilyCommands';
import { resolvePrimaryNearRpcUrl } from '@/core/config/chains';
import type { WalletHostConfig } from '../shared/configuration';
import { IndexedDBManager, configureIndexedDB } from '@/core/indexedDB';
import { pendingWalletRecoveryCodeBackupRepository } from '@/core/indexedDB/seamsWalletDB/pendingWalletRecoveryCodeBackup';
import type { TempoChainTarget } from '@/core/platform/types';
import { MinimalNearClient, type NearClient } from '@/core/rpcClients/near/NearClient';
import { requestWalletCustodyEmailOtpChallenge } from '@/core/rpcClients/relayer/walletRecoveryRotate';
import {
  acknowledgeWalletRecoveryBackupWithEmailOtp,
  acknowledgeWalletRecoveryBackupWithPasskey,
  readWalletRecoveryCodeStatusWithEmailOtp,
  readWalletRecoveryCodeStatusWithPasskey,
} from '@/SeamsWeb/operations/recovery/walletRecoveryAdminProof';
import type { EvmSignedResult } from '@/core/signingEngine/chains/evm/evmAdapter';
import {
  requireTempoFeeTokenPreferenceSigningRequest,
  type TempoFeeTokenPreferenceSigningRequest,
} from '@/core/signingEngine/chains/tempo/feeToken';
import type { SigningEngineExportKeypairWithUIInput } from '@/core/signingEngine/flows/recovery/public';
import {
  configuredThresholdEcdsaChainTargets,
  type ThresholdEcdsaChainTarget,
  type WalletSessionRef,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { UiConfirmSurfaceMeasurementBinding } from '@/core/signingEngine/uiConfirm/uiConfirm.types';
import type {
  SdkLifecycleEventListener,
  SigningFlowEvent,
  WalletRecoveryCodeBackupRequestV1,
} from '@/core/types/sdkSentEvents';
import type {
  AppearanceConfig,
  AppearanceConfigInput,
  ThemeMode,
} from '@/core/types/seams';
import type { ConfirmationConfig } from '@/core/types/signer-worker';
import { createBrowserSigningRuntime } from '@/SeamsWeb/assembly/createBrowserSigningRuntime';
import { createBrowserSigningStores } from '@/SeamsWeb/assembly/createBrowserSigningStores';
import { initializeBrowserSigningRuntime } from '@/SeamsWeb/assembly/initializeBrowserSigningRuntime';
import { showWalletRecoveryCodesUi } from '@/SeamsWeb/operations/recovery/walletRecoveryCodeBackup';
import {
  resumePendingWalletRecoveries,
  type WalletRecoveryResumeResult,
} from '@/SeamsWeb/operations/recovery/walletRecoveryCommit';
import { rotateWalletRecoveryCodes } from '@/SeamsWeb/operations/recovery/walletRecoveryRotation';
import { resumePendingNearRegistrations } from '@/SeamsWeb/operations/registration/pendingRegistrationRecovery';
import { createPublicApi } from '@/SeamsWeb/publicApi';
import {
  resolveConfiguredChainTarget,
  type EcdsaChainSelector,
} from '@/SeamsWeb/publicApi/chainTargets';
import { BrowserSigningSurface } from '@/SeamsWeb/signingSurface/BrowserSigningSurface';
import type {
  DevicesCapability,
  EvmSignerCapability,
  NearSignerCapability,
  PreferencesCapability,
  RecoveryCapability,
  RegistrationCapability,
  SeamsWebContext,
  SeamsWebSigningSurface,
  TempoSignerCapability,
} from '@/SeamsWeb/signingSurface/types';
import { createWalletHostDeviceDomain } from '@/SeamsWeb/walletIframe/host/createDeviceDomain';
import { createWalletHostEmailOtpCommands } from '@/SeamsWeb/walletIframe/host/createEmailOtpCommands';
import { createWalletHostRegistrationCommands } from '@/SeamsWeb/walletIframe/host/createRegistrationCommands';
import {
  createWalletHostSessionCommands,
  prefillWalletHostPresignatures,
} from '@/SeamsWeb/walletIframe/host/createSessionCommands';
import {
  scheduleRestoredSessionPresignaturePrefills,
  type RestoredSessionPresignaturePrefill,
} from '@/SeamsWeb/walletIframe/host/restoredSessionPresignaturePrefill';
import { type WalletIframeExactSessionState } from '@/SeamsWeb/walletIframe/shared/exactSessionState';
import {
  deliverNearProvisioningStateChanged,
  normalizeExportKeypairWithUIInput,
  normalizeResolveExactKeyExportLaneInput,
  normalizeResolveExactKeyExportLaneResult,
  resolveRuntimeAppearance,
} from '@/SeamsWeb/walletIframe/shared/facadeBoundary';
import { walletIdFromString } from '@shared/utils/registrationIds';
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
type SeamsWebContextWithDeviceLinkingResumeV1 = SeamsWebContext & {
  readonly resumePendingAcknowledgementsV1: () => void;
};
function resumeDeviceLinkingAcknowledgementsInBackgroundV1(resume: () => Promise<void>): void {
  void resume().catch(reportDeviceLinkingAcknowledgementResumeFailureV1);
}
function reportDeviceLinkingAcknowledgementResumeFailureV1(error: unknown): void {
  console.warn(
    '[SeamsWeb] pending linked-device acknowledgement replay failed:',
    error instanceof Error ? error.message : String(error || 'unknown error'),
  );
}
/** Owns wallet-origin execution and durable signing state. */
export class WalletHostRuntime {
  private readonly signingEngine: SeamsWebSigningSurface;
  private readonly nearClient: NearClient;
  readonly configs: WalletHostConfig;
  private appearance: AppearanceConfig;
  theme: ThemeMode;
  private readonly prefillRestoredSession: RestoredSessionPresignaturePrefill;
  readonly recovery: RecoveryCapability;
  readonly devices: DevicesCapability;
  readonly keys: KeyExportDomainMethods;
  readonly preferences: Omit<
    PreferencesCapability,
    'setConfirmationConfig' | 'setConfirmationBehavior' | 'onCurrentWalletChange'
  > &
    Pick<
      UserPreferencesManager,
      'setConfirmationConfig' | 'setConfirmationBehavior' | 'onCurrentWalletChange'
    >;
  readonly auth: WalletAuthCommands;
  readonly placement: WalletPlacementCapability;
  readonly registration: RegistrationCapability;
  readonly near: NearSignerCapability;
  readonly tempo: TempoSignerCapability;
  readonly evm: EvmSignerCapability;
  private readonly deviceLinkingDispose: () => void;
  private readonly resumePendingAcknowledgementsV1: () => Promise<void>;
  constructor(configs: WalletHostConfig, nearClient?: NearClient) {
    this.configs = configs;
    configureIndexedDB({ mode: 'wallet' });
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
      shouldPrewarmUiConfirmUi: shouldPrewarmBrowserUi,
    });
    this.signingEngine = browserSigningSurface;
    this.appearance = this.configs.ui.appearance;
    this.theme = this.appearance.theme.mode;
    try {
      this.signingEngine.setAppearance(this.appearance);
    } catch {}
    const userPreferences = this.signingEngine.getUserPreferences();
    const platform = createBrowserHostPlatformRuntime(browserSigningSurface.getSignerWorkerContext());
    const ownerAuthorities = createWalletHostOwnerAuthoritiesV1({
      http: platform.http,
      relayerUrl: String(this.configs.network.relayer?.url || '').trim(),
      walletSessions: walletSessionAuthorizations,
      resolveSelectedWalletAuthority:
        IndexedDBManager.resolveSelectedWalletAuthority.bind(IndexedDBManager),
      readWalletAuthenticationState:
        browserSigningSurface.readWalletAuthenticationState.bind(browserSigningSurface),
      readUnlockedEd25519ExportRootCapabilityV1: readUnlockedEd25519ExportRootLinkingCapabilityV1,
    });
    this.placement = createWalletHostPlacementCommands({
      lockWallet: this.lockAfterWalletMove.bind(this),
      signingEngine: browserSigningSurface,
      managementRequest: ownerAuthorities.managementRequest,
      readAuthentication:
        browserSigningSurface.readWalletAuthenticationState.bind(browserSigningSurface),
    });
    const deviceDomain = createWalletHostDeviceDomain({
      platform,
      ownerAuthorities,
      configs: this.configs,
      signingEngine: browserSigningSurface,
      getContext: this.getContext.bind(this),
    });
    this.deviceLinkingDispose = deviceDomain.dispose;
    this.resumePendingAcknowledgementsV1 = deviceDomain.resumePendingAcknowledgementsV1;
    const registrationCommands = createWalletHostRegistrationCommands(this.getContext.bind(this));
    const sessionCommands = createWalletHostSessionCommands(this.getContext.bind(this));
    this.prefillRestoredSession = prefillWalletHostPresignatures.bind(
      null,
      this.getContext.bind(this),
    );
    const emailOtpCommands = createWalletHostEmailOtpCommands({
      getContext: this.getContext.bind(this),
      registerWallet: registrationCommands.registerWallet,
      getWalletSession: sessionCommands.getSession,
      resumePendingAcknowledgements:
        this.resumePendingAcknowledgementsAfterExactUnlockV1.bind(this),
    });
    const hostPreferences = {
      flush: flushHostPreferenceProjection,
      setCurrentWallet: userPreferences.setCurrentWallet.bind(userPreferences),
      getCurrentWalletId: userPreferences.getCurrentWalletId.bind(userPreferences),
      onConfirmationConfigChange: userPreferences.onConfirmationConfigChange.bind(userPreferences),
      onCurrentWalletChange: userPreferences.onCurrentWalletChange.bind(userPreferences),
      setConfirmationBehavior: userPreferences.setConfirmationBehavior.bind(userPreferences),
      setConfirmationConfig: userPreferences.setConfirmationConfig.bind(userPreferences),
      getConfirmationConfig: userPreferences.getConfirmationConfig.bind(userPreferences),
    };
    const keyExport: KeyExportDomainMethods = {
      resolveExactKeyExportLane: this.resolveExactKeyExportLaneDomain.bind(this),
      exportKeypairWithUI: this.exportKeypairWithUIDomain.bind(this),
    };
    const publicApi = createPublicApi({
      createNearCommands: createWalletHostNearCommands.bind(null, this.getContext.bind(this)),
      createEvmFamilyCommands: createWalletHostEvmFamilyCommands.bind(
        null,
        this.getContext.bind(this),
      ),
      nearClient: this.nearClient,
      configs: this.configs,
      preferences: hostPreferences,
      auth: {
        ...sessionCommands,
        ...emailOtpCommands,
      },
      registration: {
        ...registrationCommands,
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
        ...deviceDomain.domain,
      },
      keys: keyExport,
    });
    this.preferences = hostPreferences;
    this.auth = publicApi.auth;
    this.registration = publicApi.registration;
    this.recovery = publicApi.recovery;
    this.devices = publicApi.devices;
    this.keys = keyExport;
    this.near = publicApi.near;
    this.tempo = publicApi.tempo;
    this.evm = publicApi.evm;
    void this.resumePendingRegistrationOnStartup();
    resumeDeviceLinkingAcknowledgementsInBackgroundV1(deviceDomain.resumePendingAcknowledgementsV1);
  }
  /** @internal One wallet-host restore owns all configured-chain prefills. */
  async prefillRestoredWalletSession(state: WalletIframeExactSessionState): Promise<void> {
    await scheduleRestoredSessionPresignaturePrefills({
      state,
      chainTargets: this.configuredChainTargets(),
      prefill: this.prefillRestoredSession,
    });
  }
  private async lockAfterWalletMove(): Promise<void> {
    clearHostedWalletSessions();
    await this.auth.lock();
  }

  /** Subscribe to typed lifecycle events emitted by the wallet boundary. */
  onSdkLifecycleEvent(listener: SdkLifecycleEventListener): () => void {
    return this.signingEngine.onSdkLifecycleEvent(listener);
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
   * @example seams.config.chainTarget('tempo-testnet')
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
    try {
      document.documentElement.setAttribute('data-seams-theme', this.theme);
    } catch {}
  }
  setWalletIframeSurfaceMeasurementBinding(binding: UiConfirmSurfaceMeasurementBinding): void {
    this.signingEngine.setWalletIframeSurfaceMeasurementBinding(binding);
  }
  private async syncAccountDomain(
    args: Parameters<RecoveryCapability['syncAccount']>[0],
  ): ReturnType<RecoveryCapability['syncAccount']> {
    const walletId = args.walletId ? walletIdFromString(args.walletId) : null;
    return await syncAccount(this.getContext(), walletId ? String(walletId) : null, args.options);
  }

  private onNearAccountChange(
    listener: Parameters<RegistrationCapability['onNearAccountChange']>[0],
  ): () => void {
    return this.onSdkLifecycleEvent(deliverNearProvisioningStateChanged.bind(null, listener));
  }

  private async getCodeStatusDomain(args: Parameters<RecoveryCapability['getCodeStatus']>[0]) {
    const relayUrl = String(this.configs.network.relayer.url || '').trim();
    const status =
      args.authorization.kind === 'passkey'
        ? await readWalletRecoveryCodeStatusWithPasskey({
            relayUrl,
            walletId: args.walletId,
            rpId: this.configs.wallet.rpId,
          })
        : await readWalletRecoveryCodeStatusWithEmailOtp({
            context: this.getContext(),
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
  private async preloadedCodeStatusDomain(
    status: Awaited<ReturnType<RecoveryCapability['getCodeStatus']>>,
  ): ReturnType<RecoveryCapability['getCodeStatus']> {
    return status;
  }
  private async confirmBackupDomain(args: Parameters<RecoveryCapability['confirmBackup']>[0]) {
    const relayUrl = String(this.configs.network.relayer.url || '').trim();
    let loadStatus: () => ReturnType<RecoveryCapability['getCodeStatus']> =
      this.getCodeStatusDomain.bind(this, args);
    if (args.authorization.kind === 'email_otp') {
      const status = await loadStatus();
      if (status.kind !== 'ready') throw new Error(status.message);
      loadStatus = this.preloadedCodeStatusDomain.bind(this, status);
    }
    const acknowledgement = await showWalletRecoveryCodesUi(
      {
        walletId: args.walletId,
        loadStatus,
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
    const result =
      args.authorization.kind === 'passkey'
        ? await acknowledgeWalletRecoveryBackupWithPasskey({
            relayUrl,
            walletId: args.walletId,
            rpId: this.configs.wallet.rpId,
            expectedIssuedAtMs: acknowledgement.issuedAtMs,
          })
        : await acknowledgeWalletRecoveryBackupWithEmailOtp({
            context: this.getContext(),
            relayUrl,
            walletId: args.walletId,
            expectedIssuedAtMs: acknowledgement.issuedAtMs,
          });
    if (result.kind === 'acknowledged') {
      await pendingWalletRecoveryCodeBackupRepository.deleteIssuedAtMs(
        args.walletId,
        acknowledgement.issuedAtMs,
      );
    }
    return result;
  }
  private async loadPendingWalletRecoveryCodeBackupRequest(
    walletId: string,
  ): Promise<WalletRecoveryCodeBackupRequestV1 | null> {
    const pending = await pendingWalletRecoveryCodeBackupRepository.read(walletId);
    if (!pending) return null;
    if (pending.kind !== 'ready') {
      throw new Error('Recovery codes are awaiting a verified server issuance. Retry registration.');
    }
    return {
      kind: 'wallet_recovery_code_backup_request_v1',
      walletId: pending.walletId,
      recoveryCodes: pending.recoveryCodes,
      continuation: 'pending_backup_must_finish',
      issuedAtMs: pending.issuedAtMs,
    };
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
    const relayUrl = String(this.configs.network.relayer.url || '').trim();
    return await rotateWalletRecoveryCodes({
      context: this.getContext(),
      relayUrl,
      walletId: args.walletId,
      authorization: args.authorization,
    });
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
    input: Parameters<KeyExportDomainMethods['resolveExactKeyExportLane']>[0],
  ): Promise<Awaited<ReturnType<KeyExportDomainMethods['resolveExactKeyExportLane']>>> {
    const resolvedInput = normalizeResolveExactKeyExportLaneInput(input);
    requireKeyExportCapability(this.configs, resolvedInput);
    const routerAccountId = String(resolvedInput.walletSession.walletId || '').trim();
    if (!routerAccountId) {
      throw new Error('[SeamsWeb] key export lane resolution requires wallet session context');
    }
    const result = await this.signingEngine.resolveExactKeyExportLane(resolvedInput);
    return normalizeResolveExactKeyExportLaneResult(result);
  }
  private async exportKeypairWithUIDomain(
    input: SigningEngineExportKeypairWithUIInput,
  ): Promise<void> {
    const resolvedInput = normalizeExportKeypairWithUIInput(input, this.theme);
    requireKeyExportCapability(this.configs, resolvedInput);
    const routerAccountId = String(resolvedInput.walletSession.walletId || '').trim();
    if (!routerAccountId) {
      throw new Error('[SeamsWeb] key export requires wallet session user context');
    }
    await this.signingEngine.exportKeypairWithUI(resolvedInput);
  }
}

async function flushHostPreferenceProjection(): Promise<void> {}

function shouldPrewarmBrowserUi(workerBaseOrigin: string): boolean {
  if (typeof window === 'undefined' || typeof window.Worker === 'undefined') return false;
  if (workerBaseOrigin && workerBaseOrigin !== window.location.origin) return false;
  return true;
}

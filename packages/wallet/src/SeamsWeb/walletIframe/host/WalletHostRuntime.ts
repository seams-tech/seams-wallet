import { syncAccount } from '@/SeamsWeb/operations/recovery/syncAccount';
import { createWalletHostNearCommands } from '@/SeamsWeb/walletIframe/host/createNearCommands';
import { createWalletHostEvmFamilyCommands } from '@/SeamsWeb/walletIframe/host/createEvmFamilyCommands';
import { resolvePrimaryNearRpcUrl } from '@/core/config/chains';
import { buildConfigsFromEnv } from '@/core/config/defaultConfigs';
import { IndexedDBManager } from '@/core/indexedDB';
import { pendingWalletRecoveryCodeBackupRepository } from '@/core/indexedDB/seamsWalletDB/pendingWalletRecoveryCodeBackup';
import type { TempoChainTarget } from '@/core/platform/types';
import { MinimalNearClient, type NearClient } from '@/core/rpcClients/near/NearClient';
import {
  acknowledgeWalletRecoveryBackup,
  readWalletRecoveryCodeStatus,
  requestWalletCustodyEmailOtpChallenge,
} from '@/core/rpcClients/relayer/walletRecoveryRotate';
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
  RegistrationResult,
  SeamsConfigsInput,
  SeamsConfigsReadonly,
  ThemeMode,
} from '@/core/types/seams';
import type { ConfirmationConfig } from '@/core/types/signer-worker';
import { resolveBrowserWorkerWarmupPolicy } from '@/SeamsWeb/assembly/browserWorkerWarmupPolicy';
import { configureBrowserIndexedDB } from '@/SeamsWeb/assembly/configureBrowserIndexedDB';
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
import {
  buildNearWalletRegistrationSignerSetSelection,
  resolvePasskeyRegistrationAccountProvisioning,
} from '@/SeamsWeb/operations/registration/registrationSignerSet';
import { createPublicApi } from '@/SeamsWeb/publicApi';
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
import { WalletIframeCoordinator } from '@/SeamsWeb/walletIframe/coordinator';
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
import type {
  EmailOtpUnlockPrewarmRecord,
  EmailOtpUnlockPrewarmStatus,
} from '@/SeamsWeb/walletIframe/shared/emailOtpLifecycle';
import { type WalletIframeExactSessionState } from '@/SeamsWeb/walletIframe/shared/exactSessionState';
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
import { createServerAllocatedWalletId, walletIdFromString } from '@shared/utils/registrationIds';
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
  readonly configs: SeamsConfigsReadonly;
  private appearance: AppearanceConfig;
  theme: ThemeMode;
  private readonly walletIframe: WalletIframeCoordinator;
  private readonly prefillRestoredSession: RestoredSessionPresignaturePrefill;
  readonly recovery: RecoveryCapability;
  readonly devices: DevicesCapability;
  readonly keys: KeyExportCapability;
  readonly preferences: PreferencesCapability;
  readonly auth: AuthCapability;
  readonly registration: RegistrationCapability;
  readonly near: NearSignerCapability;
  readonly tempo: TempoSignerCapability;
  readonly evm: EvmSignerCapability;
  private readonly deviceLinkingDispose: () => void;
  private readonly resumePendingAcknowledgementsV1: () => Promise<void>;
  private emailOtpUnlockPrewarmRecord: EmailOtpUnlockPrewarmRecord = { kind: 'none' };
  constructor(configs: SeamsConfigsInput, nearClient?: NearClient) {
    this.configs = buildConfigsFromEnv(configs, {
      allowDirectWalletMode: 'wallet_host',
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
      getAppearance: this.getAppearance.bind(this),
    });
    const deviceDomain = createWalletHostDeviceDomain({
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
      getPrewarmRecord: this.getEmailOtpUnlockPrewarmRecord.bind(this),
      registerWallet: registrationCommands.registerWallet,
      getWalletSession: sessionCommands.getWalletSession,
      resumePendingAcknowledgements:
        this.resumePendingAcknowledgementsAfterExactUnlockV1.bind(this),
    });
    const publicApi = createPublicApi({
      createNearCommands: createWalletHostNearCommands.bind(null, this.getContext.bind(this)),
      createEvmFamilyCommands: createWalletHostEvmFamilyCommands.bind(
        null,
        this.getContext.bind(this),
      ),
      nearClient: this.nearClient,
      configs: this.configs,
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
        syncAccount: this.syncAccountDomain.bind(this),
        getWalletRecoveryCodeStatus: this.getWalletRecoveryCodeStatusDomain.bind(this),
        acknowledgeWalletRecoveryCodeBackup:
          this.acknowledgeWalletRecoveryCodeBackupDomain.bind(this),
        requestWalletCustodyEmailOtpChallenge:
          this.requestWalletCustodyEmailOtpChallengeDomain.bind(this),
        rotateWalletRecoveryCodes: this.rotateWalletRecoveryCodesDomain.bind(this),
      },
      devices: {
        ...deviceDomain.domain,
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
    try {
      document.documentElement.setAttribute('data-seams-theme', this.theme);
    } catch {}
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
      tasks.push(this.signingEngine.warmCriticalResources({ kind: 'none' }));
    } else if (workers) {
      // Warm local-only resources without touching the iframe.
      const accountContext = nearAccountBinding
        ? { kind: 'near_account_bound' as const, account: nearAccountBinding }
        : { kind: 'none' as const };
      tasks.push(this.signingEngine.warmCriticalResources(accountContext));
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
    return await syncAccount(this.getContext(), walletId ? String(walletId) : null, args.options);
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
    const relayUrl = String(this.configs.network.relayer.url || '').trim();
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
    await this.signingEngine.exportKeypairWithUI(resolvedInput);
  }
}

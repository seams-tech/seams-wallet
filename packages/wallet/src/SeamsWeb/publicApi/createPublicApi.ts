import { registerTransactionReviewBridge } from './transactionReview';
import type { TransactionReviewReservation } from '../walletIframe/client/transactionReviewReservation';
import type { NearClient } from '@/core/rpcClients/near/NearClient';
import type { UserPreferencesManager } from '@/core/signingEngine/session/userPreferences';
import type { SeamsConfigsReadonly, ThemeMode } from '@/core/types/seams';
import type { WalletAuthDomainDeps } from '@/SeamsWeb/operations/auth/walletAuth';
import { createAuthCapability, type AuthCapabilityDomainMethods } from '@/SeamsWeb/publicApi/auth';
import {
  createDevicesCapability,
  type DevicesCapabilityDomainMethods,
} from '@/SeamsWeb/publicApi/devices';
import { createEvmSignerCapability } from '@/SeamsWeb/publicApi/evm';
import { createNearSignerCapability } from '@/SeamsWeb/publicApi/near';
import { createPreferencesCapability } from '@/SeamsWeb/publicApi/preferences';
import {
  createRecoveryCapability,
  type RecoveryCapabilityDomainMethods,
} from '@/SeamsWeb/publicApi/recovery';
import { createTempoSignerCapability } from '@/SeamsWeb/publicApi/tempo';
import type { PreferencesChangedPayload } from '@/SeamsWeb/walletIframe/shared/messages';
import type { WalletIframeExactSessionState } from '@/SeamsWeb/walletIframe/shared/exactSessionState';
import type {
  AuthCapability,
  DevicesCapability,
  DeviceLinkingWebContext,
  AccountSyncWebContext,
  EcdsaSessionBootstrapSurface,
  NearSigningSurface,
  EvmSignerCapability,
  KeyExportCapability,
  NearSignerCapability,
  PreferencesCapability,
  RegistrationSigningSurface,
  RecoveryCapability,
  RegistrationCapability,
  RpIdSurface,
  TempoSignerCapability,
  TempoSigningSurface,
  UserAccountLookupSurface,
} from '@/SeamsWeb/signingSurface/types';
import type { WalletIframeCoordinator } from '@/SeamsWeb/walletIframe/coordinator';
import {
  createCurrentWalletResolver,
  type CurrentWalletResolver,
} from '@/SeamsWeb/publicApi/currentWallet';
import { awaitNearReady } from '@/SeamsWeb/publicApi/awaitNearReady';
import {
  createKeyExportCapability,
  type KeyExportDomainMethods,
} from '@/SeamsWeb/publicApi/keyExport';

type WalletIframeRoutingSurface = Pick<
  WalletIframeCoordinator,
  'shouldUseWalletIframe' | 'requireRouter'
>;

export interface WalletIframeControlCapability {
  initWalletIframe(walletId?: string): Promise<WalletIframeExactSessionState>;
  isWalletIframeReady(): boolean;
  onWalletIframeReady(listener: () => void): () => void;
  onWalletIframeLoginStatusChanged(
    listener: (status: { isLoggedIn: boolean; walletId: string | null }) => void,
  ): () => void;
  onWalletIframePreferencesChanged(
    listener: (payload: PreferencesChangedPayload) => void,
  ): () => void;
}

export type RegistrationCapabilityDomainMethods = {
  resumePendingEcdsaRegistration: RegistrationCapability['resumePendingEcdsaRegistration'];
  getNearProvisioningState: RegistrationCapability['getNearProvisioningState'];
  onNearProvisioningStateChanged: RegistrationCapability['onNearProvisioningStateChanged'];
  addWalletSigner: RegistrationCapability['addWalletSigner'];
  addPasskey: RegistrationCapability['addPasskey'];
  addEmailOtp: RegistrationCapability['addEmailOtp'];
  revokeAuthMethod: RegistrationCapability['revokeAuthMethod'];
  registerWallet: RegistrationCapability['registerWallet'];
  registerPasskey: RegistrationCapability['registerPasskey'];
  requestEmailOtpEnrollmentChallenge: RegistrationCapability['requestEmailOtpEnrollmentChallenge'];
  enrollEmailOtp: RegistrationCapability['enrollEmailOtp'];
};

export type KeyExportCapabilityDomainMethods = KeyExportDomainMethods;

function createWalletIframeRoutingSurface(
  getWalletIframe: () => WalletIframeCoordinator,
): WalletIframeRoutingSurface {
  return {
    shouldUseWalletIframe: () => getWalletIframe().shouldUseWalletIframe(),
    requireRouter: async (walletId?: string) => await getWalletIframe().requireRouter(walletId),
  };
}

export type SeamsWebPublicApi = {
  auth: AuthCapability;
  registration: RegistrationCapability;
  recovery: RecoveryCapability;
  devices: DevicesCapability;
  keys: KeyExportCapability;
  preferences: PreferencesCapability;
  near: NearSignerCapability;
  tempo: TempoSignerCapability;
  evm: EvmSignerCapability;
  walletIframeControls: WalletIframeControlCapability;
};

type PublicApiSigningSurface = RegistrationSigningSurface &
  AccountSyncWebContext['signingEngine'] &
  DeviceLinkingWebContext['signingEngine'] &
  NearSigningSurface &
  UserAccountLookupSurface &
  RpIdSurface &
  TempoSigningSurface &
  EcdsaSessionBootstrapSurface;

type PublicApiDependencies = {
  signingEngine: PublicApiSigningSurface;
  nearClient: NearClient;
  configs: SeamsConfigsReadonly;
  getTheme: () => ThemeMode;
  userPreferences: UserPreferencesManager;
  getWalletIframe: () => WalletIframeCoordinator;
  getWalletAuthDeps: () => WalletAuthDomainDeps;
  auth: AuthCapabilityDomainMethods;
  registration: RegistrationCapabilityDomainMethods;
  recovery: RecoveryCapabilityDomainMethods;
  devices: DevicesCapabilityDomainMethods;
  keys: KeyExportCapabilityDomainMethods;
};

export function createPublicApi(deps: PublicApiDependencies): SeamsWebPublicApi {
  const getAccountSyncContext = (): AccountSyncWebContext => ({
    signingEngine: deps.signingEngine,
    nearClient: deps.nearClient,
    configs: deps.configs,
    theme: deps.getTheme(),
  });
  const getDeviceLinkingContext = (): DeviceLinkingWebContext => ({
    signingEngine: deps.signingEngine,
    nearClient: deps.nearClient,
    configs: deps.configs,
    theme: deps.getTheme(),
  });
  const walletIframeRoutingSurface = createWalletIframeRoutingSurface(deps.getWalletIframe);
  const auth = createAuthCapability({
    getWalletAuthDeps: deps.getWalletAuthDeps,
    domain: deps.auth,
  });
  const devices = createDevicesCapability({
    getContext: getDeviceLinkingContext,
    walletIframe: walletIframeRoutingSurface,
    domain: deps.devices,
  });
  // Defaults for calls that do not name a wallet come from the authenticated
  // session, never from the `preferences` current-wallet mirror.
  const currentWallet: CurrentWalletResolver = createCurrentWalletResolver({
    getWalletSession: auth.getWalletSession,
  });
  const signingDeps = {
    signingEngine: deps.signingEngine,
    nearClient: deps.nearClient,
    configs: deps.configs,
    getTheme: deps.getTheme,
    getWalletIframe: deps.getWalletIframe,
    currentWallet,
  };
  const near = createNearSignerCapability(signingDeps);
  const evmFamily = createTempoSignerCapability(signingDeps);
  registerTransactionReviewBridge(near, {
    getWalletIframe: deps.getWalletIframe,
    createCapabilities: createReviewedCapabilities.bind(null, signingDeps),
  });
  return {
    walletIframeControls: {
      initWalletIframe: async (walletId?: string): Promise<WalletIframeExactSessionState> =>
        await deps.getWalletIframe().init(walletId),
      isWalletIframeReady: (): boolean => deps.getWalletIframe().isReady(),
      onWalletIframeReady: (listener): (() => void) => deps.getWalletIframe().onReady(listener),
      onWalletIframeLoginStatusChanged: (listener): (() => void) =>
        deps.getWalletIframe().onLoginStatusChanged(listener),
      onWalletIframePreferencesChanged: (listener): (() => void) =>
        deps.getWalletIframe().onPreferencesChanged(listener),
    },
    preferences: createPreferencesCapability({
      userPreferences: deps.userPreferences,
      getWalletIframe: deps.getWalletIframe,
    }),
    auth,
    registration: {
      resumePendingEcdsaRegistration: deps.registration.resumePendingEcdsaRegistration,
      getNearProvisioningState: deps.registration.getNearProvisioningState,
      onNearProvisioningStateChanged: deps.registration.onNearProvisioningStateChanged,
      awaitNearReady: async (args) =>
        await awaitNearReady(
          {
            getNearProvisioningState: deps.registration.getNearProvisioningState,
            onNearProvisioningStateChanged: deps.registration.onNearProvisioningStateChanged,
          },
          { ...args, walletId: String(args.walletId) },
        ),
      addWalletSigner: deps.registration.addWalletSigner,
      addPasskey: deps.registration.addPasskey,
      addEmailOtp: deps.registration.addEmailOtp,
      revokeAuthMethod: deps.registration.revokeAuthMethod,
      registerWallet: deps.registration.registerWallet,
      registerWithEmailOtp: deps.registration.registerWallet,
      registerPasskey: deps.registration.registerPasskey,
      requestEmailOtpEnrollmentChallenge: deps.registration.requestEmailOtpEnrollmentChallenge,
      enrollEmailOtp: deps.registration.enrollEmailOtp,
    },
    recovery: createRecoveryCapability({
      getContext: getAccountSyncContext,
      walletIframe: walletIframeRoutingSurface,
      domain: deps.recovery,
    }),
    devices,
    keys: createKeyExportCapability({
      configs: deps.configs,
      currentWallet,
      domain: deps.keys,
    }),
    near,
    tempo: evmFamily,
    evm: createEvmSignerCapability({
      signingEngine: deps.signingEngine,
      nearClient: deps.nearClient,
      configs: deps.configs,
      getTheme: deps.getTheme,
      getWalletIframe: deps.getWalletIframe,
      currentWallet,
      evmFamily,
    }),
  };
}

function createReviewedCapabilities(
  deps: Pick<
    PublicApiDependencies,
    'signingEngine' | 'nearClient' | 'configs' | 'getTheme' | 'getWalletIframe'
  > & { currentWallet: CurrentWalletResolver },
  reservation: TransactionReviewReservation,
) {
  const dispatch = { kind: 'reviewed', reservation } as const;
  const tempo = createTempoSignerCapability(deps, dispatch);
  return {
    near: createNearSignerCapability(deps, dispatch),
    tempo,
    evm: createEvmSignerCapability({ ...deps, evmFamily: tempo }, dispatch),
  };
}

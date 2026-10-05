import type { WalletAuthCommands } from './auth';
import type { NearClient } from '@/core/rpcClients/near/NearClient';
import type { SeamsConfigsReadonly } from '@/core/types/seams';
import { waitForNearAccount } from '@/SeamsWeb/publicApi/waitForNearAccount';
import {
  createCurrentWalletResolver,
  type CurrentWalletResolver,
} from '@/SeamsWeb/publicApi/currentWallet';
import { createDevicesCapability, type DeviceCommands } from '@/SeamsWeb/publicApi/devices';
import {
  createKeyExportCapability,
  type KeyExportDomainMethods,
} from '@/SeamsWeb/publicApi/keyExport';
import { createNearSignerCapability } from '@/SeamsWeb/publicApi/near';
import { createEvmFamilyCapabilities } from '@/SeamsWeb/publicApi/tempo';
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
import type { WalletIframeCoordinator } from '@/SeamsWeb/walletIframe/coordinator';
import type { TransactionReviewReservation } from '../walletIframe/client/transactionReviewReservation';
import type { CreateEvmFamilyCommands } from './evmFamilyCommands';
import type { CreateNearCommands } from './nearCommands';
import { registerTransactionReviewBridge } from './transactionReview';
export type WalletRegistrationCommands = Pick<
  RegistrationCapability,
  | 'registerWallet'
  | 'getNearAccountState'
  | 'resumePendingEcdsaRegistration'
  | 'addSigner'
  | 'addPasskey'
  | 'removeAuthMethod'
  | 'addEmail'
>;
export type RegistrationCapabilityDomainMethods = WalletRegistrationCommands & {
  onNearAccountChange: RegistrationCapability['onNearAccountChange'];
  requestEmailOtpEnrollmentChallenge: RegistrationCapability['requestEmailOtpEnrollmentChallenge'];
  enrollEmailOtp: RegistrationCapability['enrollEmailOtp'];
};
export type KeyExportCapabilityDomainMethods = KeyExportDomainMethods;
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
};
type PublicApiDependencies = {
  createNearCommands: CreateNearCommands;
  createEvmFamilyCommands: CreateEvmFamilyCommands;
  nearClient: NearClient;
  configs: SeamsConfigsReadonly;
  preferences: PreferencesCapability;
  auth: WalletAuthCommands;
  registration: RegistrationCapabilityDomainMethods;
  recovery: RecoveryCapability;
  devices: DeviceCommands;
  keys: KeyExportCapabilityDomainMethods;
};
export function createPublicApi(
  deps: PublicApiDependencies,
): Omit<SeamsWebPublicApi, 'auth'> & { auth: WalletAuthCommands } {
  const auth = deps.auth;
  const devices = createDevicesCapability(deps.devices);
  // Defaults for calls that do not name a wallet come from the authenticated
  // session, never from the `preferences` current-wallet mirror.
  const currentWallet: CurrentWalletResolver = createCurrentWalletResolver({
    getWalletSession: auth.getSession,
  });
  const signingDeps = {
    createNearCommands: deps.createNearCommands,
    createEvmFamilyCommands: deps.createEvmFamilyCommands,
    nearClient: deps.nearClient,
    configs: deps.configs,
    currentWallet,
  };
  const near = createNearSignerCapability({
    ...signingDeps,
    commands: deps.createNearCommands({ kind: 'ordinary' }),
  });
  const commands = deps.createEvmFamilyCommands({ kind: 'ordinary' });
  const evmFamily = createEvmFamilyCapabilities({ ...signingDeps, commands });
  return {
    preferences: deps.preferences,
    auth,
    registration: {
      resumePendingEcdsaRegistration: deps.registration.resumePendingEcdsaRegistration,
      getNearAccountState: deps.registration.getNearAccountState,
      onNearAccountChange: deps.registration.onNearAccountChange,
      waitForNearAccount: waitForNearAccount.bind(null, deps.registration),
      addSigner: deps.registration.addSigner,
      addPasskey: deps.registration.addPasskey,
      addEmail: deps.registration.addEmail,
      removeAuthMethod: deps.registration.removeAuthMethod,
      registerWallet: deps.registration.registerWallet,
      requestEmailOtpEnrollmentChallenge: deps.registration.requestEmailOtpEnrollmentChallenge,
      enrollEmailOtp: deps.registration.enrollEmailOtp,
    },
    recovery: deps.recovery,
    devices,
    keys: createKeyExportCapability({
      configs: deps.configs,
      currentWallet,
      domain: deps.keys,
    }),
    near,
    tempo: evmFamily.tempo,
    evm: evmFamily.evm,
  };
}
export function createApplicationPublicApi(
  deps: PublicApiDependencies & { getWalletIframe: () => WalletIframeCoordinator },
): SeamsWebPublicApi {
  const api = createPublicApi(deps);
  const currentWallet = createCurrentWalletResolver({
    getWalletSession: deps.auth.getSession,
  });
  registerTransactionReviewBridge(api.near, {
    getWalletIframe: deps.getWalletIframe,
    createCapabilities: createReviewedCapabilities.bind(null, {
      nearClient: deps.nearClient,
      configs: deps.configs,
      createNearCommands: deps.createNearCommands,
      createEvmFamilyCommands: deps.createEvmFamilyCommands,
      currentWallet,
    }),
  });
  const coordinator = deps.getWalletIframe();
  return {
    ...api,
    auth: { ...api.auth, onSessionChange: coordinator.onSessionChange.bind(coordinator) },
  };
}

function createReviewedCapabilities(
  deps: Pick<
    PublicApiDependencies,
    'nearClient' | 'configs' | 'createEvmFamilyCommands' | 'createNearCommands'
  > & {
    currentWallet: CurrentWalletResolver;
  },
  reservation: TransactionReviewReservation,
) {
  const dispatch = { kind: 'reviewed', reservation } as const;
  const commands = deps.createEvmFamilyCommands(dispatch);
  const evmFamily = createEvmFamilyCapabilities({ ...deps, commands });
  return {
    near: createNearSignerCapability({ ...deps, commands: deps.createNearCommands(dispatch) }),
    tempo: evmFamily.tempo,
    evm: evmFamily.evm,
  };
}

import type { NearClient } from '@/core/rpcClients/near/NearClient';
import type { SeamsConfigsReadonly } from '@/core/types/seams';
import { awaitNearReady } from '@/SeamsWeb/publicApi/awaitNearReady';
import {
  createCurrentWalletResolver,
  type CurrentWalletResolver,
} from '@/SeamsWeb/publicApi/currentWallet';
import { createDevicesCapability, type DeviceCommands } from '@/SeamsWeb/publicApi/devices';
import { createEvmSignerCapability } from '@/SeamsWeb/publicApi/evm';
import {
  createKeyExportCapability,
  type KeyExportDomainMethods,
} from '@/SeamsWeb/publicApi/keyExport';
import { createNearSignerCapability } from '@/SeamsWeb/publicApi/near';
import { createTempoSignerCapability } from '@/SeamsWeb/publicApi/tempo';
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
  | 'getNearProvisioningState'
  | 'resumePendingEcdsaRegistration'
  | 'addWalletSigner'
  | 'addPasskey'
  | 'revokeAuthMethod'
  | 'addEmailOtp'
>;
export type RegistrationCapabilityDomainMethods = WalletRegistrationCommands & {
  onNearProvisioningStateChanged: RegistrationCapability['onNearProvisioningStateChanged'];
  registerPasskey: RegistrationCapability['registerPasskey'];
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
  auth: AuthCapability;
  registration: RegistrationCapabilityDomainMethods;
  recovery: RecoveryCapability;
  devices: DeviceCommands;
  keys: KeyExportCapabilityDomainMethods;
};
export function createPublicApi(deps: PublicApiDependencies): SeamsWebPublicApi {
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
  const evmFamily = createTempoSignerCapability({ ...signingDeps, commands });
  return {
    preferences: deps.preferences,
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
    recovery: deps.recovery,
    devices,
    keys: createKeyExportCapability({
      configs: deps.configs,
      currentWallet,
      domain: deps.keys,
    }),
    near,
    tempo: evmFamily,
    evm: createEvmSignerCapability({ configs: deps.configs, currentWallet, commands, evmFamily }),
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
  return api;
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
  const tempo = createTempoSignerCapability({ ...deps, commands });
  return {
    near: createNearSignerCapability({ ...deps, commands: deps.createNearCommands(dispatch) }),
    tempo,
    evm: createEvmSignerCapability({ ...deps, commands, evmFamily: tempo }),
  };
}

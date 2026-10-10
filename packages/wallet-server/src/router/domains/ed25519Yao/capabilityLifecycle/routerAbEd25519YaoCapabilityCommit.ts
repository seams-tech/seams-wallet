import type { WalletEd25519YaoActiveCapabilityRecord } from '../../../../core/WalletStore';
import {
  InMemoryRouterAbEd25519YaoRecoveryService,
  InMemoryRouterAbEd25519YaoRecoveryStateV1,
  type RouterAbEd25519YaoRegistrationFinalizeCapabilityInstallationV1,
  type RouterAbEd25519YaoRegistrationFinalizeCapabilityInstallResultV1,
} from '../recovery/routerAbEd25519YaoRecovery';
import type {
  RouterAbEd25519YaoPreparedWriteV1,
  RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1,
} from './routerAbEd25519YaoProductRegistrationPartitionedStateStore';

/** The wallet and its initial capability become visible in the same transaction. */
export function commitRouterAbEd25519YaoRegistrationCapability(
  store: RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1,
  installation: RouterAbEd25519YaoRegistrationFinalizeCapabilityInstallationV1,
  walletWrite: RouterAbEd25519YaoPreparedWriteV1,
): Promise<RouterAbEd25519YaoRegistrationFinalizeCapabilityInstallResultV1> {
  return commitCapability(store, installRegistration.bind(undefined, installation), walletWrite);
}

export function rehydrateRouterAbEd25519YaoCapability(
  store: RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1,
  capability: WalletEd25519YaoActiveCapabilityRecord,
): Promise<RouterAbEd25519YaoRegistrationFinalizeCapabilityInstallResultV1> {
  return commitCapability(store, installPersisted.bind(undefined, capability), null);
}

async function commitCapability(
  store: RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1,
  install: (
    service: InMemoryRouterAbEd25519YaoRecoveryService,
  ) => RouterAbEd25519YaoRegistrationFinalizeCapabilityInstallResultV1,
  companionWrite: RouterAbEd25519YaoPreparedWriteV1 | null,
): Promise<RouterAbEd25519YaoRegistrationFinalizeCapabilityInstallResultV1> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await store.loadCapabilities();
    const state = new InMemoryRouterAbEd25519YaoRecoveryStateV1();
    for (const [key, capability] of snapshot.value.recoveryCapabilities) {
      state.capabilities.set(key, capability);
    }
    for (const [key, capabilityKey] of snapshot.value.recoveryIdentityCapabilities) {
      state.identityCapabilities.set(key, capabilityKey);
    }
    const result = install(
      new InMemoryRouterAbEd25519YaoRecoveryService(
        {
          admitRecovery: rejectProtocolExecution,
          resolveRecoveryDispatchRoot: rejectProtocolExecution,
          executeRecovery: rejectProtocolExecution,
          activateRecovery: rejectProtocolExecution,
        },
        state,
      ),
    );
    if (!result.ok) return result;
    const committed = await store.commitCapabilities(
      snapshot,
      {
        capabilities: state.capabilities,
        identityCapabilities: state.identityCapabilities,
      },
      companionWrite,
    );
    if (committed.kind === 'stored') return result;
  }
  throw new Error('Capability state remained contended after one reconciliation');
}

function installRegistration(
  input: RouterAbEd25519YaoRegistrationFinalizeCapabilityInstallationV1,
  service: InMemoryRouterAbEd25519YaoRecoveryService,
) {
  return service.installRegistrationFinalizeCapability(input);
}

function installPersisted(
  input: WalletEd25519YaoActiveCapabilityRecord,
  service: InMemoryRouterAbEd25519YaoRecoveryService,
) {
  return service.installPersistedActiveCapability(input);
}

function rejectProtocolExecution(): never {
  throw new Error('A capability commit cannot execute a protocol');
}

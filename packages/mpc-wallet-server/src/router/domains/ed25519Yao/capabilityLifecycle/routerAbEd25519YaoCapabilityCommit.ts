import type { WalletEd25519YaoActiveCapabilityRecord } from '../../../../core/WalletStore';
import {
  InMemoryRouterAbEd25519YaoRecoveryService,
  InMemoryRouterAbEd25519YaoRecoveryStateV1,
  resolveRouterAbEd25519YaoActiveCapability,
  type RouterAbEd25519YaoActiveCapabilityLookupResultV1,
  type RouterAbEd25519YaoActiveCapabilityLookupV1,
  type RouterAbEd25519YaoRegistrationFinalizeCapabilityInstallationV1,
  type RouterAbEd25519YaoRegistrationFinalizeCapabilityInstallResultV1,
} from '../recovery/routerAbEd25519YaoRecovery';
import type {
  RouterAbEd25519YaoCapabilitySnapshotV1,
  RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1,
} from './routerAbEd25519YaoProductRegistrationPartitionedStateStore';

/**
 * Checks a registration's capability against its admission and its result.
 * The signer row of the wallet commit holds the capability, so a registration
 * reads and writes no recovery state.
 */
export function validateRouterAbEd25519YaoRegistrationCapability(
  installation: RouterAbEd25519YaoRegistrationFinalizeCapabilityInstallationV1,
): RouterAbEd25519YaoRegistrationFinalizeCapabilityInstallResultV1 {
  return capabilityService(
    new InMemoryRouterAbEd25519YaoRecoveryStateV1(),
  ).installRegistrationFinalizeCapability(installation);
}

/**
 * Stores a signer row's capability in the recovery state, where a recovery
 * admission suspends it.
 */
export async function rehydrateRouterAbEd25519YaoCapability(
  store: RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1,
  capability: WalletEd25519YaoActiveCapabilityRecord,
): Promise<RouterAbEd25519YaoRegistrationFinalizeCapabilityInstallResultV1> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await store.loadCapabilities();
    const state = recoveryStateFromSnapshot(snapshot);
    const result = capabilityService(state).installPersistedActiveCapability(capability);
    if (!result.ok) return result;
    const committed = await store.commitCapabilities(
      snapshot,
      {
        capabilities: state.capabilities,
        identityCapabilities: state.identityCapabilities,
      },
      null,
    );
    if (committed.kind === 'stored') return result;
  }
  throw new Error('Capability state remained contended after one reconciliation');
}

/**
 * The active capability of a signer row, as the recovery state allows it: a
 * capability that a recovery suspended is not active, and one that a recovery
 * retired conflicts. Nothing is written.
 */
export function resolveRouterAbEd25519YaoPersistedActiveCapability(
  snapshot: RouterAbEd25519YaoCapabilitySnapshotV1,
  persisted: WalletEd25519YaoActiveCapabilityRecord,
  lookup: RouterAbEd25519YaoActiveCapabilityLookupV1,
): RouterAbEd25519YaoActiveCapabilityLookupResultV1 {
  const state = recoveryStateFromSnapshot(snapshot);
  const installed = capabilityService(state).installPersistedActiveCapability(persisted);
  if (!installed.ok) {
    return { ok: false, code: 'capability_conflict', message: installed.message };
  }
  return resolveRouterAbEd25519YaoActiveCapability(state.capabilities, lookup);
}

function recoveryStateFromSnapshot(
  snapshot: RouterAbEd25519YaoCapabilitySnapshotV1,
): InMemoryRouterAbEd25519YaoRecoveryStateV1 {
  const state = new InMemoryRouterAbEd25519YaoRecoveryStateV1();
  for (const [key, capability] of snapshot.value.recoveryCapabilities) {
    state.capabilities.set(key, capability);
  }
  for (const [key, capabilityKey] of snapshot.value.recoveryIdentityCapabilities) {
    state.identityCapabilities.set(key, capabilityKey);
  }
  return state;
}

function capabilityService(
  state: InMemoryRouterAbEd25519YaoRecoveryStateV1,
): InMemoryRouterAbEd25519YaoRecoveryService {
  return new InMemoryRouterAbEd25519YaoRecoveryService(
    {
      admitRecovery: rejectProtocolExecution,
      resolveRecoveryDispatchRoot: rejectProtocolExecution,
      executeRecovery: rejectProtocolExecution,
      activateRecovery: rejectProtocolExecution,
    },
    state,
  );
}

function rejectProtocolExecution(): never {
  throw new Error('A capability commit cannot execute a protocol');
}

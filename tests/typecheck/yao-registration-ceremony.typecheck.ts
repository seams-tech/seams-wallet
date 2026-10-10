import type {
  RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1,
  RouterAbEd25519YaoRegistrationCeremonySnapshotV1,
  RouterAbEd25519YaoCapabilitySnapshotV1,
  RouterAbEd25519YaoCapabilityMutationV1,
} from '../../packages/wallet-server/src/router/domains/ed25519Yao/capabilityLifecycle/routerAbEd25519YaoProductRegistrationPartitionedStateStore';
import type { RouterAbEd25519YaoProductRegistrationStateV1 } from '../../packages/wallet-server/src/router/domains/ed25519Yao/capabilityLifecycle/routerAbEd25519YaoProductRegistration';

declare const snapshot: RouterAbEd25519YaoRegistrationCeremonySnapshotV1;
declare const shared: RouterAbEd25519YaoProductRegistrationStateV1;
declare const store: RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1;

// @ts-expect-error Registration cannot read another wallet's shared capabilities.
snapshot.state.recovery.capabilities;

const literal: RouterAbEd25519YaoRegistrationCeremonySnapshotV1['state'] = {
  registration: snapshot.state.registration,
  authorization: snapshot.state.authorization,
  // @ts-expect-error A registration snapshot cannot carry shared recovery state.
  recovery: shared.recovery,
};

const broadened = { ...snapshot, state: { ...snapshot.state, ...shared } };
// @ts-expect-error Broad spreads cannot make shared state writable through registration.
store.commitRegistration(broadened, null);

const incomplete = { lifecycleId: snapshot.lifecycleId, state: snapshot.state };
// @ts-expect-error A registration commit needs its original version and retained ceremony fields.
store.commitRegistration(incomplete, null);

void literal;

declare const capabilitySnapshot: RouterAbEd25519YaoCapabilitySnapshotV1;
const capabilityMutation: RouterAbEd25519YaoCapabilityMutationV1 = {
  capabilities: shared.recovery.capabilities,
  identityCapabilities: shared.recovery.identityCapabilities,
};
store.commitCapabilities(capabilitySnapshot, capabilityMutation);

// @ts-expect-error A capability commit cannot carry recovery lifecycle state through a spread.
store.commitCapabilities(capabilitySnapshot, { ...shared.recovery });

store.commitCapabilities(capabilitySnapshot, {
  ...capabilityMutation,
  // @ts-expect-error Capability installation must preserve existing recovery sessions.
  recoverySessions: shared.recovery.recoverySessions,
});

// @ts-expect-error A capability commit must retain the version it read.
store.commitCapabilities({ value: capabilitySnapshot.value }, capabilityMutation);

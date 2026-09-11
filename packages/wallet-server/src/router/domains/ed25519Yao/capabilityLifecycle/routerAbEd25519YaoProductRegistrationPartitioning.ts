import type {
  InMemoryRouterAbEd25519YaoRegistrationStateV1,
  RouterAbEd25519YaoRegistrationAdmissionClaimV1,
} from '../registration/routerAbEd25519YaoRegistration';
import type { InMemoryRouterAbEd25519YaoRegistrationIntentAuthorizationStateV1 } from '../registration/routerAbEd25519YaoRegistrationIntentAuthorization';
import type { InMemoryRouterAbEd25519YaoRecoveryStateV1 } from '../recovery/routerAbEd25519YaoRecovery';
import type { InMemoryRouterAbEd25519YaoExportStateV1 } from '../export/routerAbEd25519YaoExport';
import {
  createRouterAbEd25519YaoProductRegistrationStateFromPartsV1,
  type RouterAbEd25519YaoProductRegistrationStateV1,
} from './routerAbEd25519YaoProductRegistration';

type MapValue<T> = T extends Map<string, infer Value> ? Value : never;

type RegistrationLifecycleState = MapValue<InMemoryRouterAbEd25519YaoRegistrationStateV1['states']>;
type RegistrationAdmissionClaim = RouterAbEd25519YaoRegistrationAdmissionClaimV1;
type RegistrationIntentAuthority =
  InMemoryRouterAbEd25519YaoRegistrationIntentAuthorizationStateV1['authorities'][number];
type RecoveryCapabilityState = MapValue<InMemoryRouterAbEd25519YaoRecoveryStateV1['capabilities']>;
type RecoveryLifecycleState = MapValue<InMemoryRouterAbEd25519YaoRecoveryStateV1['recoveries']>;
type ExportLifecycleState = MapValue<InMemoryRouterAbEd25519YaoExportStateV1['exports']>;

const MAX_SHARED_RECOVERY_CAPABILITIES = 32;

export type RouterAbEd25519YaoProductRegistrationSharedStateV1 = {
  readonly kind: 'router_ab_ed25519_yao_product_registration_shared_state_v1';
  readonly recoveryCapabilities: ReadonlyMap<string, RecoveryCapabilityState>;
  readonly recoveryIdentityCapabilities: ReadonlyMap<string, string>;
  readonly recoverySessions: ReadonlyMap<string, string>;
  readonly exportAuthorizationNonces: ReadonlySet<string>;
  readonly exportAuthorizationUncertain: ReadonlySet<string>;
};

export type RouterAbEd25519YaoProductRegistrationCeremonyStateV1 = {
  readonly kind: 'router_ab_ed25519_yao_product_registration_ceremony_state_v1';
  readonly lifecycleId: string;
  readonly registration: {
    readonly states: ReadonlyMap<string, RegistrationLifecycleState>;
    readonly lifecycleSessions: ReadonlyMap<string, string>;
    readonly admissionClaims: ReadonlyMap<string, RegistrationAdmissionClaim>;
  };
  readonly authorization: {
    readonly authorities: readonly RegistrationIntentAuthority[];
  };
  readonly recovery: {
    readonly recoveries: ReadonlyMap<string, RecoveryLifecycleState>;
  };
  readonly export: {
    readonly exports: ReadonlyMap<string, ExportLifecycleState>;
  };
};

export type RouterAbEd25519YaoProductRegistrationStatePartitionV1 = {
  readonly kind: 'router_ab_ed25519_yao_product_registration_state_partition_v1';
  readonly lifecycleId: string;
  readonly shared: RouterAbEd25519YaoProductRegistrationSharedStateV1;
  readonly ceremony: RouterAbEd25519YaoProductRegistrationCeremonyStateV1;
};

/**
 * Projects the tenant-wide state into shared and lifecycle-owned records.
 * Capability ownership and export nonce replay state deliberately stay in the
 * shared record; only lifecycle-indexed entries enter the ceremony record.
 */
export function partitionRouterAbEd25519YaoProductRegistrationStateV1(
  state: RouterAbEd25519YaoProductRegistrationStateV1,
  lifecycleId: string,
): RouterAbEd25519YaoProductRegistrationStatePartitionV1 {
  const normalizedLifecycleId = requireLifecycleId(lifecycleId);
  const registrationStates = selectMapEntries(
    state.registration.states,
    normalizedLifecycleId,
    registrationStateLifecycleId,
  );
  const recoveryStates = selectMapEntries(
    state.recovery.recoveries,
    normalizedLifecycleId,
    recoveryStateLifecycleId,
  );
  const exportStates = selectMapEntries(
    state.export.exports,
    normalizedLifecycleId,
    exportStateLifecycleId,
  );

  return {
    kind: 'router_ab_ed25519_yao_product_registration_state_partition_v1',
    lifecycleId: normalizedLifecycleId,
    shared: {
      kind: 'router_ab_ed25519_yao_product_registration_shared_state_v1',
      recoveryCapabilities: new Map(state.recovery.capabilities),
      recoveryIdentityCapabilities: new Map(state.recovery.identityCapabilities),
      recoverySessions: new Map(state.recovery.recoverySessions),
      exportAuthorizationNonces: new Set(state.export.authorizationNonces),
      exportAuthorizationUncertain: new Set(state.export.authorizationUncertain),
    },
    ceremony: {
      kind: 'router_ab_ed25519_yao_product_registration_ceremony_state_v1',
      lifecycleId: normalizedLifecycleId,
      registration: {
        states: registrationStates,
        lifecycleSessions: selectMapLifecycleEntry(
          state.registration.lifecycleSessions,
          normalizedLifecycleId,
        ),
        admissionClaims: selectMapLifecycleEntry(
          state.registration.admissionClaims,
          normalizedLifecycleId,
        ),
      },
      authorization: {
        authorities: state.authorization.authorities.filter(
          (authority) => authorityLifecycleId(authority) === normalizedLifecycleId,
        ),
      },
      recovery: {
        recoveries: recoveryStates,
      },
      export: { exports: exportStates },
    },
  };
}

/**
 * Applies one request's partition back onto a complete snapshot. Existing
 * lifecycle entries are replaced while unrelated ceremonies and all shared
 * records remain intact.
 */
export function mergeRouterAbEd25519YaoProductRegistrationStatePartitionV1(
  base: RouterAbEd25519YaoProductRegistrationStateV1,
  partition: RouterAbEd25519YaoProductRegistrationStatePartitionV1,
): RouterAbEd25519YaoProductRegistrationStateV1 {
  const lifecycleId = requireLifecycleId(partition.lifecycleId);
  if (partition.ceremony.lifecycleId !== lifecycleId) {
    throw new Error('Ed25519 Yao ceremony partition lifecycle IDs must match');
  }

  const registrationStates = replaceLifecycleEntries(
    base.registration.states,
    partition.ceremony.registration.states,
    registrationStateLifecycleId,
    lifecycleId,
  );
  const lifecycleSessions = new Map(base.registration.lifecycleSessions);
  lifecycleSessions.delete(lifecycleId);
  for (const [key, value] of partition.ceremony.registration.lifecycleSessions) {
    lifecycleSessions.set(key, value);
  }
  const admissionClaims = new Map(base.registration.admissionClaims);
  admissionClaims.delete(lifecycleId);
  for (const [key, value] of partition.ceremony.registration.admissionClaims) {
    admissionClaims.set(key, value);
  }

  const authorities = base.authorization.authorities.filter(
    (authority) => authorityLifecycleId(authority) !== lifecycleId,
  );
  authorities.push(...partition.ceremony.authorization.authorities);

  const recoveries = replaceLifecycleEntries(
    base.recovery.recoveries,
    partition.ceremony.recovery.recoveries,
    recoveryStateLifecycleId,
    lifecycleId,
  );
  const exports = replaceLifecycleEntries(
    base.export.exports,
    partition.ceremony.export.exports,
    exportStateLifecycleId,
    lifecycleId,
  );

  return createRouterAbEd25519YaoProductRegistrationStateFromPartsV1({
    registration: {
      states: registrationStates,
      lifecycleSessions,
      admissionClaims: new Map(admissionClaims),
    },
    authorization: { authorities },
    recovery: {
      capabilities: new Map(partition.shared.recoveryCapabilities),
      identityCapabilities: new Map(partition.shared.recoveryIdentityCapabilities),
      recoveries,
      recoverySessions: new Map(partition.shared.recoverySessions),
    },
    export: {
      exports,
      authorizationNonces: new Set(partition.shared.exportAuthorizationNonces),
      authorizationUncertain: new Set(partition.shared.exportAuthorizationUncertain),
    },
  });
}

function selectMapEntries<T>(
  source: ReadonlyMap<string, T>,
  lifecycleId: string,
  lifecycleOf: (value: T) => string,
): Map<string, T> {
  const selected = new Map<string, T>();
  for (const [key, value] of source) {
    if (lifecycleOf(value) === lifecycleId) selected.set(key, value);
  }
  return selected;
}

function selectMapLifecycleEntry<T>(
  source: ReadonlyMap<string, T>,
  lifecycleId: string,
): Map<string, T> {
  const value = source.get(lifecycleId);
  return value === undefined ? new Map() : new Map([[lifecycleId, value]]);
}

function replaceLifecycleEntries<T>(
  base: ReadonlyMap<string, T>,
  replacement: ReadonlyMap<string, T>,
  lifecycleOf: (value: T) => string,
  lifecycleId: string,
): Map<string, T> {
  const merged = new Map<string, T>();
  for (const [key, value] of base) {
    if (lifecycleOf(value) !== lifecycleId) merged.set(key, value);
  }
  for (const [key, value] of replacement) merged.set(key, value);
  return merged;
}

export function boundedRouterAbEd25519YaoProductRegistrationSharedStateV1(
  source: RouterAbEd25519YaoProductRegistrationSharedStateV1,
): RouterAbEd25519YaoProductRegistrationSharedStateV1 {
  const recoveryCapabilities = boundedRecoveryCapabilities(source.recoveryCapabilities);
  return {
    kind: 'router_ab_ed25519_yao_product_registration_shared_state_v1',
    recoveryCapabilities,
    recoveryIdentityCapabilities: retainedRecoveryIdentityCapabilities(
      source.recoveryIdentityCapabilities,
      recoveryCapabilities,
    ),
    recoverySessions: new Map(source.recoverySessions),
    exportAuthorizationNonces: new Set(source.exportAuthorizationNonces),
    exportAuthorizationUncertain: new Set(source.exportAuthorizationUncertain),
  };
}

function boundedRecoveryCapabilities(
  source: ReadonlyMap<string, RecoveryCapabilityState>,
): Map<string, RecoveryCapabilityState> {
  if (source.size <= MAX_SHARED_RECOVERY_CAPABILITIES) return new Map(source);

  // Durable signer rows are canonical. This shared map is a request cache, so
  // retain active recovery ceremonies first and let older wallets rehydrate.
  const entries = [...source.entries()];
  const suspended = entries.filter(([, capability]) => capability.kind === 'suspended');
  const retained = new Set<string>();
  for (const [key] of suspended.slice(-MAX_SHARED_RECOVERY_CAPABILITIES)) retained.add(key);
  for (
    let index = entries.length - 1;
    index >= 0 && retained.size < MAX_SHARED_RECOVERY_CAPABILITIES;
    index -= 1
  ) {
    const entry = entries[index];
    if (entry) retained.add(entry[0]);
  }

  const bounded = new Map<string, RecoveryCapabilityState>();
  for (const [key, capability] of entries) {
    if (retained.has(key)) bounded.set(key, capability);
  }
  return bounded;
}

function retainedRecoveryIdentityCapabilities(
  source: ReadonlyMap<string, string>,
  capabilities: ReadonlyMap<string, RecoveryCapabilityState>,
): Map<string, string> {
  const retained = new Map<string, string>();
  for (const [identity, capabilityKey] of source) {
    if (capabilities.has(capabilityKey)) retained.set(identity, capabilityKey);
  }
  return retained;
}

function registrationStateLifecycleId(state: RegistrationLifecycleState): string {
  return state.admissionRequest.scope.lifecycle_id;
}

function authorityLifecycleId(authority: RegistrationIntentAuthority): string {
  return authority.admissionRequest.scope.lifecycle_id;
}

function recoveryStateLifecycleId(state: RecoveryLifecycleState): string {
  return state.context.admissionRequest.scope.lifecycle_id;
}

function exportStateLifecycleId(state: ExportLifecycleState): string {
  return state.request.scope.lifecycle_id;
}

function requireLifecycleId(value: string): string {
  const lifecycleId = value.trim();
  if (!lifecycleId || lifecycleId.length > 256 || !/^[\x21-\x7e]+$/u.test(lifecycleId)) {
    throw new Error('Ed25519 Yao ceremony lifecycle ID is invalid');
  }
  return lifecycleId;
}

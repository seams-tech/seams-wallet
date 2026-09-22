import type {
  VersionedJsonObject,
  VersionedJsonRecordPutResult,
  VersionedJsonRecordReadResult,
  VersionedJsonValue,
} from '../../../framework/versionedJsonRecordStore';
import {
  sameRouterAbEd25519YaoActivationBindingV1,
  type RouterAbEd25519YaoActivationClientPackageV1,
} from '@shared/utils/routerAbEd25519Yao';
import { sameRouterAbMpcMaterialActivationRef } from '@shared/utils/routerAbNormalSigningIdentity';
import { routerAbEd25519YaoExecutionMatchesAdmissionV1 } from '../registration/routerAbEd25519YaoRegistration';
import type {
  RouterAbEd25519YaoActivationConsumptionRequestV1,
  RouterAbEd25519YaoActivationConsumptionResultV1,
  RouterAbEd25519YaoRegistrationFailure,
} from '../registration/routerAbEd25519YaoRegistration';
import {
  buildRouterAbEd25519YaoRegistrationExecutionReadyRecordV1,
  routerAbEd25519YaoRegistrationExecutionRecordKeyV1,
  ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTION_RECORD_KIND_V1,
  encodeRouterAbEd25519YaoRegistrationExecutionRecordV1,
  parseRouterAbEd25519YaoRegistrationExecutionRecordV1,
  type RouterAbEd25519YaoRegistrationExecutionRecordV1,
} from '../registration/routerAbEd25519YaoRegistrationExecutionRecord';
import { createRouterAbEd25519YaoProductRegistrationStateV1 } from './routerAbEd25519YaoProductRegistration';
import type { RouterAbEd25519YaoProductRegistrationStateV1 } from './routerAbEd25519YaoProductRegistration';
import {
  encodeRouterAbEd25519YaoProductRegistrationStateV1,
  parseRouterAbEd25519YaoProductRegistrationStateJsonV1,
} from './routerAbEd25519YaoProductRegistrationPersistence';
import {
  boundedRouterAbEd25519YaoProductRegistrationSharedStateV1,
  mergeRouterAbEd25519YaoProductRegistrationStatePartitionV1,
  partitionRouterAbEd25519YaoProductRegistrationStateV1,
  type RouterAbEd25519YaoProductRegistrationCeremonyStateV1,
  type RouterAbEd25519YaoProductRegistrationSharedStateV1,
} from './routerAbEd25519YaoProductRegistrationPartitioning';

export const ROUTER_AB_ED25519_YAO_SHARED_STATE_RECORD_KEY_V1 = 'router-ab-ed25519-yao:shared';
const PARTITION_RECORD_CODEC_KIND =
  'router_ab_ed25519_yao_product_registration_partition_record_json_v1';
const SHARED_RECORD_KIND = 'router_ab_ed25519_yao_product_registration_shared_record_v1';
const CEREMONY_RECORD_KIND = 'router_ab_ed25519_yao_product_registration_ceremony_record_v1';
const EXECUTION_RECORD_KIND = ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTION_RECORD_KIND_V1;
const EXECUTION_RECONCILIATION_LEASE_MS = 10_000;

type EncodedPartitionRecord =
  | {
      readonly kind: typeof PARTITION_RECORD_CODEC_KIND;
      readonly recordKind: typeof SHARED_RECORD_KIND | typeof CEREMONY_RECORD_KIND;
      readonly lifecycleId: string;
      readonly state: VersionedJsonObject;
    }
  | {
      readonly kind: typeof PARTITION_RECORD_CODEC_KIND;
      readonly recordKind: typeof EXECUTION_RECORD_KIND;
      readonly lifecycleId: string;
      readonly execution: VersionedJsonObject;
    };

export type RouterAbEd25519YaoProductRegistrationPartitionRecordV1 =
  | {
      readonly kind: typeof SHARED_RECORD_KIND;
      readonly value: RouterAbEd25519YaoProductRegistrationSharedStateV1;
    }
  | {
      readonly kind: typeof CEREMONY_RECORD_KIND;
      readonly lifecycleId: string;
      readonly value: RouterAbEd25519YaoProductRegistrationCeremonyStateV1;
    }
  | {
      readonly kind: typeof EXECUTION_RECORD_KIND;
      readonly lifecycleId: string;
      readonly value: RouterAbEd25519YaoRegistrationExecutionRecordV1;
    };

export type RouterAbEd25519YaoProductRegistrationPartitionMutationV1 = {
  readonly key: string;
  readonly value: VersionedJsonObject;
  readonly expectedVersion: string | null;
};

type DomainPartitionMutation = {
  readonly key: string;
  readonly value: RouterAbEd25519YaoProductRegistrationPartitionRecordV1;
  readonly expectedVersion: string | null;
};

export type RouterAbEd25519YaoProductRegistrationPartitionBatchResultV1 =
  | {
      readonly kind: 'stored';
      readonly versions: readonly {
        readonly key: string;
        readonly version: string;
      }[];
    }
  | { readonly kind: 'version_mismatch'; readonly key: string };

export type RouterAbEd25519YaoProductRegistrationPartitionRecordStoreV1 = {
  readonly readMany: (keys: readonly string[]) => Promise<
    readonly {
      readonly key: string;
      readonly result: VersionedJsonRecordReadResult<VersionedJsonObject>;
    }[]
  >;
  readonly putMany: (
    mutations: readonly RouterAbEd25519YaoProductRegistrationPartitionMutationV1[],
  ) => Promise<RouterAbEd25519YaoProductRegistrationPartitionBatchResultV1>;
};

export type RouterAbEd25519YaoProductRegistrationPartitionedStateV1 = {
  readonly state: RouterAbEd25519YaoProductRegistrationStateV1;
  readonly baseline: {
    readonly sharedEncoding: RouterAbEd25519YaoSharedStateCanonicalEncodingV1;
    readonly sharedVersion: string | null;
    readonly ceremonyVersion: string | null;
    readonly executionVersion: string | null;
  };
};

export type RouterAbEd25519YaoSharedStateCanonicalEncodingV1 = VersionedJsonObject;

export type RouterAbEd25519YaoProductRegistrationPartitionedStateCommitInputV1 = {
  readonly lifecycleId: string;
  readonly state: RouterAbEd25519YaoProductRegistrationStateV1;
  readonly baseline: {
    readonly sharedEncoding: RouterAbEd25519YaoSharedStateCanonicalEncodingV1;
    readonly sharedVersion: string | null;
    readonly ceremonyVersion: string | null;
    readonly executionVersion: string | null;
  };
};

export type RouterAbEd25519YaoProductRegistrationPartitionedStateCommitResultV1 =
  | {
      readonly kind: 'stored';
      readonly sharedVersion: string | null;
      readonly ceremonyVersion: string;
      readonly executionVersion: string | null;
    }
  | { readonly kind: 'version_mismatch'; readonly key: 'shared' | 'ceremony' | 'execution' };

type ExecuteRequest = Extract<
  RouterAbEd25519YaoRegistrationExecutionRecordV1,
  { readonly kind: 'claimed' }
>['request'];
type ActivationResult = Extract<
  RouterAbEd25519YaoRegistrationExecutionRecordV1,
  { readonly kind: 'completed' }
>['result'];

export type RouterAbEd25519YaoRegistrationExecutionClaimResultV1 =
  | {
      readonly kind: 'claimed';
      readonly value: Extract<
        RouterAbEd25519YaoRegistrationExecutionRecordV1,
        { readonly kind: 'claimed' }
      >;
      readonly version: string;
    }
  | { readonly kind: 'completed'; readonly value: ActivationResult }
  | { readonly kind: 'failed'; readonly value: RouterAbEd25519YaoRegistrationFailure }
  | {
      readonly kind: 'rejected';
      readonly code:
        | 'unknown_registration'
        | 'binding_mismatch'
        | 'credential_rejected'
        | 'credential_expired'
        | 'execution_in_progress';
      readonly message: string;
    };

export type RouterAbEd25519YaoRegistrationExecutionCommitResultV1 =
  | {
      readonly kind: 'stored';
      readonly value: ActivationResult | RouterAbEd25519YaoRegistrationFailure;
    }
  | { readonly kind: 'uncertain' };

export interface RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1 {
  load(lifecycleId: string): Promise<RouterAbEd25519YaoProductRegistrationPartitionedStateV1>;
  commit(
    input: RouterAbEd25519YaoProductRegistrationPartitionedStateCommitInputV1,
  ): Promise<RouterAbEd25519YaoProductRegistrationPartitionedStateCommitResultV1>;
  claimRegistrationExecution(input: {
    readonly lifecycleId: string;
    readonly request: ExecuteRequest;
    readonly requestDigestSha256Hex: string;
    readonly credentialDigestSha256Hex: string;
    readonly nowMs: number;
  }): Promise<RouterAbEd25519YaoRegistrationExecutionClaimResultV1>;
  commitRegistrationExecution(input: {
    readonly claimed: Extract<
      RouterAbEd25519YaoRegistrationExecutionRecordV1,
      { readonly kind: 'claimed' }
    >;
    readonly claimedVersion: string;
    readonly outcome:
      | { readonly kind: 'completed'; readonly result: ActivationResult }
      | { readonly kind: 'failed'; readonly failure: RouterAbEd25519YaoRegistrationFailure };
  }): Promise<RouterAbEd25519YaoRegistrationExecutionCommitResultV1>;
  consumeRegistrationExecution(
    input: RouterAbEd25519YaoActivationConsumptionRequestV1,
  ): Promise<RouterAbEd25519YaoActivationConsumptionResultV1>;
}

export function routerAbEd25519YaoPartitionedStateAfterStoredCommitV1(input: {
  readonly lifecycleId: string;
  readonly state: RouterAbEd25519YaoProductRegistrationStateV1;
  readonly commit: Extract<
    RouterAbEd25519YaoProductRegistrationPartitionedStateCommitResultV1,
    { readonly kind: 'stored' }
  >;
}): RouterAbEd25519YaoProductRegistrationPartitionedStateV1 {
  const lifecycleId = requireLifecycleId(input.lifecycleId);
  const partition = partitionRouterAbEd25519YaoProductRegistrationStateV1(input.state, lifecycleId);
  const shared = boundedRouterAbEd25519YaoProductRegistrationSharedStateV1(partition.shared);
  return {
    state: input.state,
    baseline: {
      sharedEncoding: encodeSharedStateCanonicalEncoding(shared),
      sharedVersion: input.commit.sharedVersion,
      ceremonyVersion: input.commit.ceremonyVersion,
      executionVersion: input.commit.executionVersion,
    },
  };
}

export function createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1(
  store: RouterAbEd25519YaoProductRegistrationPartitionRecordStoreV1,
  atomicPatch?: AtomicPatch,
): RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1 {
  return new RouterAbEd25519YaoProductRegistrationPartitionedStateStore(store, atomicPatch);
}

export function encodeRouterAbEd25519YaoProductRegistrationPartitionRecordV1(
  record: RouterAbEd25519YaoProductRegistrationPartitionRecordV1,
): VersionedJsonObject {
  if (record.kind === EXECUTION_RECORD_KIND) {
    return {
      kind: PARTITION_RECORD_CODEC_KIND,
      recordKind: EXECUTION_RECORD_KIND,
      lifecycleId: record.lifecycleId,
      execution: encodeRouterAbEd25519YaoRegistrationExecutionRecordV1(record.value),
    } satisfies EncodedPartitionRecord;
  }
  const lifecycleId = record.kind === SHARED_RECORD_KIND ? 'shared' : record.lifecycleId;
  const state = createRouterAbEd25519YaoProductRegistrationStateV1();
  const empty = partitionRouterAbEd25519YaoProductRegistrationStateV1(state, lifecycleId);
  const materialized = mergeRouterAbEd25519YaoProductRegistrationStatePartitionV1(state, {
    kind: 'router_ab_ed25519_yao_product_registration_state_partition_v1',
    lifecycleId,
    shared: record.kind === SHARED_RECORD_KIND ? record.value : empty.shared,
    ceremony: record.kind === CEREMONY_RECORD_KIND ? record.value : empty.ceremony,
  });
  return {
    kind: PARTITION_RECORD_CODEC_KIND,
    recordKind: record.kind,
    lifecycleId,
    state: encodeRouterAbEd25519YaoProductRegistrationStateV1(materialized),
  } satisfies EncodedPartitionRecord;
}

export function sameRouterAbEd25519YaoSharedStateCanonicalEncodingV1(
  left: RouterAbEd25519YaoSharedStateCanonicalEncodingV1,
  right: RouterAbEd25519YaoSharedStateCanonicalEncodingV1,
): boolean {
  return sameVersionedJsonObject(left, right);
}

function encodeSharedStateCanonicalEncoding(
  shared: RouterAbEd25519YaoProductRegistrationSharedStateV1,
): RouterAbEd25519YaoSharedStateCanonicalEncodingV1 {
  return encodeRouterAbEd25519YaoProductRegistrationPartitionRecordV1({
    kind: SHARED_RECORD_KIND,
    value: shared,
  });
}

function sameVersionedJsonObject(left: VersionedJsonObject, right: VersionedJsonObject): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index];
    if (key === undefined || key !== rightKeys[index]) return false;
    if (!sameVersionedJsonValue(left[key], right[key])) return false;
  }
  return true;
}

function sameVersionedJsonValue(left: VersionedJsonValue, right: VersionedJsonValue): boolean {
  if (left === null || right === null) return left === right;
  if (typeof left !== typeof right) return false;
  if (typeof left !== 'object' || typeof right !== 'object') return left === right;
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!sameVersionedJsonValue(left[index]!, right[index]!)) return false;
    }
    return true;
  }
  if (Array.isArray(right)) return false;
  if (!isVersionedJsonObject(left) || !isVersionedJsonObject(right)) return false;
  return sameVersionedJsonObject(left, right);
}

export function parseRouterAbEd25519YaoProductRegistrationPartitionRecordV1(
  input: unknown,
): RouterAbEd25519YaoProductRegistrationPartitionRecordV1 | null {
  if (!isVersionedJsonObject(input) || input.kind !== PARTITION_RECORD_CODEC_KIND) return null;
  if (input.recordKind === EXECUTION_RECORD_KIND) {
    if (!hasExactObjectKeys(input, ['kind', 'recordKind', 'lifecycleId', 'execution'])) {
      return null;
    }
    const lifecycleId = readLifecycleId(input.lifecycleId);
    const execution = parseRouterAbEd25519YaoRegistrationExecutionRecordV1(input.execution);
    return lifecycleId !== null && execution?.lifecycleId === lifecycleId
      ? { kind: EXECUTION_RECORD_KIND, lifecycleId, value: execution }
      : null;
  }
  if (input.recordKind !== SHARED_RECORD_KIND && input.recordKind !== CEREMONY_RECORD_KIND) {
    return null;
  }
  if (!hasExactObjectKeys(input, ['kind', 'recordKind', 'lifecycleId', 'state'])) return null;
  const lifecycleId = readLifecycleId(input.lifecycleId);
  if (lifecycleId === null) return null;
  const state = parseRouterAbEd25519YaoProductRegistrationStateJsonV1(input.state);
  if (state === null) return null;
  if (input.recordKind === SHARED_RECORD_KIND) {
    if (lifecycleId !== 'shared' || !isEmptyCeremonyState(state)) return null;
    const partition = partitionRouterAbEd25519YaoProductRegistrationStateV1(state, lifecycleId);
    return { kind: SHARED_RECORD_KIND, value: partition.shared };
  }
  if (!isEmptySharedState(state) || !isCeremonyStateOwnedByLifecycle(state, lifecycleId)) {
    return null;
  }
  const partition = partitionRouterAbEd25519YaoProductRegistrationStateV1(state, lifecycleId);
  if (partition.ceremony.lifecycleId !== lifecycleId) return null;
  return { kind: CEREMONY_RECORD_KIND, lifecycleId, value: partition.ceremony };
}

/** The host-neutral adapter carries only validated encoded JSON objects. */
export function parseRouterAbEd25519YaoProductRegistrationPartitionRecordJsonV1(
  input: unknown,
): VersionedJsonObject | null {
  return isVersionedJsonObject(input) ? input : null;
}

function isEmptyCeremonyState(state: RouterAbEd25519YaoProductRegistrationStateV1): boolean {
  return (
    state.registration.states.size === 0 &&
    state.registration.lifecycleSessions.size === 0 &&
    state.registration.admissionClaims.size === 0 &&
    state.authorization.authorities.length === 0 &&
    state.recovery.recoveries.size === 0 &&
    state.export.exports.size === 0
  );
}

function isEmptySharedState(state: RouterAbEd25519YaoProductRegistrationStateV1): boolean {
  return (
    state.recovery.capabilities.size === 0 &&
    state.recovery.identityCapabilities.size === 0 &&
    state.recovery.recoverySessions.size === 0 &&
    state.export.authorizationNonces.size === 0 &&
    state.export.authorizationUncertain.size === 0
  );
}

function isCeremonyStateOwnedByLifecycle(
  state: RouterAbEd25519YaoProductRegistrationStateV1,
  lifecycleId: string,
): boolean {
  for (const value of state.registration.states.values()) {
    if (value.admissionRequest.scope.lifecycle_id !== lifecycleId) return false;
  }
  for (const key of state.registration.lifecycleSessions.keys()) {
    if (key !== lifecycleId) return false;
  }
  for (const key of state.registration.admissionClaims.keys()) {
    if (key !== lifecycleId) return false;
  }
  for (const authority of state.authorization.authorities) {
    if (authority.admissionRequest.scope.lifecycle_id !== lifecycleId) return false;
  }
  for (const value of state.recovery.recoveries.values()) {
    if (value.context.admissionRequest.scope.lifecycle_id !== lifecycleId) return false;
  }
  for (const value of state.export.exports.values()) {
    if (value.request.scope.lifecycle_id !== lifecycleId) return false;
  }
  return true;
}

type AtomicPatch = (input: {
  readonly key: string;
  readonly expectedVersion: string;
  readonly exactStringPredicates: readonly {
    readonly jsonPath: string;
    readonly value: string;
  }[];
  readonly unexpired: {
    readonly jsonPath: string;
    readonly nowMs: number;
  };
  readonly patch: VersionedJsonObject;
}) => Promise<
  VersionedJsonRecordPutResult & {
    readonly value?: VersionedJsonObject;
  }
>;

class RouterAbEd25519YaoProductRegistrationPartitionedStateStore implements RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1 {
  constructor(
    private readonly store: RouterAbEd25519YaoProductRegistrationPartitionRecordStoreV1,
    private readonly atomicPatch?: AtomicPatch,
  ) {}

  private async readMany(keys: readonly string[]): Promise<
    readonly {
      readonly key: string;
      readonly result: VersionedJsonRecordReadResult<RouterAbEd25519YaoProductRegistrationPartitionRecordV1>;
    }[]
  > {
    const encodedEntries = await this.store.readMany(keys);
    const entries: {
      key: string;
      result: VersionedJsonRecordReadResult<RouterAbEd25519YaoProductRegistrationPartitionRecordV1>;
    }[] = [];
    for (const entry of encodedEntries) {
      entries.push({ key: entry.key, result: decodePartitionReadResult(entry.result) });
    }
    return entries;
  }

  private async putMany(
    mutations: readonly DomainPartitionMutation[],
  ): Promise<RouterAbEd25519YaoProductRegistrationPartitionBatchResultV1> {
    const encodedMutations: RouterAbEd25519YaoProductRegistrationPartitionMutationV1[] = [];
    for (const mutation of mutations) {
      encodedMutations.push({
        key: mutation.key,
        value: encodeRouterAbEd25519YaoProductRegistrationPartitionRecordV1(mutation.value),
        expectedVersion: mutation.expectedVersion,
      });
    }
    return await this.store.putMany(encodedMutations);
  }

  async load(
    lifecycleId: string,
  ): Promise<RouterAbEd25519YaoProductRegistrationPartitionedStateV1> {
    const normalizedLifecycleId = requireLifecycleId(lifecycleId);
    const entries = await this.readMany([
      ROUTER_AB_ED25519_YAO_SHARED_STATE_RECORD_KEY_V1,
      normalizedLifecycleId,
      routerAbEd25519YaoRegistrationExecutionRecordKeyV1(normalizedLifecycleId),
    ]);
    const sharedResult = readManyEntry(entries, ROUTER_AB_ED25519_YAO_SHARED_STATE_RECORD_KEY_V1);
    const ceremonyResult = readManyEntry(entries, normalizedLifecycleId);
    const shared = readSharedRecord(sharedResult);
    const ceremony = readCeremonyRecord(ceremonyResult, normalizedLifecycleId);
    const executionVersion = readExecutionVersion(
      readManyEntry(
        entries,
        routerAbEd25519YaoRegistrationExecutionRecordKeyV1(normalizedLifecycleId),
      ),
      normalizedLifecycleId,
    );
    return {
      state: materializeState(shared.value, ceremony.value),
      baseline: {
        sharedEncoding: encodeSharedStateCanonicalEncoding(shared.value),
        sharedVersion: shared.version,
        ceremonyVersion: ceremony.version,
        executionVersion,
      },
    };
  }

  async commit(
    input: RouterAbEd25519YaoProductRegistrationPartitionedStateCommitInputV1,
  ): Promise<RouterAbEd25519YaoProductRegistrationPartitionedStateCommitResultV1> {
    const lifecycleId = requireLifecycleId(input.lifecycleId);
    const partition = partitionRouterAbEd25519YaoProductRegistrationStateV1(
      input.state,
      lifecycleId,
    );
    const shared = boundedRouterAbEd25519YaoProductRegistrationSharedStateV1(partition.shared);
    const mutations: DomainPartitionMutation[] = [];
    if (
      !sameRouterAbEd25519YaoSharedStateCanonicalEncodingV1(
        encodeSharedStateCanonicalEncoding(shared),
        input.baseline.sharedEncoding,
      )
    ) {
      mutations.push({
        key: ROUTER_AB_ED25519_YAO_SHARED_STATE_RECORD_KEY_V1,
        value: {
          kind: 'router_ab_ed25519_yao_product_registration_shared_record_v1',
          value: shared,
        },
        expectedVersion: input.baseline.sharedVersion,
      });
    }
    mutations.push({
      key: lifecycleId,
      value: {
        kind: 'router_ab_ed25519_yao_product_registration_ceremony_record_v1',
        lifecycleId,
        value: partition.ceremony,
      },
      expectedVersion: input.baseline.ceremonyVersion,
    });
    const execution = registrationExecutionRecordFromState(input.state, lifecycleId);
    if (input.baseline.executionVersion === null && execution !== null) {
      mutations.push({
        key: routerAbEd25519YaoRegistrationExecutionRecordKeyV1(lifecycleId),
        value: { kind: EXECUTION_RECORD_KIND, lifecycleId, value: execution },
        expectedVersion: input.baseline.executionVersion,
      });
    } else if (execution !== null) {
      const key = routerAbEd25519YaoRegistrationExecutionRecordKeyV1(lifecycleId);
      const current = readManyEntry(await this.readMany([key]), key);
      if (current.kind === 'missing' || current.version !== input.baseline.executionVersion) {
        return { kind: 'version_mismatch', key: 'execution' };
      }
      if (current.value.kind !== EXECUTION_RECORD_KIND) {
        throw new Error('Yao registration execution record has an invalid kind');
      }
      const retained = current.value.value;
      if (
        retained.credentialDigestSha256Hex !== execution.credentialDigestSha256Hex ||
        retained.expiresAtMs !== execution.expiresAtMs
      ) {
        mutations.push({
          key,
          value: {
            kind: EXECUTION_RECORD_KIND,
            lifecycleId,
            value: executionWithCurrentAuthority(retained, execution),
          },
          expectedVersion: current.version,
        });
      }
    }
    const result = await this.putMany(mutations);
    if (result.kind === 'version_mismatch') {
      return {
        kind: 'version_mismatch',
        key:
          result.key === ROUTER_AB_ED25519_YAO_SHARED_STATE_RECORD_KEY_V1
            ? 'shared'
            : result.key === routerAbEd25519YaoRegistrationExecutionRecordKeyV1(lifecycleId)
              ? 'execution'
              : 'ceremony',
      };
    }
    const sharedVersion =
      mutations[0]?.key === ROUTER_AB_ED25519_YAO_SHARED_STATE_RECORD_KEY_V1
        ? findStoredVersion(result.versions, ROUTER_AB_ED25519_YAO_SHARED_STATE_RECORD_KEY_V1)
        : input.baseline.sharedVersion;
    const ceremonyVersion = findStoredVersion(result.versions, lifecycleId);
    const executionVersion = mutations.some(isRegistrationExecutionMutation)
      ? findStoredVersion(
          result.versions,
          routerAbEd25519YaoRegistrationExecutionRecordKeyV1(lifecycleId),
        )
      : input.baseline.executionVersion;
    return { kind: 'stored', sharedVersion, ceremonyVersion, executionVersion };
  }

  async claimRegistrationExecution(input: {
    readonly lifecycleId: string;
    readonly request: ExecuteRequest;
    readonly requestDigestSha256Hex: string;
    readonly credentialDigestSha256Hex: string;
    readonly nowMs: number;
  }): Promise<RouterAbEd25519YaoRegistrationExecutionClaimResultV1> {
    const lifecycleId = requireLifecycleId(input.lifecycleId);
    const key = routerAbEd25519YaoRegistrationExecutionRecordKeyV1(lifecycleId);
    const admissionBindingJson = JSON.stringify(input.request.binding);
    if (this.atomicPatch) {
      const patch = await this.atomicPatch({
        key,
        expectedVersion: '1',
        exactStringPredicates: [
          { jsonPath: '$.recordKind', value: EXECUTION_RECORD_KIND },
          { jsonPath: '$.lifecycleId', value: lifecycleId },
          { jsonPath: '$.execution.kind', value: 'ready' },
          {
            jsonPath: '$.execution.admissionBindingJson',
            value: admissionBindingJson,
          },
          {
            jsonPath: '$.execution.credentialDigestSha256Hex',
            value: input.credentialDigestSha256Hex,
          },
        ],
        unexpired: { jsonPath: '$.execution.expiresAtMs', nowMs: input.nowMs },
        patch: {
          execution: {
            kind: 'claimed',
            requestDigestSha256Hex: input.requestDigestSha256Hex,
            request: versionedJsonObject(input.request),
            claimedAtMs: input.nowMs,
            reconcileAfterMs: input.nowMs + EXECUTION_RECONCILIATION_LEASE_MS,
          },
        },
      });
      if (patch.kind === 'stored') {
        const stored = decodeAtomicPatchValue(patch.value);
        if (stored?.kind !== EXECUTION_RECORD_KIND || stored.value.kind !== 'claimed') {
          throw new Error('Yao registration atomic claim returned an invalid execution record');
        }
        return { kind: 'claimed', value: stored.value, version: patch.version };
      }
    }
    return await this.reconcileRegistrationExecutionClaim(input);
  }

  async commitRegistrationExecution(input: {
    readonly claimed: Extract<
      RouterAbEd25519YaoRegistrationExecutionRecordV1,
      { readonly kind: 'claimed' }
    >;
    readonly claimedVersion: string;
    readonly outcome:
      | { readonly kind: 'completed'; readonly result: ActivationResult }
      | { readonly kind: 'failed'; readonly failure: RouterAbEd25519YaoRegistrationFailure };
  }): Promise<RouterAbEd25519YaoRegistrationExecutionCommitResultV1> {
    const terminal: RouterAbEd25519YaoRegistrationExecutionRecordV1 =
      input.outcome.kind === 'completed'
        ? {
            ...input.claimed,
            kind: 'completed',
            result: input.outcome.result,
            consumerBinding: null,
          }
        : { ...input.claimed, kind: 'failed', failure: input.outcome.failure };
    const key = routerAbEd25519YaoRegistrationExecutionRecordKeyV1(input.claimed.lifecycleId);
    const stored = await this.putMany([
      {
        key,
        value: {
          kind: EXECUTION_RECORD_KIND,
          lifecycleId: input.claimed.lifecycleId,
          value: terminal,
        },
        expectedVersion: input.claimedVersion,
      },
    ]);
    if (stored.kind === 'stored') {
      return {
        kind: 'stored',
        value: terminal.kind === 'completed' ? terminal.result : terminal.failure,
      };
    }
    const current = await this.readRegistrationExecution(input.claimed.lifecycleId);
    if (
      current?.kind === terminal.kind &&
      current.requestDigestSha256Hex === input.claimed.requestDigestSha256Hex
    ) {
      if (
        terminal.kind === 'completed' &&
        current.kind === 'completed' &&
        sameActivationResult(current.result, terminal.result)
      ) {
        return { kind: 'stored', value: current.result };
      }
      if (
        terminal.kind === 'failed' &&
        current.kind === 'failed' &&
        sameRegistrationFailure(current.failure, terminal.failure)
      ) {
        return { kind: 'stored', value: current.failure };
      }
    }
    return { kind: 'uncertain' };
  }

  async consumeRegistrationExecution(
    input: RouterAbEd25519YaoActivationConsumptionRequestV1,
  ): Promise<RouterAbEd25519YaoActivationConsumptionResultV1> {
    const lifecycleId = requireLifecycleId(input.reference.lifecycleId);
    const key = routerAbEd25519YaoRegistrationExecutionRecordKeyV1(lifecycleId);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const entry = readManyEntry(await this.readMany([key]), key);
      if (entry.kind === 'missing') {
        return {
          ok: false,
          code: 'unknown_registration',
          message: 'registration lifecycle was not found',
        };
      }
      if (entry.value.kind !== EXECUTION_RECORD_KIND || entry.value.lifecycleId !== lifecycleId) {
        throw new Error('Yao registration execution record does not match its lifecycle');
      }
      const execution = entry.value.value;
      if (execution.kind !== 'completed') {
        return {
          ok: false,
          code: 'registration_not_activated',
          message: 'registration lifecycle has no verified Yao activation',
        };
      }
      if (!sameByteSequence(execution.result.binding.session_id, input.reference.sessionId)) {
        return {
          ok: false,
          code: 'activation_reference_mismatch',
          message: 'Yao activation reference does not match the admitted registration',
        };
      }
      if (
        execution.consumerBinding !== null &&
        execution.consumerBinding !== input.consumerBinding
      ) {
        return {
          ok: false,
          code: 'activation_consumed',
          message: 'Yao activation was already consumed by wallet finalization',
        };
      }
      if (execution.consumerBinding !== null) {
        return {
          ok: true,
          activation: {
            admissionRequest: execution.admissionRequest,
            admissionReceipt: execution.admissionReceipt,
            result: execution.result,
          },
        };
      }
      const consumed = { ...execution, consumerBinding: input.consumerBinding };
      const result = await this.putMany([
        {
          key,
          value: { kind: EXECUTION_RECORD_KIND, lifecycleId, value: consumed },
          expectedVersion: entry.version,
        },
      ]);
      if (result.kind === 'stored') {
        return {
          ok: true,
          activation: {
            admissionRequest: execution.admissionRequest,
            admissionReceipt: execution.admissionReceipt,
            result: execution.result,
          },
        };
      }
    }
    throw new Error('Yao registration execution consumer claim did not converge');
  }

  private async reconcileRegistrationExecutionClaim(input: {
    readonly lifecycleId: string;
    readonly request: ExecuteRequest;
    readonly requestDigestSha256Hex: string;
    readonly credentialDigestSha256Hex: string;
    readonly nowMs: number;
  }): Promise<RouterAbEd25519YaoRegistrationExecutionClaimResultV1> {
    const lifecycleId = requireLifecycleId(input.lifecycleId);
    const key = routerAbEd25519YaoRegistrationExecutionRecordKeyV1(lifecycleId);
    const entry = readManyEntry(await this.readMany([key]), key);
    if (entry.kind === 'missing') {
      return {
        kind: 'rejected',
        code: 'unknown_registration',
        message: 'registration admission was not found',
      };
    }
    if (entry.value.kind !== EXECUTION_RECORD_KIND || entry.value.lifecycleId !== lifecycleId) {
      throw new Error('Yao registration execution record does not match its lifecycle');
    }
    const execution = entry.value.value;
    if (!routerAbEd25519YaoExecutionMatchesAdmissionV1(input.request, execution.admissionReceipt)) {
      return {
        kind: 'rejected',
        code: 'binding_mismatch',
        message: 'registration execution does not match the admitted binding',
      };
    }
    if (execution.credentialDigestSha256Hex !== input.credentialDigestSha256Hex) {
      return {
        kind: 'rejected',
        code: 'credential_rejected',
        message: 'registration execution credential does not match its admission subject',
      };
    }
    if (execution.expiresAtMs <= input.nowMs) {
      return {
        kind: 'rejected',
        code: 'credential_expired',
        message: 'registration intent credential is expired',
      };
    }
    switch (execution.kind) {
      case 'completed':
        return execution.requestDigestSha256Hex === input.requestDigestSha256Hex
          ? { kind: 'completed', value: execution.result }
          : {
              kind: 'rejected',
              code: 'binding_mismatch',
              message: 'completed registration rejects a different execution payload',
            };
      case 'failed':
        return execution.requestDigestSha256Hex === input.requestDigestSha256Hex
          ? { kind: 'failed', value: execution.failure }
          : {
              kind: 'rejected',
              code: 'binding_mismatch',
              message: 'failed registration rejects a different execution payload',
            };
      case 'claimed':
        if (execution.requestDigestSha256Hex !== input.requestDigestSha256Hex) {
          return {
            kind: 'rejected',
            code: 'execution_in_progress',
            message: 'registration execution is already in progress',
          };
        }
        if (execution.reconcileAfterMs > input.nowMs) {
          return {
            kind: 'rejected',
            code: 'execution_in_progress',
            message: 'registration execution is already in progress',
          };
        }
        return await this.renewRegistrationExecutionClaim(execution, entry.version, input.nowMs);
      case 'ready': {
        const claimed: RouterAbEd25519YaoRegistrationExecutionRecordV1 = {
          ...execution,
          kind: 'claimed',
          requestDigestSha256Hex: input.requestDigestSha256Hex,
          request: input.request,
          claimedAtMs: input.nowMs,
          reconcileAfterMs: input.nowMs + EXECUTION_RECONCILIATION_LEASE_MS,
        };
        const result = await this.putMany([
          {
            key,
            value: { kind: EXECUTION_RECORD_KIND, lifecycleId, value: claimed },
            expectedVersion: entry.version,
          },
        ]);
        return result.kind === 'stored'
          ? {
              kind: 'claimed',
              value: claimed,
              version: findStoredVersion(result.versions, key),
            }
          : await this.reconcileRegistrationExecutionClaim(input);
      }
    }
  }

  private async renewRegistrationExecutionClaim(
    execution: Extract<
      RouterAbEd25519YaoRegistrationExecutionRecordV1,
      { readonly kind: 'claimed' }
    >,
    expectedVersion: string,
    nowMs: number,
  ): Promise<RouterAbEd25519YaoRegistrationExecutionClaimResultV1> {
    const renewed = {
      ...execution,
      claimedAtMs: nowMs,
      reconcileAfterMs: nowMs + EXECUTION_RECONCILIATION_LEASE_MS,
    };
    const key = routerAbEd25519YaoRegistrationExecutionRecordKeyV1(execution.lifecycleId);
    const result = await this.putMany([
      {
        key,
        value: {
          kind: EXECUTION_RECORD_KIND,
          lifecycleId: execution.lifecycleId,
          value: renewed,
        },
        expectedVersion,
      },
    ]);
    return result.kind === 'stored'
      ? {
          kind: 'claimed',
          value: renewed,
          version: findStoredVersion(result.versions, key),
        }
      : {
          kind: 'rejected',
          code: 'execution_in_progress',
          message: 'registration execution reconciliation was claimed concurrently',
        };
  }

  private async readRegistrationExecution(
    lifecycleId: string,
  ): Promise<RouterAbEd25519YaoRegistrationExecutionRecordV1 | null> {
    const key = routerAbEd25519YaoRegistrationExecutionRecordKeyV1(lifecycleId);
    const entry = readManyEntry(await this.readMany([key]), key);
    if (entry.kind === 'missing') return null;
    if (entry.value.kind !== EXECUTION_RECORD_KIND || entry.value.lifecycleId !== lifecycleId) {
      throw new Error('Yao registration execution record does not match its lifecycle');
    }
    return entry.value.value;
  }
}

function isRegistrationExecutionMutation(mutation: DomainPartitionMutation): boolean {
  return mutation.value.kind === EXECUTION_RECORD_KIND;
}

function executionWithCurrentAuthority(
  retained: RouterAbEd25519YaoRegistrationExecutionRecordV1,
  authority: RouterAbEd25519YaoRegistrationExecutionRecordV1,
): RouterAbEd25519YaoRegistrationExecutionRecordV1 {
  if (
    retained.lifecycleId !== authority.lifecycleId ||
    retained.admissionBindingJson !== authority.admissionBindingJson
  ) {
    throw new Error('NEAR continuation changed its execution identity');
  }
  const common = {
    lifecycleId: retained.lifecycleId,
    admissionRequest: retained.admissionRequest,
    admissionReceipt: retained.admissionReceipt,
    admissionBindingJson: retained.admissionBindingJson,
    credentialDigestSha256Hex: authority.credentialDigestSha256Hex,
    expiresAtMs: authority.expiresAtMs,
  };
  switch (retained.kind) {
    case 'ready':
      return { kind: 'ready', ...common };
    case 'claimed':
      return {
        kind: 'claimed',
        ...common,
        requestDigestSha256Hex: retained.requestDigestSha256Hex,
        request: retained.request,
        claimedAtMs: retained.claimedAtMs,
        reconcileAfterMs: retained.reconcileAfterMs,
      };
    case 'completed':
      return {
        kind: 'completed',
        ...common,
        requestDigestSha256Hex: retained.requestDigestSha256Hex,
        request: retained.request,
        claimedAtMs: retained.claimedAtMs,
        reconcileAfterMs: retained.reconcileAfterMs,
        result: retained.result,
        consumerBinding: retained.consumerBinding,
      };
    case 'failed':
      return {
        kind: 'failed',
        ...common,
        requestDigestSha256Hex: retained.requestDigestSha256Hex,
        request: retained.request,
        claimedAtMs: retained.claimedAtMs,
        reconcileAfterMs: retained.reconcileAfterMs,
        failure: retained.failure,
      };
  }
}

type ActivationClientPackage =
  | RouterAbEd25519YaoActivationClientPackageV1<'deriver_a'>
  | RouterAbEd25519YaoActivationClientPackageV1<'deriver_b'>;

function sameActivationResult(left: ActivationResult, right: ActivationResult): boolean {
  return (
    sameRouterAbEd25519YaoActivationBindingV1(left.binding, right.binding) &&
    sameActivationClientPackage(left.deriver_a_client_package, right.deriver_a_client_package) &&
    sameActivationClientPackage(left.deriver_b_client_package, right.deriver_b_client_package) &&
    sameActivationPublicReceipt(left.public_receipt, right.public_receipt)
  );
}

function sameActivationClientPackage(
  left: ActivationClientPackage,
  right: ActivationClientPackage,
): boolean {
  return (
    left.kind === right.kind &&
    left.deriver === right.deriver &&
    sameByteSequence(left.session, right.session) &&
    sameByteSequence(left.transcript, right.transcript) &&
    sameByteSequence(left.encapsulated_key, right.encapsulated_key) &&
    sameByteSequence(left.ciphertext, right.ciphertext)
  );
}

function sameActivationPublicReceipt(
  left: ActivationResult['public_receipt'],
  right: ActivationResult['public_receipt'],
): boolean {
  return (
    sameByteSequence(left.transcript, right.transcript) &&
    sameByteSequence(left.registered_public_key, right.registered_public_key) &&
    sameByteSequence(left.joined_client_commitment, right.joined_client_commitment) &&
    sameByteSequence(
      left.joined_signing_worker_commitment,
      right.joined_signing_worker_commitment,
    ) &&
    sameByteSequence(left.signing_worker_verifying_share, right.signing_worker_verifying_share) &&
    left.state_epoch === right.state_epoch &&
    sameRouterAbMpcMaterialActivationRef(left.material_activation, right.material_activation)
  );
}

function sameRegistrationFailure(
  left: RouterAbEd25519YaoRegistrationFailure,
  right: RouterAbEd25519YaoRegistrationFailure,
): boolean {
  return left.status === right.status && left.code === right.code && left.message === right.message;
}

function sameByteSequence(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

type ReadPartitionRecordResult = {
  readonly value: RouterAbEd25519YaoProductRegistrationSharedStateV1;
  readonly version: string | null;
};

function decodePartitionReadResult(
  result: VersionedJsonRecordReadResult<VersionedJsonObject>,
): VersionedJsonRecordReadResult<RouterAbEd25519YaoProductRegistrationPartitionRecordV1> {
  if (result.kind === 'missing') return result;
  const parsed = parseRouterAbEd25519YaoProductRegistrationPartitionRecordV1(result.value);
  if (parsed === null) throw new Error('Router A/B partition record is invalid');
  return { kind: 'present', value: parsed, version: result.version };
}

function decodeAtomicPatchValue(
  value: VersionedJsonObject | undefined,
): RouterAbEd25519YaoProductRegistrationPartitionRecordV1 | undefined {
  if (value === undefined) return undefined;
  const parsed = parseRouterAbEd25519YaoProductRegistrationPartitionRecordV1(value);
  if (parsed === null) throw new Error('Router A/B atomic patch returned an invalid record');
  return parsed;
}

function readManyEntry<T>(
  entries: readonly { readonly key: string; readonly result: T }[],
  key: string,
): T {
  const entry = entries.find((candidate) => candidate.key === key);
  if (!entry) throw new Error(`Router A/B batch read omitted ${key}`);
  return entry.result;
}

type ReadCeremonyRecordResult = {
  readonly value: RouterAbEd25519YaoProductRegistrationCeremonyStateV1;
  readonly version: string | null;
};

function readSharedRecord(
  result: VersionedJsonRecordReadResult<RouterAbEd25519YaoProductRegistrationPartitionRecordV1>,
): ReadPartitionRecordResult {
  if (result.kind === 'missing') {
    const empty = partitionRouterAbEd25519YaoProductRegistrationStateV1(
      createRouterAbEd25519YaoProductRegistrationStateV1(),
      'initial',
    );
    return { value: empty.shared, version: null };
  }
  if (result.value.kind !== 'router_ab_ed25519_yao_product_registration_shared_record_v1') {
    throw new Error('Router A/B shared state record has an invalid kind');
  }
  return { value: result.value.value, version: result.version };
}

function readCeremonyRecord(
  result: VersionedJsonRecordReadResult<RouterAbEd25519YaoProductRegistrationPartitionRecordV1>,
  lifecycleId: string,
): ReadCeremonyRecordResult {
  if (result.kind === 'missing') {
    const empty = partitionRouterAbEd25519YaoProductRegistrationStateV1(
      createRouterAbEd25519YaoProductRegistrationStateV1(),
      lifecycleId,
    );
    return { value: empty.ceremony, version: null };
  }
  if (
    result.value.kind !== 'router_ab_ed25519_yao_product_registration_ceremony_record_v1' ||
    result.value.lifecycleId !== lifecycleId ||
    result.value.value.lifecycleId !== lifecycleId
  ) {
    throw new Error('Router A/B ceremony state record does not match its lifecycle key');
  }
  return { value: result.value.value, version: result.version };
}

function readExecutionVersion(
  result: VersionedJsonRecordReadResult<RouterAbEd25519YaoProductRegistrationPartitionRecordV1>,
  lifecycleId: string,
): string | null {
  if (result.kind === 'missing') return null;
  if (
    result.value.kind !== EXECUTION_RECORD_KIND ||
    result.value.lifecycleId !== lifecycleId ||
    result.value.value.lifecycleId !== lifecycleId
  ) {
    throw new Error('Router A/B execution record does not match its lifecycle key');
  }
  return result.version;
}

function registrationExecutionRecordFromState(
  state: RouterAbEd25519YaoProductRegistrationStateV1,
  lifecycleId: string,
): RouterAbEd25519YaoRegistrationExecutionRecordV1 | null {
  const sessionKey = state.registration.lifecycleSessions.get(lifecycleId);
  const registration =
    sessionKey === undefined ? undefined : state.registration.states.get(sessionKey);
  const authority = state.authorization.authorities.find(
    (candidate) => candidate.admissionRequest.scope.lifecycle_id === lifecycleId,
  );
  if (!registration || registration.kind !== 'admitted' || !authority) {
    return null;
  }
  return buildRouterAbEd25519YaoRegistrationExecutionReadyRecordV1({
    lifecycleId,
    registration,
    authority,
  });
}

function materializeState(
  shared: RouterAbEd25519YaoProductRegistrationSharedStateV1,
  ceremony: RouterAbEd25519YaoProductRegistrationCeremonyStateV1,
): RouterAbEd25519YaoProductRegistrationStateV1 {
  const state = createRouterAbEd25519YaoProductRegistrationStateV1();
  return mergeRouterAbEd25519YaoProductRegistrationStatePartitionV1(state, {
    kind: 'router_ab_ed25519_yao_product_registration_state_partition_v1',
    lifecycleId: ceremony.lifecycleId,
    shared,
    ceremony,
  });
}

function findStoredVersion(
  versions: readonly { readonly key: string; readonly version: string }[],
  key: string,
): string {
  const entry = versions.find((candidate) => candidate.key === key);
  if (!entry) throw new Error(`Router A/B batch result omitted ${key}`);
  return entry.version;
}

function requireLifecycleId(value: string): string {
  if (!isVisibleLifecycleId(value)) throw new Error('Router A/B lifecycle ID is invalid');
  return value;
}

function isVisibleLifecycleId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    /^[\x21-\x7e]+$/u.test(value)
  );
}

function readLifecycleId(value: unknown): string | null {
  return isVisibleLifecycleId(value) ? value : null;
}

function hasExactObjectKeys(
  input: VersionedJsonObject,
  expectedFields: readonly string[],
): boolean {
  const actualFields = Object.keys(input);
  if (actualFields.length !== expectedFields.length) return false;
  const expected = new Set(expectedFields);
  return actualFields.every((field) => expected.has(field));
}

function versionedJsonObject(input: unknown): VersionedJsonObject {
  const value = JSON.parse(JSON.stringify(input));
  if (!isVersionedJsonObject(value)) {
    throw new Error('Router A/B execution request is not canonical JSON');
  }
  return value;
}

function isVersionedJsonObject(input: unknown): input is VersionedJsonObject {
  return (
    typeof input === 'object' &&
    input !== null &&
    !Array.isArray(input) &&
    Object.values(input).every(isVersionedJsonValue)
  );
}

function isVersionedJsonValue(input: unknown): input is VersionedJsonValue {
  if (
    input === null ||
    typeof input === 'string' ||
    typeof input === 'boolean' ||
    typeof input === 'number'
  ) {
    return typeof input !== 'number' || Number.isFinite(input);
  }
  if (Array.isArray(input)) return input.every(isVersionedJsonValue);
  return isVersionedJsonObject(input);
}

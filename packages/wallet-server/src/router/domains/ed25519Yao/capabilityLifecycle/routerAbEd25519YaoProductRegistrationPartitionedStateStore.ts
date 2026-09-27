import type {
  VersionedJsonObject,
  VersionedJsonRecordReadResult,
  VersionedJsonValue,
} from '../../../framework/versionedJsonRecordStore';
import type { D1PreparedStatementLike } from '../../../../storage/tenantRoute';
import {
  buildRouterAbEd25519YaoRegistrationExecutionAuthorityV1,
  type RouterAbEd25519YaoRegistrationExecutionAuthorityV1,
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

type EncodedPartitionRecord = {
  readonly kind: typeof PARTITION_RECORD_CODEC_KIND;
  readonly recordKind: typeof SHARED_RECORD_KIND | typeof CEREMONY_RECORD_KIND;
  readonly lifecycleId: string;
  readonly state: VersionedJsonObject;
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

/**
 * Writes another store prepared on the same signer database, which commit in
 * the batch of a state commit or not at all.
 */
export type RouterAbEd25519YaoPreparedWriteV1 = {
  readonly statements: readonly D1PreparedStatementLike[];
};

export type RouterAbEd25519YaoProductRegistrationPartitionRecordStoreV1 = {
  readonly readMany: (keys: readonly string[]) => Promise<
    readonly {
      readonly key: string;
      readonly result: VersionedJsonRecordReadResult<VersionedJsonObject>;
    }[]
  >;
  readonly putMany: (
    mutations: readonly RouterAbEd25519YaoProductRegistrationPartitionMutationV1[],
    companion: RouterAbEd25519YaoPreparedWriteV1 | null,
  ) => Promise<RouterAbEd25519YaoProductRegistrationPartitionBatchResultV1>;
};

export type RouterAbEd25519YaoProductRegistrationPartitionedStateV1 = {
  readonly state: RouterAbEd25519YaoProductRegistrationStateV1;
  readonly baseline: {
    readonly sharedEncoding: RouterAbEd25519YaoSharedStateCanonicalEncodingV1;
    readonly sharedVersion: string | null;
    readonly ceremonyVersion: string | null;
  };
};

export type RouterAbEd25519YaoSharedStateCanonicalEncodingV1 = VersionedJsonObject;

export type RouterAbEd25519YaoProductRegistrationPartitionedStateCommitInputV1 = {
  readonly lifecycleId: string;
  readonly state: RouterAbEd25519YaoProductRegistrationStateV1;
  /** Another store's writes that commit with this state or not at all. */
  readonly companionWrite?: RouterAbEd25519YaoPreparedWriteV1;
  readonly baseline: {
    readonly sharedEncoding: RouterAbEd25519YaoSharedStateCanonicalEncodingV1;
    readonly sharedVersion: string | null;
    readonly ceremonyVersion: string | null;
  };
};

export type RouterAbEd25519YaoProductRegistrationPartitionedStateCommitResultV1 =
  | {
      readonly kind: 'stored';
      readonly sharedVersion: string | null;
      readonly ceremonyVersion: string;
    }
  | { readonly kind: 'version_mismatch'; readonly key: 'shared' | 'ceremony' };

export interface RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1 {
  load(lifecycleId: string): Promise<RouterAbEd25519YaoProductRegistrationPartitionedStateV1>;
  commit(
    input: RouterAbEd25519YaoProductRegistrationPartitionedStateCommitInputV1,
  ): Promise<RouterAbEd25519YaoProductRegistrationPartitionedStateCommitResultV1>;
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
    },
  };
}

export function createRouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1(
  store: RouterAbEd25519YaoProductRegistrationPartitionRecordStoreV1,
): RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1 {
  return new RouterAbEd25519YaoProductRegistrationPartitionedStateStore(store);
}

/**
 * The admitted authority a registration execute is checked against, from a
 * loaded ceremony state, or `null` when the lifecycle is not admitted.
 */
export function routerAbEd25519YaoAdmittedRegistrationAuthorityV1(
  state: RouterAbEd25519YaoProductRegistrationStateV1,
  lifecycleId: string,
): RouterAbEd25519YaoRegistrationExecutionAuthorityV1 | null {
  const sessionKey = state.registration.lifecycleSessions.get(lifecycleId);
  const registration =
    sessionKey === undefined ? undefined : state.registration.states.get(sessionKey);
  const authority = state.authorization.authorities.find(
    (candidate) => candidate.admissionRequest.scope.lifecycle_id === lifecycleId,
  );
  if (!registration || registration.kind !== 'admitted' || !authority) {
    return null;
  }
  return buildRouterAbEd25519YaoRegistrationExecutionAuthorityV1({
    lifecycleId,
    registration,
    authority,
    dispatchRoot: state.registration.dispatchRoots.get(lifecycleId),
  });
}

export function encodeRouterAbEd25519YaoProductRegistrationPartitionRecordV1(
  record: RouterAbEd25519YaoProductRegistrationPartitionRecordV1,
): VersionedJsonObject {
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

class RouterAbEd25519YaoProductRegistrationPartitionedStateStore implements RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1 {
  constructor(
    private readonly store: RouterAbEd25519YaoProductRegistrationPartitionRecordStoreV1,
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
    companion: RouterAbEd25519YaoPreparedWriteV1 | null,
  ): Promise<RouterAbEd25519YaoProductRegistrationPartitionBatchResultV1> {
    const encodedMutations: RouterAbEd25519YaoProductRegistrationPartitionMutationV1[] = [];
    for (const mutation of mutations) {
      encodedMutations.push({
        key: mutation.key,
        value: encodeRouterAbEd25519YaoProductRegistrationPartitionRecordV1(mutation.value),
        expectedVersion: mutation.expectedVersion,
      });
    }
    return await this.store.putMany(encodedMutations, companion);
  }

  async load(
    lifecycleId: string,
  ): Promise<RouterAbEd25519YaoProductRegistrationPartitionedStateV1> {
    const normalizedLifecycleId = requireLifecycleId(lifecycleId);
    const entries = await this.readMany([
      ROUTER_AB_ED25519_YAO_SHARED_STATE_RECORD_KEY_V1,
      normalizedLifecycleId,
    ]);
    const sharedResult = readManyEntry(entries, ROUTER_AB_ED25519_YAO_SHARED_STATE_RECORD_KEY_V1);
    const ceremonyResult = readManyEntry(entries, normalizedLifecycleId);
    const shared = readSharedRecord(sharedResult);
    const ceremony = readCeremonyRecord(ceremonyResult, normalizedLifecycleId);
    return {
      state: materializeState(shared.value, ceremony.value),
      baseline: {
        sharedEncoding: encodeSharedStateCanonicalEncoding(shared.value),
        sharedVersion: shared.version,
        ceremonyVersion: ceremony.version,
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
    const result = await this.putMany(mutations, input.companionWrite ?? null);
    if (result.kind === 'version_mismatch') {
      return {
        kind: 'version_mismatch',
        key: result.key === ROUTER_AB_ED25519_YAO_SHARED_STATE_RECORD_KEY_V1 ? 'shared' : 'ceremony',
      };
    }
    const sharedVersion =
      mutations[0]?.key === ROUTER_AB_ED25519_YAO_SHARED_STATE_RECORD_KEY_V1
        ? findStoredVersion(result.versions, ROUTER_AB_ED25519_YAO_SHARED_STATE_RECORD_KEY_V1)
        : input.baseline.sharedVersion;
    const ceremonyVersion = findStoredVersion(result.versions, lifecycleId);
    return { kind: 'stored', sharedVersion, ceremonyVersion };
  }
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

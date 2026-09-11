import {
  ROUTER_AB_ED25519_YAO_EXPORT_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_EXPORT_EXECUTE_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_ACTIVATE_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_RECOVERY_EXECUTE_PATH_V1,
  ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1,
} from '@shared/utils/routerAbEd25519Yao';
import type {
  VersionedJsonObject,
  VersionedJsonRecordPutResult,
  VersionedJsonRecordReadResult,
  VersionedJsonValue,
} from '../../../framework/versionedJsonRecordStore';
import {
  parseRouterAbEd25519YaoProductRegistrationStateV1,
  type RouterAbEd25519YaoProductRegistrationStateV1,
} from './routerAbEd25519YaoProductRegistration';

/**
 * A request-boundary key. It is intentionally limited to the opaque lifecycle
 * identifier already present in a validated Yao request; no wallet or account
 * value is accepted as a persistence partition key.
 */
export type RouterAbEd25519YaoCeremonyKeyV1 = {
  readonly kind: 'router_ab_ed25519_yao_ceremony_key_v1';
  readonly lifecycleId: string;
};

export type RouterAbEd25519YaoCeremonyKeyResolutionV1 =
  | { readonly kind: 'ceremony'; readonly value: RouterAbEd25519YaoCeremonyKeyV1 }
  | { readonly kind: 'none' }
  | { readonly kind: 'invalid'; readonly message: string };

/**
 * The persistence adapter used by a future request-scoped composition. The
 * adapter owns one record per ceremony and must implement an atomic version
 * check for every update. The generic Cloudflare JSON adapter can satisfy this
 * contract without exposing raw Durable Object storage to lifecycle code.
 */
export interface RouterAbEd25519YaoCeremonyStateStoreV1 {
  read(
    key: RouterAbEd25519YaoCeremonyKeyV1,
  ): Promise<VersionedJsonRecordReadResult<RouterAbEd25519YaoProductRegistrationStateV1>>;
  put(
    key: RouterAbEd25519YaoCeremonyKeyV1,
    value: RouterAbEd25519YaoProductRegistrationStateV1,
    expectedVersion: string | null,
  ): Promise<VersionedJsonRecordPutResult>;
}

type VersionedJsonStoreLike<T> = {
  read(key: string): Promise<VersionedJsonRecordReadResult<T>>;
  put(key: string, value: T, expectedVersion: string | null): Promise<VersionedJsonRecordPutResult>;
};

/** Bind the generic JSON adapter to the validated opaque ceremony key. */
export function createRouterAbEd25519YaoCeremonyStateStoreV1(
  store: VersionedJsonStoreLike<RouterAbEd25519YaoProductRegistrationStateV1>,
): RouterAbEd25519YaoCeremonyStateStoreV1 {
  return {
    read: async (key) => await store.read(key.lifecycleId),
    put: async (key, value, expectedVersion) =>
      await store.put(key.lifecycleId, value, expectedVersion),
  };
}

type EncodedStateValue = VersionedJsonValue;

const CODEC_KIND = 'router_ab_ed25519_yao_product_registration_state_json_v1';
const MAP_KIND = 'map_v1';
const SET_KIND = 'set_v1';
const BYTES_KIND = 'bytes_v1';

type EncodedMap = {
  readonly __seamsType: typeof MAP_KIND;
  readonly entries: readonly (readonly [string, EncodedStateValue])[];
};

type EncodedSet = {
  readonly __seamsType: typeof SET_KIND;
  readonly values: readonly EncodedStateValue[];
};

type EncodedBytes = {
  readonly __seamsType: typeof BYTES_KIND;
  readonly values: readonly number[];
};

type EncodedStateObject = {
  readonly [key: string]: EncodedStateValue;
};

type EncodedStateRecord = {
  readonly kind: typeof CODEC_KIND;
  readonly state: EncodedStateObject;
};

export function encodeRouterAbEd25519YaoProductRegistrationStateV1(
  state: RouterAbEd25519YaoProductRegistrationStateV1,
): VersionedJsonObject {
  const encoded = encodeStateValue(state);
  if (!isEncodedStateObject(encoded)) {
    throw new Error('Ed25519 Yao product state must encode to a JSON object');
  }
  return {
    kind: CODEC_KIND,
    state: encoded,
  } satisfies EncodedStateRecord;
}

export function parseRouterAbEd25519YaoProductRegistrationStateJsonV1(
  input: unknown,
): RouterAbEd25519YaoProductRegistrationStateV1 | null {
  const record = exactRouterAbEd25519YaoProductRegistrationStateEnvelopeV1(input);
  if (record === null || record.kind !== CODEC_KIND) return null;
  const decoded = decodeRouterAbEd25519YaoProductRegistrationStateValueV1(record.state);
  if (!decoded.ok || !isRouterAbEd25519YaoProductRegistrationJsonObjectV1(decoded.value)) {
    return null;
  }
  const parsed = parseRouterAbEd25519YaoProductRegistrationStateV1(decoded.value);
  return parsed.ok ? parsed.value : null;
}

export function parseRouterAbEd25519YaoCeremonyKeyV1(
  input: unknown,
): RouterAbEd25519YaoCeremonyKeyV1 | null {
  const record = readRouterAbEd25519YaoCeremonyKeyObjectV1(input);
  if (record === null) return null;
  const lifecycleId = record.lifecycleId;
  if (!isVisibleLifecycleId(lifecycleId)) return null;
  return {
    kind: 'router_ab_ed25519_yao_ceremony_key_v1',
    lifecycleId,
  };
}

/**
 * Resolve only fields owned by the route's wire contract. This function does
 * not recursively search arbitrary JSON, which prevents unrelated identifiers
 * from silently becoming persistence keys.
 */
export async function resolveRouterAbEd25519YaoCeremonyKeyFromRequestV1(
  request: Request,
): Promise<RouterAbEd25519YaoCeremonyKeyResolutionV1> {
  const pathname = new URL(request.url).pathname;
  const source = ceremonyFieldSource(pathname);
  if (source.kind === 'none') return source;

  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return { kind: 'invalid', message: 'Yao ceremony request body must be valid JSON' };
  }
  const lifecycleId = readLifecycleId(body, source.field);
  if (lifecycleId === null) {
    return { kind: 'invalid', message: 'Yao ceremony lifecycle_id is required' };
  }
  if (!isVisibleLifecycleId(lifecycleId)) {
    return { kind: 'invalid', message: 'Yao ceremony lifecycle_id is invalid' };
  }
  return {
    kind: 'ceremony',
    value: {
      kind: 'router_ab_ed25519_yao_ceremony_key_v1',
      lifecycleId,
    },
  };
}

type CeremonyField =
  | 'scope.lifecycle_id'
  | 'binding.lifecycle.lifecycle_id'
  | 'binding.ceremony.lifecycle.lifecycle_id'
  | 'ed25519.activationReference.lifecycle_id';

type CeremonyFieldSource =
  | { readonly kind: 'none' }
  | { readonly kind: 'field'; readonly field: CeremonyField };

function ceremonyFieldSource(pathname: string): CeremonyFieldSource {
  switch (pathname) {
    case ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1:
    case ROUTER_AB_ED25519_YAO_RECOVERY_ADMISSION_PATH_V1:
    case ROUTER_AB_ED25519_YAO_EXPORT_ADMISSION_PATH_V1:
      return { kind: 'field', field: 'scope.lifecycle_id' };
    case ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1:
    case ROUTER_AB_ED25519_YAO_RECOVERY_EXECUTE_PATH_V1:
    case ROUTER_AB_ED25519_YAO_RECOVERY_ACTIVATE_PATH_V1:
      return { kind: 'field', field: 'binding.lifecycle.lifecycle_id' };
    case ROUTER_AB_ED25519_YAO_EXPORT_EXECUTE_PATH_V1:
      return { kind: 'field', field: 'binding.ceremony.lifecycle.lifecycle_id' };
    default:
      return /^\/wallets\/[^/]+\/signers\/finalize$/u.test(pathname)
        ? { kind: 'field', field: 'ed25519.activationReference.lifecycle_id' }
        : { kind: 'none' };
  }
}

function readLifecycleId(input: unknown, field: CeremonyField): string | null {
  if (!isRouterAbEd25519YaoProductRegistrationJsonObjectV1(input)) return null;
  switch (field) {
    case 'scope.lifecycle_id':
      return readRouterAbEd25519YaoProductRegistrationLifecycleStringV1(input.scope);
    case 'binding.lifecycle.lifecycle_id':
      return readRouterAbEd25519YaoProductRegistrationLifecycleStringV1(
        isRouterAbEd25519YaoProductRegistrationJsonObjectV1(input.binding)
          ? input.binding.lifecycle
          : null,
      );
    case 'binding.ceremony.lifecycle.lifecycle_id': {
      const binding = isRouterAbEd25519YaoProductRegistrationJsonObjectV1(input.binding)
        ? input.binding
        : null;
      const ceremony = isRouterAbEd25519YaoProductRegistrationJsonObjectV1(binding?.ceremony)
        ? binding.ceremony
        : null;
      return readRouterAbEd25519YaoProductRegistrationLifecycleStringV1(
        isRouterAbEd25519YaoProductRegistrationJsonObjectV1(ceremony?.lifecycle)
          ? ceremony.lifecycle
          : null,
      );
    }
    case 'ed25519.activationReference.lifecycle_id': {
      const ed25519 = isRouterAbEd25519YaoProductRegistrationJsonObjectV1(input.ed25519)
        ? input.ed25519
        : null;
      return readRouterAbEd25519YaoProductRegistrationLifecycleStringV1(
        isRouterAbEd25519YaoProductRegistrationJsonObjectV1(ed25519?.activationReference)
          ? ed25519.activationReference
          : null,
      );
    }
    default:
      return assertNever(field);
  }
}

function readRouterAbEd25519YaoProductRegistrationLifecycleStringV1(input: unknown): string | null {
  if (
    !isRouterAbEd25519YaoProductRegistrationJsonObjectV1(input) ||
    typeof input.lifecycle_id !== 'string'
  ) {
    return null;
  }
  return input.lifecycle_id;
}

function isVisibleLifecycleId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    /^[\x21-\x7e]+$/u.test(value)
  );
}

function encodeStateValue(value: unknown): EncodedStateValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Ed25519 Yao state contains a non-finite number');
    return value;
  }
  if (value instanceof Uint8Array) {
    return {
      __seamsType: BYTES_KIND,
      values: Array.from(value),
    } satisfies EncodedBytes;
  }
  if (value instanceof Map) {
    const entries: [string, EncodedStateValue][] = [];
    for (const [key, entry] of value) {
      if (typeof key !== 'string') throw new Error('Ed25519 Yao state Map keys must be strings');
      entries.push([key, encodeStateValue(entry)]);
    }
    return { __seamsType: MAP_KIND, entries } satisfies EncodedMap;
  }
  if (value instanceof Set) {
    return {
      __seamsType: SET_KIND,
      values: Array.from(value, encodeStateValue),
    } satisfies EncodedSet;
  }
  if (Array.isArray(value)) return value.map(encodeStateValue);
  if (isRouterAbEd25519YaoProductRegistrationJsonObjectV1(value)) {
    const object: Record<string, EncodedStateValue> = {};
    for (const [key, entry] of Object.entries(value)) object[key] = encodeStateValue(entry);
    return object;
  }
  throw new Error(`Ed25519 Yao state contains unsupported value: ${typeof value}`);
}

type DecodeRouterAbEd25519YaoProductRegistrationStateValueV1 =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false };

function decodeRouterAbEd25519YaoProductRegistrationStateValueV1(
  value: unknown,
): DecodeRouterAbEd25519YaoProductRegistrationStateValueV1 {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return { ok: true, value };
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  }
  if (Array.isArray(value)) {
    const decoded: unknown[] = [];
    for (const entry of value) {
      const result = decodeRouterAbEd25519YaoProductRegistrationStateValueV1(entry);
      if (!result.ok) return result;
      decoded.push(result.value);
    }
    return { ok: true, value: decoded };
  }
  if (!isRouterAbEd25519YaoProductRegistrationJsonObjectV1(value)) {
    return { ok: false };
  }
  if (Object.hasOwn(value, '__seamsType')) {
    switch (value.__seamsType) {
      case BYTES_KIND:
        return decodeRouterAbEd25519YaoProductRegistrationBytesV1(value);
      case MAP_KIND:
        return decodeRouterAbEd25519YaoProductRegistrationMapV1(value);
      case SET_KIND:
        return decodeRouterAbEd25519YaoProductRegistrationSetV1(value);
      default:
        return { ok: false };
    }
  }
  const object: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const decoded = decodeRouterAbEd25519YaoProductRegistrationStateValueV1(entry);
    if (!decoded.ok) return decoded;
    object[key] = decoded.value;
  }
  return { ok: true, value: object };
}

function decodeRouterAbEd25519YaoProductRegistrationBytesV1(
  value: RouterAbEd25519YaoProductRegistrationJsonObjectV1,
): DecodeRouterAbEd25519YaoProductRegistrationStateValueV1 {
  if (
    !hasExactRouterAbEd25519YaoProductRegistrationJsonKeys(value, ['__seamsType', 'values']) ||
    value.__seamsType !== BYTES_KIND ||
    !Array.isArray(value.values)
  ) {
    return { ok: false };
  }
  const bytes: number[] = [];
  for (const entry of value.values) {
    if (typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry < 0 || entry > 255) {
      return { ok: false };
    }
    bytes.push(entry);
  }
  return { ok: true, value: Uint8Array.from(bytes) };
}

function decodeRouterAbEd25519YaoProductRegistrationMapV1(
  value: RouterAbEd25519YaoProductRegistrationJsonObjectV1,
): DecodeRouterAbEd25519YaoProductRegistrationStateValueV1 {
  if (
    !hasExactRouterAbEd25519YaoProductRegistrationJsonKeys(value, ['__seamsType', 'entries']) ||
    value.__seamsType !== MAP_KIND ||
    !Array.isArray(value.entries)
  ) {
    return { ok: false };
  }
  const map = new Map<string, unknown>();
  const keys = new Set<string>();
  for (const entry of value.entries) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') {
      return { ok: false };
    }
    if (keys.has(entry[0])) return { ok: false };
    keys.add(entry[0]);
    const decoded = decodeRouterAbEd25519YaoProductRegistrationStateValueV1(entry[1]);
    if (!decoded.ok) return decoded;
    map.set(entry[0], decoded.value);
  }
  return { ok: true, value: map };
}

function decodeRouterAbEd25519YaoProductRegistrationSetV1(
  value: RouterAbEd25519YaoProductRegistrationJsonObjectV1,
): DecodeRouterAbEd25519YaoProductRegistrationStateValueV1 {
  if (
    !hasExactRouterAbEd25519YaoProductRegistrationJsonKeys(value, ['__seamsType', 'values']) ||
    value.__seamsType !== SET_KIND ||
    !Array.isArray(value.values)
  ) {
    return { ok: false };
  }
  const set = new Set<unknown>();
  const encodedEntries = new Set<string>();
  for (const entry of value.values) {
    let encoded: string;
    try {
      encoded = JSON.stringify(entry);
    } catch {
      return { ok: false };
    }
    if (encodedEntries.has(encoded)) return { ok: false };
    encodedEntries.add(encoded);
    const decoded = decodeRouterAbEd25519YaoProductRegistrationStateValueV1(entry);
    if (!decoded.ok) return decoded;
    set.add(decoded.value);
  }
  return { ok: true, value: set };
}

function isEncodedStateObject(value: EncodedStateValue): value is EncodedStateObject {
  return (
    isRouterAbEd25519YaoProductRegistrationJsonObjectV1(value) &&
    !Object.hasOwn(value, '__seamsType')
  );
}

type RouterAbEd25519YaoProductRegistrationJsonObjectV1 = {
  readonly [key: string]: unknown;
};

function isRouterAbEd25519YaoProductRegistrationJsonObjectV1(
  input: unknown,
): input is RouterAbEd25519YaoProductRegistrationJsonObjectV1 {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function readRouterAbEd25519YaoCeremonyKeyObjectV1(
  input: unknown,
): RouterAbEd25519YaoProductRegistrationJsonObjectV1 | null {
  return isRouterAbEd25519YaoProductRegistrationJsonObjectV1(input) ? input : null;
}

function exactRouterAbEd25519YaoProductRegistrationStateEnvelopeV1(
  input: unknown,
): RouterAbEd25519YaoProductRegistrationJsonObjectV1 | null {
  if (!isRouterAbEd25519YaoProductRegistrationJsonObjectV1(input)) return null;
  return hasExactRouterAbEd25519YaoProductRegistrationJsonKeys(input, ['kind', 'state'])
    ? input
    : null;
}

function hasExactRouterAbEd25519YaoProductRegistrationJsonKeys(
  input: RouterAbEd25519YaoProductRegistrationJsonObjectV1,
  fields: readonly string[],
): boolean {
  const actual = Object.keys(input);
  return (
    actual.length === fields.length &&
    actual.every((field) => fields.some((expectedField) => expectedField === field))
  );
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Ed25519 Yao ceremony field: ${String(value)}`);
}

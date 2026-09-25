import type { LaneEffectJournalStore } from '../LaneEffectJournalStore';
import type { LaneLifecycleStore, LaneLockStore } from '../LaneLifecycleStore';
import type { SyncSqliteConnectionV1 } from '../../../storage/syncSqlite';
import { createSyncSqliteDatabase } from '../../../storage/syncSqlite';
import { WalletLaneEffectJournalSqlStore } from './walletLaneEffectJournalSqlStore';
import { WalletLaneLifecycleSqlStore } from './walletLaneLifecycleSqlStore';
import { WalletLaneLockSqlStore } from './walletLaneLockSqlStore';
import { parseWalletLaneOwnerV1, type WalletLaneOwnerV1 } from './walletLaneRecords';
import { inspectWalletLaneDatabaseV1, openWalletLaneDatabaseV1 } from './walletLaneSchema';
import { assertWalletLaneOwnerWallet } from './walletLaneRecords';

/**
 * The Router lane aggregate of one wallet. The three stores share one SQLite
 * database, so their foreign keys and guarded batches stay local to it.
 */
export type WalletLaneStoresV1 = {
  readonly lifecycle: LaneLifecycleStore;
  readonly locks: LaneLockStore;
  readonly effects: LaneEffectJournalStore;
};

const LIFECYCLE_METHODS = [
  'getEnrollment',
  'getProtocol',
  'putEnrollmentAdmission',
  'putProtocolAdmission',
  'compareAndSetProtocolLifecycle',
  'putProtocolCommitReceipt',
  'putHolderDeliveryReceipt',
  'putServerActivationReceipt',
  'putProductEpochPending',
  'compareAndSetEnrollmentLifecycle',
  'getProductEpoch',
  'getActiveProductEpoch',
  'listEnrollmentProductEpochs',
  'commitEnrollmentVisibility',
  'fenceLaneRevocation',
  'fenceEnrollmentRevocation',
  'commitEnrollmentRevocation',
  'commitLaneRevocation',
] as const satisfies readonly (keyof LaneLifecycleStore)[];

const LOCK_METHODS = [
  'acquireWalletKeyLock',
  'acquireEnrollmentLock',
  'releaseLock',
] as const satisfies readonly (keyof LaneLockStore)[];

const EFFECT_METHODS = [
  'getEffect',
  'recordEffect',
  'confirmEffect',
] as const satisfies readonly (keyof LaneEffectJournalStore)[];

type AllMethods<T> = Exclude<keyof T, never>;
type LifecycleMethod = (typeof LIFECYCLE_METHODS)[number];
type LockMethod = (typeof LOCK_METHODS)[number];
type EffectMethod = (typeof EFFECT_METHODS)[number];

// Every store method is on the wire; adding one without listing it fails to compile.
type AssertComplete<Listed, Full> = [Exclude<Full, Listed>] extends [never] ? true : never;
const lifecycleComplete: AssertComplete<LifecycleMethod, AllMethods<LaneLifecycleStore>> = true;
const locksComplete: AssertComplete<LockMethod, AllMethods<LaneLockStore>> = true;
const effectsComplete: AssertComplete<EffectMethod, AllMethods<LaneEffectJournalStore>> = true;
void lifecycleComplete;
void locksComplete;
void effectsComplete;

export type WalletLaneStoreCallV1 =
  | { readonly store: 'lifecycle'; readonly method: LifecycleMethod; readonly args: readonly unknown[] }
  | { readonly store: 'locks'; readonly method: LockMethod; readonly args: readonly unknown[] }
  | { readonly store: 'effects'; readonly method: EffectMethod; readonly args: readonly unknown[] };

export type WalletLaneStoreRequestV1 = {
  readonly kind: 'wallet_lane_store_request_v1';
  readonly owner: WalletLaneOwnerV1;
  readonly call: WalletLaneStoreCallV1;
};

export type WalletLaneStoreResponseV1 =
  | { readonly kind: 'wallet_lane_store_response_v1'; readonly ok: true; readonly value: unknown }
  | { readonly kind: 'wallet_lane_store_response_v1'; readonly ok: false; readonly error: string };

/** Delivers one request to the owner's lane store and returns its response. */
export type WalletLaneStoreTransportV1 = (
  request: WalletLaneStoreRequestV1,
) => Promise<WalletLaneStoreResponseV1>;

export function parseWalletLaneStoreRequestV1(value: unknown): WalletLaneStoreRequestV1 {
  const input = requireRecord(value, 'wallet lane store request');
  requireOnlyKeys(input, ['kind', 'owner', 'call'], 'wallet lane store request');
  if (input.kind !== 'wallet_lane_store_request_v1') {
    throw new Error('wallet lane store request kind is invalid');
  }
  const owner = parseWalletLaneOwnerV1(input.owner);
  const call = requireRecord(input.call, 'wallet lane store call');
  requireOnlyKeys(call, ['store', 'method', 'args'], 'wallet lane store call');
  if (!Array.isArray(call.args)) throw new Error('wallet lane store call args must be an array');
  const args: readonly unknown[] = call.args;
  const method = call.method;
  switch (call.store) {
    case 'lifecycle':
      if (!includes(LIFECYCLE_METHODS, method)) break;
      return { kind: 'wallet_lane_store_request_v1', owner, call: { store: 'lifecycle', method, args } };
    case 'locks':
      if (!includes(LOCK_METHODS, method)) break;
      return { kind: 'wallet_lane_store_request_v1', owner, call: { store: 'locks', method, args } };
    case 'effects':
      if (!includes(EFFECT_METHODS, method)) break;
      return { kind: 'wallet_lane_store_request_v1', owner, call: { store: 'effects', method, args } };
    default:
      throw new Error('wallet lane store is unknown');
  }
  throw new Error('wallet lane store method is unknown');
}

/**
 * Serves one request against the owner's own SQLite database. Both host
 * adapters (the Router wallet DO and the VM lane service) call this, so the
 * store logic, owner pin, and transaction semantics are identical.
 */
export async function serveWalletLaneStoreRequestV1(input: {
  readonly connection: SyncSqliteConnectionV1;
  readonly request: WalletLaneStoreRequestV1;
  readonly now?: () => number;
}): Promise<WalletLaneStoreResponseV1> {
  const now = input.now ?? Date.now;
  try {
    const readOnly = readOnlyEmptyResult(input.request);
    if (readOnly && inspectWalletLaneDatabaseV1(input.connection).kind === 'empty') {
      // A read never creates wallet storage: an owner with no lane database
      // has no lane records.
      return { kind: 'wallet_lane_store_response_v1', ok: true, value: readOnly.value };
    }
    openWalletLaneDatabaseV1(input.connection, input.request.owner, now());
    const stores = createWalletLaneSqlStoresV1({
      connection: input.connection,
      owner: input.request.owner,
      now,
    });
    const value = await dispatch(stores, input.request.call);
    return { kind: 'wallet_lane_store_response_v1', ok: true, value: value ?? null };
  } catch (error) {
    return {
      kind: 'wallet_lane_store_response_v1',
      ok: false,
      error: error instanceof Error ? error.message : 'wallet lane store request failed',
    };
  }
}

export function createWalletLaneSqlStoresV1(input: {
  readonly connection: SyncSqliteConnectionV1;
  readonly owner: WalletLaneOwnerV1;
  readonly now?: () => number;
}): WalletLaneStoresV1 {
  const options = {
    database: createSyncSqliteDatabase(input.connection),
    owner: input.owner,
    now: input.now,
  };
  return {
    lifecycle: new WalletLaneLifecycleSqlStore(options),
    locks: new WalletLaneLockSqlStore(options),
    effects: new WalletLaneEffectJournalSqlStore(options),
  };
}

/**
 * What each read-only call returns for an owner with no lane database. Only
 * calls listed here may be answered without opening (and so creating) it.
 */
const EMPTY_STORE_READS: {
  readonly lifecycle: Partial<Record<LifecycleMethod, unknown>>;
  readonly locks: Partial<Record<LockMethod, unknown>>;
  readonly effects: Partial<Record<EffectMethod, unknown>>;
} = {
  lifecycle: {
    getEnrollment: null,
    getProtocol: null,
    listEnrollmentProductEpochs: [],
    getProductEpoch: null,
    getActiveProductEpoch: null,
  },
  locks: {},
  effects: { getEffect: null },
};

/** True when the call cannot change lane state. */
export function isReadOnlyWalletLaneCallV1(call: WalletLaneStoreCallV1): boolean {
  return call.method in EMPTY_STORE_READS[call.store];
}

function readOnlyEmptyResult(request: WalletLaneStoreRequestV1): { readonly value: unknown } | null {
  const { call, owner } = request;
  if (!isReadOnlyWalletLaneCallV1(call)) return null;
  if (call.method === 'getProductEpoch' || call.method === 'getActiveProductEpoch') {
    // Lookups that name a wallet enforce the owner exactly as the store does.
    const lookup = call.args[0] as { readonly walletId?: unknown } | undefined;
    assertWalletLaneOwnerWallet(owner, String(lookup?.walletId ?? ''), 'lane product epoch lookup');
  }
  const reads = EMPTY_STORE_READS[call.store] as Record<string, unknown>;
  return { value: reads[call.method] };
}

async function dispatch(stores: WalletLaneStoresV1, call: WalletLaneStoreCallV1): Promise<unknown> {
  const target = stores[call.store] as unknown as Record<string, (...args: unknown[]) => unknown>;
  const method = target[call.method];
  if (typeof method !== 'function') throw new Error('wallet lane store method is unavailable');
  return await method.apply(target, [...call.args]);
}

/**
 * Remote lane stores for one owner. Every call is a single request to that
 * owner's authority; the caller never holds a lane transaction open across
 * the network.
 */
export function createRemoteWalletLaneStoresV1(input: {
  readonly owner: WalletLaneOwnerV1;
  readonly transport: WalletLaneStoreTransportV1;
}): WalletLaneStoresV1 {
  const owner = parseWalletLaneOwnerV1(input.owner);
  const invoke = async (call: WalletLaneStoreCallV1): Promise<unknown> => {
    const response = await input.transport({ kind: 'wallet_lane_store_request_v1', owner, call });
    if (response.kind !== 'wallet_lane_store_response_v1') {
      throw new Error('wallet lane store response kind is invalid');
    }
    if (!response.ok) throw new Error(response.error);
    return response.value;
  };
  return {
    lifecycle: remoteStore<LaneLifecycleStore>(LIFECYCLE_METHODS, (method, args) =>
      invoke({ store: 'lifecycle', method: method as LifecycleMethod, args }),
    ),
    locks: remoteStore<LaneLockStore>(LOCK_METHODS, (method, args) =>
      invoke({ store: 'locks', method: method as LockMethod, args }),
    ),
    effects: remoteStore<LaneEffectJournalStore>(EFFECT_METHODS, (method, args) =>
      invoke({ store: 'effects', method: method as EffectMethod, args }),
    ),
  };
}

export function parseWalletLaneStoreResponseV1(value: unknown): WalletLaneStoreResponseV1 {
  const input = requireRecord(value, 'wallet lane store response');
  if (input.kind !== 'wallet_lane_store_response_v1') {
    throw new Error('wallet lane store response kind is invalid');
  }
  if (input.ok === true) {
    requireOnlyKeys(input, ['kind', 'ok', 'value'], 'wallet lane store response');
    return { kind: 'wallet_lane_store_response_v1', ok: true, value: input.value ?? null };
  }
  if (input.ok === false && typeof input.error === 'string') {
    requireOnlyKeys(input, ['kind', 'ok', 'error'], 'wallet lane store response');
    return { kind: 'wallet_lane_store_response_v1', ok: false, error: input.error };
  }
  throw new Error('wallet lane store response is invalid');
}

function remoteStore<T extends object>(
  methods: readonly string[],
  invoke: (method: string, args: readonly unknown[]) => Promise<unknown>,
): T {
  const store: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const method of methods) {
    store[method] = async (...args: unknown[]) => await invoke(method, jsonArgs(args));
  }
  return store as unknown as T;
}

/** Lane records are plain JSON values; this rejects anything JSON cannot carry exactly. */
function jsonArgs(args: readonly unknown[]): readonly unknown[] {
  const encoded = JSON.stringify(args, (_key, value: unknown) => {
    if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
      throw new Error('wallet lane store arguments must be JSON values');
    }
    return value;
  });
  return JSON.parse(encoded) as readonly unknown[];
}

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label} has unexpected field ${key}`);
  }
}


import { base64UrlEncode } from '@shared/utils/base64';
import { isFunction, isPlainObject } from '@shared/utils/validation';
import { deviceKeyIdOf } from '../proofs/deviceKey';
import type { AuthLocale } from '../shared/copy';

// The device keys of this browser and the local gates in front of them. A device key is an
// Ed25519 key that cannot leave the browser. A method with a gate (VoiceID has the `voice`
// gate) signs with its device key only after the owner passes the gate. The gate gets no key,
// no challenge and no network: it gets a surface to draw on and a store for its own records.

export type GateStore = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
};

export type GateSurface = { readonly element: HTMLElement; readonly locale: AuthLocale };

export interface LocalGate {
  /** Records what the gate needs, such as a voice template, in the store of this method. */
  enroll(input: {
    surface: GateSurface;
    store: GateStore;
    signal: AbortSignal;
  }): Promise<'enrolled' | 'cancelled'>;
  /** Asks the owner to pass the gate. A failed try does not end the check. */
  check(input: {
    surface: GateSurface;
    store: GateStore;
    purpose: 'sign_in' | 'prove' | 'method_change';
    signal: AbortSignal;
  }): Promise<'passed' | 'cancelled'>;
}

export const GATE_API_VERSION = 1;

/** The gate of each method that has one, and the fixed path of its code on the account origin. */
const GATE_PATHS = { voice: '/sdk/voiceid/gate.js' } as const;
export type GateName = keyof typeof GATE_PATHS;

const gates = new Map<GateName, Promise<LocalGate | null>>();

/** Loads a gate from the account origin. Null: the operator did not install it. */
export function loadGate(name: GateName): Promise<LocalGate | null> {
  let gate = gates.get(name);
  if (!gate) {
    gate = (async () => {
      try {
        const module: unknown = await import(/* @vite-ignore */ GATE_PATHS[name]);
        if (
          isPlainObject(module) &&
          module.gateApiVersion === GATE_API_VERSION &&
          isPlainObject(module.gate) &&
          isFunction(module.gate.enroll) &&
          isFunction(module.gate.check)
        ) {
          return module.gate as unknown as LocalGate;
        }
      } catch {
        // The path has no module.
      }
      return null;
    })();
    gates.set(name, gate);
  }
  return gate;
}

export type DeviceKeyRecord = {
  readonly deviceKeyId: string;
  readonly publicKeyB64u: string;
  readonly privateKey: CryptoKey;
  readonly gate: GateName;
  /** The method and the account, after the Auth Worker stored the key. */
  readonly methodId: string | null;
  readonly accountId: string | null;
};

const DATABASE = 'seams-auth';
const KEYS = 'device-keys';
const GATE_RECORDS = 'gate-records';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(KEYS, { keyPath: 'deviceKeyId' });
      request.result.createObjectStore(GATE_RECORDS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<Result>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<Result>,
): Promise<Result> {
  const database = await openDatabase();
  try {
    return await new Promise<Result>((resolve, reject) => {
      const request = action(database.transaction(storeName, mode).objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

/** Makes a device key that cannot be exported, and stores it. */
export async function createDeviceKey(gate: GateName): Promise<DeviceKeyRecord> {
  const pair = (await crypto.subtle.generateKey('Ed25519', false, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKeyB64u = base64UrlEncode(await crypto.subtle.exportKey('raw', pair.publicKey));
  const record: DeviceKeyRecord = {
    deviceKeyId: await deviceKeyIdOf(publicKeyB64u),
    publicKeyB64u,
    privateKey: pair.privateKey,
    gate,
    methodId: null,
    accountId: null,
  };
  await run(KEYS, 'readwrite', (store) => store.put(record));
  return record;
}

export async function bindDeviceKey(
  record: DeviceKeyRecord,
  method: { readonly methodId: string; readonly accountId: string },
): Promise<void> {
  await run(KEYS, 'readwrite', (store) => store.put({ ...record, ...method }));
}

/** The device keys of this browser that are a method of an account. */
export async function boundDeviceKeys(): Promise<DeviceKeyRecord[]> {
  const records = await run<DeviceKeyRecord[]>(KEYS, 'readonly', (store) => store.getAll());
  return records.filter((record) => record.methodId !== null);
}

export async function deleteDeviceKey(deviceKeyId: string): Promise<void> {
  await run(KEYS, 'readwrite', (store) => store.delete(deviceKeyId));
}

export async function signWithDeviceKey(
  record: DeviceKeyRecord,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  return base64UrlEncode(await crypto.subtle.sign('Ed25519', record.privateKey, bytes));
}

/** The store of one gate for one device key. A gate cannot read the records of another key. */
export function gateStoreFor(deviceKeyId: string): GateStore {
  const scoped = (key: string): string => `${deviceKeyId}\n${key}`;
  return {
    get: (key) => run(GATE_RECORDS, 'readonly', (store) => store.get(scoped(key))),
    set: async (key, value) => {
      await run(GATE_RECORDS, 'readwrite', (store) => store.put(value, scoped(key)));
    },
    delete: async (key) => {
      await run(GATE_RECORDS, 'readwrite', (store) => store.delete(scoped(key)));
    },
  };
}

import type { CloudflareDurableObjectStubLike } from './types';
import {
  D1WalletAuthMethodStore,
  WALLET_AUTH_METHOD_D1_STORE,
  normalizeWalletAuthMethod,
  walletAuthMethodId,
} from './d1WalletAuthMethodStore';
import type { WalletAuthMethodRecord, WalletAuthMethodStore } from './d1WalletAuthMethodStore';
import { resolveStorePrefix } from './d1TenantStore';
import {
  createDurableObjectStore,
  postDurableObjectRequest,
  type DurableObjectStoreSpec,
  type StoreFactoryInput,
} from './storeBackends';

export {
  D1WalletAuthMethodStore,
  WALLET_AUTH_METHOD_STORE_D1_SCHEMA_SQL,
  WALLET_AUTH_METHOD_STORE_D1_SCHEMA_V2_SQL,
  ensureWalletAuthMethodStoreD1Schema,
  normalizeWalletAuthMethod,
  normalizeWalletAuthMethodV2,
  prepareD1WalletAuthMethodV2PutStatement,
  walletAuthMethodV2Id,
} from './d1WalletAuthMethodStore';
export type {
  D1WalletAuthMethodStoreOptions,
  D1WalletAuthMethodStoreSchemaOptions,
  WalletAuthMethodRecord,
  WalletAuthMethodRecordV2Owned,
  WalletAuthMethodStore,
  WalletAuthMethodV2Store,
} from './d1WalletAuthMethodStore';

export function resolveWalletAuthMethodStoreNamespace(
  config: Record<string, unknown>,
): string {
  return resolveStorePrefix(config, ['WALLET_AUTH_METHOD_PREFIX'], 'wallet-auth-method:');
}

class InMemoryWalletAuthMethodStore implements WalletAuthMethodStore {
  private readonly records = new Map<string, WalletAuthMethodRecord>();

  constructor(private readonly namespace: string) {}

  async put(record: WalletAuthMethodRecord): Promise<void> {
    this.records.set(`${this.namespace}${walletAuthMethodId(record)}`, record);
  }

  async getPasskey(input: {
    rpId: string;
    credentialIdB64u: string;
  }): Promise<WalletAuthMethodRecord | null> {
    return (
      this.records.get(`${this.namespace}passkey:${input.rpId}:${input.credentialIdB64u}`) || null
    );
  }

  async getEmailOtp(input: {
    walletId: string;
    emailHashHex: string;
  }): Promise<WalletAuthMethodRecord | null> {
    return (
      this.records.get(`${this.namespace}email_otp:${input.walletId}:${input.emailHashHex}`) ||
      null
    );
  }

  async listForWallet(input: {
    walletId: string;
    rpId?: string;
  }): Promise<WalletAuthMethodRecord[]> {
    return [...this.records.values()].filter(
      (record) =>
        record.walletId === input.walletId &&
        (record.kind === 'email_otp' || !input.rpId || record.rpId === input.rpId),
    );
  }
}

class CloudflareDurableObjectWalletAuthMethodStore
  implements WalletAuthMethodStore
{
  constructor(
    private readonly stub: CloudflareDurableObjectStubLike,
    private readonly prefix: string,
  ) {}

  private key(id: string): string {
    return `${this.prefix}auth-method:${id}`;
  }

  private walletIndexKey(input: { walletId: string; rpId?: string }): string {
    return `${this.prefix}wallet-index:${input.rpId || '*'}:${input.walletId}`;
  }

  private async request<T>(body: unknown): Promise<T> {
    const response = await postDurableObjectRequest(this.stub, body);
    if (!response.ok) {
      throw new Error(`Wallet auth-method DO store HTTP ${response.status}: ${await response.text()}`);
    }
    return (await response.json().catch(() => null)) as T;
  }

  async put(record: WalletAuthMethodRecord): Promise<void> {
    const key = this.key(walletAuthMethodId(record));
    const indexKey = this.walletIndexKey({
      walletId: record.walletId,
      ...(record.kind === 'passkey' ? { rpId: record.rpId } : {}),
    });
    const allWalletIndexKey = this.walletIndexKey({ walletId: record.walletId });
    const current = await this.request<{ value?: unknown }>({ op: 'get', key: indexKey });
    const keys = Array.isArray(current?.value)
      ? current.value.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : [];
    const nextKeys = keys.includes(key) ? keys : [...keys, key];
    const allCurrent = await this.request<{ value?: unknown }>({ op: 'get', key: allWalletIndexKey });
    const allKeys = Array.isArray(allCurrent?.value)
      ? allCurrent.value.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : [];
    const nextAllKeys = allKeys.includes(key) ? allKeys : [...allKeys, key];
    await this.request({ op: 'set', key, value: record });
    await this.request({ op: 'set', key: indexKey, value: nextKeys });
    await this.request({ op: 'set', key: allWalletIndexKey, value: nextAllKeys });
  }

  async getPasskey(input: {
    rpId: string;
    credentialIdB64u: string;
  }): Promise<WalletAuthMethodRecord | null> {
    const result = await this.request<{ value?: unknown }>({
      op: 'get',
      key: this.key(`passkey:${input.rpId}:${input.credentialIdB64u}`),
    });
    return normalizeWalletAuthMethod(result?.value);
  }

  async getEmailOtp(input: {
    walletId: string;
    emailHashHex: string;
  }): Promise<WalletAuthMethodRecord | null> {
    const result = await this.request<{ value?: unknown }>({
      op: 'get',
      key: this.key(`email_otp:${input.walletId}:${input.emailHashHex}`),
    });
    return normalizeWalletAuthMethod(result?.value);
  }

  async listForWallet(input: {
    walletId: string;
    rpId?: string;
  }): Promise<WalletAuthMethodRecord[]> {
    const current = await this.request<{ value?: unknown }>({
      op: 'get',
      key: this.walletIndexKey({ walletId: input.walletId }),
    });
    const keys = Array.isArray(current?.value)
      ? current.value.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : [];
    const records: WalletAuthMethodRecord[] = [];
    for (const key of keys) {
      const result = await this.request<{ value?: unknown }>({ op: 'get', key });
      const record = normalizeWalletAuthMethod(result?.value);
      if (
        record &&
        (record.kind === 'email_otp' || !input.rpId || record.rpId === input.rpId)
      ) {
        records.push(record);
      }
    }
    return records;
  }
}

const WALLET_AUTH_METHOD_STORE: DurableObjectStoreSpec = {
  tag: 'wallet-auth-method',
  name: 'wallet auth-method',
  inMemoryLog: 'Using in-memory store',
  d1StoreName: WALLET_AUTH_METHOD_D1_STORE,
  resolvePrefix: resolveWalletAuthMethodStoreNamespace,
};

export function createWalletAuthMethodStore(input: StoreFactoryInput): WalletAuthMethodStore {
  return createDurableObjectStore(input, WALLET_AUTH_METHOD_STORE, {
    d1: (options) => new D1WalletAuthMethodStore(options),
    durableObject: (stub, prefix) => new CloudflareDurableObjectWalletAuthMethodStore(stub, prefix),
    inMemory: (prefix) => new InMemoryWalletAuthMethodStore(prefix),
  });
}

import {
  getAddress,
  hashTypedData,
  isAddress,
  isHex,
  numberToHex,
  type Address,
  type Hex,
  type TypedDataDomain,
} from 'viem';
import {
  externalEvmFailure,
  type ExternalEvmChain,
  type ExternalEvmFailure,
  type ExternalEvmResult,
  type ExternalEvmWallet,
} from './types';

export interface ExternalProvider {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on(event: string, listener: (value: unknown) => void): void;
  removeListener(event: string, listener: (value: unknown) => void): void;
}

export type DiscoveredExternalProvider = Readonly<{
  wallet: ExternalEvmWallet;
  provider: ExternalProvider;
}>;

const PHANTOM_EVM_WALLET: ExternalEvmWallet = Object.freeze({
  id: 'phantom:ethereum',
  name: 'Phantom',
  icon: null,
  rdns: null,
});

export type ExternalProviderState =
  | Readonly<{
      kind: 'authorized';
      accounts: readonly [Address, ...Address[]];
      chainId: number;
    }>
  | Readonly<{
      kind: 'unauthorized';
      accounts?: never;
      chainId: number;
    }>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProvider(value: unknown): value is ExternalProvider {
  return isRecord(value) &&
    typeof value.request === 'function' &&
    typeof value.on === 'function' &&
    typeof value.removeListener === 'function';
}

export function parseAnnouncement(
  value: unknown,
): DiscoveredExternalProvider | null {
  if (!isRecord(value)) return null;
  const info = value.info;
  const provider = value.provider;
  if (!isRecord(info) || !isProvider(provider)) return null;
  const { uuid, name, icon, rdns } = info;
  if (
    typeof uuid !== 'string' ||
    !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(uuid)
  ) {
    return null;
  }
  if (typeof name !== 'string' || !name.trim() || name.length > 128) return null;
  if (typeof rdns !== 'string' || !rdns.trim() || rdns.length > 253) return null;
  if (
    typeof icon !== 'string' ||
    icon.length > 131072 ||
    !/^data:image\/(?:png|webp|jpeg|svg\+xml)[;,]/i.test(icon)
  ) {
    return null;
  }
  return Object.freeze({
    wallet: Object.freeze({
      id: uuid.toLowerCase(),
      name: name.trim(),
      icon,
      rdns: rdns.trim(),
    }),
    provider,
  });
}

export function parsePhantomProvider(
  value: unknown,
): DiscoveredExternalProvider | null {
  if (!isRecord(value)) return null;
  const phantom = value.phantom;
  if (!isRecord(phantom)) return null;
  const provider = phantom.ethereum;
  if (!isRecord(provider) || provider.isPhantom !== true || !isProvider(provider)) {
    return null;
  }
  return Object.freeze({
    wallet: PHANTOM_EVM_WALLET,
    provider,
  });
}

export function parseExternalAccounts(
  value: unknown,
): readonly [Address, ...Address[]] | null {
  if (!Array.isArray(value)) throw new Error('Wallet returned invalid accounts.');
  const accounts: Address[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string' || !isAddress(raw)) {
      throw new Error('Wallet returned an invalid address.');
    }
    const address = getAddress(raw);
    if (!accounts.includes(address)) accounts.push(address);
  }
  const [first, ...rest] = accounts;
  return first ? Object.freeze([first, ...rest]) : null;
}

export async function readExternalProviderState(
  provider: ExternalProvider,
): Promise<ExternalEvmResult<ExternalProviderState>> {
  let accountsRaw: unknown;
  let chainIdRaw: unknown;
  try {
    accountsRaw = await provider.request({ method: 'eth_accounts' });
    chainIdRaw = await provider.request({ method: 'eth_chainId' });
  } catch (error) {
    return providerFailure(error);
  }

  try {
    const accounts = parseExternalAccounts(accountsRaw);
    const chainId = parseChainId(chainIdRaw);
    if (!accounts) {
      return { ok: true, value: Object.freeze({ kind: 'unauthorized', chainId }) };
    }
    return {
      ok: true,
      value: Object.freeze({ kind: 'authorized', accounts, chainId }),
    };
  } catch {
    return malformedProviderResponse();
  }
}

export function parseChainId(value: unknown): number {
  if (typeof value !== 'string' || !/^0x[\da-f]+$/i.test(value)) {
    throw new Error('Wallet returned an invalid chain ID.');
  }
  const chainId = Number(BigInt(value));
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error('Wallet returned an invalid chain ID.');
  }
  return chainId;
}

export function parseChains(chains: readonly ExternalEvmChain[]): readonly ExternalEvmChain[] {
  const result: ExternalEvmChain[] = [];
  const ids = new Set<number>();
  for (const chain of chains) {
    if (
      !isRecord(chain) ||
      !Number.isSafeInteger(chain.chainId) ||
      chain.chainId <= 0 ||
      ids.has(chain.chainId)
    ) {
      throw new Error('Configure unique positive EVM chain IDs.');
    }
    if (
      typeof chain.name !== 'string' ||
      typeof chain.rpcUrl !== 'string' ||
      !chain.name.trim()
    ) {
      throw new Error('Configure a chain name and HTTP RPC URL.');
    }
    const url = new URL(chain.rpcUrl);
    if (!['https:', 'http:'].includes(url.protocol)) {
      throw new Error('Configure a chain name and HTTP RPC URL.');
    }
    ids.add(chain.chainId);
    result.push(Object.freeze({
      chainId: chain.chainId,
      name: chain.name.trim(),
      rpcUrl: url.href,
    }));
  }
  return Object.freeze(result);
}

export function parseHex(value: unknown, bytes?: number): Hex {
  if (
    typeof value !== 'string' ||
    !isHex(value, { strict: true }) ||
    value.length % 2 !== 0 ||
    (bytes !== undefined && value.length !== bytes * 2 + 2)
  ) {
    throw new Error('Wallet returned invalid hexadecimal bytes.');
  }
  return value;
}

function quantity(value: unknown): Hex {
  if (typeof value !== 'bigint' || value < 0n || value >= 2n ** 256n) {
    throw new Error('Expected an unsigned 256-bit integer.');
  }
  return numberToHex(value);
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) throw new Error(`Unsupported field: ${key}.`);
  }
}

export function parseTransaction(
  value: unknown,
  account: Address,
  chainId: number,
): Record<string, Hex> {
  if (!isRecord(value) || !isRecord(value.gas) || !isRecord(value.fees)) {
    throw new Error('Invalid transaction request.');
  }
  exactKeys(value, ['to', 'data', 'value', 'gas', 'fees']);
  if (typeof value.to !== 'string' || !isAddress(value.to)) {
    throw new Error('Enter a valid recipient address.');
  }
  const transaction: Record<string, Hex> = {
    from: account,
    chainId: numberToHex(chainId),
    to: getAddress(value.to),
    data: parseHex(value.data),
    value: quantity(value.value),
  };
  switch (value.gas.kind) {
    case 'wallet':
      exactKeys(value.gas, ['kind']);
      break;
    case 'limit':
      exactKeys(value.gas, ['kind', 'limit']);
      transaction.gas = quantity(value.gas.limit);
      if (value.gas.limit === 0n) throw new Error('Gas limit must be positive.');
      break;
    default:
      throw new Error('Invalid gas selection.');
  }
  switch (value.fees.kind) {
    case 'wallet':
      exactKeys(value.fees, ['kind']);
      break;
    case 'legacy':
      exactKeys(value.fees, ['kind', 'gasPrice']);
      transaction.gasPrice = quantity(value.fees.gasPrice);
      break;
    case 'eip1559':
      exactKeys(value.fees, ['kind', 'maxFeePerGas', 'maxPriorityFeePerGas']);
      transaction.maxFeePerGas = quantity(value.fees.maxFeePerGas);
      transaction.maxPriorityFeePerGas = quantity(value.fees.maxPriorityFeePerGas);
      if (BigInt(transaction.maxPriorityFeePerGas) > BigInt(transaction.maxFeePerGas)) {
        throw new Error('Priority fee exceeds maximum fee.');
      }
      break;
    default:
      throw new Error('Invalid fee selection.');
  }
  return transaction;
}

function stringifyBigInt(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

export function parseTypedData(input: unknown, chainId: number): string {
  // Snapshot before awaiting provider calls; hash validation uses these exact wire values.
  const serialized = JSON.stringify(input, stringifyBigInt);
  const value: unknown = JSON.parse(serialized);
  if (
    !isRecord(value) ||
    !isRecord(value.types) ||
    !isRecord(value.domain) ||
    !isRecord(value.message) ||
    typeof value.primaryType !== 'string'
  ) {
    throw new Error('Invalid EIP-712 typed data.');
  }
  exactKeys(value, ['types', 'domain', 'primaryType', 'message']);
  const types: Record<string, { name: string; type: string }[]> = Object.create(null);
  for (const [name, fields] of Object.entries(value.types)) {
    if (!Array.isArray(fields)) throw new Error('Invalid EIP-712 type fields.');
    types[name] = [];
    const names = new Set<string>();
    for (const field of fields) {
      if (
        !isRecord(field) ||
        typeof field.name !== 'string' ||
        typeof field.type !== 'string' ||
        names.has(field.name)
      ) {
        throw new Error('Invalid EIP-712 field.');
      }
      exactKeys(field, ['name', 'type']);
      names.add(field.name);
      types[name].push({ name: field.name, type: field.type });
    }
  }
  if (value.primaryType === 'EIP712Domain' || !types[value.primaryType]) {
    throw new Error('Select a message primary type.');
  }
  const domain: TypedDataDomain = {};
  exactKeys(value.domain, ['name', 'version', 'chainId', 'verifyingContract', 'salt']);
  if ('name' in value.domain) {
    if (typeof value.domain.name !== 'string') throw new Error('Invalid domain name.');
    domain.name = value.domain.name;
  }
  if ('version' in value.domain) {
    if (typeof value.domain.version !== 'string') throw new Error('Invalid domain version.');
    domain.version = value.domain.version;
  }
  if ('chainId' in value.domain) {
    const raw = value.domain.chainId;
    if (
      (typeof raw !== 'string' && typeof raw !== 'number') ||
      (typeof raw === 'number' && !Number.isSafeInteger(raw)) ||
      BigInt(raw) !== BigInt(chainId)
    ) {
      throw new Error('Typed-data domain chain differs from the connected chain.');
    }
    domain.chainId = chainId;
  }
  if ('verifyingContract' in value.domain) {
    if (
      typeof value.domain.verifyingContract !== 'string' ||
      !isAddress(value.domain.verifyingContract)
    ) {
      throw new Error('Invalid verifying contract.');
    }
    domain.verifyingContract = getAddress(value.domain.verifyingContract);
  }
  if ('salt' in value.domain) domain.salt = parseHex(value.domain.salt, 32);
  hashTypedData({ types, primaryType: value.primaryType, domain, message: value.message });
  return serialized;
}

export function providerFailure(error: unknown): ExternalEvmFailure {
  const code = isRecord(error) ? error.code : null;
  switch (code) {
    case 4001:
      return externalEvmFailure('rejected', 'Request declined in your wallet.');
    case 4100:
    case 4900:
      return externalEvmFailure('unavailable', 'Reconnect your wallet to continue.');
    case 4901:
    case 4902:
      return externalEvmFailure(
        'unsupported_chain',
        'Select a supported network in your wallet.',
      );
    case 4200:
    case -32601:
      return externalEvmFailure(
        'unsupported_method',
        'This wallet does not support the requested operation.',
      );
    case -32002:
      return externalEvmFailure(
        'pending_request',
        'Complete the pending request in your wallet.',
      );
    default:
      return externalEvmFailure('provider_failure', 'The wallet request failed.');
  }
}

export function malformedProviderResponse(): ExternalEvmFailure {
  return externalEvmFailure('malformed_response', 'The wallet returned an invalid response.');
}

export function inputFailure(error: unknown): ExternalEvmFailure {
  const message = error instanceof Error ? error.message : 'Invalid request.';
  return externalEvmFailure('invalid_input', message);
}

import type { NearClient } from '@/core/rpcClients/near/NearClient';
import { ActionType, type ActionArgsWasm, type TransactionInputWasm } from '@/core/types/actions';
import { isValidAccountId } from '@shared/utils/near';
import { isObject, isString } from '@shared/utils/validation';

type NearNetwork = 'testnet' | 'mainnet';

type TokenTransferRequest = Pick<TransactionInputWasm, 'receiverId' | 'actions'>;

/** `verified` means that the wallet's own list names this contract, not the contract's claim. */
export type NearTokenMetadata = {
  symbol: string;
  decimals: number;
  verified: boolean;
};

export type NearTokenMetadataByContract = ReadonlyMap<string, NearTokenMetadata>;

export type NearTokenTransferCall = {
  tokenContract: string;
  recipient: string;
  baseUnits: string;
};

// NEP-141 requires exactly this attached deposit on a token transfer.
export const NEAR_TOKEN_TRANSFER_DEPOSIT_YOCTO = '1';

const NEAR_TOKEN_METADATA_TIMEOUT_MS = 2_000;
const U128_MAX = (BigInt(1) << BigInt(128)) - BigInt(1);
const MAX_U128_DIGITS = 39;
const MAX_TOKEN_DECIMALS = 38;
// An ASCII-only symbol cannot imitate a known symbol with look-alike characters or bidi controls.
const TOKEN_SYMBOL = /^[A-Za-z0-9$._+-]{1,16}$/;

// An implicit account id can hold another contract on the other network, so each list is separate.
const KNOWN_NEAR_TOKENS: Readonly<
  Record<NearNetwork, Readonly<Record<string, { symbol: string; decimals: number }>>>
> = {
  mainnet: {
    '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1': {
      symbol: 'USDC',
      decimals: 6,
    },
    'usdt.tether-token.near': { symbol: 'USDt', decimals: 6 },
    'wrap.near': { symbol: 'wNEAR', decimals: 24 },
  },
  testnet: {
    '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af': {
      symbol: 'USDC',
      decimals: 6,
    },
    'wrap.testnet': { symbol: 'wNEAR', decimals: 24 },
  },
};

// A contract outside the known list that claims one of these symbols gets a warning.
const IMPERSONATED_TOKEN_SYMBOLS = new Set(['NEAR', 'WNEAR', 'USDC', 'USDT', 'ETH']);

const resolvedMetadata = new Map<string, NearTokenMetadata>();
const metadataLookups = new Map<string, Promise<NearTokenMetadata | null>>();

export function isImpersonatedNearTokenSymbol(metadata: NearTokenMetadata): boolean {
  return !metadata.verified && IMPERSONATED_TOKEN_SYMBOLS.has(metadata.symbol.toUpperCase());
}

export function isNearTokenTransferMethod(method: string): boolean {
  return method === 'ft_transfer' || method === 'ft_transfer_call';
}

function parseBaseUnits(value: unknown): string | null {
  if (!isString(value) || !/^\d+$/.test(value) || value.length > MAX_U128_DIGITS) return null;
  const units = BigInt(value);
  return units <= U128_MAX ? units.toString() : null;
}

export function parseNearTokenTransferCall(
  receiverId: string,
  action: ActionArgsWasm,
): NearTokenTransferCall | null {
  if (action.action_type !== ActionType.FunctionCall) return null;
  if (!isNearTokenTransferMethod(action.method_name) || !isValidAccountId(receiverId)) return null;
  let args: unknown;
  try {
    args = JSON.parse(action.args);
  } catch {
    return null;
  }
  if (!isObject(args) || !isValidAccountId(args.receiver_id)) return null;
  const baseUnits = parseBaseUnits(args.amount);
  if (baseUnits === null) return null;
  return { tokenContract: receiverId, recipient: args.receiver_id, baseUnits };
}

export function formatNearTokenAmount(baseUnits: string, decimals: number): string {
  if (decimals === 0) return baseUnits;
  const padded = baseUnits.padStart(decimals + 1, '0');
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return `${padded.slice(0, -decimals)}${fraction ? `.${fraction}` : ''}`;
}

function decodeTokenMetadata(value: unknown): NearTokenMetadata | null {
  if (!isObject(value)) return null;
  const { symbol, decimals } = value;
  if (!isString(symbol) || !TOKEN_SYMBOL.test(symbol)) return null;
  if (!Number.isSafeInteger(decimals)) return null;
  const tokenDecimals = decimals as number;
  if (tokenDecimals < 0 || tokenDecimals > MAX_TOKEN_DECIMALS) return null;
  return { symbol, decimals: tokenDecimals, verified: false };
}

function tokenContracts(txSigningRequests: readonly TokenTransferRequest[]): string[] {
  const contracts = new Set<string>();
  for (const tx of txSigningRequests) {
    for (const action of Array.isArray(tx.actions) ? tx.actions : []) {
      const transfer = parseNearTokenTransferCall(tx.receiverId, action);
      if (transfer) contracts.add(transfer.tokenContract);
    }
  }
  return [...contracts];
}

function metadataKey(network: NearNetwork, contract: string): string {
  return `${network}:${contract}`;
}

function immediateMetadata(network: NearNetwork, contract: string): NearTokenMetadata | undefined {
  const known = KNOWN_NEAR_TOKENS[network][contract];
  return known
    ? { ...known, verified: true }
    : resolvedMetadata.get(metadataKey(network, contract));
}

/** The metadata available without a network call. */
export function immediateNearTokenMetadata(args: {
  network: NearNetwork;
  txSigningRequests: readonly TokenTransferRequest[];
}): NearTokenMetadataByContract {
  const metadata = new Map<string, NearTokenMetadata>();
  for (const contract of tokenContracts(args.txSigningRequests)) {
    const token = immediateMetadata(args.network, contract);
    if (token) metadata.set(contract, token);
  }
  return metadata;
}

function lookUpTokenMetadata(
  nearClient: NearClient,
  network: NearNetwork,
  contract: string,
): Promise<NearTokenMetadata | null> {
  const key = metadataKey(network, contract);
  const started = metadataLookups.get(key);
  if (started) return started;
  const lookup = nearClient
    .callFunction(contract, 'ft_metadata', {}, decodeTokenMetadata)
    .catch(() => null)
    .then((token) => {
      if (token) resolvedMetadata.set(key, token);
      metadataLookups.delete(key);
      return token;
    });
  metadataLookups.set(key, lookup);
  return lookup;
}

/**
 * Read token metadata inside the wallet, because the review must not trust the application for it.
 * This waits for a limited time and never rejects: a token without metadata shows its base units.
 */
export async function resolveNearTokenMetadata(args: {
  nearClient: NearClient;
  network: NearNetwork;
  txSigningRequests: readonly TokenTransferRequest[];
}): Promise<NearTokenMetadataByContract> {
  const pending = tokenContracts(args.txSigningRequests)
    .filter((contract) => !immediateMetadata(args.network, contract))
    .map((contract) => lookUpTokenMetadata(args.nearClient, args.network, contract));
  if (pending.length > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(pending),
      new Promise((resolve) => {
        timer = setTimeout(resolve, NEAR_TOKEN_METADATA_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
  }
  return immediateNearTokenMetadata(args);
}

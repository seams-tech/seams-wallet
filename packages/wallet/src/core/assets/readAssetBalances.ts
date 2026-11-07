import type { NearClient } from '@/core/rpcClients/near/NearClient';
import { accountExists } from '@/core/rpcClients/near/accountExists';
import { createEvmClient, type EvmClient } from '@/core/rpcClients/evm/EvmClient';
import { isEvmChainNetwork, isNearChainNetwork } from '@/core/config/chains';
import type { SeamsChainNetwork } from '@/core/types/seams';
import { isValidAccountId } from '@shared/utils/near';
import {
  assetsForChain,
  type EvmWalletAsset,
  type NearWalletAsset,
  type WalletAsset,
} from './assetList';
import { nearSpendableBalance } from './nearBalance';

export type AssetBalanceUnavailableReason = 'rpc_failed' | 'timed_out' | 'invalid_response';

/**
 * One asset's balance. A failed read is its own state and never a zero: only `read` carries an
 * amount, so a caller must check the kind before it can show a number.
 */
export type AssetBalance =
  | {
      readonly kind: 'read';
      readonly asset: WalletAsset;
      /** What the wallet can send now, in base units. */
      readonly available: string;
      /** For NEAR: the part of the balance that storage keeps, in base units. */
      readonly reserved?: string;
    }
  | {
      readonly kind: 'unavailable';
      readonly asset: WalletAsset;
      readonly reason: AssetBalanceUnavailableReason;
    };

export type AssetBalances = {
  readonly readAtMs: number;
  readonly balances: readonly AssetBalance[];
};

export type AssetAccounts = {
  /** The NEAR account to read. Omit it, or pass null, to skip NEAR assets. */
  readonly nearAccount?: string | null;
  /** The EVM address to read on every configured EVM chain. Omit it to skip EVM assets. */
  readonly evmAddress?: string | null;
};

export type AssetChain = {
  readonly network: SeamsChainNetwork;
  readonly rpcUrl?: string;
  readonly chainId?: number;
};

export type AssetBalanceReadDependencies = {
  readonly chains: readonly AssetChain[];
  readonly nearClient: NearClient;
  readonly createEvmClient?: (rpcUrl: string) => EvmClient;
  readonly timeoutMs?: number;
  readonly now?: () => number;
};

const DEFAULT_TIMEOUT_MS = 6_000;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BASE_UNITS = /^\d{1,78}$/;
const HEX_QUANTITY = /^0x[0-9a-fA-F]{1,64}$/;
// balanceOf(address)
const BALANCE_OF_SELECTOR = '0x70a08231';

class BalanceReadTimeout extends Error {}
class InvalidBalanceResponse extends Error {}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BalanceReadTimeout()), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function unavailable(asset: WalletAsset, error: unknown): AssetBalance {
  const reason: AssetBalanceUnavailableReason =
    error instanceof BalanceReadTimeout
      ? 'timed_out'
      : error instanceof InvalidBalanceResponse
        ? 'invalid_response'
        : 'rpc_failed';
  return { kind: 'unavailable', asset, reason };
}

function decodeBaseUnits(value: unknown): string {
  if (typeof value !== 'string' || !BASE_UNITS.test(value)) {
    throw new InvalidBalanceResponse('ft_balance_of did not return a base-unit string');
  }
  return BigInt(value).toString();
}

function decodeHexQuantity(value: unknown): string {
  if (typeof value !== 'string' || !HEX_QUANTITY.test(value)) {
    throw new InvalidBalanceResponse('The EVM node did not return a hex quantity');
  }
  return BigInt(value).toString();
}

// A word of zeros decodes as 0x, which some nodes return for a zero balance.
function decodeUint256Word(value: unknown): string {
  if (value === '0x') return '0';
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new InvalidBalanceResponse('balanceOf did not return one 32-byte word');
  }
  return BigInt(value).toString();
}

async function readNearNative(
  deps: AssetBalanceReadDependencies,
  timeoutMs: number,
  asset: NearWalletAsset,
  accountId: string,
): Promise<AssetBalance | 'missing_account'> {
  try {
    const account = await withTimeout(deps.nearClient.viewAccount(accountId), timeoutMs);
    const { spendable, reserved } = nearSpendableBalance(account);
    return {
      kind: 'read',
      asset,
      available: spendable.toString(),
      reserved: reserved.toString(),
    };
  } catch (error) {
    // A new implicit account has no state yet; it holds nothing on any contract.
    const exists = await accountExists(deps.nearClient, accountId).catch(() => null);
    if (exists === false) return 'missing_account';
    return unavailable(asset, error);
  }
}

async function readNearToken(
  deps: AssetBalanceReadDependencies,
  timeoutMs: number,
  asset: Extract<NearWalletAsset, { kind: 'nep141' }>,
  accountId: string,
): Promise<AssetBalance> {
  try {
    const available = await withTimeout(
      deps.nearClient.view({
        account: asset.contract,
        method: 'ft_balance_of',
        args: { account_id: accountId },
        decodeResult: decodeBaseUnits,
      }),
      timeoutMs,
    );
    return { kind: 'read', asset, available };
  } catch (error) {
    return unavailable(asset, error);
  }
}

async function readNearAssets(
  deps: AssetBalanceReadDependencies,
  timeoutMs: number,
  assets: readonly NearWalletAsset[],
  accountId: string,
): Promise<AssetBalance[]> {
  const [native, ...tokens] = assets;
  if (!native || native.kind !== 'near_native') return [];
  // The token reads start with the account read, so one slow node does not add their time.
  const tokenReads = tokens.map((asset) =>
    asset.kind === 'nep141' ? readNearToken(deps, timeoutMs, asset, accountId) : null,
  );
  const nativeRead = await readNearNative(deps, timeoutMs, native, accountId);
  if (nativeRead === 'missing_account') {
    return assets.map((asset) => ({ kind: 'read', asset, available: '0' }));
  }
  const tokenBalances = await Promise.all(tokenReads);
  return [nativeRead, ...tokenBalances.filter((balance) => balance !== null)];
}

async function readEvmAsset(
  client: EvmClient,
  timeoutMs: number,
  asset: EvmWalletAsset,
  address: string,
): Promise<AssetBalance> {
  try {
    if (asset.kind === 'evm_native') {
      const result = await withTimeout(
        client.request({ method: 'eth_getBalance', params: [address, 'latest'], timeoutMs }),
        timeoutMs,
      );
      return { kind: 'read', asset, available: decodeHexQuantity(result) };
    }
    const data = `${BALANCE_OF_SELECTOR}${address.slice(2).toLowerCase().padStart(64, '0')}`;
    const result = await withTimeout(
      client.request({
        method: 'eth_call',
        params: [{ to: asset.contract, data }, 'latest'],
        timeoutMs,
      }),
      timeoutMs,
    );
    return { kind: 'read', asset, available: decodeUint256Word(result) };
  } catch (error) {
    return unavailable(asset, error);
  }
}

function defaultEvmClient(rpcUrl: string): EvmClient {
  return createEvmClient({ rpcUrl });
}

/**
 * Read the listed assets for the given accounts on every configured chain. The read uses only
 * public RPC data, so it needs no wallet session. It never rejects: each failed read is an
 * `unavailable` entry.
 */
export async function readAssetBalances(
  deps: AssetBalanceReadDependencies,
  accounts: AssetAccounts,
): Promise<AssetBalances> {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const nearAccount = accounts.nearAccount?.trim() || null;
  const evmAddress = accounts.evmAddress?.trim() || null;
  const reads: Promise<AssetBalance[]>[] = [];
  for (const chain of deps.chains) {
    const assets = assetsForChain(chain);
    if (assets.length === 0) continue;
    if (isNearChainNetwork(chain.network)) {
      if (!nearAccount || !isValidAccountId(nearAccount)) continue;
      reads.push(readNearAssets(deps, timeoutMs, assets as NearWalletAsset[], nearAccount));
      continue;
    }
    if (!isEvmChainNetwork(chain.network) || !chain.rpcUrl) continue;
    if (!evmAddress || !EVM_ADDRESS.test(evmAddress)) continue;
    const client = (deps.createEvmClient ?? defaultEvmClient)(chain.rpcUrl);
    reads.push(
      Promise.all(
        (assets as EvmWalletAsset[]).map((asset) =>
          readEvmAsset(client, timeoutMs, asset, evmAddress),
        ),
      ),
    );
  }
  const balances = (await Promise.all(reads)).flat();
  return { readAtMs: (deps.now ?? Date.now)(), balances };
}

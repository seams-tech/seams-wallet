import type { NearClient } from '@/core/rpcClients/near/NearClient';
import type { EvmClient } from '@/core/rpcClients/evm/EvmClient';
import { ActionType, type ActionArgs } from '@/core/types/actions';
import { parseUnits } from '@/core/types/amounts';
import { isValidAccountId } from '@shared/utils/near';
import type { EvmWalletAsset, NearWalletAsset, WalletAsset } from './assetList';

// 30 TGas covers storage_deposit and ft_transfer on the listed contracts.
const NEAR_TOKEN_CALL_GAS = '30000000000000';
// NEP-141 requires exactly this attached deposit on a token transfer.
const NEAR_TOKEN_TRANSFER_DEPOSIT_YOCTO = '1';
// Max keeps 0.01 NEAR for the gas of the send itself.
export const NEAR_SEND_GAS_ALLOWANCE_YOCTO = 10n ** 22n;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
// transfer(address,uint256)
const ERC20_TRANSFER_SELECTOR = 'a9059cbb';
const BASE_UNITS = /^\d{1,78}$/;

export type SendAmount =
  | { readonly kind: 'valid'; readonly baseUnits: bigint }
  | { readonly kind: 'invalid'; readonly reason: 'empty' | 'format' | 'decimals' | 'zero' };

/** Parse a decimal amount the user typed into base units. */
export function parseSendAmount(input: string, decimals: number): SendAmount {
  const value = input.trim().replace(/,/g, '');
  if (!value) return { kind: 'invalid', reason: 'empty' };
  if (!/^\d*\.?\d*$/.test(value) || value === '.') return { kind: 'invalid', reason: 'format' };
  const fraction = value.split('.')[1] ?? '';
  if (fraction.length > decimals) return { kind: 'invalid', reason: 'decimals' };
  let baseUnits: bigint;
  try {
    baseUnits = parseUnits(value.startsWith('.') ? `0${value}` : value, decimals);
  } catch {
    return { kind: 'invalid', reason: 'format' };
  }
  if (baseUnits <= 0n) return { kind: 'invalid', reason: 'zero' };
  return { kind: 'valid', baseUnits };
}

export type SendRecipient =
  | { readonly kind: 'near'; readonly accountId: string; readonly implicit: boolean }
  | { readonly kind: 'evm'; readonly address: `0x${string}` }
  | { readonly kind: 'invalid' };

/** A NEAR account id for a NEAR asset, an EVM address for an EVM asset. */
export function parseSendRecipient(asset: WalletAsset, input: string): SendRecipient {
  const value = input.trim();
  if (asset.kind === 'near_native' || asset.kind === 'nep141') {
    const accountId = value.toLowerCase();
    if (!isValidAccountId(accountId)) return { kind: 'invalid' };
    const implicit = /^[0-9a-f]{64}$/.test(accountId) || /^0x[0-9a-f]{40}$/.test(accountId);
    return { kind: 'near', accountId, implicit };
  }
  if (!EVM_ADDRESS.test(value)) return { kind: 'invalid' };
  return { kind: 'evm', address: value.toLowerCase() as `0x${string}` };
}

export type NearTokenStorage =
  | { readonly kind: 'registered' }
  | { readonly kind: 'missing'; readonly depositYocto: string };

function decodeStorageBalance(value: unknown): boolean {
  if (value === null) return false;
  if (typeof value === 'object' && value !== null && 'total' in value) return true;
  throw new Error('storage_balance_of returned an invalid value');
}

function decodeStorageMinimum(value: unknown): string {
  const min =
    typeof value === 'object' && value !== null && 'min' in value
      ? (value as { min: unknown }).min
      : undefined;
  if (typeof min !== 'string' || !BASE_UNITS.test(min)) {
    throw new Error('storage_balance_bounds returned an invalid minimum');
  }
  return min;
}

/** Whether the recipient can hold this NEP-141 token, and the deposit that registers it. */
export async function readNearTokenStorage(
  nearClient: NearClient,
  contract: string,
  recipient: string,
): Promise<NearTokenStorage> {
  const registered = await nearClient.view({
    account: contract,
    method: 'storage_balance_of',
    args: { account_id: recipient },
    decodeResult: decodeStorageBalance,
  });
  if (registered) return { kind: 'registered' };
  const depositYocto = await nearClient.view({
    account: contract,
    method: 'storage_balance_bounds',
    args: {},
    decodeResult: decodeStorageMinimum,
  });
  return { kind: 'missing', depositYocto };
}

export type NearSendTransaction = {
  readonly receiverId: string;
  readonly actions: ActionArgs[];
};

/**
 * One transaction: a NEAR transfer, or, for a token, an `ft_transfer` after a
 * `storage_deposit` that registers a recipient who cannot hold the token yet.
 */
export function nearSendTransaction(args: {
  readonly asset: NearWalletAsset;
  readonly recipient: string;
  readonly baseUnits: bigint;
  readonly storage: NearTokenStorage;
}): NearSendTransaction {
  if (args.asset.kind === 'near_native') {
    return {
      receiverId: args.recipient,
      actions: [{ type: ActionType.Transfer, amount: args.baseUnits.toString() }],
    };
  }
  const transfer: ActionArgs = {
    type: ActionType.FunctionCall,
    methodName: 'ft_transfer',
    args: { receiver_id: args.recipient, amount: args.baseUnits.toString() },
    gas: NEAR_TOKEN_CALL_GAS,
    deposit: NEAR_TOKEN_TRANSFER_DEPOSIT_YOCTO,
  };
  const actions: ActionArgs[] =
    args.storage.kind === 'missing'
      ? [
          {
            type: ActionType.FunctionCall,
            methodName: 'storage_deposit',
            args: { account_id: args.recipient, registration_only: true },
            gas: NEAR_TOKEN_CALL_GAS,
            deposit: args.storage.depositYocto,
          },
          transfer,
        ]
      : [transfer];
  return { receiverId: args.asset.contract, actions };
}

export type EvmSendTransaction = {
  readonly tx: {
    readonly to: `0x${string}`;
    readonly value: bigint;
    readonly data: `0x${string}`;
    readonly accessList: [];
    readonly maxPriorityFeePerGas: bigint;
    readonly maxFeePerGas: bigint;
    readonly gasLimit: bigint;
  };
  /** The largest fee the transaction can pay, in the chain's native base units. */
  readonly maxFeeNative: bigint;
};

function word(value: string): string {
  return value.padStart(64, '0');
}

function toHexQuantity(value: bigint): `0x${string}` {
  return `0x${value.toString(16)}`;
}

function readQuantity(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    throw new Error(`The EVM node returned an invalid ${label}`);
  }
  return BigInt(value);
}

/** Build an EIP-1559 send with a gas limit and fees from the chain's node. */
export async function estimateEvmSend(
  client: EvmClient,
  args: {
    readonly asset: EvmWalletAsset;
    readonly from: string;
    readonly recipient: `0x${string}`;
    readonly baseUnits: bigint;
  },
): Promise<EvmSendTransaction> {
  const call =
    args.asset.kind === 'evm_native'
      ? { to: args.recipient, value: args.baseUnits, data: '0x' as `0x${string}` }
      : {
          to: args.asset.contract as `0x${string}`,
          value: 0n,
          data: `0x${ERC20_TRANSFER_SELECTOR}${word(args.recipient.slice(2))}${word(
            args.baseUnits.toString(16),
          )}` as `0x${string}`,
        };
  const [estimate, gasPrice, priority] = await Promise.all([
    client.request({
      method: 'eth_estimateGas',
      params: [{ from: args.from, to: call.to, value: toHexQuantity(call.value), data: call.data }],
    }),
    client.request({ method: 'eth_gasPrice', params: [] }),
    client.request({ method: 'eth_maxPriorityFeePerGas', params: [] }).catch(() => '0x0'),
  ]);
  const estimatedGas = readQuantity(estimate, 'gas estimate');
  const gasLimit = (estimatedGas * 12n) / 10n > 21_000n ? (estimatedGas * 12n) / 10n : 21_000n;
  const maxPriorityFeePerGas = readQuantity(priority, 'priority fee');
  const maxFeePerGas = readQuantity(gasPrice, 'gas price') * 2n + maxPriorityFeePerGas;
  return {
    tx: { ...call, accessList: [], maxPriorityFeePerGas, maxFeePerGas, gasLimit },
    maxFeeNative: gasLimit * maxFeePerGas,
  };
}

function ceilDivide(value: bigint, divisor: bigint): bigint {
  return (value + divisor - 1n) / divisor;
}

/**
 * The largest amount Max fills in. NEAR keeps a gas allowance; an EVM native coin, and a token
 * that also pays gas, keep the transaction's largest fee.
 */
export function maxSendBaseUnits(args: {
  readonly asset: WalletAsset;
  readonly available: bigint;
  readonly maxFeeNative?: bigint;
}): bigint {
  const { asset, available } = args;
  let fee = 0n;
  if (asset.kind === 'near_native') fee = NEAR_SEND_GAS_ALLOWANCE_YOCTO;
  if (asset.kind === 'evm_native') fee = args.maxFeeNative ?? 0n;
  if (asset.kind === 'erc20' && asset.paysGas && args.maxFeeNative !== undefined) {
    fee = ceilDivide(
      args.maxFeeNative,
      10n ** BigInt(asset.paysGas.nativeDecimals - asset.decimals),
    );
  }
  return available > fee ? available - fee : 0n;
}

export type SendRequest = {
  readonly asset: WalletAsset;
  /** The sender: the NEAR account for a NEAR asset, the EVM address for an EVM asset. */
  readonly from: string;
  readonly recipient: string;
  /** A decimal amount in whole units, as the user typed it. */
  readonly amount: string;
};

export type SendRejection =
  | 'invalid_recipient'
  | 'invalid_amount'
  | 'missing_account'
  | 'chain_not_configured'
  | 'unavailable';

export type PreparedSend =
  | {
      readonly kind: 'near';
      readonly asset: NearWalletAsset;
      readonly baseUnits: bigint;
      readonly receiverId: string;
      readonly actions: ActionArgs[];
      /** The storage deposit that registers the recipient for the token, in yoctoNEAR. */
      readonly storageDepositYocto: string | null;
    }
  | {
      readonly kind: 'evm';
      readonly asset: EvmWalletAsset;
      readonly baseUnits: bigint;
      readonly tx: EvmSendTransaction['tx'];
      readonly maxFeeNative: bigint;
    }
  | { readonly kind: 'rejected'; readonly reason: SendRejection };

export type SendPreparationDependencies = {
  readonly nearClient: NearClient;
  readonly accountExists: (accountId: string) => Promise<boolean>;
  readonly evmClientFor: (asset: EvmWalletAsset) => EvmClient | null;
};

/**
 * Check a send and build its transaction. It checks the recipient on chain: a named NEAR
 * account must exist, and a token recipient without storage gets a `storage_deposit`.
 */
export async function prepareSend(
  deps: SendPreparationDependencies,
  request: SendRequest,
): Promise<PreparedSend> {
  const { asset } = request;
  const amount = parseSendAmount(request.amount, asset.decimals);
  if (amount.kind !== 'valid') return { kind: 'rejected', reason: 'invalid_amount' };
  const recipient = parseSendRecipient(asset, request.recipient);
  if (recipient.kind === 'invalid') return { kind: 'rejected', reason: 'invalid_recipient' };
  try {
    if (recipient.kind === 'near') {
      if (asset.kind !== 'near_native' && asset.kind !== 'nep141') {
        return { kind: 'rejected', reason: 'invalid_recipient' };
      }
      if (!recipient.implicit && !(await deps.accountExists(recipient.accountId))) {
        return { kind: 'rejected', reason: 'missing_account' };
      }
      const storage: NearTokenStorage =
        asset.kind === 'nep141'
          ? await readNearTokenStorage(deps.nearClient, asset.contract, recipient.accountId)
          : { kind: 'registered' };
      const transaction = nearSendTransaction({
        asset,
        recipient: recipient.accountId,
        baseUnits: amount.baseUnits,
        storage,
      });
      return {
        kind: 'near',
        asset,
        baseUnits: amount.baseUnits,
        ...transaction,
        storageDepositYocto: storage.kind === 'missing' ? storage.depositYocto : null,
      };
    }
    if (asset.kind !== 'evm_native' && asset.kind !== 'erc20') {
      return { kind: 'rejected', reason: 'invalid_recipient' };
    }
    const client = deps.evmClientFor(asset);
    if (!client) return { kind: 'rejected', reason: 'chain_not_configured' };
    const estimate = await estimateEvmSend(client, {
      asset,
      from: request.from,
      recipient: recipient.address,
      baseUnits: amount.baseUnits,
    });
    return { kind: 'evm', asset, baseUnits: amount.baseUnits, ...estimate };
  } catch {
    return { kind: 'rejected', reason: 'unavailable' };
  }
}

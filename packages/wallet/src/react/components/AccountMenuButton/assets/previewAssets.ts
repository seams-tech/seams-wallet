import { assetsForChain, type WalletAsset } from '@/core/assets/assetList';
import type { AssetBalance, AssetBalances } from '@/core/assets/readAssetBalances';
import {
  nearWithdrawTransaction,
  parseWithdrawAmount,
  parseWithdrawRecipient,
  type PreparedWithdrawal,
  type WithdrawalRequest,
} from '@/core/assets/withdraw';
import type { WithdrawOutcome } from './WithdrawPanel';

/** Display-only sample data for `AccountMenuButtonMock`. Nothing here reads or signs. */
export const PREVIEW_NEAR_ACCOUNT = 'alex.near';
export const PREVIEW_EVM_ADDRESS = '0x42010000000000000000000000000000000000891c';

// Whole-unit sample amounts by asset id; anything else shows zero.
const SAMPLE_AMOUNTS: Readonly<Record<string, { available: string; reserved?: string }>> = {
  'near-mainnet:native': {
    available: '12480000000000000000000000',
    reserved: '50000000000000000000000',
  },
  'near-mainnet:meta-pool.near': { available: '4100000000000000000000000' },
  'near-mainnet:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1': {
    available: '250000000',
  },
  'near-mainnet:sol.omft.near': { available: '1250000000' },
  'ethereum-mainnet:native': { available: '42000000000000000' },
  'ethereum-mainnet:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { available: '18200000' },
};

function sampleBalance(asset: WalletAsset): AssetBalance {
  const sample = SAMPLE_AMOUNTS[asset.id];
  return {
    kind: 'read',
    asset,
    available: sample?.available ?? '0',
    ...(sample?.reserved ? { reserved: sample.reserved } : {}),
  };
}

export const PREVIEW_ASSETS: readonly WalletAsset[] = [
  ...assetsForChain({ network: 'near-mainnet' }),
  ...assetsForChain({ network: 'ethereum-mainnet', chainId: 1 }),
];

export const PREVIEW_BALANCES: AssetBalances = {
  readAtMs: 0,
  balances: PREVIEW_ASSETS.map(sampleBalance),
};

/** Checks the form like the live path, then builds a transaction without any network call. */
export async function previewPrepareWithdrawal(
  request: WithdrawalRequest,
): Promise<PreparedWithdrawal> {
  const { asset } = request;
  const amount = parseWithdrawAmount(request.amount, asset.decimals);
  if (amount.kind !== 'valid') return { kind: 'rejected', reason: 'invalid_amount' };
  const recipient = parseWithdrawRecipient(asset, request.recipient);
  if (recipient.kind === 'invalid') return { kind: 'rejected', reason: 'invalid_recipient' };
  if (recipient.kind === 'near' && (asset.kind === 'near_native' || asset.kind === 'nep141')) {
    return {
      kind: 'near',
      asset,
      baseUnits: amount.baseUnits,
      ...nearWithdrawTransaction({
        asset,
        recipient: recipient.accountId,
        baseUnits: amount.baseUnits,
        storage: { kind: 'registered' },
      }),
      storageDepositYocto: null,
    };
  }
  if (recipient.kind === 'evm' && (asset.kind === 'evm_native' || asset.kind === 'erc20')) {
    return {
      kind: 'evm',
      asset,
      baseUnits: amount.baseUnits,
      tx: {
        to: recipient.address,
        value: asset.kind === 'evm_native' ? amount.baseUnits : 0n,
        data: '0x',
        accessList: [],
        maxPriorityFeePerGas: 0n,
        maxFeePerGas: 2_000_000_000n,
        gasLimit: 21_000n,
      },
      maxFeeNative: 42_000_000_000_000n,
    };
  }
  return { kind: 'rejected', reason: 'invalid_recipient' };
}

export async function previewSendWithdrawal(): Promise<WithdrawOutcome> {
  return { kind: 'not_sent', message: 'This preview does not sign or send anything.' };
}

export function previewFromFor(asset: WalletAsset): string {
  return asset.kind === 'near_native' || asset.kind === 'nep141'
    ? PREVIEW_NEAR_ACCOUNT
    : PREVIEW_EVM_ADDRESS;
}

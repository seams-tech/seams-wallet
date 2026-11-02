import type { TxDisplayTokenTransfer } from '@/core/signingEngine/interfaces/display';
import { formatTokenBaseUnits } from '../../tokenAmounts';

// transfer(address,uint256): the selector and two 32-byte words, with no trailing data.
const ERC20_TRANSFER_CALLDATA = /^0xa9059cbb0{24}([0-9a-f]{40})([0-9a-f]{64})$/;

// Each chain has its own list, because an address can hold another contract on another chain.
const KNOWN_ERC20_TOKENS: Readonly<
  Record<number, Readonly<Record<string, { symbol: string; decimals: number }>>>
> = {
  1: {
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { symbol: 'USDC', decimals: 6 },
    '0xdac17f958d2ee523a2206206994597c13d831ec7': { symbol: 'USDT', decimals: 6 },
    '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { symbol: 'WBTC', decimals: 8 },
    '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': { symbol: 'cbBTC', decimals: 8 },
  },
  8453: {
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', decimals: 6 },
    '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2': { symbol: 'USDT', decimals: 6 },
    '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': { symbol: 'cbBTC', decimals: 8 },
  },
  84532: {
    '0x036cbd53842c5426634e7929541ec2318f3dcf7e': { symbol: 'USDC', decimals: 6 },
  },
  5042002: {
    '0x3600000000000000000000000000000000000000': { symbol: 'USDC', decimals: 6 },
  },
  11155111: {
    '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238': { symbol: 'USDC', decimals: 6 },
  },
};

/** An unlisted token shows its base units, because a contract's own symbol proves nothing. */
export function parseErc20TransferForDisplay(args: {
  chainId: number;
  to: string | undefined;
  dataHex: string;
}): TxDisplayTokenTransfer | null {
  if (!args.to) return null;
  const match = ERC20_TRANSFER_CALLDATA.exec(args.dataHex.toLowerCase());
  if (!match) return null;
  const tokenContract = args.to.toLowerCase();
  const baseUnits = BigInt(`0x${match[2]}`).toString();
  const token = KNOWN_ERC20_TOKENS[args.chainId]?.[tokenContract];
  return {
    tokenContract,
    recipient: `0x${match[1]}`,
    baseUnits,
    ...(token
      ? {
          amount: {
            value: formatTokenBaseUnits(baseUnits, token.decimals),
            symbol: token.symbol,
            verified: true,
          },
        }
      : {}),
  };
}

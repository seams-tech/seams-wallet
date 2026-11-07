import type {
  SeamsChainNetwork,
  SeamsEvmChainNetwork,
  SeamsNearChainNetwork,
} from '@/core/types/seams';
import { isEvmChainNetwork, isNearChainNetwork } from '@/core/config/chains';

/**
 * The wallet's own asset list: the one source for token names, decimals, artwork and
 * "verified". The transfer review and the balance read both use it, so a token that the
 * review calls verified is the same token that Settings lists.
 */

export type TokenArtworkKey = 'NEAR' | 'stNEAR' | 'ETH' | 'USDC' | 'USDT' | 'BTC' | 'SOL' | 'ZEC';

type ListedToken = {
  readonly contract: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly name: string;
  readonly artwork: TokenArtworkKey;
  /** A primary asset is listed with a zero balance. Other variants appear only when held. */
  readonly primary: boolean;
  /** The bridge that holds the native coin, when the token is a bridge receipt. */
  readonly bridge?: 'NEAR Intents';
};

type NearNetwork = 'testnet' | 'mainnet';

// An implicit account id can hold another contract on the other network, so each list is separate.
// The order is the display order.
const NEAR_TOKENS: Readonly<Record<NearNetwork, readonly ListedToken[]>> = {
  mainnet: [
    {
      contract: 'meta-pool.near',
      symbol: 'stNEAR',
      decimals: 24,
      name: 'Staked NEAR',
      artwork: 'stNEAR',
      primary: true,
    },
    {
      contract: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
      symbol: 'USDC',
      decimals: 6,
      name: 'USD Coin',
      artwork: 'USDC',
      primary: true,
    },
    {
      contract: 'usdt.tether-token.near',
      symbol: 'USDt',
      decimals: 6,
      name: 'Tether USD',
      artwork: 'USDT',
      primary: true,
    },
    {
      contract: 'eth.bridge.near',
      symbol: 'ETH',
      decimals: 18,
      name: 'Ether (bridged)',
      artwork: 'ETH',
      primary: true,
    },
    {
      contract: 'btc.omft.near',
      symbol: 'BTC',
      decimals: 8,
      name: 'Bitcoin',
      artwork: 'BTC',
      primary: true,
      bridge: 'NEAR Intents',
    },
    {
      contract: 'sol.omft.near',
      symbol: 'SOL',
      decimals: 9,
      name: 'Solana',
      artwork: 'SOL',
      primary: true,
      bridge: 'NEAR Intents',
    },
    {
      contract: 'zec.omft.near',
      symbol: 'ZEC',
      decimals: 8,
      name: 'Zcash',
      artwork: 'ZEC',
      primary: true,
      bridge: 'NEAR Intents',
    },
    {
      contract: 'wrap.near',
      symbol: 'wNEAR',
      decimals: 24,
      name: 'Wrapped NEAR',
      artwork: 'NEAR',
      primary: false,
    },
    {
      contract: 'dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near',
      symbol: 'USDT.e',
      decimals: 6,
      name: 'Tether USD (bridged)',
      artwork: 'USDT',
      primary: false,
    },
    {
      contract: 'nbtc.bridge.near',
      symbol: 'nBTC',
      decimals: 8,
      name: 'Bitcoin (bridged)',
      artwork: 'BTC',
      primary: false,
    },
    {
      contract: '2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near',
      symbol: 'WBTC',
      decimals: 8,
      name: 'Wrapped Bitcoin',
      artwork: 'BTC',
      primary: false,
    },
  ],
  testnet: [
    {
      contract: 'meta-v2.pool.testnet',
      symbol: 'stNEAR',
      decimals: 24,
      name: 'Staked NEAR',
      artwork: 'stNEAR',
      primary: true,
    },
    {
      contract: '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af',
      symbol: 'USDC',
      decimals: 6,
      name: 'USD Coin',
      artwork: 'USDC',
      primary: true,
    },
    {
      contract: 'wrap.testnet',
      symbol: 'wNEAR',
      decimals: 24,
      name: 'Wrapped NEAR',
      artwork: 'NEAR',
      primary: false,
    },
  ],
};

// Each chain has its own list, because an address can hold another contract on another chain.
// Contracts are lowercase. Base and Base Sepolia are reviewed but are not configurable networks.
const ERC20_TOKENS: Readonly<Record<number, readonly ListedToken[]>> = {
  1: [
    {
      contract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      symbol: 'USDC',
      decimals: 6,
      name: 'USD Coin',
      artwork: 'USDC',
      primary: true,
    },
    {
      contract: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      symbol: 'USDT',
      decimals: 6,
      name: 'Tether USD',
      artwork: 'USDT',
      primary: true,
    },
    {
      contract: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
      symbol: 'WBTC',
      decimals: 8,
      name: 'Wrapped Bitcoin',
      artwork: 'BTC',
      primary: false,
    },
    {
      contract: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
      symbol: 'cbBTC',
      decimals: 8,
      name: 'Coinbase Wrapped BTC',
      artwork: 'BTC',
      primary: false,
    },
  ],
  8453: [
    {
      contract: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      symbol: 'USDC',
      decimals: 6,
      name: 'USD Coin',
      artwork: 'USDC',
      primary: true,
    },
    {
      contract: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2',
      symbol: 'USDT',
      decimals: 6,
      name: 'Tether USD',
      artwork: 'USDT',
      primary: true,
    },
    {
      contract: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf',
      symbol: 'cbBTC',
      decimals: 8,
      name: 'Coinbase Wrapped BTC',
      artwork: 'BTC',
      primary: false,
    },
  ],
  84532: [
    {
      contract: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
      symbol: 'USDC',
      decimals: 6,
      name: 'USD Coin',
      artwork: 'USDC',
      primary: true,
    },
  ],
  5042002: [
    {
      contract: '0x3600000000000000000000000000000000000000',
      symbol: 'USDC',
      decimals: 6,
      name: 'USD Coin',
      artwork: 'USDC',
      primary: true,
    },
  ],
  11155111: [
    {
      contract: '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238',
      symbol: 'USDC',
      decimals: 6,
      name: 'USD Coin',
      artwork: 'USDC',
      primary: true,
    },
  ],
};

// Arc pays gas in USDC: its native balance is the same money as the USDC token, with 18 decimals.
// Settings lists the token only, so one balance never shows twice.
const ARC_GAS_TOKEN = '0x3600000000000000000000000000000000000000';
const ARC_NATIVE_DECIMALS = 18;

type AssetCommon = {
  /** Stable within one configuration: `<network>:<contract or native>`. */
  readonly id: string;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly artwork: TokenArtworkKey;
  readonly primary: boolean;
  readonly bridge?: 'NEAR Intents';
};

export type NearNativeAsset = AssetCommon & {
  readonly kind: 'near_native';
  readonly network: SeamsNearChainNetwork;
};
export type NearTokenAsset = AssetCommon & {
  readonly kind: 'nep141';
  readonly network: SeamsNearChainNetwork;
  readonly contract: string;
};
export type EvmNativeAsset = AssetCommon & {
  readonly kind: 'evm_native';
  readonly network: SeamsEvmChainNetwork;
  readonly chainId: number;
};
export type EvmTokenAsset = AssetCommon & {
  readonly kind: 'erc20';
  readonly network: SeamsEvmChainNetwork;
  readonly chainId: number;
  readonly contract: string;
  /**
   * Set when this token also pays the chain's gas. The native balance carries more decimals,
   * so a fee in native units divides by `10^(nativeDecimals - decimals)`.
   */
  readonly paysGas?: { readonly nativeDecimals: number };
};
export type WalletAsset = NearNativeAsset | NearTokenAsset | EvmNativeAsset | EvmTokenAsset;
export type NearWalletAsset = NearNativeAsset | NearTokenAsset;
export type EvmWalletAsset = EvmNativeAsset | EvmTokenAsset;

export type AssetChainConfig = {
  readonly network: SeamsChainNetwork;
  readonly chainId?: number;
};

function nearNetwork(network: SeamsNearChainNetwork): NearNetwork {
  return network === 'near-mainnet' ? 'mainnet' : 'testnet';
}

function nearTokenAsset(network: SeamsNearChainNetwork, token: ListedToken): NearTokenAsset {
  const { contract, ...display } = token;
  return { ...display, kind: 'nep141', id: `${network}:${contract}`, network, contract };
}

function erc20Asset(
  network: SeamsEvmChainNetwork,
  chainId: number,
  token: ListedToken,
): EvmTokenAsset {
  const { contract, ...display } = token;
  return {
    ...display,
    kind: 'erc20',
    id: `${network}:${contract}`,
    network,
    chainId,
    contract,
    ...(chainId === 5042002 && contract === ARC_GAS_TOKEN
      ? { paysGas: { nativeDecimals: ARC_NATIVE_DECIMALS } }
      : {}),
  };
}

function nativeEvmSymbol(network: SeamsEvmChainNetwork): boolean {
  return network === 'ethereum-mainnet' || network === 'ethereum-sepolia';
}

/** The assets that Settings lists for one configured chain, in display order. */
export function assetsForChain(chain: AssetChainConfig): readonly WalletAsset[] {
  const { network } = chain;
  if (isNearChainNetwork(network)) {
    return [
      {
        kind: 'near_native',
        id: `${network}:native`,
        network,
        symbol: 'NEAR',
        name: 'NEAR',
        decimals: 24,
        artwork: 'NEAR',
        primary: true,
      },
      ...NEAR_TOKENS[nearNetwork(network)].map(nearTokenAsset.bind(null, network)),
    ];
  }
  if (!isEvmChainNetwork(network) || chain.chainId === undefined) return [];
  const chainId = chain.chainId;
  const native: EvmNativeAsset[] = nativeEvmSymbol(network)
    ? [
        {
          kind: 'evm_native',
          id: `${network}:native`,
          network,
          chainId,
          symbol: 'ETH',
          name: 'Ether',
          decimals: 18,
          artwork: 'ETH',
          primary: true,
        },
      ]
    : [];
  return [...native, ...(ERC20_TOKENS[chainId] ?? []).map(erc20Asset.bind(null, network, chainId))];
}

/** Every asset for the configured chains: NEAR first, then EVM chains in configuration order. */
export function assetsForChains(chains: readonly AssetChainConfig[]): readonly WalletAsset[] {
  const near = chains.filter((chain) => isNearChainNetwork(chain.network));
  const evm = chains.filter((chain) => isEvmChainNetwork(chain.network));
  return [...near, ...evm].flatMap(assetsForChain);
}

/** A NEP-141 token on the wallet's list, for the transfer review. */
export function listedNearToken(
  network: NearNetwork,
  contract: string,
): { readonly symbol: string; readonly decimals: number } | undefined {
  const token = NEAR_TOKENS[network].find((entry) => entry.contract === contract);
  return token ? { symbol: token.symbol, decimals: token.decimals } : undefined;
}

/** An ERC-20 token on the wallet's list for one chain, for the transfer review. */
export function listedErc20Token(
  chainId: number,
  contract: string,
): { readonly symbol: string; readonly decimals: number } | undefined {
  const token = ERC20_TOKENS[chainId]?.find((entry) => entry.contract === contract.toLowerCase());
  return token ? { symbol: token.symbol, decimals: token.decimals } : undefined;
}

import type { NearClient } from '@/core/rpcClients/near/NearClient';
import type { SeamsConfigsReadonly } from '@/core/types/seams';
import { assetsForChains, type WalletAsset } from '@/core/assets/assetList';
import { createEvmClient } from '@/core/rpcClients/evm/EvmClient';
import { accountExists } from '@/core/rpcClients/near/accountExists';
import { prepareSend, type PreparedSend, type SendRequest } from '@/core/assets/send';
import {
  readAssetBalances,
  type AssetAccounts,
  type AssetBalances,
} from '@/core/assets/readAssetBalances';

export type {
  AssetAccounts,
  AssetBalance,
  AssetBalances,
  AssetBalanceUnavailableReason,
} from '@/core/assets/readAssetBalances';
export type { WalletAsset, TokenArtworkKey } from '@/core/assets/assetList';
export type { PreparedSend, SendRejection, SendRequest } from '@/core/assets/send';

/**
 * Balances of the wallet's listed assets. The reads use only public chain data and the
 * application's configured RPC endpoints, so they work before connection or authentication.
 */
export interface AssetsCapability {
  /** The listed assets for the configured chains, in display order. */
  list(): readonly WalletAsset[];
  /**
   * Read each listed asset for the given accounts. It never rejects: a failed read is an
   * `unavailable` entry, never a zero.
   */
  read(accounts: AssetAccounts): Promise<AssetBalances>;
  /** Runs after each completed `read`, with its result. Returns an unsubscribe function. */
  onChange(listener: (balances: AssetBalances) => void): () => void;
  /**
   * Check a send and build its unsigned transaction. Send the result with
   * `seams.near.signAndSendTransaction` or `seams.evm.signAndSendTransaction`; the wallet's
   * confirm card shows it before anything is signed.
   */
  prepareSend(request: SendRequest): Promise<PreparedSend>;
  /**
   * Open a screen of the mounted Settings panel (`AccountMenuButton` or `WalletSettingsPage`)
   * and open the panel if it is closed. Receive and Send choose `assetId` first. It returns
   * `false` when no Settings panel for a signed-in wallet is mounted.
   */
  openScreen(request: AssetScreenRequest): boolean;
}

export type AssetScreenRequest = {
  readonly screen: 'assets' | 'receive' | 'send';
  /** An asset id from `list()`. Receive and Send choose it first; an unknown id is ignored. */
  readonly assetId?: string;
};

type AssetScreenOpener = (request: AssetScreenRequest) => void;

const screenOpeners = new WeakMap<AssetsCapability, Set<AssetScreenOpener>>();

/**
 * A mounted Settings panel registers here so that `openScreen` reaches it. The newest
 * registration opens the screen. The result removes the registration.
 */
export function registerAssetScreens(
  assets: AssetsCapability,
  opener: AssetScreenOpener,
): () => void {
  const openers = screenOpeners.get(assets);
  if (!openers) return () => {};
  openers.add(opener);
  return () => {
    openers.delete(opener);
  };
}

export function createAssetsCapability(deps: {
  readonly configs: SeamsConfigsReadonly;
  readonly nearClient: NearClient;
}): AssetsCapability {
  const listeners = new Set<(balances: AssetBalances) => void>();
  const openers = new Set<AssetScreenOpener>();
  const capability: AssetsCapability = {
    list: () => assetsForChains(deps.configs.network.chains),
    read: async (accounts) => {
      const balances = await readAssetBalances(
        { chains: deps.configs.network.chains, nearClient: deps.nearClient },
        accounts,
      );
      for (const listener of [...listeners]) {
        try {
          listener(balances);
        } catch (error) {
          console.error('[seams.assets] onChange listener failed:', error);
        }
      }
      return balances;
    },
    prepareSend: (request) =>
      prepareSend(
        {
          nearClient: deps.nearClient,
          accountExists: accountExists.bind(null, deps.nearClient),
          evmClientFor: (asset) => {
            const chain = deps.configs.network.chains.find(
              (entry) => entry.network === asset.network,
            );
            return chain?.rpcUrl ? createEvmClient({ rpcUrl: chain.rpcUrl }) : null;
          },
        },
        request,
      ),
    onChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    openScreen: (request) => {
      const opener = [...openers].at(-1);
      if (!opener) return false;
      opener(request);
      return true;
    },
  };
  screenOpeners.set(capability, openers);
  return capability;
}

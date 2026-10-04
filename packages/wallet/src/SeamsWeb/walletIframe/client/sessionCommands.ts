import { toError } from '@shared/utils/errors';
import type { WalletSessionCommands } from '@/SeamsWeb/publicApi/auth';
import type { WalletIframeCoordinator } from '@/SeamsWeb/walletIframe/coordinator';
import { walletIframeUnlockRequestFromLoginHooks } from '../shared/unlockOptions';

type SessionIframe = Pick<WalletIframeCoordinator, 'requireRouter' | 'init'>;

export function createApplicationSessionCommands(
  walletIframe: SessionIframe,
): WalletSessionCommands {
  return {
    unlock: unlock.bind(null, walletIframe),
    lock: lock.bind(null, walletIframe),
    logout: logout.bind(null, walletIframe),
    getWalletSession: getWalletSession.bind(null, walletIframe),
    getRecentUnlocks: getRecentUnlocks.bind(null, walletIframe),
    hasPasskeyCredential: hasPasskeyCredential.bind(null, walletIframe),
    prefillRouterAbEcdsaDerivationPresignaturePool: prefillPresignatures.bind(null, walletIframe),
  };
}

async function unlock(
  walletIframe: SessionIframe,
  walletId: string,
  options?: Parameters<WalletSessionCommands['unlock']>[1],
): ReturnType<WalletSessionCommands['unlock']> {
  const resolvedWalletId = String(walletId || '').trim();
  if (!resolvedWalletId) throw new Error('unlock requires walletId');
  try {
    const router = await walletIframe.requireRouter(resolvedWalletId);
    const result = await router.unlock(
      walletIframeUnlockRequestFromLoginHooks({ walletId: resolvedWalletId, options }),
    );
    if (!result.success) {
      const unlockError = new Error(result.error || 'Login failed');
      await options?.onError?.(unlockError);
      await options?.afterCall?.(false, undefined, unlockError);
      return result;
    }
    await walletIframe.init(resolvedWalletId);
    await options?.afterCall?.(true, result);
    return result;
  } catch (error: unknown) {
    const wrappedError = toError(error);
    await options?.onError?.(wrappedError);
    await options?.afterCall?.(false);
    throw wrappedError;
  }
}

async function lock(walletIframe: SessionIframe): Promise<void> {
  const router = await walletIframe.requireRouter();
  await router.lock();
}

async function logout(walletIframe: SessionIframe): Promise<void> {
  const router = await walletIframe.requireRouter();
  await router.logout();
}

async function getWalletSession(
  walletIframe: SessionIframe,
  walletId?: string,
): ReturnType<WalletSessionCommands['getWalletSession']> {
  const router = await walletIframe.requireRouter(walletId);
  const session = await router.getWalletSession(walletId);
  try {
    await router.prefetchBlockheight();
  } catch {}
  return session;
}

async function hasPasskeyCredential(
  walletIframe: SessionIframe,
  walletId: string,
): Promise<boolean> {
  const resolvedWalletId = String(walletId || '').trim();
  if (!resolvedWalletId) return false;
  const router = await walletIframe.requireRouter();
  return await router.hasPasskeyCredential(resolvedWalletId);
}

async function getRecentUnlocks(
  walletIframe: SessionIframe,
): ReturnType<WalletSessionCommands['getRecentUnlocks']> {
  try {
    const router = await walletIframe.requireRouter();
    return await router.getRecentUnlocks();
  } catch {
    return { walletIds: [], accountIds: [], lastUsedAccount: null };
  }
}

async function prefillPresignatures(
  walletIframe: SessionIframe,
  args: Parameters<WalletSessionCommands['prefillRouterAbEcdsaDerivationPresignaturePool']>[0],
): ReturnType<WalletSessionCommands['prefillRouterAbEcdsaDerivationPresignaturePool']> {
  const router = await walletIframe.requireRouter(args.walletSession.walletId);
  return await router.prefillRouterAbEcdsaDerivationPresignaturePool({
    walletSession: args.walletSession,
    options: {
      chainTarget: args.chainTarget,
      ...(typeof args.waitForPoolReady === 'boolean'
        ? { waitForPoolReady: args.waitForPoolReady }
        : {}),
    },
  });
}

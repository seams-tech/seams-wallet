import { useMemo } from 'react';
import { useSeams } from '../context';
import type { SeamsContextType } from '../types';

/**
 * The sign-in, sign-out, and registration slice of the wallet context.
 *
 * `useSeams()` returns everything the SDK can do — signing, devices, account
 * input, confirmation config, theming — which is a lot to read past when a
 * component only renders an auth button. This selects the auth-shaped members.
 * It is a view over the same context, not a second one.
 */
export type UseWalletAuthResult = Pick<
  SeamsContextType,
  | 'loginState'
  | 'unlock'
  | 'lock'
  | 'registerWallet'
  | 'addWalletSigner'
  | 'refreshLoginState'
  | 'getSession'
  | 'sdkFlow'
>;

export function useWalletAuth(): UseWalletAuthResult {
  const ctx = useSeams();
  return useMemo(
    () => ({
      loginState: ctx.loginState,
      unlock: ctx.unlock,
      lock: ctx.lock,
      registerWallet: ctx.registerWallet,
      addWalletSigner: ctx.addWalletSigner,
      refreshLoginState: ctx.refreshLoginState,
      getSession: ctx.getSession,
      sdkFlow: ctx.sdkFlow,
    }),
    [ctx],
  );
}

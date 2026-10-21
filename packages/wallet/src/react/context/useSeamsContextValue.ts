import { useCallback, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { UnlockEventPhase } from '@/core/types/sdkSentEvents';
import type { AccountInputState, LoginState, SeamsContextType, SeamsContextValue } from '../types';
import type { ThemeMode } from '@/core/types/seams';
import { useSDKFlowRuntime } from './useSDKFlowRuntime';
import { useSeamsWithSdkFlow } from './useSeamsWithSdkFlow';
import { buildReactLoggedOutLoginState } from './reactLoginStateBuilders';

export function useSeamsContextValue(args: {
  seams: SeamsContextType['seams'];
  loginState: LoginState;
  setLoginState: Dispatch<SetStateAction<LoginState>>;
  walletIframeConnected: boolean;
  refreshSession: SeamsContextType['refreshSession'];
  accountInputState: AccountInputState;
  setAccountName: SeamsContextType['setAccountName'];
  refreshAccountData: SeamsContextType['refreshAccountData'];
  hostSetTheme?: (theme: ThemeMode) => void;
}): SeamsContextValue {
  const {
    seams,
    loginState,
    setLoginState,
    walletIframeConnected,
    refreshSession,
    accountInputState,
    setAccountName,
    refreshAccountData,
    hostSetTheme,
  } = args;

  const { sdkFlow, beginSdkFlow, appendSdkEventMessage, endSdkFlow } = useSDKFlowRuntime();
  const [walletLockState, setWalletLockState] = useState<SeamsContextType['walletLockState']>({
    kind: 'idle',
  });
  const seamsWithSdkFlow = useSeamsWithSdkFlow({
    seams,
    beginSdkFlow,
    appendSdkEventMessage,
    endSdkFlow,
    hostSetTheme,
  });

  const lock: SeamsContextType['lock'] = useCallback(async () => {
    setWalletLockState({ kind: 'cleaning_up' });
    setLoginState(buildReactLoggedOutLoginState());
    try {
      await seams.auth.lock();
    } catch (error) {
      console.warn('Wallet lock warning:', error);
    } finally {
      setWalletLockState({ kind: 'idle' });
    }
  }, [setLoginState, seams]);

  const startLinking = seamsWithSdkFlow.devices.startLinking;
  const cancelLinking = seams.devices.cancelLinking;

  const unlock: SeamsContextType['unlock'] = useCallback(
    async (walletId, options) => {
      return seamsWithSdkFlow.auth.unlock(walletId, {
        ...options,
        onEvent: async (event) => {
          if (event.phase === UnlockEventPhase.STEP_07_COMPLETED && event.status === 'succeeded') {
            await refreshSession(walletId);
            await refreshAccountData();
          }
          return options?.onEvent?.(event);
        },
        onError: (error) => {
          lock();
          return options?.onError?.(error);
        },
      });
    },
    [lock, refreshAccountData, refreshSession, seamsWithSdkFlow],
  );

  const registerWallet: SeamsContextType['registerWallet'] = useCallback(
    async (args) => {
      return await seamsWithSdkFlow.registration.registerWallet({
        ...args,
        options: {
          ...args.options,
          onError: (error) => {
            lock();
            return args.options?.onError?.(error);
          },
        },
      });
    },
    [lock, seamsWithSdkFlow],
  );

  const addSigner = seamsWithSdkFlow.registration.addSigner;

  const signAndSendTransaction = seams.near.signAndSendTransaction;

  const signMessage = seams.near.signMessage;

  const signDelegateAction: SeamsContextType['signDelegateAction'] = useCallback(
    (args) => {
      return seams.near.signDelegateAction({ ...args, options: { ...(args.options || {}) } });
    },
    [seams],
  );

  const getSession: SeamsContextType['getSession'] = useCallback(
    (walletId?: string) => {
      return seams.auth.getSession(walletId);
    },
    [seams],
  );

  const setConfirmationBehavior = seams.preferences.setConfirmationBehavior;
  const setConfirmationConfig = seams.preferences.setConfirmationConfig;
  const getConfirmationConfig = seams.preferences.getConfirmationConfig;

  return useMemo(
    () => ({
      seams: seamsWithSdkFlow,
      sdkFlow,
      walletLockState,
      addSigner,
      registerWallet,
      unlock,
      lock,
      startLinking,
      cancelLinking,
      signAndSendTransaction,
      signMessage,
      signDelegateAction,
      getSession,
      refreshSession,
      loginState,
      walletIframeConnected,
      accountInputState,
      setAccountName,
      refreshAccountData,
      setConfirmationBehavior,
      setConfirmationConfig,
      getConfirmationConfig,
      themeCapabilities: {
        canSetHostTheme: typeof hostSetTheme === 'function',
      },
    }),
    [
      seamsWithSdkFlow,
      sdkFlow,
      walletLockState,
      addSigner,
      registerWallet,
      unlock,
      lock,
      startLinking,
      cancelLinking,
      signAndSendTransaction,
      signMessage,
      signDelegateAction,
      getSession,
      refreshSession,
      loginState,
      walletIframeConnected,
      accountInputState,
      setAccountName,
      refreshAccountData,
      setConfirmationBehavior,
      setConfirmationConfig,
      getConfirmationConfig,
      hostSetTheme,
    ],
  );
}

import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { SeamsWeb } from '@/SeamsWeb';
import type { WalletSession } from '@/core/types/seams';
import type { ClientConnectionState } from '@/SeamsWeb/publicApi/types';
import type { LoginState } from '../types';
import {
  buildReactLoggedInLoginStateFromSession,
  buildReactLoggedOutLoginState,
} from './reactLoginStateBuilders';

type WalletIframeReactBindings = {
  seams: SeamsWeb;
  setWalletIframeConnected: Dispatch<SetStateAction<boolean>>;
  setLoginState: Dispatch<SetStateAction<LoginState>>;
};

function applySession(bindings: WalletIframeReactBindings, session: WalletSession): void {
  if (session.authentication.kind === 'authenticated' && session.appIdentity.kind !== 'resolved') {
    return;
  }
  bindings.setLoginState(
    buildReactLoggedInLoginStateFromSession(session) ?? buildReactLoggedOutLoginState(),
  );
}

function applyConnection(bindings: WalletIframeReactBindings, state: ClientConnectionState): void {
  bindings.setWalletIframeConnected(state.kind === 'ready');
}

function reportConnectionFailure(error: unknown): void {
  console.warn('[SeamsContextProvider] WalletIframe init failed:', error);
}

function unsubscribeWallet(stopConnection: () => void, stopSession: () => void): void {
  stopConnection();
  stopSession();
}

function subscribeWallet(bindings: WalletIframeReactBindings): () => void {
  const stopSession = bindings.seams.auth.onSessionChange(applySession.bind(null, bindings));
  const stopConnection = bindings.seams.connection.onChange(applyConnection.bind(null, bindings));
  void bindings.seams.connection.connect().catch(reportConnectionFailure);
  return unsubscribeWallet.bind(null, stopConnection, stopSession);
}

export function useWalletIframeLifecycle(bindings: WalletIframeReactBindings): void {
  useEffect(subscribeWallet.bind(null, bindings), [
    bindings.seams,
    bindings.setWalletIframeConnected,
    bindings.setLoginState,
  ]);
}

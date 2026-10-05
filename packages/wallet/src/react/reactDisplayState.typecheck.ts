import type { SDKFlowState, SeamsContextType, UseAccountInputReturn } from './types';
import type { UseWalletAuthResult } from './hooks/useWalletAuth';

const idleFlow: SDKFlowState = {
  seq: 0,
  kind: null,
  status: 'idle',
  eventsText: '',
};
void idleFlow;

const inProgressFlow: SDKFlowState = {
  seq: 1,
  kind: 'login',
  status: 'in-progress',
  eventsText: 'Waiting for confirmation',
  accountId: 'frost-vermillion-k7p9m2',
};
void inProgressFlow;

const successFlow: SDKFlowState = {
  seq: 2,
  kind: 'register',
  status: 'success',
  eventsText: 'Complete',
};
void successFlow;

const errorFlow: SDKFlowState = {
  seq: 3,
  kind: 'sync',
  status: 'error',
  eventsText: 'Failed',
  error: 'Sync failed',
};
void errorFlow;

// @ts-expect-error idle display state cannot carry active account identity.
const invalidIdleFlow: SDKFlowState = {
  seq: 4,
  kind: null,
  status: 'idle',
  eventsText: '',
  accountId: 'frost-vermillion-k7p9m2',
};
void invalidIdleFlow;

// @ts-expect-error error display state requires an error message.
const invalidErrorFlow: SDKFlowState = {
  seq: 5,
  kind: 'login',
  status: 'error',
  eventsText: 'Failed',
};
void invalidErrorFlow;

// @ts-expect-error success display state cannot carry an error message.
const invalidSuccessFlow: SDKFlowState = {
  seq: 6,
  kind: 'login',
  status: 'success',
  eventsText: 'Complete',
  error: 'unexpected',
};
void invalidSuccessFlow;

declare const seamsContext: SeamsContextType;
declare const walletAuth: UseWalletAuthResult;
declare const accountInput: UseAccountInputReturn;
void seamsContext.refreshSession();
void walletAuth.refreshSession('wallet.testnet');
seamsContext.setAccountName('alice');
accountInput.setAccountName('alice');
// @ts-expect-error Use refreshSession.
void seamsContext.refreshLoginState;
// @ts-expect-error Use refreshSession.
void walletAuth.refreshLoginState;
// @ts-expect-error Use setAccountName.
void seamsContext.setInputUsername;
// @ts-expect-error Use setAccountName.
void accountInput.setInputUsername;

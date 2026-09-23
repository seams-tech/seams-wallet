import type { SeamsWeb } from '../../SeamsWeb';
import type { NearAccountRef, WalletSessionRef } from '../../boundary/walletRefs';
import type { BoundNearSigner, BoundEvmSigner, BoundTempoSigner } from '../hooks/useWallet';
import type { TransactionReviewCapabilities } from '../../SeamsWeb/publicApi/transactionReview';
import {
  resolveEvmChainTarget,
  resolveTempoChainTarget,
} from '../../SeamsWeb/publicApi/chainTargets';
import { TransactionReviewError, validateTransactionReview } from './contract';
import {
  snapshotTransactionInput,
  snapshotTransactionOptions,
  snapshotNearAction,
  reviewedConfirmationConfig,
} from './snapshot';
import type { ReviewHostController, ReviewOwner } from './controller';

type BoundReviewEnvironment = {
  readonly seams: SeamsWeb;
  readonly walletId: string;
  readonly walletSession: WalletSessionRef;
  readonly nearAccount: NearAccountRef | null;
  readonly host: ReviewHostController | null;
  readonly owner: ReviewOwner;
};

function requireHost(env: BoundReviewEnvironment): ReviewHostController {
  env.owner.assertLive();
  if (!env.host)
    throw new TransactionReviewError(
      'review_host_unavailable',
      'Wrap this useWallet component in TransactionReviewHost inside SeamsWebProvider',
    );
  return env.host;
}

export function createReviewedBoundCalls(env: BoundReviewEnvironment) {
  return {
    nearSign: nearSign.bind(null, env),
    nearExecute: nearExecute.bind(null, env),
    evmSign: evmSign.bind(null, env),
    evmExecute: evmExecute.bind(null, env),
    tempoSign: tempoSign.bind(null, env),
    tempoExecute: tempoExecute.bind(null, env),
  };
}

async function nearSign(
  env: BoundReviewEnvironment,
  args: Parameters<BoundNearSigner['signAndSendTransaction']>[0],
): ReturnType<BoundNearSigner['signAndSendTransaction']> {
  if (!env.nearAccount)
    throw new TransactionReviewError('review_identity_changed', 'This wallet has no NEAR account');
  const { review, ...ordinary } = args;
  if (review === undefined)
    return env.seams.near.signAndSendTransaction({
      ...ordinary,
      walletSession: env.walletSession,
      nearAccount: env.nearAccount,
    });
  const host = requireHost(env);
  const { options, actions, ...data } = ordinary;
  const copied = snapshotTransactionInput({ ...data, actions: actions.map(snapshotNearAction) });
  const reviewSnapshot = validateTransactionReview(review);
  const copiedOptions = snapshotTransactionOptions(options ?? {});
  reviewedConfirmationConfig(
    { uiMode: 'modal', behavior: 'requireClick' },
    copiedOptions.confirmationConfig,
  );
  const input = {
    ...copied,
    walletSession: env.walletSession,
    nearAccount: env.nearAccount,
    options: copiedOptions,
  };
  return host.run(
    env.owner,
    env.walletId,
    reviewSnapshot,
    copiedOptions.confirmationConfig,
    dispatchNearSign.bind(null, input),
  );
}

function dispatchNearSign(
  input: Parameters<TransactionReviewCapabilities['near']['signAndSendTransaction']>[0],
  capabilities: TransactionReviewCapabilities,
): ReturnType<TransactionReviewCapabilities['near']['signAndSendTransaction']> {
  return capabilities.near.signAndSendTransaction(input);
}

async function nearExecute(
  env: BoundReviewEnvironment,
  args: Parameters<BoundNearSigner['executeAction']>[0],
): ReturnType<BoundNearSigner['executeAction']> {
  if (!env.nearAccount)
    throw new TransactionReviewError('review_identity_changed', 'This wallet has no NEAR account');
  const { review, ...ordinary } = args;
  if (review === undefined)
    return env.seams.near.executeAction({
      ...ordinary,
      walletSession: env.walletSession,
      nearAccount: env.nearAccount,
    });
  const host = requireHost(env);
  const { options, actionArgs, ...data } = ordinary;
  const actions = Array.isArray(actionArgs) ? actionArgs : [actionArgs];
  const copied = snapshotTransactionInput({ ...data, actionArgs: actions.map(snapshotNearAction) });
  const reviewSnapshot = validateTransactionReview(review);
  const copiedOptions = snapshotTransactionOptions(options ?? {});
  reviewedConfirmationConfig(
    { uiMode: 'modal', behavior: 'requireClick' },
    copiedOptions.confirmationConfig,
  );
  const input = {
    ...copied,
    walletSession: env.walletSession,
    nearAccount: env.nearAccount,
    actionArgs: Array.isArray(copied.actionArgs) ? copied.actionArgs : [copied.actionArgs],
    options: copiedOptions,
  };
  return host.run(
    env.owner,
    env.walletId,
    reviewSnapshot,
    copiedOptions.confirmationConfig,
    dispatchNearExecute.bind(null, input),
  );
}

function dispatchNearExecute(
  input: Parameters<TransactionReviewCapabilities['near']['executeAction']>[0],
  capabilities: TransactionReviewCapabilities,
): ReturnType<TransactionReviewCapabilities['near']['executeAction']> {
  return capabilities.near.executeAction(input);
}

async function evmSign(
  env: BoundReviewEnvironment,
  args: Parameters<BoundEvmSigner['signTransaction']>[0],
): ReturnType<BoundEvmSigner['signTransaction']> {
  const { review, ...ordinary } = args;
  if (review === undefined)
    return env.seams.evm.signTransaction({ ...ordinary, walletSession: env.walletSession });
  const host = requireHost(env);
  const { options, ...data } = ordinary;
  const copied = snapshotTransactionInput(data);
  const reviewSnapshot = validateTransactionReview(review);
  const copiedOptions = snapshotTransactionOptions(options ?? {});
  reviewedConfirmationConfig(
    { uiMode: 'modal', behavior: 'requireClick' },
    copiedOptions.confirmationConfig,
  );
  const input = {
    ...copied,
    walletSession: env.walletSession,
    chainTarget: resolveEvmChainTarget(env.seams.configs.network.chains, copied.chainTarget),
    options: copiedOptions,
  };
  return host.run(
    env.owner,
    env.walletId,
    reviewSnapshot,
    copiedOptions.confirmationConfig,
    dispatchEvmSign.bind(null, input),
  );
}

function dispatchEvmSign(
  input: Parameters<TransactionReviewCapabilities['evm']['signTransaction']>[0],
  capabilities: TransactionReviewCapabilities,
): ReturnType<TransactionReviewCapabilities['evm']['signTransaction']> {
  return capabilities.evm.signTransaction(input);
}

async function evmExecute(
  env: BoundReviewEnvironment,
  args: Parameters<BoundEvmSigner['executeTransaction']>[0],
): ReturnType<BoundEvmSigner['executeTransaction']> {
  const { review, ...ordinary } = args;
  if (review === undefined)
    return env.seams.evm.executeTransaction({ ...ordinary, walletSession: env.walletSession });
  const host = requireHost(env);
  const { options, postFinalizationCheck, ...data } = ordinary;
  const copied = snapshotTransactionInput(data);
  const reviewSnapshot = validateTransactionReview(review);
  const copiedOptions = snapshotTransactionOptions(options ?? {});
  reviewedConfirmationConfig(
    { uiMode: 'modal', behavior: 'requireClick' },
    copiedOptions.confirmationConfig,
  );
  const input = {
    ...copied,
    walletSession: env.walletSession,
    chainTarget: resolveEvmChainTarget(env.seams.configs.network.chains, copied.chainTarget),
    postFinalizationCheck,
    options: copiedOptions,
  };
  return host.run(
    env.owner,
    env.walletId,
    reviewSnapshot,
    copiedOptions.confirmationConfig,
    dispatchEvmExecute.bind(null, input),
  );
}

function dispatchEvmExecute(
  input: Parameters<TransactionReviewCapabilities['evm']['executeTransaction']>[0],
  capabilities: TransactionReviewCapabilities,
): ReturnType<TransactionReviewCapabilities['evm']['executeTransaction']> {
  return capabilities.evm.executeTransaction(input);
}

async function tempoSign(
  env: BoundReviewEnvironment,
  args: Parameters<BoundTempoSigner['signTransaction']>[0],
): ReturnType<BoundTempoSigner['signTransaction']> {
  const { review, ...ordinary } = args;
  if (review === undefined)
    return env.seams.tempo.signTransaction({ ...ordinary, walletSession: env.walletSession });
  const host = requireHost(env);
  const { options, ...data } = ordinary;
  const copied = snapshotTransactionInput(data);
  const reviewSnapshot = validateTransactionReview(review);
  const copiedOptions = snapshotTransactionOptions(options ?? {});
  reviewedConfirmationConfig(
    { uiMode: 'modal', behavior: 'requireClick' },
    copiedOptions.confirmationConfig,
  );
  const input = {
    ...copied,
    walletSession: env.walletSession,
    chainTarget: resolveTempoChainTarget(env.seams.configs.network.chains, copied.chainTarget),
    options: copiedOptions,
  };
  return host.run(
    env.owner,
    env.walletId,
    reviewSnapshot,
    copiedOptions.confirmationConfig,
    dispatchTempoSign.bind(null, input),
  );
}

function dispatchTempoSign(
  input: Parameters<TransactionReviewCapabilities['tempo']['signTransaction']>[0],
  capabilities: TransactionReviewCapabilities,
): ReturnType<TransactionReviewCapabilities['tempo']['signTransaction']> {
  return capabilities.tempo.signTransaction(input);
}

async function tempoExecute(
  env: BoundReviewEnvironment,
  args: Parameters<BoundTempoSigner['executeTransaction']>[0],
): ReturnType<BoundTempoSigner['executeTransaction']> {
  const { review, ...ordinary } = args;
  if (review === undefined)
    return env.seams.tempo.executeTransaction({ ...ordinary, walletSession: env.walletSession });
  const host = requireHost(env);
  const { options, postFinalizationCheck, ...data } = ordinary;
  const copied = snapshotTransactionInput(data);
  const reviewSnapshot = validateTransactionReview(review);
  const copiedOptions = snapshotTransactionOptions(options ?? {});
  reviewedConfirmationConfig(
    { uiMode: 'modal', behavior: 'requireClick' },
    copiedOptions.confirmationConfig,
  );
  const input = {
    ...copied,
    walletSession: env.walletSession,
    chainTarget: resolveTempoChainTarget(env.seams.configs.network.chains, copied.chainTarget),
    postFinalizationCheck,
    options: copiedOptions,
  };
  return host.run(
    env.owner,
    env.walletId,
    reviewSnapshot,
    copiedOptions.confirmationConfig,
    dispatchTempoExecute.bind(null, input),
  );
}

function dispatchTempoExecute(
  input: Parameters<TransactionReviewCapabilities['tempo']['executeTransaction']>[0],
  capabilities: TransactionReviewCapabilities,
): ReturnType<TransactionReviewCapabilities['tempo']['executeTransaction']> {
  return capabilities.tempo.executeTransaction(input);
}

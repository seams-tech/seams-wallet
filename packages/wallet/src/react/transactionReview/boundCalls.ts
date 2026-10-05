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
  args: Parameters<BoundEvmSigner['signAndSendTransaction']>[0],
): ReturnType<BoundEvmSigner['signAndSendTransaction']> {
  const { review, ...ordinary } = args;
  if (review === undefined)
    return env.seams.evm.signAndSendTransaction({ ...ordinary, walletSession: env.walletSession });
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
  input: Parameters<TransactionReviewCapabilities['evm']['signAndSendTransaction']>[0],
  capabilities: TransactionReviewCapabilities,
): ReturnType<TransactionReviewCapabilities['evm']['signAndSendTransaction']> {
  return capabilities.evm.signAndSendTransaction(input);
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
  args: Parameters<BoundTempoSigner['signAndSendTransaction']>[0],
): ReturnType<BoundTempoSigner['signAndSendTransaction']> {
  const { review, ...ordinary } = args;
  if (review === undefined)
    return env.seams.tempo.signAndSendTransaction({ ...ordinary, walletSession: env.walletSession });
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
  input: Parameters<TransactionReviewCapabilities['tempo']['signAndSendTransaction']>[0],
  capabilities: TransactionReviewCapabilities,
): ReturnType<TransactionReviewCapabilities['tempo']['signAndSendTransaction']> {
  return capabilities.tempo.signAndSendTransaction(input);
}

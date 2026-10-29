import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';
import type { ExternalWalletAuthentication } from '@shared/auth/externalAuth';
import type { OwnerNearOperation, OwnerNearRecovery } from '../SeamsWeb/publicApi/ownerNearOperation';
import type { TransactionInput } from '@/core/types/actions';
import type { ReviewedTransactionInput } from './transactionReview/contract';
import { createReviewedBoundCalls } from './transactionReview/boundCalls';
import type { ReviewOwner, ReviewHostController } from './transactionReview/controller';
import type { AuthenticatedLoginState } from './types';
import {
  nearAccountRefFromAccountId,
  walletSessionRefFromSession,
  type NearAccountRef,
  type WalletSessionRef,
} from '../boundary/walletRefs';
import type { SeamsWeb } from '../SeamsWeb';
import type {
  ExportKeyInput,
  KeyExportOutcome,
  NearSignerCapability,
  EvmSignerCapability,
  TempoSignerCapability,
} from '../SeamsWeb/publicApi/types';

// Distributive, so unions keep their arms paired instead of collapsing.
type WithoutNearSubject<T> = T extends unknown ? Omit<T, 'walletSession' | 'nearAccount'> : never;
type WithoutWalletSession<T> = T extends unknown ? Omit<T, 'walletSession'> : never;

/** NEAR signing bound to one wallet and account: the call names only the transaction. */
export interface BoundNearSigner {
  readonly accountId: string;
  signAndSendTransaction(
    args: ReviewedTransactionInput<
      WithoutNearSubject<Parameters<NearSignerCapability['signAndSendTransaction']>[0]>
    >,
  ): ReturnType<NearSignerCapability['signAndSendTransaction']>;
  signMessage(
    args: WithoutNearSubject<Parameters<NearSignerCapability['signMessage']>[0]>,
  ): ReturnType<NearSignerCapability['signMessage']>;
}

/** EIP-1559 signing bound to one wallet. */
export interface BoundEvmSigner {
  signTransaction(
    args: ReviewedTransactionInput<
      WithoutWalletSession<Parameters<EvmSignerCapability['signTransaction']>[0]>
    >,
  ): ReturnType<EvmSignerCapability['signTransaction']>;
  signAndSendTransaction(
    args: ReviewedTransactionInput<
      WithoutWalletSession<Parameters<EvmSignerCapability['signAndSendTransaction']>[0]>
    >,
  ): ReturnType<EvmSignerCapability['signAndSendTransaction']>;
}

/** EIP-2718 Tempo signing bound to one wallet. */
export interface BoundTempoSigner {
  signTransaction(
    args: ReviewedTransactionInput<
      WithoutWalletSession<Parameters<TempoSignerCapability['signTransaction']>[0]>
    >,
  ): ReturnType<TempoSignerCapability['signTransaction']>;
  signAndSendTransaction(
    args: ReviewedTransactionInput<
      WithoutWalletSession<Parameters<TempoSignerCapability['signAndSendTransaction']>[0]>
    >,
  ): ReturnType<TempoSignerCapability['signAndSendTransaction']>;
}

export interface SigningBoundWallet {
  readonly access: 'wallet';
  readonly walletId: string;
  /** The exact reference every bound call authorizes. */
  readonly walletSession: WalletSessionRef;
  /** `null` when this wallet has no NEAR account — EVM-only, or still provisioning. */
  readonly near: BoundNearSigner | null;
  readonly evm: BoundEvmSigner;
  readonly tempo: BoundTempoSigner;
  exportKey(input: WithoutNearSubject<ExportKeyInput>): Promise<KeyExportOutcome>;
}

export interface ReadableBoundWallet {
  readonly access: 'external';
  readonly walletId: string;
  readonly authentication: ExternalWalletAuthentication;
  readonly near: {
    readonly accountId: string;
    prepareOwnerTransaction(input: { readonly transaction: TransactionInput }): OwnerNearOperation;
    resumeOwnerTransaction(input: { readonly recovery: OwnerNearRecovery }): OwnerNearOperation;
  } | null;
}

export type BoundWallet = ReadonlyExclusiveUnion<SigningBoundWallet | ReadableBoundWallet>;

export function createBoundWallet(
  seams: SeamsWeb,
  loginState: AuthenticatedLoginState,
  host: ReviewHostController | null,
  owner: ReviewOwner,
): BoundWallet {
  if (loginState.access === 'external') {
    return {
      access: 'external',
      walletId: loginState.walletId,
      authentication: loginState.externalSettings.authentication,
      near: loginState.nearAccountId ? {
        accountId: loginState.nearAccountId,
        prepareOwnerTransaction: prepareReadableOwnerTransaction.bind(null, seams, loginState.externalSettings.authentication, loginState.nearAccountId),
        resumeOwnerTransaction: resumeReadableOwnerTransaction.bind(null, seams, loginState.externalSettings.authentication),
      } : null,
    };
  }
  const { walletId, nearAccountId } = loginState;
  const walletSession = walletSessionRefFromSession({ walletId });
  const nearAccount: NearAccountRef | null = nearAccountId
    ? nearAccountRefFromAccountId(nearAccountId)
    : null;

  const reviewed = createReviewedBoundCalls({
    seams,
    walletId,
    walletSession,
    nearAccount,
    host,
    owner,
  });

  // Bind the wallet the UI rendered, rather than re-resolving per call: a button
  // signs with the wallet the person was looking at when they clicked.
  const near: BoundNearSigner | null =
    nearAccount && nearAccountId
      ? {
          accountId: nearAccountId,
          signAndSendTransaction: reviewed.nearSign,
          signMessage: signMessage.bind(null, seams, walletSession, nearAccount),
        }
      : null;

  return {
    access: 'wallet',
    walletId,
    walletSession,
    near,
    evm: {
      signTransaction: reviewed.evmSign,
      signAndSendTransaction: reviewed.evmExecute,
    },
    tempo: {
      signTransaction: reviewed.tempoSign,
      signAndSendTransaction: reviewed.tempoExecute,
    },
    exportKey: exportKey.bind(null, seams, walletSession, nearAccount),
  };
}

function signMessage(
  seams: SeamsWeb,
  walletSession: WalletSessionRef,
  nearAccount: NearAccountRef,
  args: Parameters<BoundNearSigner['signMessage']>[0],
): ReturnType<BoundNearSigner['signMessage']> {
  return seams.near.signMessage({ ...args, walletSession, nearAccount });
}

function exportKey(
  seams: SeamsWeb,
  walletSession: WalletSessionRef,
  nearAccount: NearAccountRef | null,
  input: Parameters<SigningBoundWallet['exportKey']>[0],
): Promise<KeyExportOutcome> {
  if (input.kind === 'ed25519') {
    return seams.keys.exportKey({
      ...input,
      walletSession,
      ...(nearAccount ? { nearAccount } : {}),
    });
  }
  return seams.keys.exportKey({ ...input, walletSession });
}

function prepareReadableOwnerTransaction(seams: SeamsWeb, authentication: ExternalWalletAuthentication, nearAccountId: string, input: { readonly transaction: TransactionInput }): OwnerNearOperation {
  return seams.near.prepareOwnerTransaction({ authentication, nearAccountId, transaction: input.transaction });
}

function resumeReadableOwnerTransaction(seams: SeamsWeb, authentication: ExternalWalletAuthentication, input: { readonly recovery: OwnerNearRecovery }): OwnerNearOperation {
  return seams.near.resumeOwnerTransaction({ authentication, recovery: input.recovery });
}

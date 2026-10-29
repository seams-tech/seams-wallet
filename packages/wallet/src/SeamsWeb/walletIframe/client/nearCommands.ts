import type { WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { NearCommands } from '@/SeamsWeb/publicApi/nearCommands';
import type { TransactionDispatch } from '@/SeamsWeb/walletIframe/client/transactionReviewReservation';
import type { WalletIframeCoordinator } from '@/SeamsWeb/walletIframe/coordinator';
import { toError } from '@shared/utils/errors';
import {
  nearTransactionFailure,
  notifyNearTransactionResult,
} from '@/core/signingEngine/nearTransactionSubmission';
export function createApplicationNearCommands(
  walletIframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  beforeSigning: (walletId: WalletId) => Promise<void>,
  transactionDispatch: TransactionDispatch,
): NearCommands {
  const commands = new ApplicationNearCommands(walletIframe, beforeSigning, transactionDispatch);
  return {
    ownerOperation: commands.ownerOperation.bind(commands),
    signAndSendTransaction: commands.signAndSendTransaction.bind(commands),
    signTransaction: commands.signTransaction.bind(commands),
    sendTransaction: commands.sendTransaction.bind(commands),
    signDelegateAction: commands.signDelegateAction.bind(commands),
    signMessage: commands.signMessage.bind(commands),
  };
}
class ApplicationNearCommands {
  constructor(
    private readonly walletIframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
    private readonly beforeSigning: (walletId: WalletId) => Promise<void>,
    private readonly transactionDispatch: TransactionDispatch,
  ) {}
  async ownerOperation(...args: Parameters<NearCommands['ownerOperation']>): ReturnType<NearCommands['ownerOperation']> {
    return await (await this.walletIframe.requireRouter()).ownerNearOperation(...args);
  }

  async signAndSendTransaction(
    args: Parameters<NearCommands['signAndSendTransaction']>[0],
  ): ReturnType<NearCommands['signAndSendTransaction']> {
    const walletIframe = this.walletIframe;
    const nearAccountId = args.nearAccount.accountId;
    const transaction = {
      receiverId: args.receiverId,
      actions: args.actions,
    };
    try {
      await this.beforeSigning(args.walletSession.walletId);
      const router = await walletIframe.requireRouter();
      const result = await router.signAndSendTransaction(
        {
          walletId: args.walletSession.walletId,
          nearAccountId,
          transaction,
          options: args.options,
        },
        this.transactionDispatch,
      );
      await notifyNearTransactionResult(args.options, result);
      return result;
    } catch (error: unknown) {
      const result = nearTransactionFailure(error, 'not_submitted');
      await notifyNearTransactionResult(args.options, result);
      return result;
    }
  }
  async signTransaction(
    args: Parameters<NearCommands['signTransaction']>[0],
  ): ReturnType<NearCommands['signTransaction']> {
    const walletIframe = this.walletIframe;
    const nearAccountId = args.nearAccount.accountId;
    const { transaction, options } = args;
    try {
      await this.beforeSigning(args.walletSession.walletId);
      const router = await walletIframe.requireRouter();
      const result = await router.signTransaction({
        walletId: args.walletSession.walletId,
        nearAccountId,
        transaction: {
          receiverId: transaction.receiverId,
          actions: transaction.actions,
        },
        options: {
          signerSlot: options.signerSlot,
          onEvent: options.onEvent,
          confirmationConfig: options.confirmationConfig,
          confirmerText: options.confirmerText,
        },
      });
      await options?.afterCall?.(true, result);
      return result;
    } catch (error: unknown) {
      const e = toError(error);
      await options?.onError?.(e);
      await options?.afterCall?.(false, undefined, e);
      throw e;
    }
  }
  async sendTransaction(
    args: Parameters<NearCommands['sendTransaction']>[0],
  ): ReturnType<NearCommands['sendTransaction']> {
    const walletIframe = this.walletIframe;
    const nearAccountId = args.nearAccount.accountId;
    try {
      await this.beforeSigning(args.walletSession.walletId);
      const router = await walletIframe.requireRouter();
      const result = await router.sendTransaction({
        walletId: args.walletSession.walletId,
        nearAccountId,
        signedTransaction: args.signedTransaction,
        options: {
          onEvent: args.options?.onEvent,
          ...(args.options && 'waitUntil' in args.options
            ? { waitUntil: args.options.waitUntil }
            : {}),
        },
      });
      await notifyNearTransactionResult(args.options, result);
      return result;
    } catch (error: unknown) {
      const result = nearTransactionFailure(error, 'not_submitted');
      await notifyNearTransactionResult(args.options, result);
      return result;
    }
  }
  async signDelegateAction(
    args: Parameters<NearCommands['signDelegateAction']>[0],
  ): ReturnType<NearCommands['signDelegateAction']> {
    const walletIframe = this.walletIframe;
    const nearAccountId = args.nearAccount.accountId;
    const { delegate, options } = args;
    try {
      await this.beforeSigning(args.walletSession.walletId);
      const router = await walletIframe.requireRouter();
      const result = await router.signDelegateAction({
        walletId: args.walletSession.walletId,
        nearAccountId,
        delegate,
        options: {
          signerSlot: options.signerSlot,
          onEvent: options.onEvent,
          confirmationConfig: options.confirmationConfig,
          confirmerText: options.confirmerText,
        },
      });
      await options?.afterCall?.(true, result);
      return result;
    } catch (error: unknown) {
      const e = toError(error);
      await options?.onError?.(e);
      await options?.afterCall?.(false, undefined, e);
      throw e;
    }
  }
  async signMessage(
    args: Parameters<NearCommands['signMessage']>[0],
  ): ReturnType<NearCommands['signMessage']> {
    const walletIframe = this.walletIframe;
    const nearAccountId = args.nearAccount.accountId;
    try {
      await this.beforeSigning(args.walletSession.walletId);
      const router = await walletIframe.requireRouter();
      const result = await router.signNep413Message({
        walletId: args.walletSession.walletId,
        nearAccountId,
        message: args.params.message,
        recipient: args.params.recipient,
        callbackUrl: args.params.callbackUrl,
        state: args.params.state,
        options: {
          signerSlot: args.options.signerSlot,
          onEvent: args.options.onEvent,
          confirmerText: args.options.confirmerText,
          confirmationConfig: args.options.confirmationConfig,
        },
      });
      await args.options?.afterCall?.(true, result);
      return result;
    } catch (error: unknown) {
      const e = toError(error);
      await args.options?.onError?.(e);
      await args.options?.afterCall?.(false, undefined, e);
      throw e;
    }
  }
}

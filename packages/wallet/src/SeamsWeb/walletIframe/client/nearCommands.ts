import type { WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { NearCommands } from '@/SeamsWeb/publicApi/nearCommands';
import type { TransactionDispatch } from '@/SeamsWeb/walletIframe/client/transactionReviewReservation';
import type { WalletIframeCoordinator } from '@/SeamsWeb/walletIframe/coordinator';
import { toError } from '@shared/utils/errors';
export function createApplicationNearCommands(
  walletIframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  beforeSigning: (walletId: WalletId) => Promise<void>,
  transactionDispatch: TransactionDispatch,
): NearCommands {
  const commands = new ApplicationNearCommands(
    walletIframe,
    beforeSigning,
    transactionDispatch,
  );
  return {
    fundImplicitNearAccountForTesting: commands.fundImplicitNearAccountForTesting.bind(commands),
    executeAction: commands.executeAction.bind(commands),
    signAndSendTransaction: commands.signAndSendTransaction.bind(commands),
    signTransactionWithActions: commands.signTransactionWithActions.bind(commands),
    sendTransaction: commands.sendTransaction.bind(commands),
    signDelegateAction: commands.signDelegateAction.bind(commands),
    signNEP413Message: commands.signNEP413Message.bind(commands),
  };
}
class ApplicationNearCommands {
  constructor(
    private readonly walletIframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
    private readonly beforeSigning: (walletId: WalletId) => Promise<void>,
    private readonly transactionDispatch: TransactionDispatch,
  ) {}
  async fundImplicitNearAccountForTesting(
    args: Parameters<NearCommands['fundImplicitNearAccountForTesting']>[0],
  ): ReturnType<NearCommands['fundImplicitNearAccountForTesting']> {
    const walletIframe = this.walletIframe;
    const router = await walletIframe.requireRouter();
    return await router.fundImplicitNearAccountForTesting({
      walletId: args.walletSession.walletId,
      nearAccountId: args.nearAccount.accountId,
      nearPublicKey: args.nearPublicKey,
    });
  }
  async executeAction(
    args: Parameters<NearCommands['executeAction']>[0],
  ): ReturnType<NearCommands['executeAction']> {
    const walletIframe = this.walletIframe;
    const nearAccountId = args.nearAccount.accountId;
    try {
      await this.beforeSigning(args.walletSession.walletId);
      const router = await walletIframe.requireRouter();
      const result = await router.executeAction(
        {
          walletId: args.walletSession.walletId,
          nearAccountId,
          receiverId: args.receiverId,
          actionArgs: args.actionArgs,
          options: args.options,
        },
        this.transactionDispatch,
      );
      await args.options?.afterCall?.(true, result);
      return result;
    } catch (error: unknown) {
      const e = toError(error);
      await args.options?.onError?.(e);
      await args.options?.afterCall?.(false, undefined, e);
      throw e;
    }
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
      await args.options?.afterCall?.(true, result);
      return result;
    } catch (error: unknown) {
      const e = toError(error);
      await args.options?.onError?.(e);
      await args.options?.afterCall?.(false, undefined, e);
      throw e;
    }
  }
  async signTransactionWithActions(
    args: Parameters<NearCommands['signTransactionWithActions']>[0],
  ): ReturnType<NearCommands['signTransactionWithActions']> {
    const walletIframe = this.walletIframe;
    const nearAccountId = args.nearAccount.accountId;
    const { transaction, options } = args;
    try {
      await this.beforeSigning(args.walletSession.walletId);
      const router = await walletIframe.requireRouter();
      const result = await router.signTransactionWithActions({
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
      await args.options?.afterCall?.(true, result);
      return result;
    } catch (error: unknown) {
      const e = toError(error);
      await args.options?.onError?.(e);
      await args.options?.afterCall?.(false, undefined, e);
      throw e;
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
  async signNEP413Message(
    args: Parameters<NearCommands['signNEP413Message']>[0],
  ): ReturnType<NearCommands['signNEP413Message']> {
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

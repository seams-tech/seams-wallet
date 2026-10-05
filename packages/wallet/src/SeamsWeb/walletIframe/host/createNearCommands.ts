import {
  sendTransaction,
  signAndSendTransaction,
  signTransaction,
} from '@/SeamsWeb/operations/near/actions';
import { signDelegateAction as signDelegateActionCore } from '@/SeamsWeb/operations/near/signDelegateAction';
import { signMessage as signNEP413MessageCore } from '@/SeamsWeb/operations/near/signNEP413';
import type { NearCommands } from '@/SeamsWeb/publicApi/nearCommands';
import type { NearSigningWebContext } from '@/SeamsWeb/signingSurface/types';
import { toError } from '@shared/utils/errors';
export function createWalletHostNearCommands(getContext: () => NearSigningWebContext): NearCommands {
  const commands = new WalletHostNearCommands(getContext);
  return {
    signAndSendTransaction: commands.signAndSendTransaction.bind(commands),
    signTransaction: commands.signTransaction.bind(commands),
    sendTransaction: commands.sendTransaction.bind(commands),
    signDelegateAction: commands.signDelegateAction.bind(commands),
    signMessage: commands.signMessage.bind(commands),
  };
}
class WalletHostNearCommands {
  constructor(private readonly getContext: () => NearSigningWebContext) {}
  async signAndSendTransaction(
    args: Parameters<NearCommands['signAndSendTransaction']>[0],
  ): ReturnType<NearCommands['signAndSendTransaction']> {
    const nearAccountId = args.nearAccount.accountId;
    const transaction = {
      receiverId: args.receiverId,
      actions: args.actions,
    };
    try {
      return await signAndSendTransaction({
        context: this.getContext(),
        nearAccountId,
        walletSession: args.walletSession,
        transactionInput: transaction,
        options: args.options,
      });
    } catch (error: unknown) {
      const e = toError(error);
      await args.options?.afterCall?.(false, undefined, e);
      throw e;
    }
  }
  async signTransaction(
    args: Parameters<NearCommands['signTransaction']>[0],
  ): ReturnType<NearCommands['signTransaction']> {
    const nearAccountId = args.nearAccount.accountId;
    const { transaction, options } = args;
    try {
      return await signTransaction({
        context: this.getContext(),
        nearAccountId,
        walletSession: args.walletSession,
        transactionInput: transaction,
        options,
      });
    } catch (error: unknown) {
      const e = toError(error);
      await options?.afterCall?.(false, undefined, e);
      throw e;
    }
  }
  async sendTransaction(
    args: Parameters<NearCommands['sendTransaction']>[0],
  ): ReturnType<NearCommands['sendTransaction']> {
    const nearAccountId = args.nearAccount.accountId;
    return await sendTransaction({
      context: this.getContext(),
      nearAccountId,
      walletSession: args.walletSession,
      signedTransaction: args.signedTransaction,
      options: args.options,
    });
  }
  async signDelegateAction(
    args: Parameters<NearCommands['signDelegateAction']>[0],
  ): ReturnType<NearCommands['signDelegateAction']> {
    const nearAccountId = args.nearAccount.accountId;
    const { delegate, options } = args;
    return await signDelegateActionCore({
      context: this.getContext(),
      nearAccountId,
      walletSession: args.walletSession,
      delegate,
      options,
    });
  }
  async signMessage(
    args: Parameters<NearCommands['signMessage']>[0],
  ): ReturnType<NearCommands['signMessage']> {
    const nearAccountId = args.nearAccount.accountId;
    const result = await signNEP413MessageCore({
      context: this.getContext(),
      nearAccountId,
      walletSession: args.walletSession,
      params: args.params,
      options: args.options,
    });
    if (result?.success) {
      await args.options?.afterCall?.(true, result);
    } else {
      const signingError = toError(result?.error || 'NEP-413 signing failed');
      await args.options?.afterCall?.(false, undefined, signingError);
    }
    return result;
  }
}

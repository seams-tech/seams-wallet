import type { WalletHostRuntime } from './WalletHostRuntime';
import type { ExecuteOwnerNearOperation } from '@/SeamsWeb/publicApi/ownerNearOperation';
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
import { nearTransactionFailure } from '@/core/signingEngine/nearTransactionSubmission';
export function createWalletHostNearCommands(
  getContext: () => NearSigningWebContext,
  runOwnerOperation: WalletHostRuntime['runOwnerNearOperation'],
): NearCommands {
  const commands = new WalletHostNearCommands(getContext);
  return {
    ownerOperation: executeOwnerOperation.bind(null, runOwnerOperation),
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
    try {
      if (args.signer.kind === 'near_ml_dsa_65') {
        const context = this.getContext();
        const signed = await context.signingEngine.signMlDsaNearTransaction({
          walletSession: args.walletSession,
          nearAccount: args.nearAccount,
          signer: args.signer,
          transaction: { receiverId: args.receiverId, actions: args.actions },
          options: {
            mlDsaSigningSession: args.options.mlDsaSigningSession,
            onEvent: args.options.onEvent,
            confirmationConfig: args.options.confirmationConfig,
            confirmerText: args.options.confirmerText,
          },
        });
        return await sendTransaction({
          context,
          nearAccountId: args.nearAccount.accountId,
          walletSession: args.walletSession,
          signedTransaction: signed.signedTransaction,
          options: args.options,
        });
      }
      const nearAccountId = args.nearAccount.accountId;
      const transaction = {
        receiverId: args.receiverId,
        actions: args.actions,
      };
      return await signAndSendTransaction({
        context: this.getContext(),
        nearAccountId,
        walletSession: args.walletSession,
        transactionInput: transaction,
        options: args.options,
      });
    } catch (error: unknown) {
      return nearTransactionFailure(error, 'not_submitted');
    }
  }
  async signTransaction(
    args: Parameters<NearCommands['signTransaction']>[0],
  ): ReturnType<NearCommands['signTransaction']> {
    try {
      if (args.signer.kind === 'near_ml_dsa_65') {
        return await this.getContext().signingEngine.signMlDsaNearTransaction({
          walletSession: args.walletSession,
          nearAccount: args.nearAccount,
          signer: args.signer,
          transaction: args.transaction,
          options: args.options,
        });
      }
      const nearAccountId = args.nearAccount.accountId;
      const { transaction, options } = args;
      return await signTransaction({
        context: this.getContext(),
        nearAccountId,
        walletSession: args.walletSession,
        transactionInput: transaction,
        options,
      });
    } catch (error: unknown) {
      const e = toError(error);
      await args.options.afterCall?.(false, undefined, e);
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

async function executeOwnerOperation(run: WalletHostRuntime['runOwnerNearOperation'], ...args: Parameters<ExecuteOwnerNearOperation>): ReturnType<ExecuteOwnerNearOperation> {
  const [command, execution] = args;
  return await run(command, execution.signal.throwIfAborted.bind(execution.signal), ignoreOwnerSigningEvent, execution.onSubmission);
}

function ignoreOwnerSigningEvent(_event: import('@/core/types/sdkSentEvents').SigningFlowEvent): void {}

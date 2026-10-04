import type { WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { toWalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { buildEvmWalletRegistrationArgs } from '@/SeamsWeb/operations/evm';
import { toSerializableTempoError } from '@/SeamsWeb/operations/tempo';
import type { EvmFamilyCommands } from '@/SeamsWeb/publicApi/evmFamilyCommands';
import type { TransactionDispatch } from '@/SeamsWeb/walletIframe/client/transactionReviewReservation';
import type { WalletIframeCoordinator } from '@/SeamsWeb/walletIframe/coordinator';
import { toError } from '@shared/utils/errors';
export function createApplicationEvmFamilyCommands(
  walletIframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  beforeSigning: (walletId: WalletId) => Promise<void>,
  transactionDispatch: TransactionDispatch,
): EvmFamilyCommands {
  const commands = new ApplicationEvmFamilyCommands(
    walletIframe,
    beforeSigning,
    transactionDispatch,
  );
  return {
    signEvmFamily: commands.signEvmFamily.bind(commands),
    reportBroadcastAccepted: commands.reportBroadcastAccepted.bind(commands),
    reportBroadcastRejected: commands.reportBroadcastRejected.bind(commands),
    reportFinalized: commands.reportFinalized.bind(commands),
    reportDroppedOrReplaced: commands.reportDroppedOrReplaced.bind(commands),
    reconcileNonceLane: commands.reconcileNonceLane.bind(commands),
    bootstrapEcdsaSession: commands.bootstrapEcdsaSession.bind(commands),
    onBroadcastStarted: commands.onBroadcastStarted.bind(commands),
    registerEvmWallet: commands.registerEvmWallet.bind(commands),
  };
}
class ApplicationEvmFamilyCommands {
  constructor(
    private readonly walletIframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
    private readonly beforeSigning: (walletId: WalletId) => Promise<void>,
    private readonly transactionDispatch: TransactionDispatch,
  ) {}
  async signEvmFamily(
    args: Parameters<EvmFamilyCommands['signEvmFamily']>[0],
  ): ReturnType<EvmFamilyCommands['signEvmFamily']> {
    const { chainTarget, walletSession } = args;
    const walletIframe = this.walletIframe;
    const walletId = toWalletId(walletSession.walletId);
    try {
      await this.beforeSigning(args.walletSession.walletId);
      const router = await walletIframe.requireRouter(walletId);
      const result = await router.signTempo(
        {
          walletSession,
          request: args.request,
          chainTarget,
          options: {
            confirmationConfig: args.options?.confirmationConfig,
            onEvent: args.options?.onEvent,
          },
        },
        this.transactionDispatch,
      );
      return result;
    } catch (error: unknown) {
      throw toError(error);
    }
  }
  async reportBroadcastAccepted(
    args: Parameters<EvmFamilyCommands['reportBroadcastAccepted']>[0],
  ): ReturnType<EvmFamilyCommands['reportBroadcastAccepted']> {
    const walletIframe = this.walletIframe;
    const walletId = toWalletId(args.walletSession.walletId);
    try {
      const router = await walletIframe.requireRouter(walletId);
      await router.reportTempoBroadcastAccepted({
        walletSession: args.walletSession,
        signedResult: args.signedResult,
        txHash: args.txHash,
        options: {
          onEvent: args.options?.onEvent,
        },
      });
    } catch (error: unknown) {
      throw toError(error);
    }
  }
  async reportBroadcastRejected(
    args: Parameters<EvmFamilyCommands['reportBroadcastRejected']>[0],
  ): ReturnType<EvmFamilyCommands['reportBroadcastRejected']> {
    const walletIframe = this.walletIframe;
    const walletId = toWalletId(args.walletSession.walletId);
    try {
      const router = await walletIframe.requireRouter(walletId);
      await router.reportTempoBroadcastRejected({
        walletSession: args.walletSession,
        signedResult: args.signedResult,
        ...(args.error != null ? { error: toSerializableTempoError(args.error) } : {}),
        options: {
          onEvent: args.options?.onEvent,
        },
      });
    } catch (error: unknown) {
      throw toError(error);
    }
  }
  async reportFinalized(
    args: Parameters<EvmFamilyCommands['reportFinalized']>[0],
  ): ReturnType<EvmFamilyCommands['reportFinalized']> {
    const walletIframe = this.walletIframe;
    const walletId = toWalletId(args.walletSession.walletId);
    try {
      const router = await walletIframe.requireRouter(walletId);
      await router.reportTempoFinalized({
        walletSession: args.walletSession,
        signedResult: args.signedResult,
        ...(args.txHash ? { txHash: args.txHash } : {}),
        ...(args.receiptStatus ? { receiptStatus: args.receiptStatus } : {}),
        options: {
          onEvent: args.options?.onEvent,
        },
      });
    } catch (error: unknown) {
      throw toError(error);
    }
  }
  async reportDroppedOrReplaced(
    args: Parameters<EvmFamilyCommands['reportDroppedOrReplaced']>[0],
  ): ReturnType<EvmFamilyCommands['reportDroppedOrReplaced']> {
    const walletIframe = this.walletIframe;
    const walletId = toWalletId(args.walletSession.walletId);
    try {
      const router = await walletIframe.requireRouter(walletId);
      await router.reportTempoDroppedOrReplaced({
        walletSession: args.walletSession,
        signedResult: args.signedResult,
        reason: args.reason,
        ...(args.txHash ? { txHash: args.txHash } : {}),
        options: {
          onEvent: args.options?.onEvent,
        },
      });
    } catch (error: unknown) {
      throw toError(error);
    }
  }
  async reconcileNonceLane(
    args: Parameters<EvmFamilyCommands['reconcileNonceLane']>[0],
  ): ReturnType<EvmFamilyCommands['reconcileNonceLane']> {
    const walletIframe = this.walletIframe;
    const walletId = toWalletId(args.walletSession.walletId);
    try {
      const router = await walletIframe.requireRouter(walletId);
      return await router.reconcileTempoNonceLane({
        walletSession: args.walletSession,
        signedResult: args.signedResult,
        options: {
          onEvent: args.options?.onEvent,
        },
      });
    } catch (error: unknown) {
      throw toError(error);
    }
  }
  async bootstrapEcdsaSession(
    args: Parameters<EvmFamilyCommands['bootstrapEcdsaSession']>[0],
  ): ReturnType<EvmFamilyCommands['bootstrapEcdsaSession']> {
    const walletIframe = this.walletIframe;
    const bootstrapArgs = args;
    const router = await walletIframe.requireRouter(toWalletId(args.walletSession.walletId));
    return await router.bootstrapEcdsaSession(bootstrapArgs);
  }
  onBroadcastStarted(args: Parameters<EvmFamilyCommands['onBroadcastStarted']>[0]): void {
    void this.notifyBroadcastStarted(args);
  }
  private async notifyBroadcastStarted(
    args: Parameters<EvmFamilyCommands['onBroadcastStarted']>[0],
  ): Promise<void> {
    try {
      const router = await this.walletIframe.requireRouter(toWalletId(args.walletSession.walletId));
      router.notifyTransactionBroadcastStarted(args.signedResult);
    } catch {}
  }
  async registerEvmWallet(
    args: Parameters<EvmFamilyCommands['registerEvmWallet']>[0],
  ): ReturnType<EvmFamilyCommands['registerEvmWallet']> {
    const walletIframe = this.walletIframe;
    const registerWalletArgs = buildEvmWalletRegistrationArgs(args);
    try {
      const router = await walletIframe.requireRouter();
      const result = await router.registerWallet(registerWalletArgs);
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

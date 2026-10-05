import { toWalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { EcdsaBootstrapRequest } from '@/core/signingEngine/session/passkey/ecdsaBootstrap';
import type { EvmFamilyCommands } from '@/SeamsWeb/publicApi/evmFamilyCommands';
import type { TempoSigningSurface } from '@/SeamsWeb/signingSurface/types';
type EvmFamilyHostContext = {
  signingEngine: TempoSigningSurface;
};
export function createWalletHostEvmFamilyCommands(
  getContext: () => EvmFamilyHostContext,
): EvmFamilyCommands {
  const commands = new WalletHostEvmFamilyCommands(getContext);
  return {
    signEvmFamily: commands.signEvmFamily.bind(commands),
    reportBroadcastAccepted: commands.reportBroadcastAccepted.bind(commands),
    reportBroadcastRejected: commands.reportBroadcastRejected.bind(commands),
    reportFinalized: commands.reportFinalized.bind(commands),
    reportDroppedOrReplaced: commands.reportDroppedOrReplaced.bind(commands),
    reconcileNonceLane: commands.reconcileNonceLane.bind(commands),
    bootstrapEcdsaSession: commands.bootstrapEcdsaSession.bind(commands),
    onBroadcastStarted: commands.onBroadcastStarted.bind(commands),
  };
}
class WalletHostEvmFamilyCommands {
  constructor(private readonly getContext: () => EvmFamilyHostContext) {}
  async signEvmFamily(
    args: Parameters<EvmFamilyCommands['signEvmFamily']>[0],
  ): ReturnType<EvmFamilyCommands['signEvmFamily']> {
    const { chainTarget, walletSession } = args;
    const result = await this.getContext().signingEngine.signEvmFamily({
      walletSession,
      request: args.request,
      chainTarget,
      confirmationConfigOverride: args.options?.confirmationConfig,
      shouldAbort: args.options?.shouldAbort,
      onEvent: args.options?.onEvent,
    });
    return result;
  }
  async reportBroadcastAccepted(
    args: Parameters<EvmFamilyCommands['reportBroadcastAccepted']>[0],
  ): ReturnType<EvmFamilyCommands['reportBroadcastAccepted']> {
    const walletId = toWalletId(args.walletSession.walletId);
    await this.getContext().signingEngine.reportTempoBroadcastAccepted({
      walletId,
      signedResult: args.signedResult,
      txHash: args.txHash,
      onEvent: args.options?.onEvent,
    });
    return;
  }
  async reportBroadcastRejected(
    args: Parameters<EvmFamilyCommands['reportBroadcastRejected']>[0],
  ): ReturnType<EvmFamilyCommands['reportBroadcastRejected']> {
    const walletId = toWalletId(args.walletSession.walletId);
    await this.getContext().signingEngine.reportTempoBroadcastRejected({
      walletId,
      signedResult: args.signedResult,
      ...(args.error !== undefined ? { error: args.error } : {}),
      onEvent: args.options?.onEvent,
    });
    return;
  }
  async reportFinalized(
    args: Parameters<EvmFamilyCommands['reportFinalized']>[0],
  ): ReturnType<EvmFamilyCommands['reportFinalized']> {
    const walletId = toWalletId(args.walletSession.walletId);
    await this.getContext().signingEngine.reportTempoFinalized({
      walletId,
      signedResult: args.signedResult,
      ...(args.txHash ? { txHash: args.txHash } : {}),
      ...(args.receiptStatus ? { receiptStatus: args.receiptStatus } : {}),
      onEvent: args.options?.onEvent,
    });
    return;
  }
  async reportDroppedOrReplaced(
    args: Parameters<EvmFamilyCommands['reportDroppedOrReplaced']>[0],
  ): ReturnType<EvmFamilyCommands['reportDroppedOrReplaced']> {
    const walletId = toWalletId(args.walletSession.walletId);
    await this.getContext().signingEngine.reportTempoDroppedOrReplaced({
      walletId,
      signedResult: args.signedResult,
      reason: args.reason,
      ...(args.txHash ? { txHash: args.txHash } : {}),
      onEvent: args.options?.onEvent,
    });
    return;
  }
  async reconcileNonceLane(
    args: Parameters<EvmFamilyCommands['reconcileNonceLane']>[0],
  ): ReturnType<EvmFamilyCommands['reconcileNonceLane']> {
    const walletId = toWalletId(args.walletSession.walletId);
    return await this.getContext().signingEngine.reconcileTempoNonceLane({
      walletId,
      signedResult: args.signedResult,
      onEvent: args.options?.onEvent,
    });
  }
  async bootstrapEcdsaSession(
    args: Parameters<EvmFamilyCommands['bootstrapEcdsaSession']>[0],
  ): ReturnType<EvmFamilyCommands['bootstrapEcdsaSession']> {
    const bootstrapArgs = args;
    return await this.getContext().signingEngine.bootstrapEcdsaSession(
      toLocalTempoBootstrapRequest(bootstrapArgs),
    );
  }
  onBroadcastStarted(_args: Parameters<EvmFamilyCommands['onBroadcastStarted']>[0]): void {}

}
function toLocalTempoBootstrapRequest(
  args: Parameters<EvmFamilyCommands['bootstrapEcdsaSession']>[0],
): EcdsaBootstrapRequest {
  return {
    kind: 'reuse_warm_ecdsa_bootstrap',
    walletId: toWalletId(args.walletSession.walletId),
    chainTarget: args.chainTarget,
    source: args.source,
    relayerUrl: args.relayerUrl,
    runtimeScopeBootstrap: args.runtimeScopeBootstrap,
    ttlMs: args.ttlMs,
    remainingUses: args.remainingUses,
  };
}

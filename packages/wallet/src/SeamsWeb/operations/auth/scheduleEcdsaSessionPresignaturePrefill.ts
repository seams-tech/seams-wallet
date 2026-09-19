import type { EcdsaLoginSessionSurface } from '@/SeamsWeb/signingSurface/types';
import type {
  ThresholdEcdsaChainTarget,
  WalletId,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { emitSigningSessionFlowTrace } from '@/core/signingEngine/session/operationState/trace';
import type { WalletSessionStatusReadScope } from '@/core/rpcClients/relayer/walletSessionAuthorizationStatus';

export async function scheduleEcdsaSessionPresignaturePrefill(args: {
  signingEngine: EcdsaLoginSessionSurface;
  walletId: WalletId;
  chainTarget: ThresholdEcdsaChainTarget;
  trigger: 'registration' | 'unlock';
  statusReads: WalletSessionStatusReadScope;
}): Promise<void> {
  const startedAt = performance.now();
  try {
    const result = await args.signingEngine.scheduleRouterAbEcdsaDerivationLoginPresignaturePrefill(
      {
        walletId: args.walletId,
        chainTarget: args.chainTarget,
      },
      args.statusReads,
    );
    emitSigningSessionFlowTrace('evm-family', {
      event: 'ecdsa_session_prefill',
      trigger: args.trigger,
      status: result.status,
      reason: result.reason,
      scheduleReason: 'schedule' in result ? result.schedule.reason : null,
      walletSessionId: result.walletSessionId,
      durationMs: performance.now() - startedAt,
    });
  } catch {
    emitSigningSessionFlowTrace('evm-family', {
      event: 'ecdsa_session_prefill',
      trigger: args.trigger,
      status: 'failed',
      reason: 'unexpected_error',
      durationMs: performance.now() - startedAt,
    });
  }
}

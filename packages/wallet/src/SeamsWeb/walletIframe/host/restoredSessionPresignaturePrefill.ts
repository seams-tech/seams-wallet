import type { WalletIframeExactSessionState } from '../shared/exactSessionState';
import {
  walletSessionRefFromSession,
  type ThresholdEcdsaChainTarget,
  type WalletSessionRef,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { RouterAbEcdsaDerivationLoginPresignaturePrefillResult } from '@/core/signingEngine/session/warmCapabilities/ecdsaLoginPrefill';

export type RestoredSessionPresignaturePrefill = (args: {
  walletSession: WalletSessionRef;
  chainTarget: ThresholdEcdsaChainTarget;
}) => Promise<RouterAbEcdsaDerivationLoginPresignaturePrefillResult>;

export async function scheduleRestoredSessionPresignaturePrefills(args: {
  state: WalletIframeExactSessionState;
  chainTargets: readonly ThresholdEcdsaChainTarget[];
  prefill: RestoredSessionPresignaturePrefill;
}): Promise<void> {
  switch (args.state.kind) {
    case 'active_session':
      break;
    case 'wallet_unlocked_without_signing_session':
      if (args.state.reason !== 'exhausted') return;
      break;
    case 'wallet_locked':
    case 'wallet_authenticated_identity_unresolvable':
    case 'expired_session':
      return;
    default:
      args.state satisfies never;
      return;
  }
  const walletSession = walletSessionRefFromSession({ walletId: args.state.walletId });
  const prefills: Promise<RouterAbEcdsaDerivationLoginPresignaturePrefillResult>[] = [];
  for (const chainTarget of args.chainTargets) {
    prefills.push(args.prefill({ walletSession, chainTarget }));
  }
  await Promise.all(prefills);
}

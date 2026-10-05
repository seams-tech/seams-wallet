import type { LoginHooksOptions } from '@/core/types/sdkSentEvents';
import type { SeamsConfigsReadonly } from '@/core/types/seams';
import {
  DEFAULT_UNLOCK_REMAINING_USES,
  resolveWalletUnlockSessionUsesFromRequestedUses,
} from '@/core/signingEngine/threshold/sessionPolicy';

export type UnlockSessionPolicy =
  | { readonly kind: 'disabled'; readonly ttlMs: 0; readonly unlockRemainingUses: null }
  | { readonly kind: 'enabled'; readonly ttlMs: number; readonly unlockRemainingUses: number };

export function resolveUnlockSessionPolicy(args: {
  readonly defaults: SeamsConfigsReadonly['signing']['sessionDefaults'];
  readonly override: LoginHooksOptions['signingSession'];
}): UnlockSessionPolicy {
  const ttlMsRaw = args.override?.ttlMs ?? args.defaults.ttlMs;
  const ttlMs =
    typeof ttlMsRaw === 'number' ? Math.floor(ttlMsRaw) : Math.floor(Number(ttlMsRaw) || 0);
  const unlockRemainingUses = resolveWalletUnlockSessionUsesFromRequestedUses({
    requestedRemainingUses:
      args.override?.remainingUses ?? args.defaults.remainingUses ?? DEFAULT_UNLOCK_REMAINING_USES,
  });
  if (!(ttlMs > 0) || unlockRemainingUses === null) {
    return { kind: 'disabled', ttlMs: 0, unlockRemainingUses: null };
  }
  return { kind: 'enabled', ttlMs, unlockRemainingUses };
}

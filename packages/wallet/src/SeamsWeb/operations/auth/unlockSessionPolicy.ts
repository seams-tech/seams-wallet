import type { LoginHooksOptions } from '@/core/types/sdkSentEvents';
import type { SeamsConfigsReadonly } from '@/core/types/seams';
import type { WalletSessionBudget } from '@shared/threshold/walletSessionBudget';
import { resolveRequestedWalletSessionBudget } from '@/core/signingEngine/threshold/sessionPolicy';

/**
 * The Wallet Session budget that one unlock asks for. The server grants at most
 * the maximum of the project environment, so the granted budget can be lower.
 * When the policy is disabled, the unlock asks for no budget and warms no signer.
 */
export type UnlockSessionPolicy =
  | { readonly kind: 'disabled'; readonly budget: null }
  | { readonly kind: 'enabled'; readonly budget: WalletSessionBudget };

export function resolveUnlockSessionPolicy(args: {
  readonly defaults: SeamsConfigsReadonly['signing']['sessionDefaults'];
  readonly override: LoginHooksOptions['signingSession'];
}): UnlockSessionPolicy {
  const budget = resolveRequestedWalletSessionBudget({
    defaults: args.defaults,
    override: args.override,
  });
  return budget ? { kind: 'enabled', budget } : { kind: 'disabled', budget: null };
}

/** The app's budget from its config alone, for an unlock that has no per-login override. */
export function resolveConfiguredWalletSessionBudget(
  configs: Pick<SeamsConfigsReadonly, 'signing'>,
): WalletSessionBudget | null {
  return resolveUnlockSessionPolicy({
    defaults: configs.signing.sessionDefaults,
    override: undefined,
  }).budget;
}

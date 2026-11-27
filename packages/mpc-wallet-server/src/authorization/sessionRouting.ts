import type { WalletSessionHome } from '@shared/device-linking/contracts';
import type { WalletId } from '@shared/utils/domainIds';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import type { ReadonlyExclusiveUnion } from '@shared/utils/variant';

export type WalletSessionLocatorPublication = ReadonlyExclusiveUnion<
  | {
      readonly kind: 'credential' | 'exchange';
      readonly digest: DigestB64u;
      readonly walletId: WalletId;
      readonly expiresAtMs: number;
    }
  | {
      readonly kind: 'exchanged_credential';
      readonly digest: DigestB64u;
      readonly exchangeDigest: DigestB64u;
    }
>;

/** Publishes digest-to-wallet metadata; home-local storage authorizes its use. */
export interface WalletSessionRoutingPublisher {
  home(): WalletSessionHome;
  publish(input: WalletSessionLocatorPublication): Promise<void>;
}

/** Preserve an authenticated host's billing refusal at the HTTP boundary. */
export function isBillingCreditFailure(
  error: unknown,
): error is Error & { readonly code: 'billing_credit_exhausted' } {
  return error instanceof Error && 'code' in error && error.code === 'billing_credit_exhausted';
}

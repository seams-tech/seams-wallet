import type { WalletId } from '@shared/utils/domainIds';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';

export type WalletSessionLocatorPublication =
  | {
      readonly kind: 'credential' | 'exchange';
      readonly digest: DigestB64u;
      readonly walletId: WalletId;
      readonly expiresAtMs: number;
      readonly exchangeDigest?: never;
    }
  | {
      readonly kind: 'exchanged_credential';
      readonly digest: DigestB64u;
      readonly exchangeDigest: DigestB64u;
      readonly walletId?: never;
      readonly expiresAtMs?: never;
    };

/** Publishes digest-to-wallet metadata; home-local storage authorizes its use. */
export interface WalletSessionRoutingPublisher {
  publish(input: WalletSessionLocatorPublication): Promise<void>;
}

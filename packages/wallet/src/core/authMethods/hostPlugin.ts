import type { RegistrationWebContext } from '@/SeamsWeb/signingSurface/types';
import type { ParentToChildEnvelope } from '@/SeamsWeb/walletIframe/shared/messages';
import type { ConfiguredWalletHost } from '@/SeamsWeb/walletIframe/shared/configuration';
import type { WalletAuthMethodId, WalletId } from '@shared/utils/domainIds';

export type AuthMethodActivationResult = Readonly<{
  walletId: WalletId;
  walletAuthMethodId: WalletAuthMethodId;
}>;

export interface AuthMethodReviewApproval {
  readonly messages: Readonly<{
    prompt: string;
    starting: string;
    listening: string;
    approved: string;
  }>;
  approve(signal: AbortSignal, onListening: () => void): Promise<void>;
  consume(): void;
}

export type AuthMethodReviewPolicy =
  | { readonly kind: 'disabled'; readonly approval?: never }
  | { readonly kind: 'required'; readonly approval: AuthMethodReviewApproval };

/** Implementations run in the trusted Wallet host, never in the embedding app. */
export interface WalletAuthMethodHostPlugin {
  activate(input: {
    readonly context: RegistrationWebContext;
    readonly walletId: WalletId;
  }): Promise<AuthMethodActivationResult>;
  review(
    request: ParentToChildEnvelope,
    configuration: ConfiguredWalletHost,
  ): Promise<AuthMethodReviewPolicy>;
}

import type { UiConfirmSurfaceMeasurementBinding } from '@/core/signingEngine/uiConfirm/uiConfirm.types';
import type { RegistrationWebContext } from '@/SeamsWeb/signingSurface/types';
import type { ParentToChildEnvelope } from '@/SeamsWeb/walletIframe/shared/messages';
import type { ConfiguredWalletHost } from '@/SeamsWeb/walletIframe/shared/configuration';
import type { WalletAuthMethodId, WalletId } from '@shared/utils/domainIds';
import type {
  ActiveWalletSessionV1,
  WalletSessionOperationCredentialV1,
} from '@shared/device-linking/contracts';
import type { ActiveMethodBoundWalletSeedEnvelope } from '@shared/passkey-custody/custodyEnvelope';
import type { LoginAndCreateSessionResult } from '@/core/types/seams';
import type { ParsedYaoRecoveryCapabilityV1 } from '@/core/signingEngine/session/passkey/ed25519YaoRecoveryCapability';

export type AuthMethodNearInstallation =
  | { readonly kind: 'unavailable' }
  | {
      readonly kind: 'ready';
      readonly capability: ParsedYaoRecoveryCapabilityV1;
      readonly remainingUses: number;
    };

export type AuthMethodUnlockSuccess = Extract<LoginAndCreateSessionResult, { success: true }>;

/** Core owns installation and returns only after the signer is ready. The plugin owns and wipes the factor buffer. */
export type AuthMethodSessionInstaller = (input: {
  readonly walletSession: ActiveWalletSessionV1;
  readonly operationCredential: WalletSessionOperationCredentialV1;
  readonly custodyEnvelope: ActiveMethodBoundWalletSeedEnvelope;
  readonly factorSecret32: Uint8Array;
  readonly signal: AbortSignal;
  readonly near: AuthMethodNearInstallation;
}) => Promise<AuthMethodUnlockSuccess>;

/** How a mounted capture ended: `succeeded` means it already showed the unlock success itself. */
export type AuthMethodCaptureSettlement = 'succeeded' | 'closed';

export type AuthMethodCaptureMount = (
  element: HTMLElement,
) => (settlement: AuthMethodCaptureSettlement) => void;

/** A person who closes the activation surface has made a choice; it is not an error. */
export type AuthMethodActivationResult =
  | Readonly<{
      kind: 'activated';
      walletId: WalletId;
      walletAuthMethodId: WalletAuthMethodId;
    }>
  | Readonly<{ kind: 'cancelled'; walletId?: never; walletAuthMethodId?: never }>;

export type AuthMethodApprovalResult =
  | { readonly kind: 'approved'; readonly message?: never }
  | { readonly kind: 'retry'; readonly message: string };

export interface AuthMethodReviewApproval {
  readonly messages: Readonly<{
    prompt: string;
    approved: string;
    confirm?: string;
  }>;
  readonly surface: HTMLElement;
  approve(signal: AbortSignal): Promise<AuthMethodApprovalResult>;
  consume(): void;
}

export type AuthMethodReviewPolicy =
  | { readonly kind: 'disabled'; readonly approval?: never }
  | { readonly kind: 'required'; readonly approval: AuthMethodReviewApproval };

/** Implementations run in the trusted Wallet host, never in the embedding app. */
export interface WalletAuthMethodHostPlugin {
  unlock(input: {
    readonly relayerUrl: string;
    readonly walletId: WalletId;
    readonly walletAuthMethodId: WalletAuthMethodId;
    readonly surfaceMeasurementBinding: UiConfirmSurfaceMeasurementBinding;
    readonly mountCapture?: AuthMethodCaptureMount;
    readonly prepareSession: (signal: AbortSignal) => Promise<AuthMethodSessionInstaller>;
    readonly assertActive: () => void;
  }): Promise<AuthMethodUnlockSuccess>;
  activate(input: {
    readonly context: RegistrationWebContext;
    readonly walletId: WalletId;
  }): Promise<AuthMethodActivationResult>;
  review(
    request: ParentToChildEnvelope,
    configuration: ConfiguredWalletHost,
  ): Promise<AuthMethodReviewPolicy>;
}

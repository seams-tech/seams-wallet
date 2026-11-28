export const VOICE_ID_HOST_API_VERSION = 12;

import type {
  VoiceIdActivationPreparation,
  VoiceIdOperationPreparation,
  VoiceIdUnlockPreparation,
} from './voiceId/boundary';
import type { VoiceIdOperationProof } from './voiceId/operationProof';
import type { UiConfirmSurfaceMeasurementBinding } from '@/core/signingEngine/uiConfirm/uiConfirm.types';
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

/** Core returns only after the signer is ready and clears the captured factor when installation settles. */
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

export type WalletAuthMethodUnlockPurpose = 'unlock' | 'step_up';

/** One accepted enrollment sample: 16 kHz mono samples and the sentence that the owner read. */
export type AuthMethodEnrollmentRecording = Readonly<{ samples: Float32Array; sentence: string }>;

/** Implementations run in the trusted Wallet host, never in the embedding app. */
export interface WalletAuthMethodHostPlugin {
  unlock(input: {
    readonly walletId: WalletId;
    readonly walletAuthMethodId: WalletAuthMethodId;
    /** A step-up re-authenticates inside an operation, so it shows no unlock success. */
    readonly purpose: WalletAuthMethodUnlockPurpose;
    readonly surfaceMeasurementBinding: UiConfirmSurfaceMeasurementBinding;
    readonly mountCapture?: AuthMethodCaptureMount;
    readonly prepareUnlock: (signal: AbortSignal) => Promise<VoiceIdUnlockPreparation>;
  }): Promise<AuthMethodUnlockSuccess>;
  activate(input: {
    readonly surfaceMeasurementBinding: UiConfirmSurfaceMeasurementBinding;
    readonly prepareActivation: () => Promise<VoiceIdActivationPreparation>;
    readonly walletId: WalletId;
    /**
     * Receives the accepted samples of a new enrollment after it is saved, so Speak-to-Sign can
     * enroll the same voice without a second set of recordings. The receiver owns the samples and
     * clears them. An activation that checks an existing enrollment calls nothing.
     */
    readonly keepRecordings?: (recordings: readonly AuthMethodEnrollmentRecording[]) => void;
  }): Promise<AuthMethodActivationResult>;
  /** A fresh voice check for one operation, such as key export; it never unlocks. */
  confirmOperation(input: {
    readonly walletId: WalletId;
    readonly walletAuthMethodId: WalletAuthMethodId;
    readonly surfaceMeasurementBinding: UiConfirmSurfaceMeasurementBinding;
    readonly prepareOperation: (signal: AbortSignal) => Promise<VoiceIdOperationPreparation>;
  }): Promise<VoiceIdOperationProof>;
}

export const VOICE_ID_HOST_API_VERSION = 10;

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

/** One clip of a shown sentence: 16 kHz mono samples that passed the quality gate. */
export type AuthMethodPhraseRecording =
  | Readonly<{
      kind: 'recorded';
      samples: Float32Array;
      /**
       * `performance.now()` of the last voiced frame: the owner stopped speaking then, before the
       * pause that ends the recording.
       */
      endOfSpeechAt: number;
    }>
  | Readonly<{ kind: 'cancelled' }>;

export type AuthMethodPhraseRequest = Readonly<{
  sentence: string;
  signal: AbortSignal;
  surfaceMeasurementBinding: UiConfirmSurfaceMeasurementBinding;
}>;

/** One segment of the line that shows a check: waiting, working, passed, failed or held. */
export type PhraseSegmentState = 'idle' | 'run' | 'done' | 'fail' | 'wait' | 'skip';

/** Text in which some words are marked, such as words that a verifier heard differently. */
export type PhraseText = string | readonly (string | Readonly<{ mark: string }>)[];

/**
 * A check after the recording: the sentence stays and dims, the action row goes, and the line
 * becomes segments. Segments that change from `run` to `done` fill one after another.
 */
export type PhraseCheckView = Readonly<{
  kind: 'check';
  label: string;
  caption: string;
  /** The second line. Several lines change every 1.3 s and stay on the last one. */
  details: readonly string[];
  segments: readonly PhraseSegmentState[];
}>;

/** A result or a question: a headline takes the sentence's place, with one action. */
export type PhraseResultView = Readonly<{
  kind: 'result';
  label: string;
  headline: string;
  caption: PhraseText;
  detail: string;
  /** A link after the detail, such as the transaction in a block explorer. */
  link?: Readonly<{ text: string; href: string }>;
  /** `busy` shows the action dimmed while something outside the surface finishes. */
  action: Readonly<{ label: string; icon?: 'passkey'; busy?: boolean }>;
  /** `seal`: the line closes into the success seal. */
  line: 'seal' | readonly PhraseSegmentState[];
}>;

export type PhraseView = PhraseCheckView | PhraseResultView;

/** `replaced`: another view or a recording took the surface first. */
export type PhraseChoice = 'action' | 'closed' | 'replaced';

/**
 * The phrase surface stays open after a recording, so the caller can show its check and the
 * result in the same card. The caller closes it.
 */
export interface AuthMethodPhraseSurface {
  /** Shows the sentence with Record and records one clip. A later call records again. */
  record(): Promise<AuthMethodPhraseRecording>;
  /** A check view settles only when it is replaced; a result settles on its action or close. */
  show(view: PhraseView): Promise<PhraseChoice>;
  close(): void;
}

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
  }): Promise<AuthMethodActivationResult>;
  /** A fresh voice check for one operation, such as key export; it never unlocks. */
  confirmOperation(input: {
    readonly walletId: WalletId;
    readonly walletAuthMethodId: WalletAuthMethodId;
    readonly surfaceMeasurementBinding: UiConfirmSurfaceMeasurementBinding;
    readonly prepareOperation: (signal: AbortSignal) => Promise<VoiceIdOperationPreparation>;
  }): Promise<VoiceIdOperationProof>;
  /**
   * Opens a surface that shows one sentence and records clips of it for a transaction feature.
   * It reads no enrollment and proves nothing; the caller sends each clip to its own verifier.
   */
  openPhrase(input: AuthMethodPhraseRequest): Promise<AuthMethodPhraseSurface>;
}

import type { UserConfirmSecurityContext } from '@/core/types';
import type { AppearanceConfig } from '@/core/types/seams';
import type { TxDisplayModel } from '@/core/signingEngine/interfaces/display';
import type {
  EmailOtpConfirmPrompt,
  SigningAuthMode,
} from '@/core/signingEngine/stepUpConfirmation/types';

export type { ThemeMode } from '@/core/types/seams';

export type ConfirmationUIMode = 'none' | 'modal' | 'drawer';

// Public handle returned by mount/await helpers

export type SigningKeyChoice = {
  readonly selected: string;
  readonly options: readonly { readonly id: string; readonly label: string }[];
  readonly onChange: (id: string) => void;
};

export type ConfirmUIUpdate = {
  signingKeyChoice?: SigningKeyChoice | null;
  model?: TxDisplayModel;
  securityContext?: Partial<UserConfirmSecurityContext>;
  appearance?: AppearanceConfig;
  nearExplorerUrl?: string;
  tempoExplorerUrl?: string;
  evmExplorerUrl?: string;
  loading?: boolean;
  /** Shows the confirm button as loading while signing work finishes behind the review. */
  preparing?: boolean;
  errorMessage?: string;
  confirmText?: string;
  cancelText?: string;
  onBack?: () => void;
  title?: string;
  body?: string;
  authMethodApprovalMessage?: string;
  authMethodCapture?: HTMLElement | null;
  signingAuthMode?: SigningAuthMode;
  emailOtpPrompt?: EmailOtpConfirmPrompt;
};

export interface ConfirmUIHandle {
  close(confirmed: boolean): void;
  update(props: ConfirmUIUpdate): void;
  /**
   * Subscribe to cancel events emitted by the mounted confirmer element.
   * Returns an unsubscribe function.
   */
  onCancel?(listener: (detail: { error?: string }) => void): () => void;
}

/**
 * Runs after the person confirms and before the decision reaches the operation, such as an
 * authentication capture inside the card. A rejection cancels the card with its message.
 */
export type ConfirmUIConfirmGate = () => Promise<void>;

export type ConfirmUISurfaceDecision =
  | {
      kind: 'confirmed';
      emailOtp: { kind: 'absent' } | { kind: 'provided'; code: string; challengeId: string };
    }
  | { kind: 'cancelled'; error: string | null };

export interface MountedConfirmUIHandle extends ConfirmUIHandle {
  readonly element: HTMLElement;
  takeDecision(): Promise<ConfirmUISurfaceDecision>;
  /** The next confirmation passes this gate once; a later one publishes at once. */
  setConfirmGate(gate: ConfirmUIConfirmGate): void;
}

export type ConfirmUISurfaceSource =
  | { kind: 'mount_new' }
  | { kind: 'reuse_mounted'; handle: MountedConfirmUIHandle }
  | { kind: 'preparation_cancelled' };

export type ConfirmUIPromptDiagnostics = {
  kind: 'confirm_ui_prompt_diagnostics_v1';
  elementDefineMs: number;
  mountMs: number;
  hostFirstUpdateMs: number;
  hostInteractiveMs: number;
  confirmEventMs: number;
  decisionWaitMs: number;
};

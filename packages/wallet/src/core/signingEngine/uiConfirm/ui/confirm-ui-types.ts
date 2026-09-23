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

export type ConfirmUIUpdate = {
  model?: TxDisplayModel;
  securityContext?: Partial<UserConfirmSecurityContext>;
  appearance?: AppearanceConfig;
  nearExplorerUrl?: string;
  tempoExplorerUrl?: string;
  evmExplorerUrl?: string;
  loading?: boolean;
  errorMessage?: string;
  confirmText?: string;
  cancelText?: string;
  onBack?: () => void;
  title?: string;
  body?: string;
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

export type ConfirmUISurfaceDecision =
  | {
      kind: 'confirmed';
      emailOtp:
        | { kind: 'absent' }
        | { kind: 'provided'; code: string; challengeId: string };
    }
  | { kind: 'cancelled'; error: string | null };

export interface MountedConfirmUIHandle extends ConfirmUIHandle {
  readonly element: HTMLElement;
  takeDecision(): Promise<ConfirmUISurfaceDecision>;
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

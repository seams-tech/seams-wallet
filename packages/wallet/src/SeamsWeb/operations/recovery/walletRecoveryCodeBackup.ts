import type { AppearanceConfig } from '@/core/types/seams';
import type { WalletIframeSurfaceMeasurement } from '../../walletIframe/shared/messages';
import type {
  WalletRecoveryCodeBackupAcknowledgementV1,
  WalletRecoveryCodeBackupRequestV1,
} from '@/core/types/sdkSentEvents';
import type { UiConfirmSurfaceMeasurementBinding } from '@/core/signingEngine/uiConfirm/uiConfirm.types';
import {
  createWalletIframeSurfaceMeasurementReporter,
  type WalletIframeSurfaceMeasurementReporter,
} from '../../walletIframe/host/surface-measurement-reporter';
/* Relative, not `@/`-aliased: unit tests load this module as raw source over
   Vite's /@fs route, where the SDK's path alias is not configured. Type-only
   `@/` imports above are erased before that matters; these are values. */
import type {
  RecoveryBackupCloseDetail,
  RecoveryCodeBackupExperience,
} from '../../../core/signingEngine/uiConfirm/ui/preact/RecoveryCodeBackupSurface';

const CANCELLED_MESSAGE = 'Recovery-code backup was cancelled before acknowledgement';

type AccountMenuRecoveryCodeExperience = Extract<
  RecoveryCodeBackupExperience,
  { readonly kind: 'account_menu' }
>;

type WalletRecoveryCodesUiRequest = Omit<AccountMenuRecoveryCodeExperience, 'kind'>;

type RecoveryCodeBackupUiOptions = {
  readonly appearance?: AppearanceConfig;
  readonly shouldCancel?: () => boolean;
};

type RecoveryCodeExperienceResult =
  | { readonly kind: 'registration_backed_up' }
  | { readonly kind: 'account_menu_backed_up'; readonly issuedAtMs: number }
  | { readonly kind: 'deferred' };

/**
 * Shows the recovery-code backup dialog and resolves with the user's
 * acknowledgement. This wrapper owns the promise contract: an acknowledged
 * close resolves as backed-up, an unacknowledged close defers during
 * registration and cancels from the account menu, and Escape always cancels.
 */
async function showRecoveryCodeExperience(
  experience: RecoveryCodeBackupExperience,
  measurementBinding: UiConfirmSurfaceMeasurementBinding = { kind: 'disabled' },
  options: RecoveryCodeBackupUiOptions = {},
): Promise<RecoveryCodeExperienceResult> {
  if (typeof document === 'undefined') {
    throw new Error('Wallet recovery-code backup requires a browser or a backup handler');
  }

  const previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (options.shouldCancel?.()) throw new Error(CANCELLED_MESSAGE);
  const surfaceModule = await import(
    '../../../core/signingEngine/uiConfirm/ui/preact/mountRecoveryCodeBackupSurface'
  );
  if (options.shouldCancel?.()) throw new Error(CANCELLED_MESSAGE);

  let measurementReporter: WalletIframeSurfaceMeasurementReporter | null = null;
  let surface: ReturnType<typeof surfaceModule.mountRecoveryCodeBackupSurface> | null = null;
  let settled = false;

  return await new Promise<RecoveryCodeExperienceResult>((resolve, reject) => {
    const cleanup = (): void => {
      measurementReporter?.disconnect();
      measurementReporter = null;
      surface?.dispose();
      surface = null;
      previousFocus?.focus();
    };

    const settle = (result: RecoveryCodeExperienceResult | Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };

    const handleClose = (detail: RecoveryBackupCloseDetail): void => {
      switch (detail.kind) {
        case 'dismissed':
          settle(new Error(CANCELLED_MESSAGE));
          return;
        case 'recovery_codes':
          if (detail.acknowledged) {
            if (experience.kind === 'account_menu') {
              if (detail.request.continuation !== 'pending_backup_must_finish') {
                settle(new Error('Displayed recovery codes have no committed issuance'));
                return;
              }
              settle({ kind: 'account_menu_backed_up', issuedAtMs: detail.request.issuedAtMs });
              return;
            }
            settle({ kind: 'registration_backed_up' });
            return;
          }
          if (
            experience.kind === 'direct_backup' &&
            experience.request.continuation === 'registration_may_defer'
          ) {
            settle({ kind: 'deferred' });
            return;
          }
          settle(new Error(CANCELLED_MESSAGE));
          return;
      }
    };

    try {
      surface = surfaceModule.mountRecoveryCodeBackupSurface({
        parent: document.body,
        appearance: options.appearance,
        experience,
        surface: measurementBinding.kind === 'wallet_iframe' ? 'wallet-iframe' : 'standalone',
        onClose: handleClose,
        onCancel: () => settle(new Error(CANCELLED_MESSAGE)),
        onShown: (dialog) => {
          if (settled || measurementBinding.kind !== 'wallet_iframe') return;
          measurementReporter = createWalletIframeSurfaceMeasurementReporter({
            kind: 'request_scroll_surface',
            requestId: measurementBinding.requestId,
            element: dialog,
            postMeasurement: postRecoveryMeasurement.bind(null, dialog, measurementBinding.postMeasurement),
          });
        },
      });
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export async function showWalletRecoveryCodeBackupUi(
  request: WalletRecoveryCodeBackupRequestV1,
  measurementBinding: UiConfirmSurfaceMeasurementBinding = { kind: 'disabled' },
): Promise<WalletRecoveryCodeBackupAcknowledgementV1> {
  const result = await showRecoveryCodeExperience(
    { kind: 'direct_backup', request },
    measurementBinding,
  );
  switch (result.kind) {
    case 'registration_backed_up':
      return { kind: 'wallet_recovery_codes_backed_up_v1' };
    case 'deferred':
      return { kind: 'wallet_recovery_code_backup_deferred_v1' };
    case 'account_menu_backed_up':
      throw new Error('Registration backup returned an account-menu issuance');
  }
}

export async function showWalletRecoveryCodesUi(
  request: WalletRecoveryCodesUiRequest,
  measurementBinding: UiConfirmSurfaceMeasurementBinding = { kind: 'disabled' },
  options: RecoveryCodeBackupUiOptions = {},
): Promise<{ readonly kind: 'wallet_recovery_codes_backed_up_v1'; readonly issuedAtMs: number }> {
  const result = await showRecoveryCodeExperience(
    { kind: 'account_menu', ...request },
    measurementBinding,
    options,
  );
  if (result.kind !== 'account_menu_backed_up') {
    throw new Error('Account-menu backup did not acknowledge committed recovery codes');
  }
  return { kind: 'wallet_recovery_codes_backed_up_v1', issuedAtMs: result.issuedAtMs };
}

function postRecoveryMeasurement(
  dialog: HTMLDialogElement,
  postMeasurement: (measurement: WalletIframeSurfaceMeasurement) => void,
  measurement: WalletIframeSurfaceMeasurement,
): void {
  if (measurement.kind !== 'measured_v1') {
    throw new Error('Recovery codes require a request surface measurement');
  }
  postMeasurement({
    kind: 'measured_v1',
    requestId: measurement.requestId,
    sequence: measurement.sequence,
    widthCssPx: dialog.dataset.seamsRecoveryStage === 'recovery_codes' ? 688 : 480,
    heightCssPx: measurement.heightCssPx,
  });
}

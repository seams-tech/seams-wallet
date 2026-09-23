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

export type WalletRecoveryCodesUiRequest = Omit<AccountMenuRecoveryCodeExperience, 'kind'>;

type RecoveryCodeBackupUiOptions = {
  readonly appearance?: AppearanceConfig;
  readonly shouldCancel?: () => boolean;
};

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
): Promise<WalletRecoveryCodeBackupAcknowledgementV1> {
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

  return await new Promise<WalletRecoveryCodeBackupAcknowledgementV1>((resolve, reject) => {
    const cleanup = (): void => {
      measurementReporter?.disconnect();
      measurementReporter = null;
      surface?.dispose();
      surface = null;
      previousFocus?.focus();
    };

    const settle = (result: WalletRecoveryCodeBackupAcknowledgementV1 | Error): void => {
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
            settle({ kind: 'wallet_recovery_codes_backed_up_v1' });
            return;
          }
          if (
            experience.kind === 'direct_backup' &&
            experience.request.continuation === 'registration_may_defer'
          ) {
            settle({ kind: 'wallet_recovery_code_backup_deferred_v1' });
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
  return await showRecoveryCodeExperience({ kind: 'direct_backup', request }, measurementBinding);
}

export async function showWalletRecoveryCodesUi(
  request: WalletRecoveryCodesUiRequest,
  measurementBinding: UiConfirmSurfaceMeasurementBinding = { kind: 'disabled' },
  options: RecoveryCodeBackupUiOptions = {},
): Promise<WalletRecoveryCodeBackupAcknowledgementV1> {
  return await showRecoveryCodeExperience(
    { kind: 'account_menu', ...request },
    measurementBinding,
    options,
  );
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

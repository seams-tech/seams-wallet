import {
  parseQrLinkedDeviceSessionPayloadV5,
  serializeQrLinkedDeviceSessionPayloadV5,
  type QrLinkedDeviceSessionPayloadV5,
} from '@shared/device-linking';
import type { DelegatedWalletPermissionV1 } from '@shared/authorization/delegatedAuthority';
import { sha256Utf8DigestB64u } from '@shared/utils/canonicalPrimitives';
import type { WalletId } from '@shared/utils/domainIds';
import type { AppearanceConfig } from '@/core/types/seams';
import type { DeviceCommands } from '@/SeamsWeb/publicApi/devices';
import type { MountedConfirmUIHandle } from '@/core/signingEngine/uiConfirm/ui/confirm-ui-types';
import type { UiConfirmSurfaceMeasurementBinding } from '@/core/signingEngine/uiConfirm/uiConfirm.types';

const CANCELLED = 'Device linking was cancelled';
let activeApproval: DeviceLinkApproval | null = null;

type ApprovalContext = {
  readonly execute: DeviceCommands['approveLinking'];
  readonly readAppearance: () => AppearanceConfig;
  readonly readMeasurementBinding: () => UiConfirmSurfaceMeasurementBinding;
};

export type DeviceLinkOwnerConfirmation = (input: {
  readonly walletId: WalletId;
  readonly payload: QrLinkedDeviceSessionPayloadV5;
}) => Promise<{ readonly assertCurrent: () => void }>;

function permissionLabel(permission: DelegatedWalletPermissionV1): string {
  switch (permission) {
    case 'sign':
      return 'Sign transactions';
    case 'export_keys':
      return 'Export signing keys';
    case 'link_devices':
      return 'Link other devices';
    case 'revoke_devices':
      return 'Remove devices';
    default:
      permission satisfies never;
      throw new Error('Unsupported device permission');
  }
}

class DeviceLinkApproval {
  private surface: MountedConfirmUIHandle | null = null;
  private state: 'pending' | 'showing' | 'approved' | 'cancelled' = 'pending';
  readonly snapshot: string;

  constructor(
    readonly requestId: string,
    readonly target: QrLinkedDeviceSessionPayloadV5,
    private readonly appearance: AppearanceConfig,
    private readonly measurement: UiConfirmSurfaceMeasurementBinding,
  ) {
    Object.freeze(target.targetFactor);
    Object.freeze(target.requestedPermission);
    Object.freeze(target);
    this.snapshot = serializeQrLinkedDeviceSessionPayloadV5(target);
  }

  cancel(): void {
    this.state = 'cancelled';
    this.surface?.close(false);
  }

  assertCurrent(): void {
    if (activeApproval !== this || this.state === 'cancelled' || this.target.expiresAtMs <= Date.now()) {
      this.cancel();
      throw new Error(CANCELLED);
    }
  }

  async confirm(walletId: WalletId): Promise<void> {
    this.assertCurrent();
    if (this.state !== 'pending') throw new Error('Device approval was already requested');
    this.state = 'showing';
    const timeout = setTimeout(this.cancel.bind(this), Math.max(0, this.target.expiresAtMs - Date.now()));
    try {
      const fingerprint = await sha256Utf8DigestB64u(this.snapshot);
      const { mountConfirmUI } = await import('@/core/signingEngine/uiConfirm/ui/confirm-ui');
      this.assertCurrent();
      const factor = this.target.targetFactor.kind === 'passkey_prf'
        ? 'Passkey'
        : `Email code: ${this.target.targetEmail}`;
      this.surface = await mountConfirmUI({
        ctx: { surfaceMeasurementBinding: this.measurement },
        summary: {
          title: 'Link a device?',
          body: [
            `Wallet: ${String(walletId).slice(0, 12)}…`,
            `Device request: ${fingerprint.slice(0, 16)}`,
            `Sign-in method: ${factor}`,
            '',
            'This device will be able to:',
            ...this.target.requestedPermission.permissions.map(permissionBullet),
          ].join('\n'),
        },
        securityContext: { rpId: window.location.hostname },
        appearance: this.appearance,
        uiMode: 'modal',
      });
      this.surface.element.dataset.seamsDeviceLinkApproval = fingerprint;
      this.surface.element.dataset.seamsDeviceLinkWallet = walletId;
      this.surface.update({ confirmText: 'Link device', cancelText: 'Cancel' });
      this.assertCurrent();
      const decision = await this.surface.takeDecision();
      this.assertCurrent();
      if (decision.kind !== 'confirmed') {
        this.cancel();
        throw new Error(CANCELLED);
      }
      this.state = 'approved';
    } finally {
      clearTimeout(timeout);
      this.surface?.close(false);
      this.surface = null;
    }
  }
}

function permissionBullet(permission: DelegatedWalletPermissionV1): string {
  return `• ${permissionLabel(permission)}`;
}

/** The owner preflight supplies the authenticated wallet, never a parent preference. */
export const confirmDeviceLinkApproval: DeviceLinkOwnerConfirmation = async (input) => {
  const approval = activeApproval;
  if (!approval || serializeQrLinkedDeviceSessionPayloadV5(input.payload) !== approval.snapshot) {
    throw new Error('Device linking requires its exact Wallet-origin approval');
  }
  await approval.confirm(input.walletId);
  return { assertCurrent: approval.assertCurrent.bind(approval) };
};

export async function approveDeviceLinkWithConsent(
  context: ApprovalContext,
  qrData: Parameters<DeviceCommands['approveLinking']>[0],
  options: Parameters<DeviceCommands['approveLinking']>[1],
): ReturnType<DeviceCommands['approveLinking']> {
  if (activeApproval) throw new Error('Another device-link request is active');
  const measurement = context.readMeasurementBinding();
  if (measurement.kind !== 'wallet_iframe') throw new Error('Device approval requires the Wallet origin');
  const target = parseQrLinkedDeviceSessionPayloadV5(qrData);
  const approval = new DeviceLinkApproval(
    measurement.requestId, target, context.readAppearance(), measurement,
  );
  activeApproval = approval;
  try {
    return await context.execute(target, options);
  } finally {
    approval.cancel();
    if (activeApproval === approval) activeApproval = null;
  }
}

export function cancelDeviceLinkApproval(
  scope: { readonly kind: 'all' } | { readonly kind: 'request'; readonly requestId: string },
): void {
  if (scope.kind === 'all' || activeApproval?.requestId === scope.requestId) activeApproval?.cancel();
}

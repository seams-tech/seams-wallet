// Around the Device 2 flow: ids, the QR payload and image, event phases, logging, retry timing,
// and how failures are classified.
import type { DeviceLinkingWebContext } from '@/SeamsWeb/signingSurface/types';
import type { StartDevice2LinkingFlowArgs } from '@/core/types/linkDevice';
import {
  DeviceLinkingError,
  DeviceLinkingErrorCode,
  normalizeLinkedDeviceTargetEmailAddressV1,
} from '@/core/types/linkDevice';
import {
  buildQrLinkedDeviceSessionPayloadV5,
  assertNeverLinkSessionStateV1,
} from '@shared/device-linking';
import type {
  LinkedDeviceTargetCredentialRegistrationResultV1,
  LinkSessionStateV1,
  ActiveWalletSessionV1,
  QrLinkedDeviceSessionPayloadV5,
} from '@shared/device-linking';
import { parseLinkDeviceSessionId } from '@shared/signing-lanes/ids';
import { secureRandomId } from '@shared/utils/secureRandomId';
import { errorMessage } from '@shared/utils/errors';
import { LinkDeviceEventPhase } from '@/core/types/sdkSentEvents';
import type { CreateLinkDeviceFlowEventInput } from '@/core/types/sdkSentEvents';
import type { WalletAuthenticationState } from '@/core/types/seams';
import { nextLinkedDevicePollingDelayMsV1 } from './deviceLinkingHttpTransport';
import { buildFullOwnerDelegatedWalletAuthorityV1 } from '@shared/authorization/delegatedAuthority';
import { WALLET_AUTH_METHODS } from '@shared/utils/signerDomain';

export type EmitLinkDeviceEventInput = Omit<
  CreateLinkDeviceFlowEventInput,
  'flowId' | 'accountId'
> & {
  readonly accountId?: string;
};

export type GetLinkedDeviceAuthenticationContext = () => DeviceLinkingWebContext;

export function linkedDeviceWalletAuthenticationState(
  walletSession: ActiveWalletSessionV1,
  registration: LinkedDeviceTargetCredentialRegistrationResultV1,
): Extract<WalletAuthenticationState, { readonly kind: 'authenticated' }> {
  switch (registration.targetFactor.kind) {
    case 'verified_passkey_target_v1':
      return {
        kind: 'authenticated',
        walletId: walletSession.walletId,
        authMethod: WALLET_AUTH_METHODS.passkey,
      };
    case 'verified_email_otp_target_v1':
      return {
        kind: 'authenticated',
        walletId: walletSession.walletId,
        authMethod: WALLET_AUTH_METHODS.emailOtp,
      };
    default:
      return registration.targetFactor satisfies never;
  }
}

export function createLinkSessionId(): import('@shared/signing-lanes/ids').LinkDeviceSessionId {
  const parsed = parseLinkDeviceSessionId(secureRandomId('link-session', 32));
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

export function createFlowId(): string {
  return secureRandomId('link-flow', 16);
}

export function notifyError(callback: ((error: Error) => void) | undefined, error: Error): void {
  try {
    callback?.(error);
  } catch {
    // Consumer callback failures do not replace the domain error.
  }
}

export function logDevice2LinkingStageV1(input: {
  readonly flowId: string;
  readonly linkSessionId: string;
  readonly stage: string;
  readonly details?: Readonly<Record<string, unknown>>;
}): void {
  console.info('[Device2Linking]', {
    flowId: input.flowId,
    linkSessionId: input.linkSessionId,
    stage: input.stage,
    ...input.details,
  });
}

export function logDevice2LinkingFailureV1(input: {
  readonly flowId: string;
  readonly linkSessionId: string;
  readonly state: LinkSessionStateV1['state'];
  readonly error: unknown;
}): void {
  console.error('[Device2Linking] failed', {
    flowId: input.flowId,
    linkSessionId: input.linkSessionId,
    state: input.state,
    error: errorMessage(input.error),
  });
}

function resolveSessionStateRetry(resolve: () => void, attempt: number): void {
  setTimeout(resolve, nextLinkedDevicePollingDelayMsV1(250, attempt));
}

export async function waitForSessionStateRetry(attempt: number): Promise<void> {
  await new Promise<void>((resolve) => resolveSessionStateRetry(resolve, attempt));
}

export function phaseForState(state: LinkSessionStateV1): LinkDeviceEventPhase {
  switch (state.state) {
    case 'displaying_qr':
    case 'expired':
    case 'cancelled':
      return LinkDeviceEventPhase.STEP_01_QR_PREPARE_STARTED;
    case 'claimed':
    case 'awaiting_target_factor':
    case 'awaiting_source_contribution':
    case 'provisioning':
    case 'authority_pending_local_install':
    case 'active':
      return LinkDeviceEventPhase.STEP_02_QR_SCAN_STARTED;
    case 'failed_before_commit':
      return LinkDeviceEventPhase.FAILED;
    default:
      return assertNeverLinkSessionStateV1(state);
  }
}

export function errorForFailure(
  error: unknown,
  phase: DeviceLinkingError['phase'],
): DeviceLinkingError {
  if (error instanceof DeviceLinkingError) return error;
  return new DeviceLinkingError(
    errorMessage(error) || 'Device linking failed',
    DeviceLinkingErrorCode.REGISTRATION_FAILED,
    phase,
  );
}

export type LinkedDeviceDeliveryRecoveryReasonV1 =
  | 'recipient_private_handle_lost'
  | 'sealed_delivery_expired';

/**
 * These failures happen after the server has committed the linked authority.
 * The original delivery is intentionally abandoned; exact-method unlock uses
 * the durable local installation to obtain a successor Wallet Session.
 */
export function classifyLinkedDeviceDeliveryFailureV1(
  error: unknown,
): LinkedDeviceDeliveryRecoveryReasonV1 | null {
  const message = errorMessage(error).toLowerCase();
  if (
    message.includes('device-linking key handle is unknown or discarded') ||
    message.includes('recipient handle lost')
  ) {
    return 'recipient_private_handle_lost';
  }
  if (message.includes('linked-device wallet session credential delivery is expired')) {
    return 'sealed_delivery_expired';
  }
  return null;
}

export function linkedDeviceDeliveryRecoveryMessageV1(
  reason: LinkedDeviceDeliveryRecoveryReasonV1,
): string {
  switch (reason) {
    case 'recipient_private_handle_lost':
    case 'sealed_delivery_expired':
      return 'The linked device is ready. Return to sign in and unlock the new method to finish setup.';
    default:
      return reason satisfies never;
  }
}

export class LinkDeviceFlowSupersededError extends Error {
  constructor() {
    super('Device-link flow was cancelled or reset');
    this.name = 'LinkDeviceFlowSupersededError';
  }
}

export async function generateQrCodeDataUrlV1(payload: string): Promise<string> {
  let qrcode: typeof import('qrcode');
  try {
    qrcode = await import('qrcode');
  } catch {
    throw new DeviceLinkingError(
      'Device-link QR generation requires the optional qrcode package',
      DeviceLinkingErrorCode.UNSUPPORTED,
      'generation',
    );
  }
  return await qrcode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 2,
  });
}

export function buildDevice2QrSessionPayloadV1(input: {
  readonly linkSessionId: import('@shared/signing-lanes/ids').LinkDeviceSessionId;
  readonly linkPublicKeyB64u: import('@shared/device-linking').LinkDevicePublicKeyB64u;
  readonly devicePublicKeyB64u: import('@shared/device-linking').LinkDevicePublicKeyB64u;
  readonly target: StartDevice2LinkingFlowArgs;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}): QrLinkedDeviceSessionPayloadV5 {
  const requestedPermission = buildFullOwnerDelegatedWalletAuthorityV1();
  if (input.target.targetFactor.kind === 'email_otp') {
    return buildQrLinkedDeviceSessionPayloadV5({
      linkSessionId: input.linkSessionId,
      linkPublicKeyB64u: input.linkPublicKeyB64u,
      devicePublicKeyB64u: input.devicePublicKeyB64u,
      requestedPermission,
      targetFactor: { kind: 'email_otp' },
      targetEmail: normalizeLinkedDeviceTargetEmailAddressV1(input.target.targetEmail),
      issuedAtMs: input.issuedAtMs,
      expiresAtMs: input.expiresAtMs,
    });
  }
  return buildQrLinkedDeviceSessionPayloadV5({
    linkSessionId: input.linkSessionId,
    linkPublicKeyB64u: input.linkPublicKeyB64u,
    devicePublicKeyB64u: input.devicePublicKeyB64u,
    requestedPermission,
    targetFactor: { kind: 'passkey_prf' },
    issuedAtMs: input.issuedAtMs,
    expiresAtMs: input.expiresAtMs,
  });
}

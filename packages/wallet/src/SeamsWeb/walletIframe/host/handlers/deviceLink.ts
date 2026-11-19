import type { HandlerDeps, HandlerMap, Req } from './walletIframeHandler.types';
import { respondOk, respondOkResult, withProgress } from './shared';
import {
  parseLinkedDeviceListRequestV1,
  parseLinkedDeviceListResultV1,
  parseLinkedDeviceRevokeResultV1,
  parseQrLinkedDeviceSessionPayloadV5,
} from '@shared/device-linking';
import type {
  LinkedDeviceTargetFactorActivationV1,
  StartDevice2LinkingFlowArgs,
} from '@/core/types/linkDevice';
import { classifyLinkDeviceFlowEvent, type LinkDeviceFlowEvent } from '@/core/types/sdkSentEvents';
import type {
  DeviceLinkTargetFactorActionV1,
  DeviceLinkTargetFactorActivationProgressV1,
} from '../../shared/messages';
import { parseDeviceLinkTargetFactorActionPayloadV1 } from '../../shared/messages';

type ActiveDeviceLinkTargetFactorV1 = {
  readonly activationId: string;
  readonly activation: LinkedDeviceTargetFactorActivationV1;
};

type ActiveDeviceLinkTargetFactorStoreV1 = {
  current: ActiveDeviceLinkTargetFactorV1 | null;
};

function targetFactorProgressV1(
  active: ActiveDeviceLinkTargetFactorV1,
): DeviceLinkTargetFactorActivationProgressV1 {
  switch (active.activation.kind) {
    case 'linked_device_target_passkey_activation_v1':
      return {
        event: 'wallet_device_link_target_factor_activation_v1',
        activationId: active.activationId,
        activation: { kind: active.activation.kind },
      };
    case 'linked_device_target_email_otp_activation_v1':
      return {
        event: 'wallet_device_link_target_factor_activation_v1',
        activationId: active.activationId,
        activation: {
          kind: active.activation.kind,
          state: active.activation.state,
        },
      };
    default:
      active.activation satisfies never;
      throw new Error('Unsupported linked-device target-factor activation');
  }
}

async function performTargetFactorActionV1(input: {
  readonly active: ActiveDeviceLinkTargetFactorV1;
  readonly action: DeviceLinkTargetFactorActionV1;
}): Promise<void> {
  switch (input.action.kind) {
    case 'create_passkey':
      if (input.active.activation.kind !== 'linked_device_target_passkey_activation_v1') {
        throw new Error('linked-device Passkey activation is unavailable');
      }
      await input.active.activation.createPasskey();
      return;
    case 'send_email_otp':
      if (input.active.activation.kind !== 'linked_device_target_email_otp_activation_v1') {
        throw new Error('linked-device Email OTP activation is unavailable');
      }
      await input.active.activation.sendCode();
      return;
    case 'resend_email_otp':
      if (input.active.activation.kind !== 'linked_device_target_email_otp_activation_v1') {
        throw new Error('linked-device Email OTP activation is unavailable');
      }
      await input.active.activation.resendCode();
      return;
    case 'submit_email_otp':
      if (input.active.activation.kind !== 'linked_device_target_email_otp_activation_v1') {
        throw new Error('linked-device Email OTP activation is unavailable');
      }
      await input.active.activation.submitCode(input.action.otpCode);
      return;
    default:
      input.action satisfies never;
      throw new Error('Unsupported linked-device target-factor action');
  }
}

function publishTargetFactorActivationV1(
  store: ActiveDeviceLinkTargetFactorStoreV1,
  deps: Pick<HandlerDeps, 'postProgress'>,
  requestId: string | undefined,
  activationId: string,
  activation: LinkedDeviceTargetFactorActivationV1,
): void {
  store.current = { activationId, activation };
  deps.postProgress(requestId, targetFactorProgressV1(store.current));
}

function forwardDeviceLinkEventV1(
  store: ActiveDeviceLinkTargetFactorStoreV1,
  deps: Pick<HandlerDeps, 'postProgress'>,
  requestId: string | undefined,
  event: LinkDeviceFlowEvent,
): void {
  deps.postProgress(requestId, event);
  const outcome = classifyLinkDeviceFlowEvent(event);
  if (
    outcome.kind === 'active' ||
    outcome.kind === 'failed' ||
    outcome.kind === 'invalid_active' ||
    outcome.kind === 'cancelled'
  ) {
    store.current = null;
  }
}

export function createDeviceLinkWalletIframeHandlers(deps: HandlerDeps): HandlerMap {
  const activeTargetFactor: ActiveDeviceLinkTargetFactorStoreV1 = { current: null };
  return {
    PM_START_DEVICE2_LINKING_FLOW: async (req: Req<'PM_START_DEVICE2_LINKING_FLOW'>) => {
      const pm = deps.getWalletRuntime();
      const payload = req.payload;
      if (!payload) throw new Error('PM_START_DEVICE2_LINKING_FLOW requires a payload');
      const { ui, cameraId, options } = payload;
      let target: StartDevice2LinkingFlowArgs;
      if (payload.targetFactor.kind === 'email_otp') {
        if (typeof payload.targetEmail !== 'string') {
          throw new Error('PM_START_DEVICE2_LINKING_FLOW requires targetEmail for Email OTP');
        }
        target = {
          targetFactor: payload.targetFactor,
          targetEmail: payload.targetEmail,
        };
      } else {
        target = { targetFactor: payload.targetFactor };
      }
      if (deps.respondIfCancelled(req.requestId)) return;
      const activationId = String(req.requestId || '').trim();
      if (!activationId) throw new Error('Device-link target-factor activation id is required');
      const result = await pm.devices.startLinking({
        ...target,
        ...(ui ? { ui } : {}),
        ...(cameraId ? { cameraId } : {}),
        options: {
          ...(options || {}),
          onEvent: forwardDeviceLinkEventV1.bind(null, activeTargetFactor, deps, req.requestId),
          onTargetFactorRequired: publishTargetFactorActivationV1.bind(
            null,
            activeTargetFactor,
            deps,
            req.requestId,
            activationId,
          ),
        },
      });
      if (deps.respondIfCancelled(req.requestId)) return;
      respondOkResult(deps, req.requestId, result);
    },

    PM_DEVICE_LINK_TARGET_FACTOR_ACTION: async (
      req: Req<'PM_DEVICE_LINK_TARGET_FACTOR_ACTION'>,
    ) => {
      const payload = parseDeviceLinkTargetFactorActionPayloadV1(req.payload);
      if (!payload) throw new Error('PM_DEVICE_LINK_TARGET_FACTOR_ACTION payload is invalid');
      const active = activeTargetFactor.current;
      if (!active || active.activationId !== payload.activationId) {
        throw new Error('linked-device target-factor activation is unavailable');
      }
      await performTargetFactorActionV1({ active, action: payload.action });
      respondOk(deps, req.requestId);
    },

    PM_CANCEL_DEVICE_LINKING: async (req: Req<'PM_CANCEL_DEVICE_LINKING'>) => {
      const pm = deps.getWalletRuntime();
      if (deps.respondIfCancelled(req.requestId)) return;
      await pm.devices.cancelLinking();
      activeTargetFactor.current = null;
      if (deps.respondIfCancelled(req.requestId)) return;
      respondOk(deps, req.requestId);
    },

    PM_SCAN_AND_LINK_DEVICE: async (req: Req<'PM_SCAN_AND_LINK_DEVICE'>) => {
      const pm = deps.getWalletRuntime();
      const { qrData, options } = req.payload!;
      if (deps.respondIfCancelled(req.requestId)) return;
      const result = await pm.devices.approveLinking(
        parseQrLinkedDeviceSessionPayloadV5(qrData),
        withProgress(deps, req.requestId, options || {}),
      );
      if (deps.respondIfCancelled(req.requestId)) return;
      respondOkResult(deps, req.requestId, result);
    },

    PM_HAS_PASSKEY: async (req: Req<'PM_HAS_PASSKEY'>) => {
      const pm = deps.getWalletRuntime();
      const { walletId } = req.payload!;
      const result = await pm.auth.hasPasskey(walletId);
      respondOkResult(deps, req.requestId, result);
    },

    PM_LIST_LINKED_DEVICES: async (req: Req<'PM_LIST_LINKED_DEVICES'>) => {
      const pm = deps.getWalletRuntime();
      const payload = req.payload;
      if (!payload) throw new Error('PM_LIST_LINKED_DEVICES requires a payload');
      const request = parseLinkedDeviceListRequestV1({
        kind: 'linked_device_list_request_v1',
        walletId: payload.walletId,
        limit: payload.limit,
        cursor: payload.cursor,
      });
      const result = await pm.devices.list({
        walletId: String(request.walletId),
        limit: request.limit,
        cursor: request.cursor,
      });
      respondOkResult(deps, req.requestId, parseLinkedDeviceListResultV1(result));
    },

    PM_REVOKE_LINKED_DEVICE: async (req: Req<'PM_REVOKE_LINKED_DEVICE'>) => {
      const pm = deps.getWalletRuntime();
      const payload = req.payload;
      if (!payload) throw new Error('PM_REVOKE_LINKED_DEVICE requires a payload');
      if (deps.respondIfCancelled(req.requestId)) return;
      const result = await pm.devices.remove({
        walletId: payload.walletId,
        walletAuthMethodId: payload.walletAuthMethodId,
      });
      if (deps.respondIfCancelled(req.requestId)) return;
      respondOkResult(deps, req.requestId, parseLinkedDeviceRevokeResultV1(result));
    },
  };
}

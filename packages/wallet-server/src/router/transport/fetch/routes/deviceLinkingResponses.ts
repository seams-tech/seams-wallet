import type { DeviceLinkingAuthDeniedV1 } from './deviceLinking';
import {
  assertNeverLinkSessionStateV1,
  type LinkSessionProjectionV1,
  type LinkSessionStateV1,
  type LinkedDeviceTargetCredentialRegistrationResultV1,
} from '@shared/device-linking/contracts';
import type { LinkedDeviceSessionRecordV1 } from '../../../../core/deviceLinking/linkedDeviceSessionRecord';
import { json } from '../../../framework/http';

function projectLinkSessionStateV1(state: LinkSessionStateV1): LinkSessionStateV1 {
  switch (state.state) {
    case 'displaying_qr':
      return { state: 'displaying_qr' };
    case 'claimed':
    case 'awaiting_target_factor':
    case 'awaiting_source_contribution':
    case 'provisioning':
      return { state: state.state, deviceId: state.deviceId };
    case 'authority_pending_local_install':
      return {
        state: 'authority_pending_local_install',
        deviceId: state.deviceId,
        authorityId: state.authorityId,
        packageSetDigestB64u: state.packageSetDigestB64u,
      };
    case 'active':
      return {
        state: 'active',
        deviceId: state.deviceId,
        authorityId: state.authorityId,
        activatedAtMs: state.activatedAtMs,
      };
    case 'failed_before_commit':
      return { state: 'failed_before_commit', error: state.error };
    case 'cancelled':
      return { state: 'cancelled', cancelledAtMs: state.cancelledAtMs };
    case 'expired':
      return { state: 'expired', expiredAtMs: state.expiredAtMs };
    default:
      return assertNeverLinkSessionStateV1(state);
  }
}

export function projectSession(record: LinkedDeviceSessionRecordV1): LinkSessionProjectionV1 {
  return {
    kind: 'linked_device_session_projection_v1',
    linkSessionId: record.linkSessionId,
    qrPayload: record.qrPayload,
    revision: record.revision,
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs,
    state: projectLinkSessionStateV1(record.state),
  };
}

export function invalidStateResponse(record: LinkedDeviceSessionRecordV1): Response {
  return json(
    {
      ok: false,
      outcome: 'invalid_state',
      state: record.state.state,
      session: projectSession(record),
    },
    { status: 409 },
  );
}

export function sessionProjectionResponse(
  record: LinkedDeviceSessionRecordV1,
  outcome: 'applied' | 'replayed',
): Response {
  return json({ ok: true, outcome, session: projectSession(record) }, { status: 200 });
}

export function targetCredentialResultResponse(
  record: LinkedDeviceSessionRecordV1,
  outcome: 'applied' | 'replayed',
  targetCredential: LinkedDeviceTargetCredentialRegistrationResultV1,
): Response {
  return json(
    { ok: true, outcome, targetCredential, session: projectSession(record) },
    { status: 200 },
  );
}

export function exportRootWriteResponse(result: {
  readonly outcome: 'applied' | 'replayed' | 'conflict';
  readonly reason?: string;
}): Response {
  return result.outcome === 'conflict'
    ? json(
        { ok: false, code: result.reason ?? 'conflict', message: 'export-root relay conflict' },
        { status: 409 },
      )
    : json({ ok: true, outcome: result.outcome }, { status: 200 });
}

export function invalidInputResponse(message: string): Response {
  return json(
    { ok: false, outcome: 'invalid_input', code: 'invalid_input', message },
    { status: 400 },
  );
}

export function notSupportedResponse(message = 'Device linking is not configured'): Response {
  return json({ ok: false, code: 'not_supported', message }, { status: 501 });
}

export function notFoundResponse(): Response {
  return json(
    { ok: false, code: 'not_found', message: 'Linked-device session not found' },
    { status: 404 },
  );
}

export function methodNotAllowedResponse(): Response {
  return json(
    { ok: false, code: 'method_not_allowed', message: 'Method is not allowed' },
    { status: 405 },
  );
}

export function authDeniedResponse(result: DeviceLinkingAuthDeniedV1): Response {
  if (result.code === 'unavailable') {
    return json({ ok: false, code: result.code, message: result.message }, { status: 503 });
  }
  return json(
    { ok: false, outcome: 'unauthorized', code: result.code, message: result.message },
    { status: result.code === 'expired' ? 410 : 401 },
  );
}


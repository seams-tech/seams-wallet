import { expect, test } from '@playwright/test';
import { base64UrlEncode } from '@shared/utils/base64';
import { DeviceLinkingError, DeviceLinkingErrorCode } from '@/core/types/linkDevice';
import {
  classifyLinkDeviceFlowEvent,
  createLinkDeviceFlowEvent,
  LinkDeviceEventPhase,
} from '@/core/types/sdkSentEvents';
import { validateQrLinkedDeviceSessionPayloadV5 } from '../../../packages/mpc-wallet/src/SeamsWeb/operations/devices/scanDevice';

/**
 * The nine device-linking codes, as the app receives them on `DeviceLinkingError.code` and on
 * a failed link event. Six are produced today; nothing produces the three marked `unused`.
 */
const DEVICE_LINKING_CODES = {
  INVALID_QR_DATA: 'produced',
  ACCOUNT_NOT_OWNED: 'unused',
  AUTHORIZATION_TIMEOUT: 'unused',
  INSUFFICIENT_BALANCE: 'unused',
  REGISTRATION_FAILED: 'produced',
  WALLET_UNLOCK_REQUIRED: 'produced',
  DELIVERY_RECOVERY_REQUIRED: 'produced',
  SESSION_EXPIRED: 'produced',
  UNSUPPORTED: 'produced',
} as const;

const PUBLIC_KEY_B64U = base64UrlEncode(new Uint8Array(32).fill(4));

function qrPayload(times: { issuedAtMs: number; expiresAtMs: number }) {
  return {
    version: 'v5',
    purpose: 'linked_device_lane_creation',
    linkSessionId: 'link-session:conformance',
    linkPublicKeyB64u: PUBLIC_KEY_B64U,
    devicePublicKeyB64u: PUBLIC_KEY_B64U,
    requestedPermission: {
      kind: 'delegated_wallet_authority_v1',
      permissions: ['sign', 'link_devices'],
    },
    targetFactor: { kind: 'passkey_prf' },
    ...times,
  };
}

function refusal(raw: unknown): { code: string; phase: string } | 'accepted' {
  try {
    validateQrLinkedDeviceSessionPayloadV5(raw);
    return 'accepted';
  } catch (error) {
    if (!(error instanceof DeviceLinkingError)) throw error;
    return { code: error.code, phase: error.phase };
  }
}

test('the device-linking codes keep their wire strings', () => {
  expect(Object.values(DeviceLinkingErrorCode).sort()).toEqual(
    Object.keys(DEVICE_LINKING_CODES).sort(),
  );
  for (const code of Object.keys(DEVICE_LINKING_CODES)) {
    expect(DeviceLinkingErrorCode[code as keyof typeof DeviceLinkingErrorCode]).toBe(code);
  }
  expect(
    Object.entries(DEVICE_LINKING_CODES)
      .filter(([, use]) => use === 'unused')
      .map(([code]) => code),
  ).toEqual(['ACCOUNT_NOT_OWNED', 'AUTHORIZATION_TIMEOUT', 'INSUFFICIENT_BALANCE']);
});

test('a scanned QR code is refused with INVALID_QR_DATA or SESSION_EXPIRED', () => {
  const now = Date.now();
  expect(refusal(qrPayload({ issuedAtMs: now - 1_000, expiresAtMs: now + 600_000 }))).toBe(
    'accepted',
  );
  expect(refusal({ version: 'v4' })).toEqual({ code: 'INVALID_QR_DATA', phase: 'authorization' });
  // A code from the future is refused as invalid, past the allowed clock skew.
  expect(
    refusal(qrPayload({ issuedAtMs: now + 3_600_000, expiresAtMs: now + 4_000_000 })),
  ).toEqual({ code: 'INVALID_QR_DATA', phase: 'authorization' });
  expect(refusal(qrPayload({ issuedAtMs: now - 600_000, expiresAtMs: now - 1_000 }))).toEqual({
    code: 'SESSION_EXPIRED',
    phase: 'authorization',
  });
});

test('a failed link event carries the code to the app', () => {
  const event = createLinkDeviceFlowEvent({
    flowId: 'link-session:conformance',
    phase: LinkDeviceEventPhase.FAILED,
    status: 'failed',
    error: { code: DeviceLinkingErrorCode.SESSION_EXPIRED, message: 'QR code expired' },
  });
  expect(classifyLinkDeviceFlowEvent(event)).toEqual({ kind: 'failed' });
  expect(event.error).toEqual({ code: 'SESSION_EXPIRED', message: 'QR code expired' });
  expect(event.interaction).toEqual({ kind: 'none', overlay: 'hide' });
});

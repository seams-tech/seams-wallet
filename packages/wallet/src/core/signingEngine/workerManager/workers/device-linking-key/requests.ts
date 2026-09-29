// The worker's request and response messages, and the parsing every request goes through.
import {
  LINKED_DEVICE_REQUEST_PROOF_MAX_TTL_MS_V1,
  LINKED_DEVICE_REQUEST_PROOF_NONCE_BYTES_V1,
  parseLinkedDeviceEmailOtpFactorReleaseEnvelopeV1,
  parseLinkedDeviceEmailOtpVerificationGrantV1,
  parseLinkedDeviceWalletSessionCredentialDeliveryV1,
  parseLinkedDeviceWalletSessionCredentialDeliveryBindingV1,
  type LinkedDeviceEmailOtpFactorReleaseEnvelopeV1,
  type LinkedDeviceEmailOtpVerificationGrantV1,
  type LinkedDeviceWalletSessionCredentialDeliveryV1,
  type LinkedDeviceWalletSessionCredentialDeliveryBindingV1,
  type WalletSessionOperationCredentialV1,
  type LinkDevicePublicKeyB64u,
} from '@shared/device-linking';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { parseDigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  parseMpcWalletSigningQuotaId,
  parseWalletSessionAuthorizationId,
  parseWalletSessionId,
  type MpcWalletSigningQuotaId,
  type WalletSessionAuthorizationId,
  type WalletSessionId,
} from '@shared/authorization/capabilityKinds';
import {
  parseWalletAuthMethodId,
  parseWalletAuthorityId,
  parseWalletId,
  type WalletAuthMethodId,
  type WalletAuthorityId,
  type WalletId,
} from '@shared/utils/domainIds';
import {
  parseLinkedDeviceEnrollmentId,
  parseLinkedDeviceId,
  parseLinkDeviceSessionId,
  type LinkedDeviceEnrollmentId,
  type LinkedDeviceId,
  type LinkDeviceSessionId,
} from '@shared/signing-lanes/ids';
import { isPlainObject, requireCanonicalString } from '@shared/utils/validation';
import {
  parseOrdinaryMaterialWorkerPrivateRequestV1,
  parseOrdinaryMaterialWorkerRequestV1,
  type DeviceLinkingOrdinaryMaterialWorkerPrivateRequestV1,
  type DeviceLinkingOrdinarySignerMaterialRecipientPreparationV1,
  type DeviceLinkingOrdinaryMaterialWorkerRequestV1,
  type DeviceLinkingOrdinaryTargetFactorBindingV1,
  type DeviceLinkingOrdinarySignerMaterialReservationPreparationV1,
  type SealedLocalAuthorityMaterialSetV1,
} from '../../deviceLinkingPorts';

export type DeviceLinkingKeyWorkerRequestV1 =
  | { readonly kind: 'device_linking_key_material_create_v1' }
  | DeviceLinkingOrdinaryMaterialWorkerRequestV1
  | DeviceLinkingOrdinaryMaterialWorkerPrivateRequestV1
  | {
      readonly kind: 'device_linking_email_otp_export_root_recipient_create_v1';
      readonly handleId: string;
    }
  | {
      readonly kind: 'device_linking_request_sign_v1';
      readonly handleId: string;
      readonly linkSessionId: LinkDeviceSessionId;
      readonly method: 'GET' | 'POST';
      readonly canonicalPath: string;
      readonly bodyDigestB64u: DigestB64u;
      readonly devicePublicKeyDigestB64u: DigestB64u;
      readonly challengeB64u: string;
      readonly issuedAtMs: number;
      readonly expiresAtMs: number;
    }
  | {
      readonly kind: 'device_linking_email_otp_factor_release_open_v1';
      readonly handleId: string;
      readonly walletId: WalletId;
      readonly linkSessionId: LinkDeviceSessionId;
      readonly enrollmentId: LinkedDeviceEnrollmentId;
      readonly deviceId: LinkedDeviceId;
      readonly walletAuthMethodId: WalletAuthMethodId;
      readonly baseWalletAuthMethodId: WalletAuthMethodId;
      readonly targetPreparationDigestB64u: DigestB64u;
      readonly expectedChallengeId: string;
      readonly verificationGrant: LinkedDeviceEmailOtpVerificationGrantV1;
      readonly factorRelease: LinkedDeviceEmailOtpFactorReleaseEnvelopeV1;
    }
  | {
      readonly kind: 'device_linking_wallet_session_credential_delivery_open_v1';
      readonly handleId: string;
      readonly delivery: LinkedDeviceWalletSessionCredentialDeliveryV1;
      readonly expected: {
        readonly linkSessionId: LinkDeviceSessionId;
        readonly walletId: WalletId;
        readonly authorityId: WalletAuthorityId;
        readonly walletAuthMethodId: WalletAuthMethodId;
        readonly authorizationId: WalletSessionAuthorizationId;
        readonly walletSessionId: WalletSessionId;
        readonly quotaId: MpcWalletSigningQuotaId;
        readonly deliveryBinding: LinkedDeviceWalletSessionCredentialDeliveryBindingV1;
        readonly credentialDigestB64u: DigestB64u;
        readonly installationReceiptDigestB64u: DigestB64u;
        readonly recipientPublicKey65B64u: string;
        readonly issuedAtMs: number;
        readonly expiresAtMs: number;
      };
    }
  | {
      readonly kind: 'device_linking_key_material_discard_v1';
      readonly handleId: string;
    };

export type DeviceLinkingKeyWorkerResponseV1 =
  | SealedLocalAuthorityMaterialSetV1
  | (DeviceLinkingOrdinarySignerMaterialRecipientPreparationV1 & {
      readonly kind: 'device_linking_ordinary_signer_material_recipient_preparation_v1';
    })
  | {
      readonly kind: 'device_linking_ordinary_signer_material_preparation_v1';
      readonly targetFactor: DeviceLinkingOrdinaryTargetFactorBindingV1;
      readonly preparations: readonly [
        DeviceLinkingOrdinarySignerMaterialReservationPreparationV1,
        ...DeviceLinkingOrdinarySignerMaterialReservationPreparationV1[],
      ];
    }
  | {
      readonly kind: 'device_linking_email_otp_factor_release_result_v1';
      readonly verificationGrant: LinkedDeviceEmailOtpVerificationGrantV1;
      readonly factorSecret: ArrayBuffer;
    }
  | WalletSessionOperationCredentialV1
  | {
      readonly handleId: string;
      readonly linkPublicKeyB64u: LinkDevicePublicKeyB64u;
      readonly devicePublicKeyB64u: LinkDevicePublicKeyB64u;
      readonly deliveryRecipientPublicKey65B64u: string;
    }
  | { readonly recipientPublicKeyB64u: string }
  | { readonly signatureB64u: string };

type DeviceLinkingKeyWorkerFrameV1 = {
  readonly id: string;
  readonly request: unknown;
};

type DeviceLinkingSignRequestRecordV1 = {
  readonly kind: unknown;
  readonly handleId: unknown;
  readonly linkSessionId: unknown;
  readonly method: unknown;
  readonly canonicalPath: unknown;
  readonly bodyDigestB64u: unknown;
  readonly devicePublicKeyDigestB64u: unknown;
  readonly challengeB64u: unknown;
  readonly issuedAtMs: unknown;
  readonly expiresAtMs: unknown;
};

function isDeviceLinkingSignRequestRecordV1(
  value: unknown,
): value is DeviceLinkingSignRequestRecordV1 {
  return hasExactKeys(
    value,
    'bodyDigestB64u|canonicalPath|challengeB64u|devicePublicKeyDigestB64u|expiresAtMs|handleId|issuedAtMs|kind|linkSessionId|method',
  );
}

type DeviceLinkingCreateRequestRecordV1 = {
  readonly kind: unknown;
};

function isDeviceLinkingCreateRequestRecordV1(
  value: unknown,
): value is DeviceLinkingCreateRequestRecordV1 {
  return hasExactKeys(value, 'kind');
}

type DeviceLinkingHandleRequestRecordV1 = {
  readonly kind: unknown;
  readonly handleId: unknown;
};

function isDeviceLinkingHandleRequestRecordV1(
  value: unknown,
): value is DeviceLinkingHandleRequestRecordV1 {
  return hasExactKeys(value, 'handleId|kind');
}

type DeviceLinkingEmailOtpFactorReleaseRequestRecordV1 = {
  readonly kind: unknown;
  readonly handleId: unknown;
  readonly walletId: unknown;
  readonly linkSessionId: unknown;
  readonly enrollmentId: unknown;
  readonly deviceId: unknown;
  readonly walletAuthMethodId: unknown;
  readonly baseWalletAuthMethodId: unknown;
  readonly targetPreparationDigestB64u: unknown;
  readonly expectedChallengeId: unknown;
  readonly verificationGrant: unknown;
  readonly factorRelease: unknown;
};

function isDeviceLinkingEmailOtpFactorReleaseRequestRecordV1(
  value: unknown,
): value is DeviceLinkingEmailOtpFactorReleaseRequestRecordV1 {
  return hasExactKeys(
    value,
    'baseWalletAuthMethodId|deviceId|enrollmentId|expectedChallengeId|factorRelease|handleId|kind|linkSessionId|targetPreparationDigestB64u|verificationGrant|walletAuthMethodId|walletId',
  );
}

type DeviceLinkingWalletSessionDeliveryRequestRecordV1 = {
  readonly kind: unknown;
  readonly handleId: unknown;
  readonly delivery: unknown;
  readonly expected: unknown;
};

function isDeviceLinkingWalletSessionDeliveryRequestRecordV1(
  value: unknown,
): value is DeviceLinkingWalletSessionDeliveryRequestRecordV1 {
  return hasExactKeys(value, 'delivery|expected|handleId|kind');
}

type DeviceLinkingWalletSessionExpectedRecordV1 = {
  readonly linkSessionId: unknown;
  readonly walletId: unknown;
  readonly authorityId: unknown;
  readonly walletAuthMethodId: unknown;
  readonly authorizationId: unknown;
  readonly walletSessionId: unknown;
  readonly quotaId: unknown;
  readonly deliveryBinding: unknown;
  readonly credentialDigestB64u: unknown;
  readonly installationReceiptDigestB64u: unknown;
  readonly recipientPublicKey65B64u: unknown;
  readonly issuedAtMs: unknown;
  readonly expiresAtMs: unknown;
};

function isDeviceLinkingWalletSessionExpectedRecordV1(
  value: unknown,
): value is DeviceLinkingWalletSessionExpectedRecordV1 {
  return hasExactKeys(
    value,
    'authorityId|authorizationId|credentialDigestB64u|deliveryBinding|expiresAtMs|installationReceiptDigestB64u|issuedAtMs|linkSessionId|quotaId|recipientPublicKey65B64u|walletAuthMethodId|walletId|walletSessionId',
  );
}

type DeviceLinkingWorkerFrameRecordV1 = {
  readonly id: unknown;
  readonly request: unknown;
};

function isDeviceLinkingWorkerFrameRecordV1(
  value: unknown,
): value is DeviceLinkingWorkerFrameRecordV1 {
  return hasExactKeys(value, 'id|request');
}

// A plain object whose own keys, sorted and joined with `|`, are exactly `sortedKeys`.
function hasExactKeys(value: unknown, sortedKeys: string): boolean {
  return isPlainObject(value) && Object.keys(value).sort().join('|') === sortedKeys;
}

function parseHandleId(value: unknown): string {
  const handleId = requireCanonicalString(value, 'handleId', 'is required');
  if (handleId.length > 256) throw new Error('handleId is too long');
  return handleId;
}

function parseFixedBase64Url(value: unknown, length: number, label: string): string {
  const encoded = requireCanonicalString(value, label, 'is required');
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error(`${label} is invalid`);
  let bytes: Uint8Array;
  try {
    bytes = base64UrlDecode(encoded);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (bytes.length !== length || base64UrlEncode(bytes) !== encoded) {
    bytes.fill(0);
    throw new Error(`${label} must be canonical base64url`);
  }
  bytes.fill(0);
  return encoded;
}

function parseDigest(value: unknown, label: string): DigestB64u {
  try {
    return parseDigestB64u(value);
  } catch (error) {
    throw new Error(`${label} ${error instanceof Error ? error.message : 'is invalid'}`);
  }
}

function parseSessionId(value: unknown): LinkDeviceSessionId {
  const parsed = parseLinkDeviceSessionId(value);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

function parseCanonicalPath(value: unknown): string {
  const path = requireCanonicalString(value, 'canonicalPath', 'is required');
  if (!path.startsWith('/') || path.includes('?') || path.includes('#')) {
    throw new Error('canonicalPath is invalid');
  }
  return path;
}

function parseTimestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} is invalid`);
  }
  return Number(value);
}

function parseSignRequest(value: unknown): {
  readonly handleId: string;
  readonly linkSessionId: LinkDeviceSessionId;
  readonly method: 'GET' | 'POST';
  readonly canonicalPath: string;
  readonly bodyDigestB64u: DigestB64u;
  readonly devicePublicKeyDigestB64u: DigestB64u;
  readonly challengeB64u: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
} {
  if (!isDeviceLinkingSignRequestRecordV1(value)) {
    throw new Error('device-linking sign request has invalid fields');
  }
  if (value.kind !== 'device_linking_request_sign_v1') {
    throw new Error('device-linking sign request kind is invalid');
  }
  const issuedAtMs = parseTimestamp(value.issuedAtMs, 'issuedAtMs');
  const expiresAtMs = parseTimestamp(value.expiresAtMs, 'expiresAtMs');
  if (expiresAtMs <= issuedAtMs) throw new Error('expiresAtMs must be after issuedAtMs');
  if (expiresAtMs - issuedAtMs > LINKED_DEVICE_REQUEST_PROOF_MAX_TTL_MS_V1) {
    throw new Error('request proof lifetime exceeds the maximum');
  }
  if (value.method !== 'GET' && value.method !== 'POST') throw new Error('method is invalid');
  return {
    handleId: parseHandleId(value.handleId),
    linkSessionId: parseSessionId(value.linkSessionId),
    method: value.method,
    canonicalPath: parseCanonicalPath(value.canonicalPath),
    bodyDigestB64u: parseDigest(value.bodyDigestB64u, 'bodyDigestB64u'),
    devicePublicKeyDigestB64u: parseDigest(
      value.devicePublicKeyDigestB64u,
      'devicePublicKeyDigestB64u',
    ),
    challengeB64u: parseFixedBase64Url(
      value.challengeB64u,
      LINKED_DEVICE_REQUEST_PROOF_NONCE_BYTES_V1,
      'challengeB64u',
    ),
    issuedAtMs,
    expiresAtMs,
  };
}

export function parseFrame(value: unknown): DeviceLinkingKeyWorkerFrameV1 {
  if (!isDeviceLinkingWorkerFrameRecordV1(value)) {
    throw new Error('device-linking worker frame has invalid fields');
  }
  const frame = value;
  return {
    id: requireCanonicalString(frame.id, 'device-linking worker frame.id', 'is required'),
    request: frame.request,
  };
}

export function parseRequest(value: unknown): DeviceLinkingKeyWorkerRequestV1 {
  if (isDeviceLinkingCreateRequestRecordV1(value)) {
    if (value.kind !== 'device_linking_key_material_create_v1') {
      throw new Error('device-linking worker request kind is unsupported');
    }
    return { kind: 'device_linking_key_material_create_v1' };
  }
  if (
    isDeviceLinkingHandleRequestRecordV1(value) &&
    value.kind === 'device_linking_key_material_discard_v1'
  ) {
    return {
      kind: 'device_linking_key_material_discard_v1',
      handleId: parseHandleId(value.handleId),
    };
  }
  if (
    isPlainObject(value) &&
    'kind' in value &&
    value.kind === 'device_linking_ordinary_signer_material_prepare_private_v1'
  ) {
    const factorSecret =
      'factorSecret' in value && value.factorSecret instanceof ArrayBuffer
        ? new Uint8Array(value.factorSecret)
        : null;
    try {
      return parseOrdinaryMaterialWorkerPrivateRequestV1(value);
    } catch (error) {
      factorSecret?.fill(0);
      zeroizeRawOrdinaryRecipientInputs(
        'recipientInputs' in value ? value.recipientInputs : undefined,
      );
      throw error;
    }
  }
  if (
    isPlainObject(value) &&
    'kind' in value &&
    (value.kind === 'device_linking_ordinary_signer_material_recipient_prepare_v1' ||
      value.kind === 'device_linking_ordinary_signer_material_seal_v1')
  ) {
    const factorSecret =
      'factorSecret' in value && value.factorSecret instanceof ArrayBuffer
        ? new Uint8Array(value.factorSecret)
        : null;
    try {
      return parseOrdinaryMaterialWorkerRequestV1(value);
    } catch (error) {
      factorSecret?.fill(0);
      throw error;
    }
  }
  if (
    isDeviceLinkingHandleRequestRecordV1(value) &&
    value.kind === 'device_linking_email_otp_export_root_recipient_create_v1'
  ) {
    return {
      kind: 'device_linking_email_otp_export_root_recipient_create_v1',
      handleId: parseHandleId(value.handleId),
    };
  }
  if (isDeviceLinkingSignRequestRecordV1(value)) {
    const parsed = parseSignRequest(value);
    return { kind: 'device_linking_request_sign_v1', ...parsed };
  }
  if (isDeviceLinkingEmailOtpFactorReleaseRequestRecordV1(value)) {
    if (value.kind !== 'device_linking_email_otp_factor_release_open_v1') {
      throw new Error('device-linking worker request kind is unsupported');
    }
    const walletId = parseWalletId(value.walletId);
    if (!walletId.ok) throw new Error(walletId.error.message);
    const linkSessionId = parseLinkDeviceSessionId(value.linkSessionId);
    if (!linkSessionId.ok) throw new Error(linkSessionId.error.message);
    const enrollmentId = parseLinkedDeviceEnrollmentId(value.enrollmentId);
    if (!enrollmentId.ok) throw new Error(enrollmentId.error.message);
    const deviceId = parseLinkedDeviceId(value.deviceId);
    if (!deviceId.ok) throw new Error(deviceId.error.message);
    const walletAuthMethodId = parseWalletAuthMethodId(value.walletAuthMethodId);
    if (!walletAuthMethodId.ok) throw new Error(walletAuthMethodId.error.message);
    const baseWalletAuthMethodId = parseWalletAuthMethodId(value.baseWalletAuthMethodId);
    if (!baseWalletAuthMethodId.ok) throw new Error(baseWalletAuthMethodId.error.message);
    return {
      kind: 'device_linking_email_otp_factor_release_open_v1',
      handleId: parseHandleId(value.handleId),
      walletId: walletId.value,
      linkSessionId: linkSessionId.value,
      enrollmentId: enrollmentId.value,
      deviceId: deviceId.value,
      walletAuthMethodId: walletAuthMethodId.value,
      baseWalletAuthMethodId: baseWalletAuthMethodId.value,
      targetPreparationDigestB64u: parseDigest(
        value.targetPreparationDigestB64u,
        'targetPreparationDigestB64u',
      ),
      expectedChallengeId: requireCanonicalString(
        value.expectedChallengeId,
        'expectedChallengeId',
        'is required',
      ),
      verificationGrant: parseLinkedDeviceEmailOtpVerificationGrantV1(value.verificationGrant),
      factorRelease: parseLinkedDeviceEmailOtpFactorReleaseEnvelopeV1(value.factorRelease),
    };
  }
  if (isDeviceLinkingWalletSessionDeliveryRequestRecordV1(value)) {
    if (value.kind !== 'device_linking_wallet_session_credential_delivery_open_v1') {
      throw new Error('device-linking worker request kind is unsupported');
    }
    if (!isDeviceLinkingWalletSessionExpectedRecordV1(value.expected)) {
      throw new Error(
        'device-linking Wallet Session credential delivery expected identity has invalid fields',
      );
    }
    const expected = value.expected;
    const walletId = parseWalletId(expected.walletId);
    if (!walletId.ok) throw new Error(walletId.error.message);
    const authorityId = parseWalletAuthorityId(expected.authorityId);
    if (!authorityId.ok) throw new Error(authorityId.error.message);
    const walletAuthMethodId = parseWalletAuthMethodId(expected.walletAuthMethodId);
    if (!walletAuthMethodId.ok) throw new Error(walletAuthMethodId.error.message);
    const authorizationId = parseWalletSessionAuthorizationId(expected.authorizationId);
    if (!authorizationId.ok) throw new Error(authorizationId.error.message);
    const walletSessionId = parseWalletSessionId(expected.walletSessionId);
    if (!walletSessionId.ok) throw new Error(walletSessionId.error.message);
    const quotaId = parseMpcWalletSigningQuotaId(expected.quotaId);
    if (!quotaId.ok) throw new Error(quotaId.error.message);
    const linkSessionId = parseLinkDeviceSessionId(expected.linkSessionId);
    if (!linkSessionId.ok) throw new Error(linkSessionId.error.message);
    const credentialDigestB64u = parseDigest(expected.credentialDigestB64u, 'credentialDigestB64u');
    const installationReceiptDigestB64u = parseDigest(
      expected.installationReceiptDigestB64u,
      'installationReceiptDigestB64u',
    );
    const issuedAtMs = parseTimestamp(expected.issuedAtMs, 'issuedAtMs');
    const expiresAtMs = parseTimestamp(expected.expiresAtMs, 'expiresAtMs');
    if (expiresAtMs <= issuedAtMs) throw new Error('expiresAtMs must be after issuedAtMs');
    return {
      kind: 'device_linking_wallet_session_credential_delivery_open_v1',
      handleId: parseHandleId(value.handleId),
      delivery: parseLinkedDeviceWalletSessionCredentialDeliveryV1(value.delivery),
      expected: {
        linkSessionId: linkSessionId.value,
        walletId: walletId.value,
        authorityId: authorityId.value,
        walletAuthMethodId: walletAuthMethodId.value,
        authorizationId: authorizationId.value,
        walletSessionId: walletSessionId.value,
        quotaId: quotaId.value,
        deliveryBinding: parseLinkedDeviceWalletSessionCredentialDeliveryBindingV1(
          expected.deliveryBinding,
        ),
        credentialDigestB64u,
        installationReceiptDigestB64u,
        recipientPublicKey65B64u: parseFixedBase64Url(
          expected.recipientPublicKey65B64u,
          65,
          'recipientPublicKey65B64u',
        ),
        issuedAtMs,
        expiresAtMs,
      },
    };
  }
  throw new Error('device-linking worker request kind is unsupported');
}

function zeroizeRawOrdinaryRecipientInputs(value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    if (!isPlainObject(entry)) continue;
    const privateKey =
      'recipientPrivateKey' in entry && entry.recipientPrivateKey instanceof ArrayBuffer
        ? entry.recipientPrivateKey
        : 'clientEphemeralPrivateKey' in entry &&
            entry.clientEphemeralPrivateKey instanceof ArrayBuffer
          ? entry.clientEphemeralPrivateKey
          : null;
    if (privateKey) new Uint8Array(privateKey).fill(0);
  }
}

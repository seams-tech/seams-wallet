import type {
  LinkSessionProjectionV1,
  LinkSessionTransportEventV1,
  LinkedDeviceTargetCredentialRegistrationResultV1,
  LinkDevicePublicKeyB64u,
  QrLinkedDeviceSessionPayloadV5,
  LocalAuthorityActivationFinalAckV1,
  LinkedDeviceTargetPreparationRequestV1,
} from '@shared/device-linking';
import {
  parseActivateInstalledAuthorityResultV1,
  parseCommittedAuthorityPackagesV1,
  parseLocalAuthorityActivationFinalAckV1,
  parseLocalAuthorityInstallationReceiptV1,
  parseLinkedDeviceApprovalDeliveryV1,
  parseLinkedDeviceEmailOtpChallengeResultV1,
  parseLinkedDeviceEmailOtpChallengeResendRequestV1,
  parseLinkedDeviceEmailOtpChallengeStartRequestV1,
  parseLinkedDeviceEmailOtpChallengeVerifyRequestV1,
  parseLinkedDeviceEmailOtpVerificationResultV1,
  parseLinkSessionProjectionV1,
  parseLinkSessionTransportEventV1,
  parseLinkedDeviceTargetCredentialRegistrationResultV1,
  parseLinkedDeviceTargetPreparationV1,
  parseLinkedDeviceTargetPreparationRequestV1,
  parseWalletSessionOperationCredentialV1,
} from '@shared/device-linking';
import {
  computeLinkedDevicePublicKeyDigestV1,
  LINKED_DEVICE_REQUEST_PROOF_HEADER_V1,
  LINKED_DEVICE_REQUEST_PROOF_MAX_TTL_MS_V1,
  LINKED_DEVICE_REQUEST_PROOF_NONCE_BYTES_V1,
  type LinkedDeviceRequestProofV1,
} from '@shared/device-linking';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import { base64UrlEncode } from '@shared/utils/base64';
import { sha256Bytes } from '@shared/utils/digests';
import { secureRandomBase64Url } from '@shared/utils/secureRandomId';
import { parseLinkDeviceSessionId, type LinkDeviceSessionId } from '@shared/signing-lanes/ids';
import { parseLinkedDeviceEd25519ExportRootPackageV1 } from '@shared/device-linking/ed25519ExportRoot';
import type { HttpTransport } from '@/core/platform/http';
import type {
  DeviceLinkingAuthenticatedTransportPortV1,
  DeviceLinkingAuthorityActivationTransportPortV1,
  DeviceLinkingKeyMaterialHandleV1,
  DeviceLinkingKeyMaterialPortV1,
  DeviceLinkingWalletSessionAcknowledgementReplayPortV1,
  LinkSessionSnapshotV1,
  LinkSessionSubscriptionV1,
  LinkSessionOwnerTransportPortV1,
  LinkSessionTransportPortV1,
} from './deviceLinkingPorts';

export const LINKED_DEVICE_SESSION_HTTP_BASE_PATH_V1 = '/wallet/device-linking/v1/sessions';

const LINKED_DEVICE_POLL_MAX_DELAY_MS = 4_000;
const LINKED_DEVICE_COMMITTED_PACKAGES_WAIT_TIMEOUT_MS = 60_000;

type PlainDeviceLinkingResponse = { readonly [key: string]: unknown };

const SESSION_MUTATION_RESPONSE_FIELDS = ['ok', 'outcome', 'session'] as const;
const TARGET_CREDENTIAL_RESPONSE_FIELDS = ['ok', 'outcome', 'session', 'targetCredential'] as const;
const CODED_FAILURE_RESPONSE_FIELDS = ['ok', 'code', 'message'] as const;
const OUTCOME_FAILURE_RESPONSE_FIELDS = ['ok', 'outcome', 'code', 'message'] as const;
const SESSION_CONFLICT_FAILURE_FIELDS = [
  'ok',
  'outcome',
  'expectedRevision',
  'actualRevision',
  'session',
] as const;
const SESSION_EXPIRED_FAILURE_FIELDS = ['ok', 'outcome', 'session'] as const;
const SESSION_INVALID_STATE_FAILURE_FIELDS = ['ok', 'outcome', 'state', 'session'] as const;
const SESSION_INTEGRITY_FAILURE_FIELDS = ['ok', 'outcome', 'reason', 'session'] as const;

/** Keep long-lived session polling responsive without creating a tight request loop. */
export function nextLinkedDevicePollingDelayMsV1(baseDelayMs: number, attempt: number): number {
  const boundedBaseDelayMs = Math.min(baseDelayMs, LINKED_DEVICE_POLL_MAX_DELAY_MS);
  const boundedAttempt = Math.min(Math.max(attempt, 0), 5);
  const exponentialDelayMs = Math.min(
    LINKED_DEVICE_POLL_MAX_DELAY_MS,
    boundedBaseDelayMs * 2 ** boundedAttempt,
  );
  const jitterWindowMs = Math.max(1, Math.min(boundedBaseDelayMs, exponentialDelayMs / 4));
  const jitterMs = Math.floor(Math.random() * jitterWindowMs);
  return Math.min(LINKED_DEVICE_POLL_MAX_DELAY_MS, exponentialDelayMs + jitterMs);
}

async function waitForCommittedAuthorityPackagesV1(input: {
  readonly options: DeviceLinkingAuthenticatedSessionTransportOptionsV1;
  readonly baseUrl: string;
  readonly linkSessionId: LinkDeviceSessionId;
}): Promise<ReturnType<typeof parseCommittedAuthorityPackagesV1>> {
  const deadlineMs = input.options.nowMs() + LINKED_DEVICE_COMMITTED_PACKAGES_WAIT_TIMEOUT_MS;
  let attempt = 0;
  while (input.options.nowMs() < deadlineMs) {
    const response = await requestDeviceV1({
      options: input.options,
      baseUrl: input.baseUrl,
      method: 'GET',
      canonicalPath: sessionActionPath(input.linkSessionId, 'approval'),
      linkSessionId: input.linkSessionId,
    });
    if (response.status !== 204) return parseCommittedAuthorityPackagesV1(response.body);
    const delayMs = nextLinkedDevicePollingDelayMsV1(input.options.pollIntervalMs, attempt);
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    attempt += 1;
  }
  throw new Error('committed authority packages were not ready before the activation deadline');
}

export type DeviceLinkingAuthenticatedSessionTransportOptionsV1 = {
  readonly http: HttpTransport;
  readonly relayerUrl: string;
  readonly publishableKey: string;
  readonly projectEnvironmentId: string;
  readonly keyMaterial: DeviceLinkingKeyMaterialPortV1;
  readonly keyMaterialHandle: DeviceLinkingKeyMaterialHandleV1;
  readonly devicePublicKeyB64u: LinkDevicePublicKeyB64u;
  readonly nowMs: () => number;
  readonly pollIntervalMs: number;
};

export type DeviceLinkingSessionTransportAssemblyOptionsV1 = {
  readonly owner: LinkSessionOwnerTransportPortV1;
  readonly http: HttpTransport;
  readonly relayerUrl: string;
  readonly publishableKey: string;
  readonly projectEnvironmentId: string;
  readonly keyMaterial: DeviceLinkingKeyMaterialPortV1;
  readonly nowMs: () => number;
  readonly pollIntervalMs: number;
};

export type DeviceLinkingWalletSessionAcknowledgementTransportOptionsV1 = {
  readonly http: HttpTransport;
  readonly relayerUrl: string;
  readonly projectEnvironmentId: string;
};

type SessionMutationEnvelopeV1 = {
  readonly ok: true;
  readonly outcome: 'applied' | 'replayed';
  readonly session: LinkSessionProjectionV1;
};

type DeviceRequestResponseV1 = {
  readonly status: number;
  readonly body: unknown;
};

export function createDeviceLinkingAuthenticatedSessionTransportV1(
  options: DeviceLinkingAuthenticatedSessionTransportOptionsV1,
): DeviceLinkingAuthenticatedTransportPortV1 {
  const baseUrl = normalizeBaseUrl(options.relayerUrl);
  if (!Number.isSafeInteger(options.pollIntervalMs) || options.pollIntervalMs <= 0) {
    throw new Error('linked-device session poll interval must be a positive integer');
  }
  return {
    ...createDeviceLinkingAuthorityActivationTransportV1(options),
    ...createDeviceLinkingWalletSessionAcknowledgementReplayPortV1(options),
    createUnclaimedSessionV1: async (input) => {
      await requestMutationV1({
        options,
        baseUrl,
        method: 'POST',
        canonicalPath: LINKED_DEVICE_SESSION_HTTP_BASE_PATH_V1,
        linkSessionId: input.payload.linkSessionId,
        body: {
          kind: 'linked_device_session_create_request_v1',
          payload: input.payload,
        },
      });
    },
    getSessionV1: async ({ linkSessionId }) =>
      await requestSessionV1({ options, baseUrl, linkSessionId }),
    getApprovalV1: async ({ linkSessionId }) => {
      const response = await requestDeviceV1({
        options,
        baseUrl,
        method: 'GET',
        canonicalPath: sessionActionPath(linkSessionId, 'approval'),
        linkSessionId,
      });
      return parseLinkedDeviceApprovalDeliveryV1(response.body).approval;
    },
    getTargetPreparationV1: async ({ linkSessionId, deliveryRecipientPublicKey65B64u }) => {
      const request: LinkedDeviceTargetPreparationRequestV1 =
        parseLinkedDeviceTargetPreparationRequestV1({
          kind: 'linked_device_target_preparation_request_v1',
          linkSessionId,
          deliveryRecipientPublicKey65B64u,
        });
      const response = await requestDeviceV1({
        options,
        baseUrl,
        method: 'POST',
        canonicalPath: sessionActionPath(linkSessionId, 'target-preparation'),
        linkSessionId,
        body: request,
      });
      return parseLinkedDeviceTargetPreparationV1(response.body);
    },
    startTargetEmailOtpChallengeV1: async ({ request }) => {
      const parsedRequest = parseLinkedDeviceEmailOtpChallengeStartRequestV1(request);
      const response = await requestDeviceV1({
        options,
        baseUrl,
        method: 'POST',
        canonicalPath: sessionActionPath(parsedRequest.linkSessionId, 'email-otp/challenge'),
        linkSessionId: parsedRequest.linkSessionId,
        body: parsedRequest,
      });
      return parseLinkedDeviceEmailOtpChallengeResultV1(response.body);
    },
    resendTargetEmailOtpChallengeV1: async ({ request }) => {
      const parsedRequest = parseLinkedDeviceEmailOtpChallengeResendRequestV1(request);
      const response = await requestDeviceV1({
        options,
        baseUrl,
        method: 'POST',
        canonicalPath: sessionActionPath(parsedRequest.linkSessionId, 'email-otp/challenge/resend'),
        linkSessionId: parsedRequest.linkSessionId,
        body: parsedRequest,
      });
      return parseLinkedDeviceEmailOtpChallengeResultV1(response.body);
    },
    verifyTargetEmailOtpChallengeV1: async ({ request }) => {
      const parsedRequest = parseLinkedDeviceEmailOtpChallengeVerifyRequestV1(request);
      const response = await requestDeviceV1({
        options,
        baseUrl,
        method: 'POST',
        canonicalPath: sessionActionPath(parsedRequest.linkSessionId, 'email-otp/challenge/verify'),
        linkSessionId: parsedRequest.linkSessionId,
        body: parsedRequest,
      });
      return parseLinkedDeviceEmailOtpVerificationResultV1(response.body);
    },
    registerTargetCredentialV1: async ({ registration }) => {
      const response = await requestDeviceV1({
        options,
        baseUrl,
        method: 'POST',
        canonicalPath: sessionActionPath(registration.linkSessionId, 'credential'),
        linkSessionId: registration.linkSessionId,
        body: registration,
      });
      return parseTargetCredentialRegistrationResponseV1(response.body);
    },
    registerEd25519ExportRootRecipientV1: async ({ recipient }) => {
      const linkSessionId = requireLinkSessionId(recipient.linkSessionId);
      await requestDeviceV1({
        options,
        baseUrl,
        method: 'POST',
        canonicalPath: sessionActionPath(linkSessionId, 'ed25519-export-root-recipient'),
        linkSessionId,
        body: recipient,
      });
    },
    getEd25519ExportRootPackageV1: async ({ linkSessionId }) => {
      const response = await requestDeviceV1({
        options,
        baseUrl,
        method: 'GET',
        canonicalPath: sessionActionPath(linkSessionId, 'ed25519-export-root'),
        linkSessionId,
      });
      // Device 1 has not sealed yet. Normal while the owner is approving.
      if (response.status === 204) return null;
      return parseLinkedDeviceEd25519ExportRootPackageV1(response.body);
    },
    retryCommittedDeliveryV1: async ({ request }) => {
      await requestMutationV1({
        options,
        baseUrl,
        method: 'POST',
        canonicalPath: sessionActionPath(request.linkSessionId, 'retry'),
        linkSessionId: request.linkSessionId,
        body: request,
      });
    },
    cancelSessionV1: async ({ request }) => {
      await requestMutationV1({
        options,
        baseUrl,
        method: 'POST',
        canonicalPath: sessionActionPath(request.linkSessionId, 'cancel'),
        linkSessionId: request.linkSessionId,
        body: request,
      });
    },
    subscribeSessionV1: async ({ linkSessionId, onEvent }) =>
      await createPollingSubscriptionV1({
        options,
        baseUrl,
        linkSessionId,
        onEvent,
      }),
  };
}

export function createDeviceLinkingWalletSessionAcknowledgementReplayPortV1(
  options: DeviceLinkingWalletSessionAcknowledgementTransportOptionsV1,
): DeviceLinkingWalletSessionAcknowledgementReplayPortV1 {
  const baseUrl = normalizeBaseUrl(options.relayerUrl);
  return {
    acknowledgeLocalAuthorityActivationWithWalletSessionV1: async ({
      acknowledgement,
      operationCredential,
    }) => {
      const parsedAcknowledgement = parseLocalAuthorityActivationFinalAckV1(acknowledgement);
      const parsedCredential = parseWalletSessionOperationCredentialV1(operationCredential);
      if (parsedCredential.walletSessionId !== parsedAcknowledgement.walletSessionId) {
        throw new Error('linked-device acknowledgement credential does not match Wallet Session');
      }
      await requestWalletSessionAcknowledgementV1({
        options,
        baseUrl,
        linkSessionId: parsedAcknowledgement.linkSessionId,
        token: parsedCredential.token,
        body: parsedAcknowledgement,
      });
    },
  };
}

export function createDeviceLinkingAuthorityActivationTransportV1(
  options: DeviceLinkingAuthenticatedSessionTransportOptionsV1,
): DeviceLinkingAuthorityActivationTransportPortV1 {
  const baseUrl = normalizeBaseUrl(options.relayerUrl);
  return {
    receiveCommittedAuthorityPackagesV1: async ({ linkSessionId }) =>
      await waitForCommittedAuthorityPackagesV1({ options, baseUrl, linkSessionId }),
    activateInstalledAuthorityV1: async ({ linkSessionId, receipt }) => {
      const parsedReceipt = parseLocalAuthorityInstallationReceiptV1(receipt);
      const response = await requestDeviceV1({
        options,
        baseUrl,
        method: 'POST',
        canonicalPath: sessionActionPath(linkSessionId, 'receipt'),
        linkSessionId,
        body: parsedReceipt,
      });
      return parseActivateInstalledAuthorityResultV1(response.body);
    },
    acknowledgeLocalAuthorityActivationV1: async ({ acknowledgement }) => {
      const parsedAcknowledgement = parseLocalAuthorityActivationFinalAckV1(acknowledgement);
      await requestDeviceV1({
        options,
        baseUrl,
        method: 'POST',
        canonicalPath: sessionActionPath(acknowledgement.linkSessionId, 'receipt'),
        linkSessionId: acknowledgement.linkSessionId,
        body: parsedAcknowledgement,
      });
    },
  };
}

/** Compose one direct transport port; owner auth remains an injected boundary. */
export function createDeviceLinkingSessionTransportPortV1(
  options: DeviceLinkingSessionTransportAssemblyOptionsV1,
): LinkSessionTransportPortV1 {
  return {
    ...options.owner,
    createAuthenticatedSessionTransportV1: ({ keyMaterial, devicePublicKeyB64u }) =>
      createDeviceLinkingAuthenticatedSessionTransportV1({
        http: options.http,
        relayerUrl: options.relayerUrl,
        publishableKey: options.publishableKey,
        projectEnvironmentId: options.projectEnvironmentId,
        keyMaterial: options.keyMaterial,
        keyMaterialHandle: keyMaterial,
        devicePublicKeyB64u,
        nowMs: options.nowMs,
        pollIntervalMs: options.pollIntervalMs,
      }),
  };
}

/**
 * The recipient registration carries its link session as a plain string,
 * because it is also the body the server parses. Re-parsing it here keeps the
 * signed canonical path derived from a branded id.
 */
function requireLinkSessionId(raw: string): LinkDeviceSessionId {
  const parsed = parseLinkDeviceSessionId(raw);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

async function requestSessionV1(input: {
  readonly options: DeviceLinkingAuthenticatedSessionTransportOptionsV1;
  readonly baseUrl: string;
  readonly linkSessionId: LinkDeviceSessionId;
}): Promise<LinkSessionSnapshotV1> {
  const response = await requestDeviceV1({
    options: input.options,
    baseUrl: input.baseUrl,
    method: 'GET',
    canonicalPath: sessionPath(input.linkSessionId),
    linkSessionId: input.linkSessionId,
  });
  return parseSessionMutationEnvelopeV1(response.body).session;
}

async function requestMutationV1(input: {
  readonly options: DeviceLinkingAuthenticatedSessionTransportOptionsV1;
  readonly baseUrl: string;
  readonly method: 'POST';
  readonly canonicalPath: string;
  readonly linkSessionId: LinkDeviceSessionId;
  readonly body: QrLinkedDeviceSessionPayloadV5 | object;
}): Promise<SessionMutationEnvelopeV1> {
  const response = await requestDeviceV1(input);
  return parseSessionMutationEnvelopeV1(response.body);
}

async function requestDeviceV1(input: {
  readonly options: DeviceLinkingAuthenticatedSessionTransportOptionsV1;
  readonly baseUrl: string;
  readonly method: 'GET' | 'POST';
  readonly canonicalPath: string;
  readonly linkSessionId: LinkDeviceSessionId;
  readonly body?: unknown;
}): Promise<DeviceRequestResponseV1> {
  const publishableKey = input.options.publishableKey.trim();
  const projectEnvironmentId = input.options.projectEnvironmentId.trim();
  if (!publishableKey || !projectEnvironmentId) {
    throw new Error('linked-device Passkey ceremony requires registration API credentials');
  }
  const bodyBytes = encodeRequestBodyV1(input.body);
  const bodyDigestB64u = parseDigestB64u(base64UrlEncode(await sha256Bytes(bodyBytes)));
  const issuedAtMs = input.options.nowMs();
  if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs <= 0) {
    throw new Error('linked-device request clock is invalid');
  }
  const expiresAtMs = issuedAtMs + LINKED_DEVICE_REQUEST_PROOF_MAX_TTL_MS_V1;
  const requestNonceB64u = secureRandomBase64Url(
    LINKED_DEVICE_REQUEST_PROOF_NONCE_BYTES_V1,
    'linked-device request proof nonce',
  );
  const devicePublicKeyDigestB64u = await computeLinkedDevicePublicKeyDigestV1(
    input.options.devicePublicKeyB64u,
  );
  const signed = await input.options.keyMaterial.signDeviceSessionRequestV1({
    handle: input.options.keyMaterialHandle,
    linkSessionId: input.linkSessionId,
    method: input.method,
    canonicalPath: input.canonicalPath,
    bodyDigestB64u,
    devicePublicKeyDigestB64u,
    challengeB64u: requestNonceB64u,
    issuedAtMs,
    expiresAtMs,
  });
  const proof: LinkedDeviceRequestProofV1 = {
    kind: 'linked_device_request_proof_v1',
    linkSessionId: input.linkSessionId,
    devicePublicKeyDigestB64u,
    requestNonceB64u,
    method: input.method,
    canonicalPath: input.canonicalPath,
    bodyDigestB64u,
    issuedAtMs,
    expiresAtMs,
    signatureB64u: signed.signatureB64u,
  };
  const proofHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(proof)));
  const response = await input.options.http.request({
    method: input.method,
    url: `${input.baseUrl}${input.canonicalPath}`,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${publishableKey}`,
      'Content-Type': 'application/json',
      'X-Seams-Environment-Id': projectEnvironmentId,
      [LINKED_DEVICE_REQUEST_PROOF_HEADER_V1]: proofHeader,
    },
    ...(input.body === undefined ? {} : { body: input.body }),
  });
  if (!response.ok) throw new Error(`linked-device request failed: ${response.message}`);
  if (response.value.status < 200 || response.value.status >= 300) {
    throw new Error(parseHttpFailureMessageV1(response.value));
  }
  return response.value;
}

async function requestWalletSessionAcknowledgementV1(input: {
  readonly options: DeviceLinkingWalletSessionAcknowledgementTransportOptionsV1;
  readonly baseUrl: string;
  readonly linkSessionId: LinkDeviceSessionId;
  readonly token: string;
  readonly body: LocalAuthorityActivationFinalAckV1;
}): Promise<void> {
  const token = input.token.trim();
  const projectEnvironmentId = input.options.projectEnvironmentId.trim();
  if (!token || !projectEnvironmentId) {
    throw new Error('linked-device Wallet Session acknowledgement requires session credentials');
  }
  const response = await input.options.http.request({
    method: 'POST',
    url: `${input.baseUrl}${sessionActionPath(input.linkSessionId, 'receipt')}`,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Seams-Environment-Id': projectEnvironmentId,
    },
    body: input.body,
  });
  if (!response.ok) throw new Error(`linked-device request failed: ${response.message}`);
  if (response.value.status < 200 || response.value.status >= 300) {
    throw new Error(parseHttpFailureMessageV1(response.value));
  }
}

async function createPollingSubscriptionV1(input: {
  readonly options: DeviceLinkingAuthenticatedSessionTransportOptionsV1;
  readonly baseUrl: string;
  readonly linkSessionId: LinkDeviceSessionId;
  readonly onEvent: (event: LinkSessionTransportEventV1) => void;
}): Promise<LinkSessionSubscriptionV1> {
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastRevision: number | null = null;
  let firstPoll = true;
  let retryAttempt = 0;
  let inFlight: Promise<void> | null = null;
  const poll = async (): Promise<void> => {
    if (closed) return;
    try {
      const session = await requestSessionV1({ ...input });
      if (lastRevision === null || session.revision !== lastRevision) {
        lastRevision = session.revision;
        retryAttempt = 0;
        input.onEvent(
          parseLinkSessionTransportEventV1({
            kind: 'linked_device_session_event_v1',
            linkSessionId: session.linkSessionId,
            state: session.state,
            emittedAtMs: session.updatedAtMs,
          }),
        );
      } else {
        retryAttempt += 1;
      }
    } catch (error: unknown) {
      if (firstPoll) {
        closed = true;
        throw error;
      }
      retryAttempt += 1;
    } finally {
      firstPoll = false;
      if (!closed) {
        timer = setTimeout(
          () => {
            inFlight = poll();
          },
          nextLinkedDevicePollingDelayMsV1(
            input.options.pollIntervalMs,
            Math.max(0, retryAttempt - 1),
          ),
        );
      }
    }
  };
  await (inFlight = poll());
  return {
    /* Awaiting the in-flight poll lets a caller sequence "stop polling" before
       an action that invalidates the session server-side; a fire-and-forget
       close would leave one read racing that action. */
    close: async () => {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      await inFlight?.catch(() => undefined);
    },
  };
}

function parseSessionMutationEnvelopeV1(raw: unknown): SessionMutationEnvelopeV1 {
  const record = asPlainDeviceLinkingResponse(raw);
  if (record === null) {
    throw new Error('linked-device response must be an object');
  }
  if (!hasExactKeys(record, SESSION_MUTATION_RESPONSE_FIELDS)) {
    throw new Error('linked-device response contains invalid fields');
  }
  if (record.ok !== true) {
    throw new Error('linked-device response outcome is invalid');
  }
  switch (record.outcome) {
    case 'applied':
      return {
        ok: true,
        outcome: 'applied',
        session: parseLinkSessionProjectionV1(record.session),
      };
    case 'replayed':
      return {
        ok: true,
        outcome: 'replayed',
        session: parseLinkSessionProjectionV1(record.session),
      };
    default:
      throw new Error('linked-device response outcome is invalid');
  }
}

function parseTargetCredentialRegistrationResponseV1(
  raw: unknown,
): LinkedDeviceTargetCredentialRegistrationResultV1 {
  const record = asPlainDeviceLinkingResponse(raw);
  if (record === null) {
    throw new Error('linked-device target credential response must be an object');
  }
  if (!hasExactKeys(record, TARGET_CREDENTIAL_RESPONSE_FIELDS)) {
    throw new Error('linked-device target credential response contains invalid fields');
  }
  if (record.ok !== true) {
    throw new Error('linked-device target credential response outcome is invalid');
  }
  switch (record.outcome) {
    case 'applied':
      return parseTargetCredentialRegistrationResponseBranch(record, 'applied');
    case 'replayed':
      return parseTargetCredentialRegistrationResponseBranch(record, 'replayed');
    default:
      throw new Error('linked-device target credential response outcome is invalid');
  }
}

function parseTargetCredentialRegistrationResponseBranch(
  record: PlainDeviceLinkingResponse,
  outcome: 'applied' | 'replayed',
): LinkedDeviceTargetCredentialRegistrationResultV1 {
  const session = parseLinkSessionProjectionV1(record.session);
  const targetCredential = parseLinkedDeviceTargetCredentialRegistrationResultV1(
    record.targetCredential,
  );
  if (targetCredential.outcome !== outcome) {
    throw new Error('linked-device target credential response outcome does not match its result');
  }
  if (targetCredential.linkSessionId !== session.linkSessionId) {
    throw new Error('linked-device target credential response session identity differs');
  }
  return targetCredential;
}

function parseHttpFailureMessageV1(response: DeviceRequestResponseV1): string {
  const record = asPlainDeviceLinkingResponse(response.body);
  if (record === null || record.ok !== false) {
    return `linked-device request failed with HTTP ${response.status}`;
  }
  if (
    hasExactKeys(record, CODED_FAILURE_RESPONSE_FIELDS) &&
    typeof record.code === 'string' &&
    typeof record.message === 'string' &&
    record.message.trim()
  ) {
    return `linked-device request failed: ${record.message}`;
  }
  if (
    hasExactKeys(record, OUTCOME_FAILURE_RESPONSE_FIELDS) &&
    typeof record.outcome === 'string' &&
    typeof record.code === 'string' &&
    typeof record.message === 'string' &&
    record.message.trim()
  ) {
    return `linked-device request failed: ${record.message}`;
  }
  switch (record.outcome) {
    case 'conflict':
      if (hasExactKeys(record, SESSION_CONFLICT_FAILURE_FIELDS)) {
        return 'linked-device request failed: conflict';
      }
      break;
    case 'expired':
      if (hasExactKeys(record, SESSION_EXPIRED_FAILURE_FIELDS)) {
        return 'linked-device request failed: expired';
      }
      break;
    case 'invalid_state':
      if (hasExactKeys(record, SESSION_INVALID_STATE_FAILURE_FIELDS)) {
        return 'linked-device request failed: invalid_state';
      }
      break;
    case 'integrity_error':
      if (hasExactKeys(record, SESSION_INTEGRITY_FAILURE_FIELDS)) {
        return 'linked-device request failed: integrity_error';
      }
      break;
    default:
      break;
  }
  return `linked-device request failed with HTTP ${response.status}`;
}

function asPlainDeviceLinkingResponse(value: unknown): PlainDeviceLinkingResponse | null {
  return isPlainDeviceLinkingResponse(value) ? value : null;
}

function isPlainDeviceLinkingResponse(value: unknown): value is PlainDeviceLinkingResponse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function hasExactKeys(
  record: PlainDeviceLinkingResponse,
  expectedKeys: readonly string[],
): boolean {
  try {
    const actualKeys = Object.keys(record).sort();
    const expected = [...expectedKeys].sort();
    return (
      actualKeys.length === expected.length &&
      actualKeys.every((key, index) => key === expected[index])
    );
  } catch {
    return false;
  }
}

function encodeRequestBodyV1(body: unknown): Uint8Array {
  if (body === undefined) return new Uint8Array();
  const encoded = JSON.stringify(body);
  if (typeof encoded !== 'string')
    throw new Error('linked-device request body is not JSON serializable');
  return new TextEncoder().encode(encoded);
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  if (!normalized) throw new Error('linked-device relayer URL is required');
  return normalized;
}

function sessionPath(linkSessionId: LinkDeviceSessionId): string {
  return `${LINKED_DEVICE_SESSION_HTTP_BASE_PATH_V1}/${String(linkSessionId)}`;
}

function sessionActionPath(
  linkSessionId: LinkDeviceSessionId,
  action:
    | 'approval'
    | 'target-preparation'
    | 'email-otp/challenge'
    | 'email-otp/challenge/resend'
    | 'email-otp/challenge/verify'
    | 'credential'
    | 'ed25519-export-root'
    | 'ed25519-export-root-recipient'
    | 'receipt'
    | 'retry'
    | 'cancel',
): string {
  return `${sessionPath(linkSessionId)}/${action}`;
}

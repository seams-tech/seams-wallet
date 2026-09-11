import {
  parseLinkedDeviceApprovalResultV1,
  parseLinkedDeviceOrdinaryMaterialSourceContributionPreparationTupleV1,
  parseLinkSessionProjectionV1,
  parseLinkedDeviceSessionClaimV1,
  parseLinkedDeviceEmailOtpBaseFactorResolutionResultV1,
} from '@shared/device-linking';
import type { LinkedDeviceApprovalResultV1 } from '@shared/device-linking';
import { parseLinkDeviceSessionId, type LinkDeviceSessionId } from '@shared/signing-lanes/ids';
import { parseLinkedDeviceEd25519ExportRootRecipientV1 } from '@shared/device-linking/ed25519ExportRoot';
import type {
  LinkSessionAuthenticationV1,
  LinkSessionSnapshotV1,
  LinkSessionOwnerTransportPortV1,
  LinkSessionSubscriptionV1,
} from './deviceLinkingPorts';
import { LINKED_DEVICE_SESSION_HTTP_BASE_PATH_V1 } from './deviceLinkingHttpTransport';

/**
 * This port is the owner-authentication boundary. Implementations own the
 * wallet session or step-up headers and never expose them to the flow.
 */
export type LinkSessionOwnerAuthenticatedRequestPortV1 = {
  requestOwnerV1(input: {
    readonly method: 'GET' | 'POST';
    readonly canonicalPath: string;
    readonly body?: unknown;
    readonly authentication: LinkSessionAuthenticationV1;
  }): Promise<{ readonly status: number; readonly body: unknown }>;
};

/** Approval polling/subscription is separate because the relay may choose SSE or polling. */
export type LinkSessionOwnerApprovalUpdatesPortV1 = {
  getApprovalV1(input: {
    readonly linkSessionId: LinkDeviceSessionId;
    readonly authentication: LinkSessionAuthenticationV1;
  }): Promise<LinkedDeviceApprovalResultV1>;
  subscribeApprovalV1(input: {
    readonly linkSessionId: LinkDeviceSessionId;
    readonly authentication: LinkSessionAuthenticationV1;
    readonly onResult: (result: LinkedDeviceApprovalResultV1) => void;
  }): Promise<LinkSessionSubscriptionV1>;
};

export type DeviceLinkingOwnerTransportOptionsV1 = {
  readonly request: LinkSessionOwnerAuthenticatedRequestPortV1;
  readonly approvalUpdates: LinkSessionOwnerApprovalUpdatesPortV1;
};

export function createDeviceLinkingOwnerTransportV1(
  options: DeviceLinkingOwnerTransportOptionsV1,
): LinkSessionOwnerTransportPortV1 {
  return {
    claimSessionV1: async (input) => {
      const response = await options.request.requestOwnerV1({
        method: 'POST',
        canonicalPath: `${sessionPath(input.request.payload.linkSessionId)}/claim`,
        body: input.request,
        authentication: input.authentication,
      });
      return parseOwnerResponseV1(response, parseLinkedDeviceSessionClaimV1);
    },
    resolveEmailOtpBaseFactorV1: async (input) => {
      const response = await options.request.requestOwnerV1({
        method: 'POST',
        canonicalPath: `${sessionPath(input.linkSessionId)}/email-otp-base-factor`,
        body: input.request,
        authentication: input.authentication,
      });
      return parseOwnerResponseV1(response, parseLinkedDeviceEmailOtpBaseFactorResolutionResultV1);
    },
    cancelClaimedSessionV1: async (input) => {
      const response = await options.request.requestOwnerV1({
        method: 'POST',
        canonicalPath: `${sessionPath(input.linkSessionId)}/owner-cancel`,
        body: { expectedRevision: input.expectedRevision },
        authentication: input.authentication,
      });
      return parseOwnerResponseV1(response, parseSessionProjectionResponseV1);
    },
    recordOwnerApprovalV1: async (input) => {
      const response = await options.request.requestOwnerV1({
        method: 'POST',
        canonicalPath: `${sessionPath(input.approval.linkSessionId)}/approval`,
        body: input.approval,
        authentication: input.authentication,
      });
      return parseOwnerResponseV1(response, parseLinkedDeviceApprovalResultV1);
    },
    getSourceContributionPreparationV1: async (input) => {
      const response = await options.request.requestOwnerV1({
        method: 'GET',
        canonicalPath: `${sessionPath(input.linkSessionId)}/source-contribution-preparation`,
        authentication: input.authentication,
      });
      if (response.status === 204) return null;
      return parseOwnerResponseV1(
        response,
        parseLinkedDeviceOrdinaryMaterialSourceContributionPreparationTupleV1,
      );
    },
    recordSourceContributionV1: async (input) => {
      const response = await options.request.requestOwnerV1({
        method: 'POST',
        canonicalPath: `${sessionPath(input.approval.linkSessionId)}/source-contribution`,
        body: input.approval,
        authentication: input.authentication,
      });
      return parseOwnerResponseV1(response, parseSourceContributionSessionResponseV1);
    },
    getApprovalV1: options.approvalUpdates.getApprovalV1,
    getEd25519ExportRootRecipientV1: async (input) => {
      const response = await options.request.requestOwnerV1({
        method: 'GET',
        canonicalPath: `${sessionPath(input.linkSessionId)}/ed25519-export-root-recipient`,
        authentication: input.authentication,
      });
      // Device 2 has not published a recipient key yet. Normal while the
      // target device is still preparing, so it is a value rather than a throw.
      if (response.status === 204) return null;
      return parseOwnerResponseV1(response, parseLinkedDeviceEd25519ExportRootRecipientV1);
    },
    submitEd25519ExportRootPackageV1: async (input) => {
      const response = await options.request.requestOwnerV1({
        method: 'POST',
        canonicalPath: `${sessionPath(
          requireLinkSessionId(input.submission.linkSessionId),
        )}/ed25519-export-root`,
        body: input.submission,
        authentication: input.authentication,
      });
      parseOwnerResponseV1(response, (raw) => raw);
    },
    subscribeApprovalV1: options.approvalUpdates.subscribeApprovalV1,
  };
}

function parseOwnerResponseV1<T>(
  response: { readonly status: number; readonly body: unknown },
  parse: (raw: unknown) => T,
): T {
  if (response.status < 200 || response.status >= 300) {
    throw Object.assign(new Error(parseOwnerFailureMessageV1(response)), {
      status: response.status,
    });
  }
  return parse(response.body);
}

function parseOwnerFailureMessageV1(response: {
  readonly status: number;
  readonly body: unknown;
}): string {
  const errorBody = decodeLinkedDeviceOwnerErrorBodyV1(response.body);
  if (errorBody) {
    return `linked-device owner request failed: ${errorBody.message}`;
  }
  return `linked-device owner request failed with HTTP ${response.status}`;
}

function parseSourceContributionSessionResponseV1(raw: unknown): LinkSessionSnapshotV1 {
  const response = decodeLinkedDeviceSessionResponseV1(raw);
  if (!response) {
    throw new Error('linked-device source contribution response is invalid');
  }
  return parseLinkSessionProjectionV1(response.session);
}

function parseSessionProjectionResponseV1(raw: unknown): LinkSessionSnapshotV1 {
  const response = decodeLinkedDeviceSessionResponseV1(raw);
  if (!response) {
    throw new Error('linked-device session response is invalid');
  }
  return parseLinkSessionProjectionV1(response.session);
}

type LinkedDeviceSessionResponseDto = {
  readonly session: unknown;
};

type LinkedDeviceOwnerErrorDto = {
  readonly message: string;
};

function decodeLinkedDeviceSessionResponseV1(raw: unknown): LinkedDeviceSessionResponseDto | null {
  if (
    raw === null ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null)
  ) {
    return null;
  }
  const fields = new Map<string, unknown>(Object.entries(raw));
  const names = [...fields.keys()];
  const expected = new Set(['ok', 'outcome', 'session']);
  if (
    names.length !== expected.size ||
    !names.every((name) => expected.has(name)) ||
    fields.get('ok') !== true ||
    (fields.get('outcome') !== 'applied' && fields.get('outcome') !== 'replayed')
  ) {
    return null;
  }
  return { session: fields.get('session') };
}

function decodeLinkedDeviceOwnerErrorBodyV1(raw: unknown): LinkedDeviceOwnerErrorDto | null {
  if (
    raw === null ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null)
  ) {
    return null;
  }
  const fields = new Map<string, unknown>(Object.entries(raw));
  const names = [...fields.keys()];
  if (
    names.length === 0 ||
    names.length > 2 ||
    !names.every((name) => name === 'code' || name === 'message')
  ) {
    return null;
  }
  const message = fields.get('message');
  return typeof message === 'string' ? { message } : null;
}

function sessionPath(linkSessionId: LinkDeviceSessionId): string {
  return `${LINKED_DEVICE_SESSION_HTTP_BASE_PATH_V1}/${String(linkSessionId)}`;
}

/**
 * The submission carries its link session as a plain string because that is
 * also the body the server parses. Re-parsing keeps the request path derived
 * from a branded id.
 */
function requireLinkSessionId(raw: string): LinkDeviceSessionId {
  const parsed = parseLinkDeviceSessionId(raw);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

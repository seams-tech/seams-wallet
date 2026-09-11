import {
  parseRouterAbEd25519YaoRegistrationActivationAdmissionReceiptV1,
  parseRouterAbEd25519YaoRegistrationActivationExecuteRequestV1,
  parseRouterAbEd25519YaoRegistrationActivationResultV1,
  parseRouterAbEd25519YaoRegistrationAdmissionRequestV1,
  type RouterAbEd25519YaoActivationAdmissionReceiptV1,
  type RouterAbEd25519YaoActivationExecuteRequestV1,
  type RouterAbEd25519YaoActivationResultV1,
  type RouterAbEd25519YaoRegistrationAdmissionRequestV1,
} from '@shared/utils/routerAbEd25519Yao';
import type {
  VersionedJsonObject,
  VersionedJsonValue,
} from '../../../framework/versionedJsonRecordStore';
import type {
  RouterAbEd25519YaoRegistrationFailure,
  RouterAbEd25519YaoRegistrationFailureCode,
} from './routerAbEd25519YaoRegistration';
import { encodeRouterAbEd25519YaoRegistrationAdmissionFingerprintV1 } from './routerAbEd25519YaoRegistration';
import type { InMemoryRouterAbEd25519YaoRegistrationStateV1 } from './routerAbEd25519YaoRegistration';
import type { InMemoryRouterAbEd25519YaoRegistrationIntentAuthorizationStateV1 } from './routerAbEd25519YaoRegistrationIntentAuthorization';
import { routerAbEd25519YaoCredentialDigestHexV1 } from './routerAbEd25519YaoRegistrationIntentAuthorization';

export const ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTION_RECORD_KIND_V1 =
  'router_ab_ed25519_yao_registration_execution_record_v1';

type AdmissionReceipt = RouterAbEd25519YaoActivationAdmissionReceiptV1<'registration'>;
type ExecuteRequest = RouterAbEd25519YaoActivationExecuteRequestV1<'registration'>;
type ActivationResult = RouterAbEd25519YaoActivationResultV1<'registration'>;

type RouterAbEd25519YaoRegistrationExecutionRecordObjectV1 = {
  readonly [key: string]: unknown;
};

const EXECUTION_AUTHORITY_FIELDS = [
  'recordKind',
  'lifecycleId',
  'admissionRequest',
  'admissionReceipt',
  'admissionBindingJson',
  'credentialDigestSha256Hex',
  'expiresAtMs',
] as const;
const READY_FIELDS = [...EXECUTION_AUTHORITY_FIELDS, 'kind'] as const;
const CLAIMED_FIELDS = [
  ...EXECUTION_AUTHORITY_FIELDS,
  'kind',
  'requestDigestSha256Hex',
  'request',
  'claimedAtMs',
  'reconcileAfterMs',
] as const;
const COMPLETED_FIELDS = [...CLAIMED_FIELDS, 'result', 'consumerBinding'] as const;
const FAILED_FIELDS = [...CLAIMED_FIELDS, 'failure'] as const;
const FAILURE_FIELDS = ['ok', 'status', 'code', 'message'] as const;

type RegistrationExecutionAuthority = {
  readonly lifecycleId: string;
  readonly admissionRequest: RouterAbEd25519YaoRegistrationAdmissionRequestV1;
  readonly admissionReceipt: AdmissionReceipt;
  readonly admissionBindingJson: string;
  readonly credentialDigestSha256Hex: string;
  readonly expiresAtMs: number;
};

export type RouterAbEd25519YaoRegistrationExecutionRecordV1 =
  | (RegistrationExecutionAuthority & {
      readonly kind: 'ready';
      readonly requestDigestSha256Hex?: never;
      readonly request?: never;
      readonly result?: never;
      readonly failure?: never;
      readonly consumerBinding?: never;
    })
  | (RegistrationExecutionAuthority & {
      readonly kind: 'claimed';
      readonly requestDigestSha256Hex: string;
      readonly request: ExecuteRequest;
      readonly claimedAtMs: number;
      readonly reconcileAfterMs: number;
      readonly result?: never;
      readonly failure?: never;
      readonly consumerBinding?: never;
    })
  | (RegistrationExecutionAuthority & {
      readonly kind: 'completed';
      readonly requestDigestSha256Hex: string;
      readonly request: ExecuteRequest;
      readonly claimedAtMs: number;
      readonly reconcileAfterMs: number;
      readonly result: ActivationResult;
      readonly consumerBinding: string | null;
      readonly failure?: never;
    })
  | (RegistrationExecutionAuthority & {
      readonly kind: 'failed';
      readonly requestDigestSha256Hex: string;
      readonly request: ExecuteRequest;
      readonly claimedAtMs: number;
      readonly reconcileAfterMs: number;
      readonly failure: RouterAbEd25519YaoRegistrationFailure;
      readonly result?: never;
      readonly consumerBinding?: never;
    });

type MapValue<T> = T extends Map<string, infer Value> ? Value : never;
type RegistrationLifecycleState = MapValue<InMemoryRouterAbEd25519YaoRegistrationStateV1['states']>;
type AdmittedRegistration = Extract<RegistrationLifecycleState, { readonly kind: 'admitted' }>;
type BoundRegistrationIntentAuthority =
  InMemoryRouterAbEd25519YaoRegistrationIntentAuthorizationStateV1['authorities'][number];

export function buildRouterAbEd25519YaoRegistrationExecutionReadyRecordV1(input: {
  readonly lifecycleId: string;
  readonly registration: AdmittedRegistration;
  readonly authority: BoundRegistrationIntentAuthority;
}): RouterAbEd25519YaoRegistrationExecutionRecordV1 | null {
  const { lifecycleId, registration, authority } = input;
  if (
    registration.admissionRequest.scope.lifecycle_id !== lifecycleId ||
    registration.admissionReceipt.binding.lifecycle.lifecycle_id !== lifecycleId ||
    authority.admissionRequest.scope.lifecycle_id !== lifecycleId ||
    authority.admissionFingerprint !==
      encodeRouterAbEd25519YaoRegistrationAdmissionFingerprintV1(authority.admissionRequest) ||
    authority.admissionFingerprint !==
      encodeRouterAbEd25519YaoRegistrationAdmissionFingerprintV1(registration.admissionRequest) ||
    !Number.isSafeInteger(authority.expiresAtMs) ||
    authority.expiresAtMs <= 0
  ) {
    return null;
  }
  return {
    kind: 'ready',
    lifecycleId,
    admissionRequest: registration.admissionRequest,
    admissionReceipt: registration.admissionReceipt,
    admissionBindingJson: routerAbEd25519YaoRegistrationAdmissionBindingJsonV1(
      registration.admissionReceipt,
    ),
    credentialDigestSha256Hex: routerAbEd25519YaoCredentialDigestHexV1(
      authority.credentialDigestSha256,
    ),
    expiresAtMs: authority.expiresAtMs,
  };
}

export function routerAbEd25519YaoRegistrationExecutionRecordKeyV1(lifecycleId: string): string {
  return `registration-execution:${requireVisibleString(lifecycleId, 'lifecycleId', 256)}`;
}

export function encodeRouterAbEd25519YaoRegistrationExecutionRecordV1(
  record: RouterAbEd25519YaoRegistrationExecutionRecordV1,
): VersionedJsonObject {
  return toJsonObject({
    recordKind: ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTION_RECORD_KIND_V1,
    ...record,
  });
}

export function parseRouterAbEd25519YaoRegistrationExecutionRecordV1(
  input: unknown,
): RouterAbEd25519YaoRegistrationExecutionRecordV1 | null {
  const record = readRouterAbEd25519YaoRegistrationExecutionRecordObjectV1(input);
  if (
    record === null ||
    record.recordKind !== ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTION_RECORD_KIND_V1
  ) {
    return null;
  }
  const kind = parseRouterAbEd25519YaoRegistrationExecutionRecordKindV1(record.kind);
  switch (kind) {
    case 'ready':
      return parseRouterAbEd25519YaoRegistrationExecutionReadyRecordV1(record);
    case 'claimed':
      return parseRouterAbEd25519YaoRegistrationExecutionClaimedRecordV1(record);
    case 'completed':
      return parseRouterAbEd25519YaoRegistrationExecutionCompletedRecordV1(record);
    case 'failed':
      return parseRouterAbEd25519YaoRegistrationExecutionFailedRecordV1(record);
    case null:
      return null;
    default:
      return assertNever(kind);
  }
}

function parseRouterAbEd25519YaoRegistrationExecutionReadyRecordV1(
  record: RouterAbEd25519YaoRegistrationExecutionRecordObjectV1,
): RouterAbEd25519YaoRegistrationExecutionRecordV1 | null {
  if (!hasExactRouterAbEd25519YaoRegistrationExecutionRecordKeys(record, READY_FIELDS)) {
    return null;
  }
  const authority = parseRouterAbEd25519YaoRegistrationExecutionAuthorityV1(record);
  if (authority === null) return null;
  return {
    kind: 'ready',
    lifecycleId: authority.lifecycleId,
    admissionRequest: authority.admissionRequest,
    admissionReceipt: authority.admissionReceipt,
    admissionBindingJson: authority.admissionBindingJson,
    credentialDigestSha256Hex: authority.credentialDigestSha256Hex,
    expiresAtMs: authority.expiresAtMs,
  };
}

function parseRouterAbEd25519YaoRegistrationExecutionClaimedRecordV1(
  record: RouterAbEd25519YaoRegistrationExecutionRecordObjectV1,
): RouterAbEd25519YaoRegistrationExecutionRecordV1 | null {
  if (!hasExactRouterAbEd25519YaoRegistrationExecutionRecordKeys(record, CLAIMED_FIELDS)) {
    return null;
  }
  const authority = parseRouterAbEd25519YaoRegistrationExecutionAuthorityV1(record);
  if (authority === null) return null;
  const progress = parseRouterAbEd25519YaoRegistrationExecutionProgressV1(
    record,
    authority.lifecycleId,
  );
  if (progress === null) return null;
  return {
    kind: 'claimed',
    lifecycleId: authority.lifecycleId,
    admissionRequest: authority.admissionRequest,
    admissionReceipt: authority.admissionReceipt,
    admissionBindingJson: authority.admissionBindingJson,
    credentialDigestSha256Hex: authority.credentialDigestSha256Hex,
    expiresAtMs: authority.expiresAtMs,
    requestDigestSha256Hex: progress.requestDigestSha256Hex,
    request: progress.request,
    claimedAtMs: progress.claimedAtMs,
    reconcileAfterMs: progress.reconcileAfterMs,
  };
}

function parseRouterAbEd25519YaoRegistrationExecutionCompletedRecordV1(
  record: RouterAbEd25519YaoRegistrationExecutionRecordObjectV1,
): RouterAbEd25519YaoRegistrationExecutionRecordV1 | null {
  if (!hasExactRouterAbEd25519YaoRegistrationExecutionRecordKeys(record, COMPLETED_FIELDS)) {
    return null;
  }
  const authority = parseRouterAbEd25519YaoRegistrationExecutionAuthorityV1(record);
  if (authority === null) return null;
  const progress = parseRouterAbEd25519YaoRegistrationExecutionProgressV1(
    record,
    authority.lifecycleId,
  );
  if (progress === null) return null;
  const result = parseRouterAbEd25519YaoRegistrationActivationResultV1(record.result);
  const consumerBinding =
    record.consumerBinding === null ? null : readVisibleString(record.consumerBinding, 512);
  if (!result.ok || (consumerBinding === null && record.consumerBinding !== null)) return null;
  return {
    kind: 'completed',
    lifecycleId: authority.lifecycleId,
    admissionRequest: authority.admissionRequest,
    admissionReceipt: authority.admissionReceipt,
    admissionBindingJson: authority.admissionBindingJson,
    credentialDigestSha256Hex: authority.credentialDigestSha256Hex,
    expiresAtMs: authority.expiresAtMs,
    requestDigestSha256Hex: progress.requestDigestSha256Hex,
    request: progress.request,
    claimedAtMs: progress.claimedAtMs,
    reconcileAfterMs: progress.reconcileAfterMs,
    result: result.value,
    consumerBinding,
  };
}

function parseRouterAbEd25519YaoRegistrationExecutionFailedRecordV1(
  record: RouterAbEd25519YaoRegistrationExecutionRecordObjectV1,
): RouterAbEd25519YaoRegistrationExecutionRecordV1 | null {
  if (!hasExactRouterAbEd25519YaoRegistrationExecutionRecordKeys(record, FAILED_FIELDS)) {
    return null;
  }
  const authority = parseRouterAbEd25519YaoRegistrationExecutionAuthorityV1(record);
  if (authority === null) return null;
  const progress = parseRouterAbEd25519YaoRegistrationExecutionProgressV1(
    record,
    authority.lifecycleId,
  );
  if (progress === null) return null;
  const failure = parseRouterAbEd25519YaoRegistrationExecutionFailureV1(record.failure);
  if (failure === null) return null;
  return {
    kind: 'failed',
    lifecycleId: authority.lifecycleId,
    admissionRequest: authority.admissionRequest,
    admissionReceipt: authority.admissionReceipt,
    admissionBindingJson: authority.admissionBindingJson,
    credentialDigestSha256Hex: authority.credentialDigestSha256Hex,
    expiresAtMs: authority.expiresAtMs,
    requestDigestSha256Hex: progress.requestDigestSha256Hex,
    request: progress.request,
    claimedAtMs: progress.claimedAtMs,
    reconcileAfterMs: progress.reconcileAfterMs,
    failure,
  };
}

export function routerAbEd25519YaoRegistrationExecutionRequestDigestV1(
  request: ExecuteRequest,
): Promise<string> {
  return sha256Hex(JSON.stringify(request));
}

export function routerAbEd25519YaoRegistrationAdmissionBindingJsonV1(
  receipt: AdmissionReceipt,
): string {
  return JSON.stringify(receipt.binding);
}

type RouterAbEd25519YaoRegistrationExecutionRecordKindV1 =
  | 'ready'
  | 'claimed'
  | 'completed'
  | 'failed';

function parseRouterAbEd25519YaoRegistrationExecutionRecordKindV1(
  input: unknown,
): RouterAbEd25519YaoRegistrationExecutionRecordKindV1 | null {
  switch (input) {
    case 'ready':
    case 'claimed':
    case 'completed':
    case 'failed':
      return input;
    default:
      return null;
  }
}

function parseRouterAbEd25519YaoRegistrationExecutionAuthorityV1(
  input: RouterAbEd25519YaoRegistrationExecutionRecordObjectV1,
): RegistrationExecutionAuthority | null {
  const lifecycleId = readVisibleString(input.lifecycleId, 256);
  const admissionRequest = parseRouterAbEd25519YaoRegistrationAdmissionRequestV1(
    input.admissionRequest,
  );
  const admissionReceipt = parseRouterAbEd25519YaoRegistrationActivationAdmissionReceiptV1(
    input.admissionReceipt,
  );
  const admissionBindingJson = readVisibleString(input.admissionBindingJson, 65_536);
  const credentialDigestSha256Hex = readSha256Hex(input.credentialDigestSha256Hex);
  const expiresAtMs = readPositiveSafeInteger(input.expiresAtMs);
  if (
    lifecycleId === null ||
    !admissionRequest.ok ||
    !admissionReceipt.ok ||
    admissionBindingJson === null ||
    credentialDigestSha256Hex === null ||
    expiresAtMs === null ||
    admissionRequest.value.scope.lifecycle_id !== lifecycleId ||
    admissionReceipt.value.binding.lifecycle.lifecycle_id !== lifecycleId
  ) {
    return null;
  }
  return {
    lifecycleId,
    admissionRequest: admissionRequest.value,
    admissionReceipt: admissionReceipt.value,
    admissionBindingJson,
    credentialDigestSha256Hex,
    expiresAtMs,
  };
}

type ParsedRouterAbEd25519YaoRegistrationExecutionProgressV1 = {
  readonly requestDigestSha256Hex: string;
  readonly request: ExecuteRequest;
  readonly claimedAtMs: number;
  readonly reconcileAfterMs: number;
};

function parseRouterAbEd25519YaoRegistrationExecutionProgressV1(
  input: RouterAbEd25519YaoRegistrationExecutionRecordObjectV1,
  lifecycleId: string,
): ParsedRouterAbEd25519YaoRegistrationExecutionProgressV1 | null {
  const requestDigestSha256Hex = readSha256Hex(input.requestDigestSha256Hex);
  const request = parseRouterAbEd25519YaoRegistrationActivationExecuteRequestV1(input.request);
  const claimedAtMs = readPositiveSafeInteger(input.claimedAtMs);
  const reconcileAfterMs = readPositiveSafeInteger(input.reconcileAfterMs);
  if (
    requestDigestSha256Hex === null ||
    !request.ok ||
    claimedAtMs === null ||
    reconcileAfterMs === null ||
    reconcileAfterMs <= claimedAtMs ||
    request.value.binding.lifecycle.lifecycle_id !== lifecycleId
  ) {
    return null;
  }
  return { requestDigestSha256Hex, request: request.value, claimedAtMs, reconcileAfterMs };
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  try {
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
    let encoded = '';
    for (const byte of digest) encoded += byte.toString(16).padStart(2, '0');
    digest.fill(0);
    return encoded;
  } finally {
    bytes.fill(0);
  }
}

function parseRouterAbEd25519YaoRegistrationExecutionFailureV1(
  input: unknown,
): RouterAbEd25519YaoRegistrationFailure | null {
  const failure = readRouterAbEd25519YaoRegistrationExecutionRecordObjectV1(input);
  if (
    failure === null ||
    !hasExactRouterAbEd25519YaoRegistrationExecutionRecordKeys(failure, FAILURE_FIELDS) ||
    failure.ok !== false ||
    !Number.isSafeInteger(failure.status) ||
    typeof failure.code !== 'string' ||
    typeof failure.message !== 'string'
  ) {
    return null;
  }
  if (
    failure.status !== 400 &&
    failure.status !== 401 &&
    failure.status !== 403 &&
    failure.status !== 404 &&
    failure.status !== 408 &&
    failure.status !== 409 &&
    failure.status !== 429 &&
    failure.status !== 500 &&
    failure.status !== 502 &&
    failure.status !== 503
  ) {
    return null;
  }
  if (!isFailureCode(failure.code)) return null;
  return {
    ok: false,
    status: failure.status,
    code: failure.code,
    message: failure.message,
  };
}

function isFailureCode(input: string): input is RouterAbEd25519YaoRegistrationFailureCode {
  return (
    input === 'invalid_backend_response' ||
    input === 'admission_failed' ||
    input === 'admission_in_progress' ||
    input === 'admission_uncertain' ||
    input === 'unknown_registration' ||
    input === 'binding_mismatch' ||
    input === 'execution_in_progress' ||
    input === 'execution_failed' ||
    input === 'ceremony_expired'
  );
}

function readSha256Hex(input: unknown): string | null {
  return typeof input === 'string' && /^[0-9a-f]{64}$/u.test(input) ? input : null;
}

function readPositiveSafeInteger(input: unknown): number | null {
  return typeof input === 'number' && Number.isSafeInteger(input) && input > 0 ? input : null;
}

function requireVisibleString(input: unknown, field: string, maxLength: number): string {
  const value = readVisibleString(input, maxLength);
  if (value === null) throw new Error(`Yao registration execution ${field} is invalid`);
  return value;
}

function readVisibleString(input: unknown, maxLength: number): string | null {
  return typeof input === 'string' &&
    input.length > 0 &&
    input.length <= maxLength &&
    /^[\x20-\x7e]+$/u.test(input)
    ? input
    : null;
}

function toJsonObject(input: unknown): VersionedJsonObject {
  const value = JSON.parse(JSON.stringify(input));
  if (!isJsonObject(value)) {
    throw new Error('Yao registration execution record is not canonical JSON');
  }
  return value;
}

function isJsonObject(input: unknown): input is VersionedJsonObject {
  return (
    isRouterAbEd25519YaoRegistrationExecutionRecordObjectV1(input) &&
    Object.values(input).every(isJsonValue)
  );
}

function isJsonValue(input: unknown): input is VersionedJsonValue {
  if (
    input === null ||
    typeof input === 'string' ||
    typeof input === 'boolean' ||
    typeof input === 'number'
  ) {
    return typeof input !== 'number' || Number.isFinite(input);
  }
  if (Array.isArray(input)) return input.every(isJsonValue);
  return isJsonObject(input);
}

function readRouterAbEd25519YaoRegistrationExecutionRecordObjectV1(
  input: unknown,
): RouterAbEd25519YaoRegistrationExecutionRecordObjectV1 | null {
  return isRouterAbEd25519YaoRegistrationExecutionRecordObjectV1(input) ? input : null;
}

function isRouterAbEd25519YaoRegistrationExecutionRecordObjectV1(
  input: unknown,
): input is RouterAbEd25519YaoRegistrationExecutionRecordObjectV1 {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function hasExactRouterAbEd25519YaoRegistrationExecutionRecordKeys(
  record: RouterAbEd25519YaoRegistrationExecutionRecordObjectV1,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(record);
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key) => expectedKeys.some((expectedKey) => expectedKey === key))
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Yao registration execution record kind: ${String(value)}`);
}

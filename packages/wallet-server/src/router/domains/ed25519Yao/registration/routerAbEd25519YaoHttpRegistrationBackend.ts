import {
  deriveRouterAbEd25519YaoStableContextBindingV1,
  parseRouterAbEd25519YaoActivationKeysetV1,
  parseRouterAbEd25519YaoActivationResultV1,
  parseRouterAbEd25519YaoExportResultV1,
  type RouterAbEd25519YaoActivationExecuteRequestV1,
  type RouterAbEd25519YaoActivationKeysetV1,
  type RouterAbEd25519YaoRecoveryActivationRequestV1,
  type RouterAbEd25519YaoRecoveryAdmissionRequestV1,
  type RouterAbEd25519YaoRegistrationAdmissionRequestV1,
  type RouterAbEd25519YaoExportAdmissionRequestV1,
  type RouterAbEd25519YaoExportExecuteRequestV1,
} from '@shared/utils/routerAbEd25519Yao';
import type {
  RouterAbEd25519YaoRegistrationBackend,
  RouterAbEd25519YaoRegistrationBackendFailure,
  RouterAbEd25519YaoRegistrationBackendResult,
} from './routerAbEd25519YaoRegistration';
import type { RouterAbEd25519YaoExportBackend } from '../export/routerAbEd25519YaoExport';
import type { RouterAbEd25519YaoRecoveryBackend } from '../recovery/routerAbEd25519YaoRecovery';
import {
  routerAbEd25519YaoTenantRootWireV1,
  type RouterAbEd25519YaoTenantRootResolverV1,
  type RouterAbEd25519YaoTenantRootWireV1,
} from '../routerAbEd25519YaoGatewayEnvelope';
import {
  createRouterAbTraceContextV1,
  type RouterAbTraceContextV1,
} from '@shared/utils/routerAbTraceContext';

type RouterAbEd25519YaoRegistrationExecuteRequestV1 =
  RouterAbEd25519YaoActivationExecuteRequestV1<'registration'>;
type RouterAbEd25519YaoRecoveryExecuteRequestV1 =
  RouterAbEd25519YaoActivationExecuteRequestV1<'recovery'>;

const INTERNAL_AUTH_HEADER = 'x-router-ab-internal-service-auth';
const TRACE_ID_HEADER = 'x-seams-trace-id';
const ROUTER_REPLAY_HEADER = 'x-seams-yao-replay';
const ROUTER_EXECUTE_PATH = '/router-ab/router/ed25519-yao/execute';
const ROUTER_REGISTRATION_CONSUME_PATH = '/router-ab/router/ed25519-yao/registration/consume';
const ROUTER_RECOVERY_PROMOTE_PATH = '/router-ab/router/ed25519-yao/recovery/promote';

const ROUTER_AB_ENV_KEYS = {
  routerUrl: 'MPC_ROUTER_URL',
  signingWorkerId: 'SIGNING_WORKER_ID',
  internalServiceAuth: 'ROUTER_AB_GATEWAY_TO_ROUTER_AUTH_SECRET',
  deriverAInputPublicKey: 'DERIVER_A_ED25519_YAO_INPUT_PUBLIC_KEY',
  deriverBInputPublicKey: 'DERIVER_B_ED25519_YAO_INPUT_PUBLIC_KEY',
  signingWorkerRecipientPublicKey: 'SIGNING_WORKER_SERVER_OUTPUT_HPKE_PUBLIC_KEY',
} as const;

export type RouterAbEd25519YaoHttpRegistrationBackendConfig = {
  routerUrl: string;
  signingWorkerId: string;
  internalServiceAuth: string;
  deriverAInputPublicKey: readonly number[];
  deriverBInputPublicKey: readonly number[];
  signingWorkerRecipientPublicKey: readonly number[];
  resolveTenantRoot: RouterAbEd25519YaoTenantRootResolverV1;
  fetch: typeof fetch;
  onSpan?: (span: RouterAbEd25519YaoGatewaySpanV1) => void;
};

export type RouterAbEd25519YaoGatewaySpanV1 = {
  readonly event: 'router_ab_yao_gateway_span_v1';
  readonly span: 'gateway.pre_yao' | 'gateway.yao_execute' | 'gateway.d1_commit';
  readonly operation: 'registration' | 'recovery' | 'export';
  readonly outcome: 'success' | 'failure';
  readonly duration_ms: number;
  readonly trace_id: string;
};

export type RouterAbEd25519YaoHttpRegistrationBackendRawEnv = Readonly<Record<string, unknown>>;

export function parseRouterAbEd25519YaoActivationKeysetFromEnvV1(
  env: RouterAbEd25519YaoHttpRegistrationBackendRawEnv,
): RouterAbEd25519YaoActivationKeysetV1 {
  return parseRouterAbEd25519YaoActivationKeysetV1({
    deriver_a_input_public_key: x25519PublicKeyFromEnv(
      envValue(env, ROUTER_AB_ENV_KEYS.deriverAInputPublicKey),
      ROUTER_AB_ENV_KEYS.deriverAInputPublicKey,
    ),
    deriver_b_input_public_key: x25519PublicKeyFromEnv(
      envValue(env, ROUTER_AB_ENV_KEYS.deriverBInputPublicKey),
      ROUTER_AB_ENV_KEYS.deriverBInputPublicKey,
    ),
    signing_worker_recipient_public_key: x25519PublicKeyFromEnv(
      envValue(env, ROUTER_AB_ENV_KEYS.signingWorkerRecipientPublicKey),
      ROUTER_AB_ENV_KEYS.signingWorkerRecipientPublicKey,
    ),
  });
}

type ValidatedHttpBackendConfig = {
  routerUrl: string;
  signingWorkerId: string;
  internalServiceAuth: string;
  deriverAInputPublicKey: readonly number[];
  deriverBInputPublicKey: readonly number[];
  signingWorkerRecipientPublicKey: readonly number[];
  resolveTenantRoot: RouterAbEd25519YaoTenantRootResolverV1;
  fetch: typeof fetch;
  onSpan: ((span: RouterAbEd25519YaoGatewaySpanV1) => void) | undefined;
};

type HttpSuccess = { ok: true; body: unknown; serverTiming: string | null };
type HttpResult = HttpSuccess | RouterAbEd25519YaoRegistrationBackendFailure;

type ActiveSigningWorkerReceipt = {
  session: readonly number[];
  transcript: readonly number[];
  registeredPublicKey: readonly number[];
  joinedClientCommitment: readonly number[];
  joinedSigningWorkerCommitment: readonly number[];
  signingWorkerVerifyingShare: readonly number[];
  stateEpoch: number;
};

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  record: Record<string, unknown>,
  label: string,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`${label}.${key} is not supported`);
  }
  for (const key of allowedKeys) {
    if (!Object.hasOwn(record, key)) throw new Error(`${label}.${key} is required`);
  }
}

function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is required`);
  return value;
}

function requireHttpOrigin(value: unknown, label: string): string {
  const parsed = new URL(requireNonEmpty(value, label));
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use HTTP or HTTPS`);
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${label} must contain only an origin`);
  }
  return parsed.origin;
}

function requireByte(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`${label} must be a byte`);
  }
  return value;
}

function requireBytes32(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.length !== 32) {
    throw new Error(`${label} must contain 32 bytes`);
  }
  const parsed: number[] = [];
  let nonzero = false;
  for (let index = 0; index < value.length; index += 1) {
    const byte = requireByte(value[index], `${label}[${index}]`);
    parsed.push(byte);
    if (byte !== 0) nonzero = true;
  }
  if (!nonzero) throw new Error(`${label} must be nonzero`);
  return parsed;
}

function equalBytes(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function hexToBytes32(value: unknown, label: string): number[] {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be canonical 32-byte lowercase hex`);
  }
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 2) {
    bytes.push(Number.parseInt(value.slice(index, index + 2), 16));
  }
  return bytes;
}

function x25519PublicKeyFromEnv(value: unknown, label: string): number[] {
  const encoded = requireNonEmpty(value, label);
  if (!encoded.startsWith('x25519:')) throw new Error(`${label} must use x25519:<hex>`);
  return requireBytes32(hexToBytes32(encoded.slice('x25519:'.length), label), label);
}

function envValue(env: RouterAbEd25519YaoHttpRegistrationBackendRawEnv, key: string): unknown {
  if (!Object.hasOwn(env, key)) throw new Error(`${key} is required`);
  return env[key];
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function randomSession(): number[] {
  const bytes = new Uint8Array(32);
  do {
    globalThis.crypto.getRandomValues(bytes);
  } while (isZero(bytes));
  return Array.from(bytes);
}

function isZero(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte !== 0) return false;
  }
  return true;
}

function validateConfig(
  input: RouterAbEd25519YaoHttpRegistrationBackendConfig,
): ValidatedHttpBackendConfig {
  const deriverAInputPublicKey = requireBytes32(
    input.deriverAInputPublicKey,
    'deriverAInputPublicKey',
  );
  const deriverBInputPublicKey = requireBytes32(
    input.deriverBInputPublicKey,
    'deriverBInputPublicKey',
  );
  const signingWorkerRecipientPublicKey = requireBytes32(
    input.signingWorkerRecipientPublicKey,
    'signingWorkerRecipientPublicKey',
  );
  if (
    equalBytes(deriverAInputPublicKey, deriverBInputPublicKey) ||
    equalBytes(deriverAInputPublicKey, signingWorkerRecipientPublicKey) ||
    equalBytes(deriverBInputPublicKey, signingWorkerRecipientPublicKey)
  ) {
    throw new Error('Ed25519 Yao recipient keys must be distinct');
  }
  if (typeof input.fetch !== 'function') throw new Error('fetch is required');
  if (typeof input.resolveTenantRoot !== 'function') {
    throw new Error('resolveTenantRoot is required');
  }
  return {
    routerUrl: requireHttpOrigin(input.routerUrl, 'routerUrl'),
    signingWorkerId: requireNonEmpty(input.signingWorkerId, 'signingWorkerId'),
    internalServiceAuth: requireNonEmpty(input.internalServiceAuth, 'internalServiceAuth'),
    deriverAInputPublicKey,
    deriverBInputPublicKey,
    signingWorkerRecipientPublicKey,
    resolveTenantRoot: input.resolveTenantRoot,
    fetch: input.fetch,
    onSpan: input.onSpan,
  };
}

function emitGatewaySpan(
  callback: ((span: RouterAbEd25519YaoGatewaySpanV1) => void) | undefined,
  span: RouterAbEd25519YaoGatewaySpanV1['span'],
  operation: RouterAbEd25519YaoGatewaySpanV1['operation'],
  traceId: string,
  startedAt: number,
  outcome: RouterAbEd25519YaoGatewaySpanV1['outcome'],
): void {
  if (!callback) return;
  const event: RouterAbEd25519YaoGatewaySpanV1 = {
    event: 'router_ab_yao_gateway_span_v1',
    span,
    operation,
    outcome,
    duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
    trace_id: traceId,
  };
  try {
    callback(event);
  } catch {
    // Observability must never change the registration response or retry path.
  }
}

function internalFailure(
  code: string,
  message: string,
): RouterAbEd25519YaoRegistrationBackendFailure {
  return { ok: false, status: 502, code, message };
}

function unavailableFailure(error: unknown): RouterAbEd25519YaoRegistrationBackendFailure {
  return {
    ok: false,
    status: 503,
    code: 'worker_unavailable',
    message: error instanceof Error ? error.message : String(error),
  };
}

/// Another run holds the Router's claim of this registration until its lease
/// lapses; the same request, retried after it, replays the run.
function executionInProgressFailure(): RouterAbEd25519YaoRegistrationBackendFailure {
  return {
    ok: false,
    status: 409,
    code: 'execution_in_progress',
    message: 'registration execution is already in progress',
  };
}

/// Another request already owns this registration's execution at the Router.
function executionMismatchFailure(): RouterAbEd25519YaoRegistrationBackendFailure {
  return {
    ok: false,
    status: 409,
    code: 'execution_mismatch',
    message: 'registration execution rejects a different execution payload',
  };
}

function ceremonyExpiredFailure(): RouterAbEd25519YaoRegistrationBackendFailure {
  return {
    ok: false,
    status: 409,
    code: 'ceremony_expired',
    message: 'Router Yao ceremony expired; allocate a new ceremony identity',
  };
}

function parseSigningWorkerReceipt(
  value: unknown,
  session: readonly number[],
  transcript: readonly number[],
  expectedStatus: 'active' | 'staged',
): ActiveSigningWorkerReceipt {
  const label = `${expectedStatus} SigningWorker receipt`;
  const record = requireRecord(value, label);
  requireExactKeys(record, label, [
    'status',
    'session',
    'transcript',
    'registered_public_key',
    'joined_client_commitment',
    'joined_signing_worker_commitment',
    'signing_worker_verifying_share',
    'state_epoch',
  ]);
  if (record.status !== expectedStatus) {
    throw new Error(`SigningWorker did not return a ${expectedStatus} receipt`);
  }
  const parsedSession = requireBytes32(record.session, `${label} session`);
  const parsedTranscript = requireBytes32(record.transcript, `${label} transcript`);
  if (!equalBytes(parsedSession, session) || !equalBytes(parsedTranscript, transcript)) {
    throw new Error(`${label} does not match the ceremony`);
  }
  const receipt = {
    session: parsedSession,
    transcript: parsedTranscript,
    registeredPublicKey: requireBytes32(
      record.registered_public_key,
      `${label} registered_public_key`,
    ),
    joinedClientCommitment: requireBytes32(
      record.joined_client_commitment,
      `${label} joined_client_commitment`,
    ),
    joinedSigningWorkerCommitment: requireBytes32(
      record.joined_signing_worker_commitment,
      `${label} joined_signing_worker_commitment`,
    ),
    signingWorkerVerifyingShare: requireBytes32(
      record.signing_worker_verifying_share,
      `${label} signing_worker_verifying_share`,
    ),
    stateEpoch: requirePositiveSafeInteger(record.state_epoch, `${label} state_epoch`),
  };
  if (!equalBytes(receipt.signingWorkerVerifyingShare, receipt.joinedSigningWorkerCommitment)) {
    throw new Error(`${label} verifying share does not match its commitment`);
  }
  return receipt;
}

function parseActiveSigningWorkerReceipt(
  value: unknown,
  session: readonly number[],
  transcript: readonly number[],
): ActiveSigningWorkerReceipt {
  return parseSigningWorkerReceipt(value, session, transcript, 'active');
}

function activeReceiptMatchesRecoveryActivation(
  receipt: ActiveSigningWorkerReceipt,
  activation: RouterAbEd25519YaoRecoveryActivationRequestV1,
): boolean {
  const publicReceipt = activation.public_receipt;
  return (
    equalBytes(receipt.session, activation.binding.session_id) &&
    equalBytes(receipt.transcript, publicReceipt.transcript) &&
    equalBytes(receipt.registeredPublicKey, publicReceipt.registered_public_key) &&
    equalBytes(receipt.joinedClientCommitment, publicReceipt.joined_client_commitment) &&
    equalBytes(
      receipt.joinedSigningWorkerCommitment,
      publicReceipt.joined_signing_worker_commitment,
    ) &&
    equalBytes(receipt.signingWorkerVerifyingShare, publicReceipt.signing_worker_verifying_share) &&
    receipt.stateEpoch === publicReceipt.state_epoch
  );
}

type RouterExecuteTargetBoundary =
  | {
      operation: 'registration';
      binding: RouterAbEd25519YaoRegistrationExecuteRequestV1['binding'];
      deriver_a_input: RouterAbEd25519YaoRegistrationExecuteRequestV1['deriver_a_input'];
      deriver_b_input: RouterAbEd25519YaoRegistrationExecuteRequestV1['deriver_b_input'];
    }
  | {
      operation: 'recovery';
      binding: RouterAbEd25519YaoRecoveryExecuteRequestV1['binding'];
      attempt: number;
      deriver_a_input: RouterAbEd25519YaoRecoveryExecuteRequestV1['deriver_a_input'];
      deriver_b_input: RouterAbEd25519YaoRecoveryExecuteRequestV1['deriver_b_input'];
    }
  | {
      operation: 'export';
      binding: RouterAbEd25519YaoExportExecuteRequestV1['binding'];
      deriver_a_input: RouterAbEd25519YaoExportExecuteRequestV1['deriver_a_input'];
      deriver_b_input: RouterAbEd25519YaoExportExecuteRequestV1['deriver_b_input'];
    };

type RouterExecuteBoundary = {
  tenant_root: RouterAbEd25519YaoTenantRootWireV1;
  application: RouterAbEd25519YaoRegistrationAdmissionRequestV1['application_binding'];
  participant_ids: RouterAbEd25519YaoRegistrationAdmissionRequestV1['participant_ids'];
  target: RouterExecuteTargetBoundary;
};

type RouterExecuteInput =
  | {
      readonly operation: 'registration';
      readonly request: RouterAbEd25519YaoRegistrationExecuteRequestV1;
      readonly admissionRequest: RouterAbEd25519YaoRegistrationAdmissionRequestV1;
    }
  | {
      readonly operation: 'recovery';
      readonly request: RouterAbEd25519YaoRecoveryExecuteRequestV1;
      readonly admissionRequest: RouterAbEd25519YaoRecoveryAdmissionRequestV1;
    }
  | {
      readonly operation: 'export';
      readonly request: RouterAbEd25519YaoExportExecuteRequestV1;
      readonly admissionRequest: RouterAbEd25519YaoExportAdmissionRequestV1;
    };

export interface RouterAbEd25519YaoPinnedRegistrationBackend
  extends RouterAbEd25519YaoRegistrationBackend {
  resolveRegistrationDispatchRoot(
    admissionRequest: RouterAbEd25519YaoRegistrationAdmissionRequestV1,
  ): Promise<RouterAbEd25519YaoTenantRootWireV1>;
  /// Executes one registration at the Router, which claims it and records
  /// its terminal answer: an exact retry gets that answer.
  executePinnedRegistration(
    request: RouterAbEd25519YaoRegistrationExecuteRequestV1,
    admissionRequest: RouterAbEd25519YaoRegistrationAdmissionRequestV1,
    dispatchRoot: RouterAbEd25519YaoTenantRootWireV1,
    traceContext: RouterAbTraceContextV1,
  ): Promise<RouterAbEd25519YaoRegistrationBackendResult>;
  /// Consumes a completed registration's activation at the Router, for one
  /// finalization: the first consumer binding wins.
  consumeRegistration(
    input: RouterAbEd25519YaoRegistrationConsumeInputV1,
  ): Promise<RouterAbEd25519YaoRegistrationConsumeOutcomeV1>;
}

export type RouterAbEd25519YaoRegistrationConsumeInputV1 = {
  readonly tenantRoot: RouterAbEd25519YaoTenantRootWireV1;
  readonly walletId: string;
  readonly lifecycleId: string;
  readonly sessionId: readonly number[];
  readonly consumerBinding: string;
};

/// The Router's answer to a consumption: the executed request and the
/// Router's recorded answer, exactly as it gave them, or a refusal.
export type RouterAbEd25519YaoRegistrationConsumeOutcomeV1 =
  | { readonly kind: 'consumed'; readonly requestJson: string; readonly responseJson: string }
  | {
      readonly kind: 'refused';
      readonly code:
        | 'unknown_registration'
        | 'registration_not_activated'
        | 'activation_reference_mismatch'
        | 'activation_consumed';
      readonly message: string;
    }
  | { readonly kind: 'unavailable'; readonly message: string };

function registrationRouterExecuteRequest(
  input: Extract<RouterExecuteInput, { readonly operation: 'registration' }>,
  tenantRoot: RouterAbEd25519YaoTenantRootWireV1,
): RouterExecuteBoundary {
  return {
    tenant_root: tenantRoot,
    application: input.admissionRequest.application_binding,
    participant_ids: input.admissionRequest.participant_ids,
    target: {
      operation: 'registration',
      binding: input.request.binding,
      deriver_a_input: input.request.deriver_a_input,
      deriver_b_input: input.request.deriver_b_input,
    },
  };
}

function recoveryRouterExecuteRequest(
  input: Extract<RouterExecuteInput, { readonly operation: 'recovery' }>,
  tenantRoot: RouterAbEd25519YaoTenantRootWireV1,
  attempt: number,
): RouterExecuteBoundary {
  return {
    tenant_root: tenantRoot,
    application: input.admissionRequest.application_binding,
    participant_ids: input.admissionRequest.participant_ids,
    target: {
      operation: 'recovery',
      binding: input.request.binding,
      attempt,
      deriver_a_input: input.request.deriver_a_input,
      deriver_b_input: input.request.deriver_b_input,
    },
  };
}

/** A recovery runs under the root pinned at its admission, never resolved here. */
async function routerExecuteRequest(
  input: Exclude<RouterExecuteInput, { readonly operation: 'recovery' }>,
  resolveTenantRoot: RouterAbEd25519YaoTenantRootResolverV1,
): Promise<RouterExecuteBoundary> {
  switch (input.operation) {
    case 'registration': {
      const tenantRoot = await routerAbEd25519YaoTenantRootWireV1(
        await resolveTenantRoot({
          operation: 'registration',
          admissionRequest: input.admissionRequest,
        }),
      );
      return registrationRouterExecuteRequest(input, tenantRoot);
    }
    case 'export': {
      const tenantRoot = await routerAbEd25519YaoTenantRootWireV1(
        await resolveTenantRoot({ operation: 'export', admissionRequest: input.admissionRequest }),
      );
      return {
        tenant_root: tenantRoot,
        application: input.admissionRequest.application_binding,
        participant_ids: input.admissionRequest.participant_ids,
        target: {
          operation: 'export',
          binding: input.request.binding,
          deriver_a_input: input.request.deriver_a_input,
          deriver_b_input: input.request.deriver_b_input,
        },
      };
    }
  }
}

function executeOperation(
  request: RouterExecuteInput['request'],
): RouterAbEd25519YaoGatewaySpanV1['operation'] {
  return 'ceremony' in request.binding
    ? request.binding.ceremony.operation
    : request.binding.operation;
}

function parseRouterExecuteResult(
  value: unknown,
  request: RouterExecuteInput['request'],
): RouterAbEd25519YaoRegistrationBackendResult {
  try {
    const envelope = requireRecord(value, 'Router Yao execute result');
    switch (envelope.status) {
      case 'recoverable_failure': {
        requireExactKeys(envelope, 'Router Yao recoverable failure', [
          'status',
          'code',
          'retry_after_ms',
        ]);
        if (
          typeof envelope.code !== 'string' ||
          ![
            'service_unavailable',
            'conflicting_pair',
            'missing_preparation',
            'ceremony_expired',
            'signing_worker_uncertain',
            'terminal_role_failure',
            'authorization_rejected',
            'execution_in_progress',
          ].includes(envelope.code)
        ) {
          throw new Error('Router Yao recoverable failure code is invalid');
        }
        requirePositiveSafeInteger(envelope.retry_after_ms, 'Router Yao retry_after_ms');
        if (envelope.code === 'ceremony_expired') return ceremonyExpiredFailure();
        if (envelope.code === 'execution_in_progress') return executionInProgressFailure();
        return internalFailure('router_execution_retryable', 'Router Yao execution is retryable');
      }
      case 'rejected': {
        requireExactKeys(envelope, 'Router Yao rejected result', ['status', 'code']);
        if (typeof envelope.code !== 'string' || envelope.code.length === 0) {
          throw new Error('Router Yao rejection code is invalid');
        }
        if (envelope.code === 'ceremony_expired') return ceremonyExpiredFailure();
        if (envelope.code === 'execution_mismatch') return executionMismatchFailure();
        return internalFailure('router_execution_rejected', 'Router Yao execution was rejected');
      }
      case 'burned': {
        requireExactKeys(envelope, 'Router Yao burned result', [
          'status',
          'execution_id',
          'reason',
        ]);
        requireBytes32(envelope.execution_id, 'Router Yao burned execution_id');
        if (
          !['caller_disconnected', 'peer_uncertain', 'protocol_failure'].includes(
            String(envelope.reason),
          )
        ) {
          throw new Error('Router Yao burned reason is invalid');
        }
        return internalFailure('router_execution_burned', 'Router Yao execution was burned');
      }
      case 'succeeded':
        break;
      default:
        throw new Error('Router Yao result status is invalid');
    }
    requireExactKeys(envelope, 'Router Yao execute result', ['status', 'result']);
    const result = requireRecord(envelope.result, 'Router Yao success');
    requireExactKeys(result, 'Router Yao success', ['operation', 'result']);
    const operation = executeOperation(request);
    if (result.operation !== operation) {
      return internalFailure(
        'operation_mismatch',
        'Router Yao result operation differs from request',
      );
    }
    switch (operation) {
      case 'registration': {
        const parsed = parseRouterAbEd25519YaoActivationResultV1(result.result);
        if (!parsed.ok || parsed.value.binding.operation !== 'registration') {
          return internalFailure('invalid_router_result', 'Router registration result is invalid');
        }
        return { ok: true, body: parsed.value };
      }
      case 'recovery': {
        const parsed = parseRouterAbEd25519YaoActivationResultV1(result.result);
        if (!parsed.ok || parsed.value.binding.operation !== 'recovery') {
          return internalFailure('invalid_router_result', 'Router recovery result is invalid');
        }
        return { ok: true, body: parsed.value };
      }
      case 'export': {
        const parsed = parseRouterAbEd25519YaoExportResultV1(result.result);
        if (!parsed.ok) {
          return internalFailure('invalid_router_result', 'Router export result is invalid');
        }
        return { ok: true, body: parsed.value };
      }
    }
  } catch (error: unknown) {
    return internalFailure(
      'invalid_router_result',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** The registration result a Router answer, exactly as recorded, carries. */
export function parseRouterAbEd25519YaoRegistrationRouterAnswerV1(
  responseJson: string,
  request: RouterAbEd25519YaoRegistrationExecuteRequestV1,
): RouterAbEd25519YaoRegistrationBackendResult {
  let answer: unknown;
  try {
    answer = JSON.parse(responseJson);
  } catch {
    return internalFailure('invalid_router_result', 'Router registration answer is not JSON');
  }
  return parseRouterExecuteResult(answer, request);
}

function parseRouterRegistrationConsumeOutcome(
  value: unknown,
): RouterAbEd25519YaoRegistrationConsumeOutcomeV1 {
  try {
    const envelope = requireRecord(value, 'Router registration consume answer');
    switch (envelope.kind) {
      case 'consumed':
        requireExactKeys(envelope, 'Router registration consumption', [
          'kind',
          'request_json',
          'response_json',
        ]);
        if (typeof envelope.request_json !== 'string' || typeof envelope.response_json !== 'string') {
          throw new Error('Router registration consumption is invalid');
        }
        return {
          kind: 'consumed',
          requestJson: envelope.request_json,
          responseJson: envelope.response_json,
        };
      case 'refused': {
        requireExactKeys(envelope, 'Router registration consume refusal', ['kind', 'code', 'message']);
        const code = envelope.code;
        if (
          (code !== 'unknown_registration' &&
            code !== 'registration_not_activated' &&
            code !== 'activation_reference_mismatch' &&
            code !== 'activation_consumed') ||
          typeof envelope.message !== 'string'
        ) {
          throw new Error('Router registration consume refusal is invalid');
        }
        return { kind: 'refused', code, message: envelope.message };
      }
      default:
        throw new Error('Router registration consume answer kind is invalid');
    }
  } catch (error: unknown) {
    return { kind: 'unavailable', message: error instanceof Error ? error.message : String(error) };
  }
}

function requestInitWithReplayHeader(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers);
  headers.set(ROUTER_REPLAY_HEADER, '1');
  return { ...init, headers };
}

export class RouterAbEd25519YaoHttpRegistrationBackend
  implements
    RouterAbEd25519YaoPinnedRegistrationBackend,
    RouterAbEd25519YaoRecoveryBackend,
    RouterAbEd25519YaoExportBackend
{
  private readonly config: ValidatedHttpBackendConfig;
  private lastRouterServerTiming: string | null = null;

  constructor(config: RouterAbEd25519YaoHttpRegistrationBackendConfig) {
    this.config = validateConfig(config);
  }

  takeLastRouterServerTiming(): string | null {
    const timing = this.lastRouterServerTiming;
    this.lastRouterServerTiming = null;
    return timing;
  }

  async admit(
    request: RouterAbEd25519YaoRegistrationAdmissionRequestV1,
    _traceContext?: RouterAbTraceContextV1,
  ): Promise<RouterAbEd25519YaoRegistrationBackendResult> {
    return await this.admitActivation(request, 'registration');
  }

  async admitRecovery(
    request: RouterAbEd25519YaoRecoveryAdmissionRequestV1,
    _traceContext?: RouterAbTraceContextV1,
  ): Promise<RouterAbEd25519YaoRegistrationBackendResult> {
    return await this.admitActivation(request, 'recovery');
  }

  async admitExport(
    request: RouterAbEd25519YaoExportAdmissionRequestV1,
    _traceContext?: RouterAbTraceContextV1,
  ): Promise<RouterAbEd25519YaoRegistrationBackendResult> {
    if (request.scope.signing_worker_id !== this.config.signingWorkerId) {
      return {
        ok: false,
        status: 400,
        code: 'signing_worker_mismatch',
        message: 'export scope selects a different SigningWorker',
      };
    }
    const stableContextBinding = await deriveRouterAbEd25519YaoStableContextBindingV1(
      request.application_binding,
      request.participant_ids,
    );
    return {
      ok: true,
      body: {
        binding: {
          ceremony: {
            lifecycle: {
              lifecycle_id: request.scope.lifecycle_id,
              work_kind: 'key_export',
              primitive_request_kind: 'export',
              root_share_epoch: request.scope.root_share_epoch,
              account_id: request.scope.account_id,
              session_id: request.scope.threshold_session_id,
              signer_set_id: request.scope.signer_set_id,
              selected_server_id: request.scope.signing_worker_id,
            },
            operation: 'export',
            session_id: randomSession(),
            stable_key_context_binding: stableContextBinding,
            material_activation: request.scope.material_activation,
          },
          registered_public_key: request.registered_public_key,
          state_epoch: request.state_epoch,
          runtime_policy_binding: request.runtime_policy_binding,
          authorization_digest: request.authorization.authorization_digest,
        },
        keyset: {
          deriver_a_input_public_key: this.config.deriverAInputPublicKey,
          deriver_b_input_public_key: this.config.deriverBInputPublicKey,
          signing_worker_recipient_public_key: this.config.signingWorkerRecipientPublicKey,
        },
      },
    };
  }

  async executeExport(
    request: RouterAbEd25519YaoExportExecuteRequestV1,
    admissionRequest: RouterAbEd25519YaoExportAdmissionRequestV1,
    traceContext?: RouterAbTraceContextV1,
  ): Promise<RouterAbEd25519YaoRegistrationBackendResult> {
    return await this.executeRouterRequest(
      { operation: 'export', request, admissionRequest },
      false,
      traceContext,
    );
  }

  private keyset() {
    return {
      deriver_a_input_public_key: this.config.deriverAInputPublicKey,
      deriver_b_input_public_key: this.config.deriverBInputPublicKey,
      signing_worker_recipient_public_key: this.config.signingWorkerRecipientPublicKey,
    };
  }

  private async admitActivation(
    request:
      | RouterAbEd25519YaoRegistrationAdmissionRequestV1
      | RouterAbEd25519YaoRecoveryAdmissionRequestV1,
    operation: 'registration' | 'recovery',
  ): Promise<RouterAbEd25519YaoRegistrationBackendResult> {
    if (request.scope.signing_worker_id !== this.config.signingWorkerId) {
      return {
        ok: false,
        status: 400,
        code: 'signing_worker_mismatch',
        message: `${operation} scope selects a different SigningWorker`,
      };
    }
    const stableContextBinding = await deriveRouterAbEd25519YaoStableContextBindingV1(
      request.application_binding,
      request.participant_ids,
    );
    const keyset = this.keyset();
    const sessionId = randomSession();
    switch (operation) {
      case 'registration':
        return {
          ok: true,
          body: {
            binding: {
              lifecycle: {
                lifecycle_id: request.scope.lifecycle_id,
                work_kind: 'registration_prepare',
                primitive_request_kind: 'registration',
                root_share_epoch: request.scope.root_share_epoch,
                account_id: request.scope.account_id,
                session_id: request.scope.threshold_session_id,
                signer_set_id: request.scope.signer_set_id,
                selected_server_id: request.scope.signing_worker_id,
              },
              operation: 'registration',
              session_id: sessionId,
              stable_key_context_binding: stableContextBinding,
              material_activation: request.scope.material_activation,
            },
            keyset,
          },
        };
      case 'recovery':
        return {
          ok: true,
          body: {
            binding: {
              lifecycle: {
                lifecycle_id: request.scope.lifecycle_id,
                work_kind: 'recovery',
                primitive_request_kind: 'recovery',
                root_share_epoch: request.scope.root_share_epoch,
                account_id: request.scope.account_id,
                session_id: request.scope.threshold_session_id,
                signer_set_id: request.scope.signer_set_id,
                selected_server_id: request.scope.signing_worker_id,
              },
              operation: 'recovery',
              session_id: sessionId,
              stable_key_context_binding: stableContextBinding,
              material_activation: request.scope.material_activation,
            },
            keyset,
          },
        };
    }
  }

  async execute(
    request: RouterAbEd25519YaoRegistrationExecuteRequestV1,
    admissionRequest: RouterAbEd25519YaoRegistrationAdmissionRequestV1,
    traceContext?: RouterAbTraceContextV1,
  ): Promise<RouterAbEd25519YaoRegistrationBackendResult> {
    return await this.executeRouterRequest(
      { operation: 'registration', request, admissionRequest },
      false,
      traceContext,
    );
  }

  async resolveRegistrationDispatchRoot(
    admissionRequest: RouterAbEd25519YaoRegistrationAdmissionRequestV1,
  ): Promise<RouterAbEd25519YaoTenantRootWireV1> {
    return await routerAbEd25519YaoTenantRootWireV1(
      await this.config.resolveTenantRoot({ operation: 'registration', admissionRequest }),
    );
  }

  async executePinnedRegistration(
    request: RouterAbEd25519YaoRegistrationExecuteRequestV1,
    admissionRequest: RouterAbEd25519YaoRegistrationAdmissionRequestV1,
    dispatchRoot: RouterAbEd25519YaoTenantRootWireV1,
    traceContext: RouterAbTraceContextV1,
  ): Promise<RouterAbEd25519YaoRegistrationBackendResult> {
    const routerInput = { operation: 'registration', request, admissionRequest } as const;
    // The Router decides a registration's replay from its own claim, so a
    // retry after a lost reply is the exact request, unmarked.
    return await this.sendRouterRequest(
      routerInput,
      registrationRouterExecuteRequest(routerInput, dispatchRoot),
      traceContext.value,
      'exact',
      false,
    );
  }

  async consumeRegistration(
    input: RouterAbEd25519YaoRegistrationConsumeInputV1,
  ): Promise<RouterAbEd25519YaoRegistrationConsumeOutcomeV1> {
    let response: HttpResult;
    try {
      response = await this.post(
        ROUTER_REGISTRATION_CONSUME_PATH,
        {
          tenant_root: input.tenantRoot,
          wallet_id: input.walletId,
          lifecycle_id: input.lifecycleId,
          session_id: Array.from(input.sessionId),
          consumer_binding: input.consumerBinding,
        },
        createRouterAbTraceContextV1().value,
        'exact',
      );
    } catch (error: unknown) {
      return { kind: 'unavailable', message: error instanceof Error ? error.message : String(error) };
    }
    if (!response.ok) return { kind: 'unavailable', message: response.message };
    return parseRouterRegistrationConsumeOutcome(response.body);
  }

  async resolveRecoveryDispatchRoot(
    admissionRequest: RouterAbEd25519YaoRecoveryAdmissionRequestV1,
  ): Promise<RouterAbEd25519YaoTenantRootWireV1> {
    return await routerAbEd25519YaoTenantRootWireV1(
      await this.config.resolveTenantRoot({ operation: 'recovery', admissionRequest }),
    );
  }

  async executeRecovery(
    request: RouterAbEd25519YaoRecoveryExecuteRequestV1,
    admissionRequest: RouterAbEd25519YaoRecoveryAdmissionRequestV1,
    dispatchRoot: RouterAbEd25519YaoTenantRootWireV1,
    attempt: number,
    replay: boolean,
    traceContext?: RouterAbTraceContextV1,
  ): Promise<RouterAbEd25519YaoRegistrationBackendResult> {
    const routerInput = { operation: 'recovery', request, admissionRequest } as const;
    return await this.sendRouterRequest(
      routerInput,
      recoveryRouterExecuteRequest(routerInput, dispatchRoot, attempt),
      (traceContext ?? createRouterAbTraceContextV1()).value,
      'replay',
      replay,
    );
  }

  /// Runs one Router execution. `replay` marks the first call as the
  /// Router's replay: an earlier call for this payload may have reached it.
  private async executeRouterRequest(
    request: Exclude<RouterExecuteInput, { readonly operation: 'recovery' }>,
    replay: boolean,
    traceContext?: RouterAbTraceContextV1,
  ): Promise<RouterAbEd25519YaoRegistrationBackendResult> {
    const traceId = (traceContext ?? createRouterAbTraceContextV1()).value;
    const operation = request.operation;
    const preYaoStartedAt = performance.now();
    let routerRequest: RouterExecuteBoundary;
    try {
      routerRequest = await routerExecuteRequest(request, this.config.resolveTenantRoot);
    } catch (error: unknown) {
      emitGatewaySpan(
        this.config.onSpan,
        'gateway.pre_yao',
        operation,
        traceId,
        preYaoStartedAt,
        'failure',
      );
      return unavailableFailure(error);
    }
    emitGatewaySpan(
      this.config.onSpan,
      'gateway.pre_yao',
      operation,
      traceId,
      preYaoStartedAt,
      'success',
    );

    return await this.sendRouterRequest(request, routerRequest, traceId, 'replay', replay);
  }

  private async sendRouterRequest(
    request: RouterExecuteInput,
    routerRequest: RouterExecuteBoundary,
    traceId: string,
    retryAfterTransportFailure: 'exact' | 'replay',
    replay: boolean,
  ): Promise<RouterAbEd25519YaoRegistrationBackendResult> {
    const operation = request.operation;
    const executeStartedAt = performance.now();
    try {
      const response = await this.post(
        ROUTER_EXECUTE_PATH,
        routerRequest,
        traceId,
        retryAfterTransportFailure,
        replay,
      );
      this.lastRouterServerTiming = response.ok ? response.serverTiming : null;
      const result = response.ok
        ? parseRouterExecuteResult(response.body, request.request)
        : response;
      emitGatewaySpan(
        this.config.onSpan,
        'gateway.yao_execute',
        operation,
        traceId,
        executeStartedAt,
        result.ok ? 'success' : 'failure',
      );
      return result;
    } catch (error: unknown) {
      emitGatewaySpan(
        this.config.onSpan,
        'gateway.yao_execute',
        operation,
        traceId,
        executeStartedAt,
        'failure',
      );
      return unavailableFailure(error);
    }
  }

  async activateRecovery(
    request: RouterAbEd25519YaoRecoveryActivationRequestV1,
    dispatchRoot: RouterAbEd25519YaoTenantRootWireV1,
    traceContext?: RouterAbTraceContextV1,
  ): Promise<RouterAbEd25519YaoRegistrationBackendResult> {
    // The root names the wallet's SigningWorker, as it did for the delivery.
    const promoted = await this.post(
      ROUTER_RECOVERY_PROMOTE_PATH,
      { ...request, tenant_root: dispatchRoot },
      (traceContext ?? createRouterAbTraceContextV1()).value,
    );
    if (!promoted.ok) return promoted;
    const activeReceipt = parseActiveSigningWorkerReceipt(
      promoted.body,
      request.binding.session_id,
      request.public_receipt.transcript,
    );
    if (!activeReceiptMatchesRecoveryActivation(activeReceipt, request)) {
      return internalFailure(
        'recovery_promotion_mismatch',
        'Router promotion receipt does not match the verified recovery result',
      );
    }
    return { ok: true, body: request };
  }

  /// Posts once, and after a transport failure retries once: the exact
  /// request, or for a recovery or export execution, the request marked as
  /// the Router's replay.
  private async post(
    path: string,
    body: unknown,
    traceId: string,
    retryAfterTransportFailure: 'none' | 'exact' | 'replay' = 'none',
    replay = false,
  ): Promise<HttpResult> {
    const init: RequestInit = {
      method: 'POST',
      headers: this.headers(traceId),
      body: JSON.stringify(body),
    };
    return await this.request(
      this.config.routerUrl,
      path,
      replay ? requestInitWithReplayHeader(init) : init,
      retryAfterTransportFailure,
    );
  }

  private headers(traceId: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      [INTERNAL_AUTH_HEADER]: this.config.internalServiceAuth,
      [TRACE_ID_HEADER]: traceId,
    };
  }

  private async request(
    baseUrl: string,
    path: string,
    init: RequestInit,
    retryAfterTransportFailure: 'none' | 'exact' | 'replay',
  ): Promise<HttpResult> {
    let response: Response;
    try {
      response = await this.config.fetch.call(globalThis, `${baseUrl}${path}`, init);
    } catch (error: unknown) {
      if (retryAfterTransportFailure === 'none') throw error;
      response = await this.config.fetch.call(
        globalThis,
        `${baseUrl}${path}`,
        retryAfterTransportFailure === 'replay' ? requestInitWithReplayHeader(init) : init,
      );
    }
    const text = await response.text();
    if (!response.ok) {
      return internalFailure('worker_rejected', `worker ${path} returned HTTP ${response.status}`);
    }
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      return internalFailure(
        'worker_invalid_json',
        `worker ${path} returned HTTP ${response.status} with invalid JSON`,
      );
    }
    return {
      ok: true,
      body,
      serverTiming: parseRouterServerTiming(response.headers.get('Server-Timing')),
    };
  }
}

function parseRouterServerTiming(value: string | null): string | null {
  if (!value) return null;
  const metrics = value.split(',').map((metric) => metric.trim());
  const allowedNames = new Set([
    'yao_router_prepare_pair',
    'yao_router_verify_readiness',
    'yao_router_role_execution',
    'yao_router_signing_worker_delivery',
  ]);
  for (const metric of metrics) {
    const match = /^([a-z0-9_]+);dur=(\d+(?:\.\d+)?)$/.exec(metric);
    if (!match || !allowedNames.has(match[1] || '')) return null;
  }
  return metrics.join(', ');
}

export function createRouterAbEd25519YaoHttpRegistrationBackendFromEnv(input: {
  env: RouterAbEd25519YaoHttpRegistrationBackendRawEnv;
  resolveTenantRoot: RouterAbEd25519YaoTenantRootResolverV1;
  onSpan?: (span: RouterAbEd25519YaoGatewaySpanV1) => void;
  fetch: typeof fetch;
}): RouterAbEd25519YaoPinnedRegistrationBackend &
  RouterAbEd25519YaoRecoveryBackend &
  RouterAbEd25519YaoExportBackend {
  const env = input.env;
  return new RouterAbEd25519YaoHttpRegistrationBackend({
    routerUrl: requireNonEmpty(
      envValue(env, ROUTER_AB_ENV_KEYS.routerUrl),
      ROUTER_AB_ENV_KEYS.routerUrl,
    ),
    signingWorkerId: requireNonEmpty(
      envValue(env, ROUTER_AB_ENV_KEYS.signingWorkerId),
      ROUTER_AB_ENV_KEYS.signingWorkerId,
    ),
    internalServiceAuth: requireNonEmpty(
      envValue(env, ROUTER_AB_ENV_KEYS.internalServiceAuth),
      ROUTER_AB_ENV_KEYS.internalServiceAuth,
    ),
    deriverAInputPublicKey: x25519PublicKeyFromEnv(
      envValue(env, ROUTER_AB_ENV_KEYS.deriverAInputPublicKey),
      ROUTER_AB_ENV_KEYS.deriverAInputPublicKey,
    ),
    deriverBInputPublicKey: x25519PublicKeyFromEnv(
      envValue(env, ROUTER_AB_ENV_KEYS.deriverBInputPublicKey),
      ROUTER_AB_ENV_KEYS.deriverBInputPublicKey,
    ),
    signingWorkerRecipientPublicKey: x25519PublicKeyFromEnv(
      envValue(env, ROUTER_AB_ENV_KEYS.signingWorkerRecipientPublicKey),
      ROUTER_AB_ENV_KEYS.signingWorkerRecipientPublicKey,
    ),
    resolveTenantRoot: input.resolveTenantRoot,
    onSpan: input.onSpan,
    fetch: input.fetch,
  });
}

import { base64UrlEncode } from '@shared/utils/encoders';
import { alphabetizeStringify, sha256BytesUtf8 } from '@shared/utils/digests';
import {
  ROUTER_AB_ED25519_YAO_EXPORT_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_EXPORT_EXECUTE_PATH_V1,
  type RouterAbEd25519YaoExportAdmissionReceiptV1,
  type RouterAbEd25519YaoExportAdmissionRequestV1,
  type RouterAbEd25519YaoExportExecuteRequestV1,
  type RouterAbEd25519YaoExportResultV1,
} from '@shared/utils/routerAbEd25519Yao';
import {
  createRouterAbTraceContextV1,
  parseRouterAbTraceContextV1,
  ROUTER_AB_TRACE_ID_HEADER_V1,
  type RouterAbTraceContextV1,
} from '@shared/utils/routerAbTraceContext';
import { normalizeCorsOrigin } from '../../../../core/SessionService';
import { json, readJson } from '../../../framework/http';
import {
  InMemoryRouterAbEd25519YaoExportService,
  parseRouterAbEd25519YaoExportAdmissionEnvelopeV1,
  parseRouterAbEd25519YaoExportExecuteEnvelopeV1,
  type RouterAbEd25519YaoExportAdmissionClaimV1,
  type RouterAbEd25519YaoExportAuthorizationAdapter,
  type RouterAbEd25519YaoExportEmailOtpFactorReleaseV1,
  type RouterAbEd25519YaoExportOperationAdmissionV1,
  type RouterAbEd25519YaoExportAuthorizationResult,
  type RouterAbEd25519YaoExportBackend,
  type RouterAbEd25519YaoExportBackendResult,
  type RouterAbEd25519YaoExportExecuteClaimV1,
  type RouterAbEd25519YaoExportFailure,
  type RouterAbEd25519YaoExportServiceResult,
  type RouterAbEd25519YaoExportAdmissionEnvelopeParseResultV1,
  type RouterAbEd25519YaoExportServerAuthorizationIdentityV1,
} from './routerAbEd25519YaoExport';
import type { RouterAbEd25519YaoActiveCapabilityResolverV1 } from '../recovery/routerAbEd25519YaoRecovery';
import {
  runRouterAbEd25519YaoRegistrationTwoPhaseV1,
  type RouterAbEd25519YaoRegistrationTwoPhaseBackendResultV1,
  type RouterAbEd25519YaoRegistrationTwoPhaseCompletionV1,
  type RouterAbEd25519YaoRegistrationTwoPhasePrepareResultV1,
  type RouterAbEd25519YaoRegistrationTwoPhaseRunResultV1,
} from '../registration/routerAbEd25519YaoRegistrationTwoPhaseRunner';
import type {
  RouterAbEd25519YaoProductRegistrationPartitionedStateCommitResultV1,
  RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1,
} from '../capabilityLifecycle/routerAbEd25519YaoProductRegistrationPartitionedStateStore';
import type { RouterAbEd25519YaoProductRegistrationStateV1 } from '../capabilityLifecycle/routerAbEd25519YaoProductRegistration';

type AuthorizationFailure = Extract<
  RouterAbEd25519YaoExportAuthorizationResult,
  { readonly ok: false }
>;

type ExportResponse =
  | RouterAbEd25519YaoExportServiceResult<RouterAbEd25519YaoExportAdmissionReceiptV1>
  | RouterAbEd25519YaoExportServiceResult<RouterAbEd25519YaoExportResultV1>
  | AuthorizationFailure;

type TraceResolution =
  | { readonly ok: true; readonly value: RouterAbTraceContextV1 }
  | { readonly ok: false; readonly message: string };

export type RouterAbEd25519YaoExportRequestScopedCloudflareInputV1 = {
  readonly request: Request;
  readonly store: RouterAbEd25519YaoProductRegistrationPartitionedStateStoreV1;
  readonly backend: RouterAbEd25519YaoExportBackend;
  readonly capabilities: RouterAbEd25519YaoActiveCapabilityResolverV1;
  readonly authorization: RouterAbEd25519YaoExportAuthorizationAdapter;
};

type ExportRequestScopedContext = {
  readonly input: RouterAbEd25519YaoExportRequestScopedCloudflareInputV1;
  readonly trace: RouterAbTraceContextV1;
};

type ParsedAdmission = Extract<
  RouterAbEd25519YaoExportAdmissionEnvelopeParseResultV1,
  { readonly ok: true }
>;

type AuthorizationRunResult =
  | {
      readonly ok: true;
      readonly authorizationIdentity: RouterAbEd25519YaoExportServerAuthorizationIdentityV1;
      readonly factorRelease?: RouterAbEd25519YaoExportEmailOtpFactorReleaseV1;
    }
  | AuthorizationFailure;

class ExportAdmissionRequestRun {
  constructor(
    private readonly context: ExportRequestScopedContext,
    private readonly request: RouterAbEd25519YaoExportAdmissionRequestV1,
    private readonly authorizationIdentity: RouterAbEd25519YaoExportServerAuthorizationIdentityV1,
  ) {}

  async prepare(
    state: RouterAbEd25519YaoProductRegistrationStateV1,
  ): Promise<
    RouterAbEd25519YaoRegistrationTwoPhasePrepareResultV1<
      RouterAbEd25519YaoExportAdmissionClaimV1,
      ExportResponse,
      RouterAbEd25519YaoExportFailure
    >
  > {
    const preparation = await exportService(this.context, state).prepareAdmitExport(
      this.request,
      this.authorizationIdentity,
    );
    switch (preparation.kind) {
      case 'claimed':
        return { kind: 'claimed', state, claim: preparation.claim };
      case 'completed':
        return { kind: 'completed', value: success(preparation.value) };
      case 'failed':
        return { kind: 'rejected', value: preparation.failure };
    }
  }

  async backend(
    _claim: RouterAbEd25519YaoExportAdmissionClaimV1,
  ): Promise<
    RouterAbEd25519YaoRegistrationTwoPhaseBackendResultV1<RouterAbEd25519YaoExportBackendResult>
  > {
    try {
      return {
        kind: 'response',
        value: await this.context.input.backend.admitExport(this.request, this.context.trace),
      };
    } catch (error: unknown) {
      return { kind: 'uncertain', message: errorMessage(error) };
    }
  }

  async complete(
    state: RouterAbEd25519YaoProductRegistrationStateV1,
    claim: RouterAbEd25519YaoExportAdmissionClaimV1,
    outcome: RouterAbEd25519YaoExportBackendResult,
  ): Promise<RouterAbEd25519YaoRegistrationTwoPhaseCompletionV1<ExportResponse>> {
    const value = exportService(this.context, state).commitAdmitExport({
      request: this.request,
      claim,
      outcome: { kind: 'backend_response', result: outcome },
    });
    return { kind: 'state', state, value };
  }
}

class ExportExecutionRequestRun {
  constructor(
    private readonly context: ExportRequestScopedContext,
    private readonly request: RouterAbEd25519YaoExportExecuteRequestV1,
    private readonly authorizationIdentity: RouterAbEd25519YaoExportServerAuthorizationIdentityV1,
  ) {}

  async prepare(
    state: RouterAbEd25519YaoProductRegistrationStateV1,
  ): Promise<
    RouterAbEd25519YaoRegistrationTwoPhasePrepareResultV1<
      RouterAbEd25519YaoExportExecuteClaimV1,
      ExportResponse,
      AuthorizationFailure | RouterAbEd25519YaoExportFailure
    >
  > {
    const preparation = exportService(this.context, state).prepareExecuteExport(
      this.request,
      this.authorizationIdentity,
    );
    switch (preparation.kind) {
      case 'claimed':
        return { kind: 'claimed', state, claim: preparation.claim };
      case 'completed':
        return { kind: 'completed', value: success(preparation.value) };
      case 'failed':
        return { kind: 'rejected', value: preparation.failure };
    }
  }

  async backend(
    _claim: RouterAbEd25519YaoExportExecuteClaimV1,
  ): Promise<
    RouterAbEd25519YaoRegistrationTwoPhaseBackendResultV1<RouterAbEd25519YaoExportBackendResult>
  > {
    try {
      return {
        kind: 'response',
        value: await this.context.input.backend.executeExport(
          this.request,
          _claim.admissionRequest,
          this.context.trace,
        ),
      };
    } catch (error: unknown) {
      return { kind: 'uncertain', message: errorMessage(error) };
    }
  }

  async complete(
    state: RouterAbEd25519YaoProductRegistrationStateV1,
    claim: RouterAbEd25519YaoExportExecuteClaimV1,
    outcome: RouterAbEd25519YaoExportBackendResult,
  ): Promise<RouterAbEd25519YaoRegistrationTwoPhaseCompletionV1<ExportResponse>> {
    const value = exportService(this.context, state).commitExecuteExport({
      request: this.request,
      claim,
      outcome: { kind: 'backend_response', result: outcome },
    });
    return { kind: 'state', state, value };
  }
}

export async function handleRouterAbEd25519YaoExportRequestScopedCloudflareV1(
  input: RouterAbEd25519YaoExportRequestScopedCloudflareInputV1,
): Promise<Response> {
  if (input.request.method !== 'POST') {
    return json(
      { ok: false, code: 'method_not_allowed', message: 'Method not allowed' },
      { status: 405 },
    );
  }
  const trace = resolveTrace(input.request);
  if (!trace.ok) {
    return json({ ok: false, code: 'invalid_trace_id', message: trace.message }, { status: 400 });
  }
  const context: ExportRequestScopedContext = { input, trace: trace.value };
  try {
    return await handleParsedRequest(context, await readJson(input.request));
  } catch (error: unknown) {
    return json(
      { ok: false, code: 'router_state_unavailable', message: errorMessage(error) },
      { status: 503 },
    );
  }
}

async function handleParsedRequest(
  context: ExportRequestScopedContext,
  raw: unknown,
): Promise<Response> {
  const pathname = new URL(context.input.request.url).pathname;
  if (pathname === ROUTER_AB_ED25519_YAO_EXPORT_ADMISSION_PATH_V1) {
    return await handleAdmissionRequest(context, raw);
  }
  if (pathname === ROUTER_AB_ED25519_YAO_EXPORT_EXECUTE_PATH_V1) {
    return await handleExecutionRequest(context, raw);
  }
  return json({ ok: false, code: 'not_found', message: 'Not found' }, { status: 404 });
}

async function handleAdmissionRequest(
  context: ExportRequestScopedContext,
  raw: unknown,
): Promise<Response> {
  const parsed = parseRouterAbEd25519YaoExportAdmissionEnvelopeV1(raw);
  if (!parsed.ok) return invalidBody(parsed.message);
  const expectedOrigin = normalizeCorsOrigin(
    context.input.request.headers.get('origin') || undefined,
  );
  if (!expectedOrigin) {
    return json(
      {
        ok: false,
        code: 'forbidden',
        message: 'Origin header is required and must be a valid exact origin',
      },
      { status: 403 },
    );
  }
  const admission = await runAuthorization(context, parsed, expectedOrigin);
  if (!admission.ok) return exportResponse(admission);
  const result = await runAdmission(context, parsed.protocol, admission.authorizationIdentity);
  if (result.ok) {
    return json(
      {
        protocol: result.value,
        ...(admission.factorRelease ? { factorRelease: admission.factorRelease } : {}),
      },
      { status: result.status },
    );
  }
  return exportResponse(result);
}

async function handleExecutionRequest(
  context: ExportRequestScopedContext,
  raw: unknown,
): Promise<Response> {
  const parsed = parseRouterAbEd25519YaoExportExecuteEnvelopeV1(raw);
  if (!parsed.ok) return invalidBody(parsed.message);
  const authorized = await context.input.authorization.authorizeExecution({
    request: context.input.request,
    body: parsed.protocol,
  });
  if (!authorized.ok) return exportResponse(authorized);
  const run = new ExportExecutionRequestRun(
    context,
    parsed.protocol,
    authorized.authorizationIdentity,
  );
  const result = await runRouterAbEd25519YaoRegistrationTwoPhaseV1<
    RouterAbEd25519YaoExportExecuteClaimV1,
    RouterAbEd25519YaoExportBackendResult,
    ExportResponse,
    AuthorizationFailure | RouterAbEd25519YaoExportFailure
  >({
    lifecycleId: parsed.protocol.binding.ceremony.lifecycle.lifecycle_id,
    store: context.input.store,
    prepare: run.prepare.bind(run),
    backend: run.backend.bind(run),
    complete: run.complete.bind(run),
  });
  return exportResponse(mapExecutionResult(result));
}

/**
 * Authorizes one export admission in a single commit: after its proof
 * verifies, the export's `authorized` state, its nonce claim and its
 * authorized operation commit in one batch or not at all. A retry of the
 * exact request finds the export authorized, or nothing of it.
 */
async function runAuthorization(
  context: ExportRequestScopedContext,
  parsed: ParsedAdmission,
  expectedOrigin: string,
): Promise<AuthorizationRunResult> {
  const lifecycleId = parsed.protocol.scope.lifecycle_id;
  let loaded = await context.input.store.load(lifecycleId);
  const service = exportService(context, loaded.state);
  if (service.authorizationIsUncertain(parsed.protocol)) {
    return authorizationFailure(
      503,
      'export_authorization_uncertain',
      'Export authorization outcome is uncertain and cannot be retried',
    );
  }
  const existingIdentity = service.readAuthorizationIdentity(parsed.protocol);
  let verified: VerifiedAuthorization;
  // An export already authorized answers from its state: its proof is spent,
  // and an Email OTP one cannot be verified again. Its authorization must
  // still be in its window, and its owner must still hold the active
  // material identity.
  if (existingIdentity) {
    if (parsed.protocol.authorization.expires_at_ms <= Date.now()) {
      return authorizationFailure(
        403,
        'export_authorization_expired',
        'Ed25519 Yao export authorization is expired',
      );
    }
    const resolved = await context.input.authorization.resolveAuthorizationIdentity(
      parsed.protocol,
    );
    if (!resolved.ok) return resolved;
    if (!sameAuthorizationIdentity(resolved.authorizationIdentity, existingIdentity)) {
      return authorizationFailure(
        409,
        'export_authorization_conflict',
        'Export authorization owner changed for an existing request',
      );
    }
    verified = { identity: existingIdentity, admission: null };
  } else {
    let authorized: Awaited<
      ReturnType<RouterAbEd25519YaoExportAuthorizationAdapter['authorizeAdmission']>
    >;
    try {
      authorized = await context.input.authorization.authorizeAdmission({
        request: context.input.request,
        body: parsed.protocol,
        authorization: parsed.authorization,
        expectedOrigin,
      });
    } catch (error: unknown) {
      return (
        (await persistAuthorizationUncertain(context, parsed.protocol)) ??
        authorizationFailure(503, 'export_authorization_uncertain', errorMessage(error))
      );
    }
    if (!authorized.ok) return authorized;
    verified = {
      identity: authorized.authorizationIdentity,
      admission: authorized.admission,
      ...(authorized.factorRelease ? { factorRelease: authorized.factorRelease } : {}),
    };
  }
  const authorizationFingerprint = await authorizationFingerprintForIdentity(
    parsed,
    verified.identity,
  );
  for (let attempt = 1; ; attempt += 1) {
    const decision = exportService(context, loaded.state).authorizeExport(
      parsed.protocol,
      authorizationFingerprint,
      verified.identity,
      verified.factorRelease ?? null,
    );
    if (decision.kind === 'completed') {
      return decision.value.ok
        ? authorizedRun({
            identity: verified.identity,
            admission: verified.admission,
            ...(decision.value.factorRelease
              ? { factorRelease: decision.value.factorRelease }
              : {}),
          })
        : decision.value;
    }
    if (!verified.admission) {
      /* The export was authorized when this request began, and is gone. */
      return authorizationFailure(
        503,
        'export_authorization_uncertain',
        'Export authorization changed while it was being replayed',
      );
    }
    const prepared = await verified.admission.prepare();
    if (prepared.kind === 'rejected') return prepared.failure;
    let committed: RouterAbEd25519YaoProductRegistrationPartitionedStateCommitResultV1;
    try {
      committed = await context.input.store.commit({
        lifecycleId,
        state: loaded.state,
        baseline: loaded.baseline,
        companionWrite: prepared.kind === 'prepared' ? prepared.write : null,
      });
    } catch (error: unknown) {
      const rejected = verified.admission.classifyFailure(error);
      if (rejected) return rejected;
      throw error;
    }
    if (committed.kind === 'stored') return authorizedRun(verified);
    if (attempt === EXPORT_AUTHORIZATION_COMMIT_ATTEMPTS) {
      return authorizationFailure(
        409,
        'export_authorization_conflict',
        `Export authorization conflicted on ${committed.key}`,
      );
    }
    loaded = await context.input.store.load(lifecycleId);
  }
}

/* One reload after a concurrent commit: enough for a replay of the same
   request to find the export authorized, without looping on contention. */
const EXPORT_AUTHORIZATION_COMMIT_ATTEMPTS = 2;

type VerifiedAuthorization = {
  readonly identity: RouterAbEd25519YaoExportServerAuthorizationIdentityV1;
  /** Null when the export was already authorized and only its identity was checked. */
  readonly admission: RouterAbEd25519YaoExportOperationAdmissionV1 | null;
  readonly factorRelease?: RouterAbEd25519YaoExportEmailOtpFactorReleaseV1;
};

function authorizedRun(verified: VerifiedAuthorization): AuthorizationRunResult {
  return {
    ok: true,
    authorizationIdentity: verified.identity,
    ...(verified.factorRelease ? { factorRelease: verified.factorRelease } : {}),
  };
}

async function persistAuthorizationUncertain(
  context: ExportRequestScopedContext,
  request: RouterAbEd25519YaoExportAdmissionRequestV1,
): Promise<AuthorizationFailure | null> {
  const loaded = await context.input.store.load(request.scope.lifecycle_id);
  const service = exportService(context, loaded.state);
  service.recordAuthorizationUncertain(request);
  const committed = await context.input.store.commit({
    lifecycleId: request.scope.lifecycle_id,
    state: loaded.state,
    baseline: loaded.baseline,
    companionWrite: null,
  });
  if (committed.kind === 'version_mismatch') {
    return authorizationFailure(
      503,
      'export_authorization_uncertain',
      'Export authorization outcome is uncertain after persistence conflict',
    );
  }
  return null;
}

async function runAdmission(
  context: ExportRequestScopedContext,
  request: RouterAbEd25519YaoExportAdmissionRequestV1,
  authorizationIdentity: RouterAbEd25519YaoExportServerAuthorizationIdentityV1,
): Promise<ExportResponse> {
  const run = new ExportAdmissionRequestRun(context, request, authorizationIdentity);
  const result = await runRouterAbEd25519YaoRegistrationTwoPhaseV1<
    RouterAbEd25519YaoExportAdmissionClaimV1,
    RouterAbEd25519YaoExportBackendResult,
    ExportResponse,
    RouterAbEd25519YaoExportFailure
  >({
    lifecycleId: request.scope.lifecycle_id,
    store: context.input.store,
    prepare: run.prepare.bind(run),
    backend: run.backend.bind(run),
    complete: run.complete.bind(run),
  });
  return mapAdmissionResult(result);
}

function mapAdmissionResult(
  result: RouterAbEd25519YaoRegistrationTwoPhaseRunResultV1<
    RouterAbEd25519YaoExportAdmissionClaimV1,
    ExportResponse,
    RouterAbEd25519YaoExportFailure
  >,
): ExportResponse {
  switch (result.kind) {
    case 'committed':
    case 'completed':
    case 'rejected':
      return result.value;
    case 'preclaim_version_mismatch':
      return stateConflictFailure('admission_failed', 'preclaim', result.key);
    case 'backend_uncertain':
      return backendUncertainFailure('admission_failed', result.message);
    case 'terminal_version_mismatch':
      return stateConflictFailure('admission_failed', 'terminal', result.key);
  }
}

function mapExecutionResult(
  result: RouterAbEd25519YaoRegistrationTwoPhaseRunResultV1<
    RouterAbEd25519YaoExportExecuteClaimV1,
    ExportResponse,
    AuthorizationFailure | RouterAbEd25519YaoExportFailure
  >,
): ExportResponse {
  switch (result.kind) {
    case 'committed':
    case 'completed':
    case 'rejected':
      return result.value;
    case 'preclaim_version_mismatch':
      return stateConflictFailure('execution_failed', 'preclaim', result.key);
    case 'backend_uncertain':
      return backendUncertainFailure('execution_failed', result.message);
    case 'terminal_version_mismatch':
      return stateConflictFailure('execution_failed', 'terminal', result.key);
  }
}

function exportService(
  context: ExportRequestScopedContext,
  state: RouterAbEd25519YaoProductRegistrationStateV1,
): InMemoryRouterAbEd25519YaoExportService {
  return new InMemoryRouterAbEd25519YaoExportService(
    context.input.backend,
    context.input.capabilities,
    state.export,
  );
}

function stateConflictFailure(
  code: 'admission_failed' | 'execution_failed',
  phase: 'preclaim' | 'terminal',
  key: Extract<
    RouterAbEd25519YaoProductRegistrationPartitionedStateCommitResultV1,
    { readonly kind: 'version_mismatch' }
  >['key'],
): RouterAbEd25519YaoExportFailure {
  return {
    ok: false,
    status: phase === 'preclaim' ? 409 : 503,
    code,
    message:
      phase === 'preclaim'
        ? `Yao export claim conflicted on ${key}`
        : `Yao export terminal state is uncertain after a ${key} conflict`,
  };
}

function backendUncertainFailure(
  code: 'admission_failed' | 'execution_failed',
  message: string,
): RouterAbEd25519YaoExportFailure {
  return { ok: false, status: 503, code, message };
}

function authorizationFailure(
  status: 403 | 409 | 503,
  code: string,
  message: string,
): AuthorizationFailure {
  return { ok: false, status, code, message };
}

function success<T>(value: T): { readonly ok: true; readonly status: 200; readonly value: T } {
  return { ok: true, status: 200, value };
}

function invalidBody(message: string): Response {
  return json({ ok: false, code: 'invalid_body', message }, { status: 400 });
}

function exportResponse(result: ExportResponse): Response {
  return result.ok
    ? json(result.value, { status: result.status })
    : json({ ok: false, code: result.code, message: result.message }, { status: result.status });
}

async function authorizationFingerprintForIdentity(
  parsed: ParsedAdmission,
  authorizationIdentity: RouterAbEd25519YaoExportServerAuthorizationIdentityV1,
): Promise<string> {
  const canonical = alphabetizeStringify({
    authorizationIdentity,
    authorization: parsed.authorization,
  });
  return base64UrlEncode(await sha256BytesUtf8(canonical));
}

function sameAuthorizationIdentity(
  left: RouterAbEd25519YaoExportServerAuthorizationIdentityV1,
  right: RouterAbEd25519YaoExportServerAuthorizationIdentityV1,
): boolean {
  return left.thresholdSessionId === right.thresholdSessionId;
}

function resolveTrace(request: Request): TraceResolution {
  const parsed = parseRouterAbTraceContextV1(request.headers.get(ROUTER_AB_TRACE_ID_HEADER_V1));
  if (parsed.ok) return parsed;
  if (parsed.reason === 'missing') return { ok: true, value: createRouterAbTraceContextV1() };
  return { ok: false, message: parsed.message };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

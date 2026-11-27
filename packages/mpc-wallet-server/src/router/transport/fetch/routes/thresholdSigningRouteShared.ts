import type { RuntimePolicyScope } from '@shared/threshold/signingRootScope';
import type { WalletId } from '@shared/utils/domainIds';
import { failure } from '@shared/utils/failure';
import { isPlainObject } from '@shared/utils/validation';
import type {
  AuthorizedOperation,
  OwnerOperationAuthorizationDecision,
} from '../../../../authorization/domain';
import type { PinnedOwnerWalletScope } from '../../../../authorization/ecdsaWalletSessionAdmission';
import type { OperationStepUpBinding } from '../../../domains/signingOperations/authorizedOperationWire';
import type { RouterApiAuthorizedOperationService } from '../../../framework/authServicePort';
import { json, jsonFailure, readJson } from '../../../framework/http';
import type { FetchRouterApiContext } from '../createFetchRouter';

/** Milliseconds each stage of a signing request took; null for a stage it did not reach. */
export type SigningGatewayTiming = {
  authorize: number | null;
  admit: number | null;
  proxy: number | null;
  complete: number | null;
  total: number | null;
};

export function emptySigningGatewayTiming(): SigningGatewayTiming {
  return { authorize: null, admit: null, proxy: null, complete: null, total: null };
}

/**
 * Runs a route and answers with its response plus a `Server-Timing` entry
 * `<prefix><stage>` for each stage it reached, then the `extra` entries.
 */
export async function withServerTiming<
  T extends Record<string, number | null> & { total: number | null },
>(
  prefix: string,
  timing: T,
  run: () => Promise<Response>,
  extra: ReadonlyMap<string, number> = new Map(),
): Promise<Response> {
  const startedAt = performance.now();
  const response = await run();
  timing.total = performance.now() - startedAt;
  const headers = new Headers(response.headers);
  for (const [stage, duration] of Object.entries(timing)) {
    if (duration !== null) {
      headers.append('Server-Timing', `${prefix}${stage};dur=${Math.max(0, duration).toFixed(1)}`);
    }
  }
  for (const [name, duration] of extra) {
    headers.append('Server-Timing', `${name};dur=${duration.toFixed(1)}`);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * The JSON body of a POST to one of `paths`, or null for any other request.
 * A body that is not JSON reads as `body: null`.
 */
export async function readThresholdRouteBody(
  ctx: FetchRouterApiContext,
  paths: readonly string[],
): Promise<{ readonly pathname: string; readonly body: unknown } | null> {
  if (ctx.method !== 'POST' || !paths.includes(ctx.pathname)) return null;
  return { pathname: ctx.pathname, body: await readJson(ctx.request.clone()) };
}

/** A JSON object body as a record; any other body as an empty one. */
export function jsonObjectOrEmpty(body: unknown): Record<string, unknown> {
  return isPlainObject(body) ? body : {};
}

/** A refusal that a route answers later with `json(error.body, { status: error.status })`. */
export function failureResult(
  status: number,
  code: string,
  message: string,
): {
  readonly ok: false;
  readonly error: { readonly status: number; readonly body: ReturnType<typeof failure> };
} {
  return { ok: false, error: { status, body: failure(code, message) } };
}

/** The request half of a normal-signing authorization, which both curves send alike. */
export function normalSigningAuthorizationRequest<P>(input: {
  readonly ctx: FetchRouterApiContext;
  readonly body: Record<string, unknown>;
  readonly phase: P;
}) {
  return {
    body: input.body,
    rawBody: input.body,
    headers: Object.fromEntries(input.ctx.request.headers.entries()),
    session: input.ctx.opts.session,
    authorizedOperations: input.ctx.service.authorizedOperations,
    authorizationSessions: input.ctx.service.authorizationSessions,
    admissionAdapter: input.ctx.opts.routerAbNormalSigningAdmission,
    phase: input.phase,
  };
}

/** The Wallet Session that admitted a normal-signing request with an operation credential. */
export function reusableWalletSession<S>(
  authorization:
    | {
        readonly kind: 'wallet_session_operation_credential_v1';
        readonly validated: {
          readonly admission: {
            readonly context: { readonly authorization: { readonly session: S } };
          };
        };
      }
    | {
        readonly kind: 'wallet_session_operation_credential_exhausted_candidate_v1';
        readonly candidate: { readonly status: { readonly session: S } };
      },
): S {
  return authorization.kind === 'wallet_session_operation_credential_v1'
    ? authorization.validated.admission.context.authorization.session
    : authorization.candidate.status.session;
}

/** The Router binding for an operation that a reusable Wallet Session admitted. */
export function gatewayOwnerWalletSessionBinding(input: {
  readonly session: {
    readonly principalId: string;
    readonly walletId: string;
    readonly authorizationId: string;
    readonly walletSessionId: string;
    readonly quotaId: string;
    readonly expiresAtMs: number;
  };
  readonly pinned: PinnedOwnerWalletScope;
  readonly runtimePolicyScope: RuntimePolicyScope;
  readonly thresholdSessionId: string;
  readonly signingWorkerId: string;
}) {
  const { session, pinned, runtimePolicyScope } = input;
  return {
    kind: 'gateway_owner_wallet_session' as const,
    ownershipGeneration: pinned.ownershipGeneration,
    subjectId: String(session.principalId),
    accountId: String(session.walletId),
    authorizationId: String(session.authorizationId),
    walletSessionId: String(session.walletSessionId),
    quotaId: String(session.quotaId),
    thresholdSessionId: input.thresholdSessionId,
    orgId: runtimePolicyScope.orgId,
    projectId: runtimePolicyScope.projectId,
    environment: runtimePolicyScope.envId,
    projectEnvironmentId: pinned.projectEnvironmentId,
    signingWorkerId: input.signingWorkerId,
    expiresAtMs: session.expiresAtMs,
  };
}

type OperationStepUpSession = {
  readonly sessionId: string;
  readonly principalId: string;
  readonly walletId: string;
  readonly runtimePolicyScope: RuntimePolicyScope;
};

/** The wallet scope that the store pinned when it claimed a verified step-up's operation. */
export async function readPinnedStepUpWalletScope(
  ctx: FetchRouterApiContext,
  walletId: WalletId,
  scope: RuntimePolicyScope,
  operation: AuthorizedOperation,
): Promise<PinnedOwnerWalletScope> {
  const pinned = await ctx.service.authorizedOperations.readPinnedOwnerWalletScope({
    operation,
    walletId,
  });
  if (pinned.orgId !== scope.orgId || pinned.projectId !== scope.projectId) {
    throw new Error('Step-up wallet scope differs from the Wallet Session scope');
  }
  return pinned;
}

/**
 * The Router binding for a verified step-up: the wallet it signs for and the
 * Console project environment of the store that claimed the operation, so
 * the SigningWorker reaches the wallet's own storage.
 */
export function operationStepUpBinding(
  session: OperationStepUpSession,
  pinned: PinnedOwnerWalletScope,
): OperationStepUpBinding {
  const scope = session.runtimePolicyScope;
  return {
    kind: 'operation_step_up',
    ownershipGeneration: pinned.ownershipGeneration,
    authorizationSessionId: session.sessionId,
    orgId: scope.orgId,
    projectId: scope.projectId,
    environment: scope.envId,
    projectEnvironmentId: pinned.projectEnvironmentId,
    subjectId: session.principalId,
    accountId: session.walletId,
  };
}

/** The 403 for a reusable Wallet Session operation that the owner decision did not authorize. */
export function ownerOperationNotAuthorizedResponse(
  decision: Exclude<OwnerOperationAuthorizationDecision<unknown>, { readonly kind: 'authorized' }>,
  notAdmittedMessage: string,
): Response {
  const denial =
    decision.kind === 'denied'
      ? decision.denial
      : { code: 'authorization_unavailable' as const, message: notAdmittedMessage };
  return json(
    {
      ok: false,
      code: denial.code,
      message: denial.message,
      authorization_decision: { kind: 'denied' as const, denial },
    },
    { status: 403 },
  );
}

type AuthorizedOperationAdmissionKind = Awaited<
  ReturnType<RouterApiAuthorizedOperationService['admitAuthorizedOperation']>
>['kind'];

/**
 * The refusal for a verified step-up that the store did not admit, or null
 * when the store claimed the operation, is running it or replays it.
 */
export function operationStepUpAdmissionRefusal(
  kind: AuthorizedOperationAdmissionKind,
  curve: 'ECDSA' | 'Ed25519',
): Response | null {
  switch (kind) {
    case 'claimed':
    case 'operation_in_progress':
    case 'replayed':
      return null;
    case 'authorization_grant_rejected':
    case 'verified_step_up_rejected':
      return jsonFailure(403, kind, `${curve} operation step-up authorization is invalid`);
    case 'billing_credit_exhausted':
      return jsonFailure(402, kind, 'The application has no available signing credit');
    case 'wallet_session_quota_exhausted':
    case 'material_mismatch':
      return jsonFailure(409, kind, `${curve} operation step-up authorization is unavailable`);
  }
}

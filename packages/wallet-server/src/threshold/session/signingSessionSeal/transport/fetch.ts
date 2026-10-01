import type { NormalizedLogger } from '../../../../core/logger';
import { headersToRecord, readJson } from '../../../../router/framework/http';
import {
  buildSigningSessionSealApplyPath,
  buildSigningSessionSealRemovePath,
  authorizeSigningSessionSealRequest,
  parseSigningSessionSealApplyBody,
  parseSigningSessionSealRemoveBody,
  signingSessionSealAuthorizeStatusCode,
  signingSessionSealStatusCode,
  resolveSigningSessionSealBasePath,
} from './shared';
import type { SigningSessionSealRoutesOptions } from '../signingSessionSeal.types';
import { failure } from '@shared/utils/failure';

type FetchSigningSessionSealContext = {
  request: Request;
  pathname: string;
  method: string;
  logger: NormalizedLogger;
  authorize?: SigningSessionSealRoutesOptions['authorize'];
  options: SigningSessionSealRoutesOptions | null | undefined;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Internal error');
}

export async function handleSigningSessionSealRoutes(
  ctx: FetchSigningSessionSealContext,
): Promise<Response | null> {
  const options = ctx.options;
  if (!options) return null;

  const basePath = resolveSigningSessionSealBasePath(options.basePath);
  const applyPath = buildSigningSessionSealApplyPath(basePath);
  const removePath = buildSigningSessionSealRemovePath(basePath);

  const isApply = ctx.method === 'POST' && ctx.pathname === applyPath;
  const isRemove = ctx.method === 'POST' && ctx.pathname === removePath;
  if (!isApply && !isRemove) return null;

  const startedAtMs = Date.now();
  const operation = isApply ? 'apply-server-seal' : 'remove-server-seal';
  try {
    ctx.logger.info('[threshold-signing-session-seal] request', {
      route: isApply ? applyPath : removePath,
      operation,
    });
    const body = await readJson(ctx.request);
    const parsed = isApply
      ? parseSigningSessionSealApplyBody(body)
      : parseSigningSessionSealRemoveBody(body);
    if (!parsed.ok) {
      ctx.logger.warn('[threshold-signing-session-seal] invalid_body', {
        route: isApply ? applyPath : removePath,
        operation,
        code: parsed.code,
        message: parsed.message,
        durationMs: Math.max(0, Date.now() - startedAtMs),
      });
      return json(failure(parsed.code, parsed.message), 400);
    }

    const authorized = await authorizeSigningSessionSealRequest({
      options,
      headers: headersToRecord(ctx.request.headers),
      authorize: ctx.authorize,
      thresholdSessionId: parsed.value.thresholdSessionId,
    });
    if (!authorized.ok) {
      ctx.logger.warn('[threshold-signing-session-seal] unauthorized', {
        route: isApply ? applyPath : removePath,
        operation,
        code: authorized.code || 'unauthorized',
        message: authorized.message || 'Unauthorized',
        durationMs: Math.max(0, Date.now() - startedAtMs),
      });
      return json(
        failure(authorized.code || 'unauthorized', authorized.message || 'Unauthorized'),
        signingSessionSealAuthorizeStatusCode(authorized),
      );
    }

    const result = isApply
      ? await options.service.applyServerSeal(parsed.value, authorized.auth)
      : await options.service.removeServerSeal(parsed.value, authorized.auth);
    const status = signingSessionSealStatusCode(result);
    ctx.logger.info('[threshold-signing-session-seal] response', {
      route: isApply ? applyPath : removePath,
      operation,
      status,
      ok: result.ok,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      userId: authorized.auth.userId,
    });
    return json(result, status);
  } catch (error: unknown) {
    const message = errMessage(error);
    ctx.logger.error('[threshold-signing-session-seal] error', {
      route: isApply ? applyPath : removePath,
      message,
      durationMs: Math.max(0, Date.now() - startedAtMs),
    });
    return json(failure('internal', message), 500);
  }
}

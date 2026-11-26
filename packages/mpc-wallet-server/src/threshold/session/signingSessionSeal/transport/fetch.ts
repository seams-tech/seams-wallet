import type { NormalizedLogger } from '../../../../core/logger';
import { headersToRecord, readJson } from '../../../../router/framework/http';
import {
  buildSigningSessionSealEvaluatePath,
  authorizeSigningSessionSealRequest,
  parseSigningSessionSealEvaluateBody,
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
  const route = buildSigningSessionSealEvaluatePath(basePath);
  if (ctx.method !== 'POST' || ctx.pathname !== route) return null;

  const startedAtMs = Date.now();
  try {
    ctx.logger.info('[threshold-signing-session-seal] request', { route });
    const body = await readJson(ctx.request);
    const parsed = parseSigningSessionSealEvaluateBody(body);
    if (!parsed.ok) {
      ctx.logger.warn('[threshold-signing-session-seal] invalid_body', {
        route,
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
        route,
        code: authorized.code || 'unauthorized',
        message: authorized.message || 'Unauthorized',
        durationMs: Math.max(0, Date.now() - startedAtMs),
      });
      return json(
        failure(authorized.code || 'unauthorized', authorized.message || 'Unauthorized'),
        signingSessionSealAuthorizeStatusCode(authorized),
      );
    }

    const result = await options.service.evaluate(parsed.value, authorized.auth);
    const status = signingSessionSealStatusCode(result);
    ctx.logger.info('[threshold-signing-session-seal] response', {
      route,
      status,
      ok: result.ok,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      userId: authorized.auth.userId,
    });
    return json(result, status);
  } catch (error: unknown) {
    const message = errMessage(error);
    ctx.logger.error('[threshold-signing-session-seal] error', {
      route,
      message,
      durationMs: Math.max(0, Date.now() - startedAtMs),
    });
    return json(failure('internal', message), 500);
  }
}

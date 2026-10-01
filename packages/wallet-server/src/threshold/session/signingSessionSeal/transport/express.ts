import type { Request, Response, Router as ExpressRouter } from 'express';
import type { NormalizedLogger } from '../../../../core/logger';
import type { SessionAdapter } from '../../../../router/framework/routerApi';
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

type ExpressSigningSessionSealContext = {
  logger: NormalizedLogger;
  session: SessionAdapter | null | undefined;
  options: SigningSessionSealRoutesOptions | null | undefined;
};

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Internal error');
}

export function registerSigningSessionSealRoutes(
  router: ExpressRouter,
  ctx: ExpressSigningSessionSealContext,
): void {
  const options = ctx.options;
  ctx.logger.info('[threshold-signing-session-seal] routes', { enabled: Boolean(options) });
  if (!options) return;

  const basePath = resolveSigningSessionSealBasePath(options.basePath);
  const applyPath = buildSigningSessionSealApplyPath(basePath);
  const removePath = buildSigningSessionSealRemovePath(basePath);

  const handleSealRoute =
    (route: string, operation: 'apply-server-seal' | 'remove-server-seal') =>
    async (req: Request, res: Response) => {
      const startedAtMs = Date.now();
      try {
        ctx.logger.info('[threshold-signing-session-seal] request', { route, operation });
        const parsed =
          operation === 'apply-server-seal'
            ? parseSigningSessionSealApplyBody(req.body || {})
            : parseSigningSessionSealRemoveBody(req.body || {});
        if (!parsed.ok) {
          ctx.logger.warn('[threshold-signing-session-seal] invalid_body', {
            route,
            operation,
            code: parsed.code,
            message: parsed.message,
            durationMs: Math.max(0, Date.now() - startedAtMs),
          });
          res.status(400).json(failure(parsed.code, parsed.message));
          return;
        }

        const authorized = await authorizeSigningSessionSealRequest({
          options,
          headers: req.headers || {},
          thresholdSessionId: parsed.value.thresholdSessionId,
        });
        if (!authorized.ok) {
          ctx.logger.warn('[threshold-signing-session-seal] unauthorized', {
            route,
            operation,
            code: authorized.code || 'unauthorized',
            message: authorized.message || 'Unauthorized',
            durationMs: Math.max(0, Date.now() - startedAtMs),
          });
          res
            .status(signingSessionSealAuthorizeStatusCode(authorized))
            .json(failure(authorized.code || 'unauthorized', authorized.message || 'Unauthorized'));
          return;
        }

        const result =
          operation === 'apply-server-seal'
            ? await options.service.applyServerSeal(parsed.value, authorized.auth)
            : await options.service.removeServerSeal(parsed.value, authorized.auth);
        const status = signingSessionSealStatusCode(result);
        res.status(status).json(result);
        ctx.logger.info('[threshold-signing-session-seal] response', {
          route,
          status,
          ok: result.ok,
          durationMs: Math.max(0, Date.now() - startedAtMs),
          userId: authorized.auth.userId,
        });
      } catch (error: unknown) {
        const message = errMessage(error);
        ctx.logger.error('[threshold-signing-session-seal] error', {
          route,
          message,
          durationMs: Math.max(0, Date.now() - startedAtMs),
        });
        res.status(500).json(failure('internal', message));
      }
    };

  router.post(applyPath, handleSealRoute(applyPath, 'apply-server-seal'));
  router.post(removePath, handleSealRoute(removePath, 'remove-server-seal'));
}

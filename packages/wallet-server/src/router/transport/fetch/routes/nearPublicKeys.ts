import type { FetchRouterApiContext } from '../createFetchRouter';
import { json, jsonFailure } from '../../../framework/http';
import { extractBearerCredential } from '../../../auth/routerApiKeyAuth';

export async function handleNearPublicKeys(ctx: FetchRouterApiContext): Promise<Response | null> {
  if (ctx.method !== 'GET') return null;
  if (ctx.pathname !== '/near/public-keys') return null;

  try {
    const token = extractBearerCredential(ctx.request.headers);
    if (!token) {
      return jsonFailure(401, 'unauthorized', 'No valid Wallet Session');
    }
    const nowMs = Date.now();
    const exact =
      await ctx.service.authorizationSessions.readWalletSessionAuthorizationV2ByOperationCredential(
        {
          tenantId: ctx.service.authorizationSessions.tenantId,
          token,
          nowMs,
        },
      );
    if (!exact) {
      return jsonFailure(401, 'unauthorized', 'No valid Wallet Session');
    }

    const result = await ctx.service.nearFunding.listNearPublicKeysForUser({
      userId: String(exact.authorization.session.walletId),
    });
    if (!result.ok) {
      const status =
        result.code === 'not_supported' ? 501 : result.code === 'invalid_args' ? 400 : 500;
      return json(result, { status });
    }

    return json(result, { status: 200 });
  } catch (e: any) {
    return jsonFailure(500, 'internal', e?.message || 'Internal error');
  }
}

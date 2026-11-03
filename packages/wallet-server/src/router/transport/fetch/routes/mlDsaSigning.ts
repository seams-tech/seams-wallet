import {
  mlDsaRouterKeyScope,
  type MlDsaSigningTarget,
  type PreparedMlDsaOwnerOperation,
} from '../../../domains/signingOperations/mlDsaOwnerAdmission';
import { parseMlDsaStockProgress, type MlDsaStockProgress } from '@shared/near/mlDsaSigning';
import type { RouterAbNormalSigningRouterProxy } from '../../../framework/routerApi';
import { json } from '../../../framework/http';
import {
  normalizeRouterAbInternalServiceAuthSecret,
  ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
} from '../../../../core/ThresholdService/routerAb/internalServiceHttp';

/** Only an exact admitted owner operation can reach the private Router signer. */
export async function dispatchMlDsaOwnerOperation(
  proxy: RouterAbNormalSigningRouterProxy,
  operation: PreparedMlDsaOwnerOperation,
): Promise<Response> {
  if (Date.now() >= operation.expiresAtMs) {
    return json({ ok: false, code: 'ml_dsa_owner_evidence_expired' }, { status: 403 });
  }
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set(
    ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
    normalizeRouterAbInternalServiceAuthSecret(proxy.internalServiceAuthSecret),
  );
  const request = new Request('https://router-ab.internal/router-ab/ml-dsa/sign', {
    method: 'POST',
    headers,
    body: operation.encode(),
  });
  return proxy.fetch(request);
}

/**
 * Best effort. The Router counts this read as signing demand, so a key that went idle
 * starts to refill while its owner reviews the transaction.
 */
export async function readMlDsaStock(
  proxy: RouterAbNormalSigningRouterProxy,
  target: MlDsaSigningTarget,
): Promise<MlDsaStockProgress | null> {
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set(
    ROUTER_AB_INTERNAL_SERVICE_AUTH_HEADER_V1,
    normalizeRouterAbInternalServiceAuthSecret(proxy.internalServiceAuthSecret),
  );
  try {
    const response = await proxy.fetch(
      new Request('https://router-ab.internal/router-ab/ml-dsa/stock', {
        method: 'POST',
        headers,
        body: JSON.stringify({ key: await mlDsaRouterKeyScope(target) }),
      }),
    );
    if (response.status !== 200) return null;
    return parseMlDsaStockProgress(await response.json());
  } catch {
    return null;
  }
}

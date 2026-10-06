import type { Request, Response } from '@playwright/test';
import { requireRecord } from '@shared/utils/validation';

const ROUTER_AB_WALLET_BUDGET_STATUS_PATH = '/wallet/session/status';

export type CapturedWalletBudgetStatusRequest = {
  url: string;
  authorization: string;
  contentType: string;
  body: string;
  walletSessionId: string;
  quotaId: string;
};

export function captureWalletBudgetStatusRequest(
  request: Request,
  routerUrl: string,
): CapturedWalletBudgetStatusRequest | null {
  if (request.method() !== 'POST') return null;
  let requestUrl: URL;
  let routerOrigin: string;
  try {
    requestUrl = new URL(request.url());
    routerOrigin = new URL(routerUrl).origin;
  } catch {
    return null;
  }
  if (
    requestUrl.origin !== routerOrigin ||
    requestUrl.pathname !== ROUTER_AB_WALLET_BUDGET_STATUS_PATH
  ) {
    return null;
  }

  const headers = request.headers();
  const authorization = headers.authorization?.trim() ?? '';
  const contentType = headers['content-type']?.trim() ?? 'application/json';
  const body = request.postData();
  if (!authorization.startsWith('Bearer ') || !body) return null;

  let walletSessionId: string;
  let quotaId: string;
  try {
    const parsed: unknown = JSON.parse(body);
    const requestBody = requireRecord(parsed, 'wallet budget status request body');
    if (
      Object.keys(requestBody).length !== 2 ||
      typeof requestBody.walletSessionId !== 'string' ||
      typeof requestBody.quotaId !== 'string'
    )
      return null;
    walletSessionId = requestBody.walletSessionId;
    quotaId = requestBody.quotaId;
  } catch {
    return null;
  }

  return {
    url: request.url(),
    authorization,
    contentType,
    body,
    walletSessionId,
    quotaId,
  };
}

/** Capture the session identity for an independent, post-signing budget query. */
export async function capturePreparedWalletBudgetStatus(
  response: Response,
): Promise<CapturedWalletBudgetStatusRequest | null> {
  try {
    const body = requireRecord(await response.json(), 'prepare response');
    if (body.kind !== 'reusable_wallet_session') return null;
    const status = requireRecord(body.session_status, 'prepare session');
    if (typeof status.walletSessionId !== 'string' || typeof status.quotaId !== 'string')
      return null;
    const authorization = response.request().headers().authorization;
    if (!authorization?.startsWith('Bearer ')) return null;
    return {
      url: new URL(ROUTER_AB_WALLET_BUDGET_STATUS_PATH, response.url()).href,
      authorization,
      contentType: 'application/json',
      body: JSON.stringify({ walletSessionId: status.walletSessionId, quotaId: status.quotaId }),
      walletSessionId: status.walletSessionId,
      quotaId: status.quotaId,
    };
  } catch {
    return null;
  }
}

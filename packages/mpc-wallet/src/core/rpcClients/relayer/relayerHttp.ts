import type { WalletSessionHome } from '@shared/device-linking/contracts';
import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking/contracts';
import { isPlainObject } from '@shared/utils/validation';
import { stripTrailingSlashes } from '@shared/utils/normalize';

type RelayerHttpHeaders = Readonly<Record<string, string>>;

export function normalizeRelayerBaseUrl(
  value: unknown,
  options: { trim: boolean } = { trim: true },
): string {
  const raw = String(value ?? '');
  return stripTrailingSlashes(options.trim ? raw.trim() : raw);
}

export function buildBearerAuthorizationHeader(args: {
  token: unknown;
  missingMessage: string;
}): Record<string, string> {
  const token = String(args.token ?? '').trim();
  if (!token) throw new Error(args.missingMessage);
  return { Authorization: `Bearer ${token}` };
}

export function buildRelayerJsonPostRequestInit(args: {
  body: unknown;
  headers?: RelayerHttpHeaders;
  bodyJson?: string;
}): RequestInit {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(args.headers || {}),
    },
    credentials: 'omit',
    body: args.bodyJson ?? JSON.stringify(args.body),
  };
}

/**
 * Runs the CORS preflight of relayer routes ahead of their first request.
 *
 * A cross-origin JSON request costs one preflight exchange for each new URL.
 * The browser caches the answer for that URL, so an early preflight takes the
 * exchange out of the later request's path. An `OPTIONS` fetch is the smallest
 * request that makes the browser run one.
 *
 * Best effort: a failed preflight changes nothing, because the later request
 * runs its own. A same-origin relayer needs no preflight and gets no request.
 */
export function prewarmRelayerPreflights(relayerUrl: string, paths: readonly string[]): void {
  const base = normalizeRelayerBaseUrl(relayerUrl);
  const pageOrigin = globalThis.location?.origin;
  let relayerOrigin: string;
  try {
    relayerOrigin = new URL(base).origin;
  } catch {
    return;
  }
  if (!pageOrigin || relayerOrigin === pageOrigin) return;
  for (const path of paths) {
    void fetch(`${base}${path}`, { method: 'OPTIONS', credentials: 'omit' }).catch(() => {});
  }
}

export function buildWalletSessionAuthorizationHeaders(
  credential: Pick<WalletSessionOperationCredentialV1, 'token' | 'home'>,
): Record<string, string> {
  const headers = buildBearerAuthorizationHeader({
    token: credential.token,
    missingMessage: 'Wallet Session token is required',
  });
  return { ...headers, ...buildWalletHomeRoutingHeaders(credential.home) };
}

export function buildWalletHomeRoutingHeaders(home: WalletSessionHome): Record<string, string> {
  switch (home.kind) {
    case 'direct':
      return {};
    case 'regional':
      return { 'X-Seams-Wallet-Region': home.region };
  }
}

// Only the Gateway's explicit pre-admission routing refusal permits rediscovery.
// Preserve the exact operation body and bearer token through the public entrypoint.
export async function fetchWithWalletHomeDiscovery(request: Request): Promise<Response> {
  const response = await fetch(request.clone());
  if (response.status !== 409 || !request.headers.has('X-Seams-Wallet-Region')) return response;
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  if (!isPlainObject(body) || body.code !== 'wallet_home_discovery_required') return response;
  const headers = new Headers(request.headers);
  headers.delete('X-Seams-Wallet-Region');
  return fetch(new Request(request, { headers }));
}

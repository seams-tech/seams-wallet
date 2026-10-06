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

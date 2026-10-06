import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking/contracts';
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
  credential: WalletSessionOperationCredentialV1,
): Record<string, string> {
  const headers = buildBearerAuthorizationHeader({
    token: credential.token,
    missingMessage: 'Wallet Session token is required',
  });
  switch (credential.home.kind) {
    case 'direct':
      return headers;
    case 'regional':
      return { ...headers, 'X-Seams-Wallet-Region': credential.home.region };
  }
}

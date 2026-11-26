import { requireRecord } from '@shared/utils/validation';
import {
  buildWalletSessionAuthorizationHeaders,
  fetchWithWalletHomeDiscovery,
} from '@/core/rpcClients/relayer/relayerHttp';
import { errorMessage } from '@shared/utils/errors';
import { joinNormalizedUrl } from '@shared/utils/normalize';
import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking';

type EmailOtpWorkerJson = Record<string, unknown>;

export async function postEmailOtpJson(args: {
  relayUrl: string;
  route: string;
  body: EmailOtpWorkerJson;
  sessionAuth?: WalletSessionOperationCredentialV1;
}): Promise<EmailOtpWorkerJson> {
  const url = joinNormalizedUrl(args.relayUrl, args.route);
  try {
    const request = new Request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(args.sessionAuth ? buildWalletSessionAuthorizationHeaders(args.sessionAuth) : {}),
      },
      credentials: args.sessionAuth ? 'omit' : 'include',
      body: JSON.stringify(args.body),
    });
    const response = args.sessionAuth
      ? await fetchWithWalletHomeDiscovery(request)
      : await fetch(request);
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`${url} returned non-JSON response (HTTP ${response.status})`);
    }
    const objectJson = requireRecord(json, url);
    if (!response.ok || objectJson.ok === false) {
      const message =
        (typeof objectJson.message === 'string' && objectJson.message.trim()) ||
        `${url} failed (HTTP ${response.status})`;
      throw new Error(message);
    }
    return objectJson;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

import type { SignedDelegate } from '@/core/types/delegate';
import type { DelegateRelayHooksOptions } from '@/core/types/sdkSentEvents';
import { SigningEventPhase } from '@/core/types/sdkSentEvents';
import type { DelegateRouterApiResult } from '@/core/types/seams';
import type { WasmSignedDelegate } from '@/core/types/signer-worker';
import { isObject } from '@shared/utils/validation';
import { emitNearSigningEvent } from './signingEventHelpers';
interface RouterApiDelegateRequest {
  hash: string;
  signedDelegate: SignedDelegate | WasmSignedDelegate;
}
/**
 * Credentials the Router API `/signed-delegate` route requires. Its auth plane
 * is `api_credentials` with `publishable_key`, plus environment + origin
 * binding. The publishable key travels as a Bearer token, the environment id
 * as `X-Seams-Environment-Id`; the Origin header is added by the browser.
 */
export interface DelegateRelayerAuth {
  publishableKey?: string;
  environmentId?: string;
}
/** HTTP header carrying the managed environment id for Router API auth. */
const ROUTER_API_ENVIRONMENT_ID_HEADER = 'X-Seams-Environment-Id';
const DELEGATE_RELAYER_TIMEOUT_MS = 30000;
function buildDelegateRelayerHeaders(auth?: DelegateRelayerAuth): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const publishableKey = String(auth?.publishableKey ?? '').trim();
  if (publishableKey) headers.Authorization = `Bearer ${publishableKey}`;
  const environmentId = String(auth?.environmentId ?? '').trim();
  if (environmentId) headers[ROUTER_API_ENVIRONMENT_ID_HEADER] = environmentId;
  return headers;
}
function parseDelegateRelayerFailure(body: unknown, status: number): DelegateRouterApiResult {
  if (!isObject(body)) {
    return { ok: false, error: `Relayer HTTP ${status}` };
  }
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const message =
    typeof body.message === 'string'
      ? body.message.trim()
      : typeof body.error === 'string'
        ? body.error.trim()
        : '';
  const detail = message || `Relayer HTTP ${status}`;
  return {
    ok: false,
    error: code ? `${detail} (${code})` : detail,
  };
}
/**
 * Extracts the delegate relayer credentials from resolved SDK configs. Managed
 * registration carries the publishable key + project environment id the Router
 * API needs; other modes have no credentials to send (returns `{}`).
 */
export function delegateRelayerAuthFromConfigs(configs: unknown): DelegateRelayerAuth {
  const registration = (
    configs as
      | {
          registration?: unknown;
        }
      | null
      | undefined
  )?.registration;
  if (!registration || typeof registration !== 'object') return {};
  if (
    (
      registration as {
        mode?: unknown;
      }
    ).mode !== 'managed'
  )
    return {};
  const publishableKey = String(
    (
      registration as {
        publishableKey?: unknown;
      }
    ).publishableKey ?? '',
  ).trim();
  const environmentId = String(
    (
      registration as {
        projectEnvironmentId?: unknown;
      }
    ).projectEnvironmentId ?? '',
  ).trim();
  return {
    ...(publishableKey ? { publishableKey } : {}),
    ...(environmentId ? { environmentId } : {}),
  };
}
const toNumberArray = (value: number[] | Uint8Array): number[] =>
  Array.isArray(value) ? value : Array.from(value);
const normalizeSignedDelegateForRelay = (
  signedDelegate: SignedDelegate | WasmSignedDelegate,
): SignedDelegate => {
  const delegateAction = signedDelegate.delegateAction as SignedDelegate['delegateAction'] & {
    publicKey: {
      keyType: number;
      keyData: number[] | Uint8Array;
    };
  };
  const signature = signedDelegate.signature as SignedDelegate['signature'] & {
    keyType: number;
    signatureData: number[] | Uint8Array;
  };
  return {
    delegateAction: {
      ...delegateAction,
      publicKey: {
        ...delegateAction.publicKey,
        keyData: toNumberArray(delegateAction.publicKey.keyData),
      },
    },
    signature: {
      ...signature,
      signatureData: toNumberArray(signature.signatureData),
    },
  };
};
export async function sendDelegateActionViaRelayer(args: {
  url: string;
  payload: RouterApiDelegateRequest;
  auth?: DelegateRelayerAuth;
  signal?: AbortSignal;
  options?: DelegateRelayHooksOptions;
}): Promise<DelegateRouterApiResult> {
  const { url, payload, auth, signal, options } = args;
  const normalizedPayload: RouterApiDelegateRequest = {
    ...payload,
    signedDelegate: normalizeSignedDelegateForRelay(payload.signedDelegate),
  };
  emitNearSigningEvent(options?.onEvent, 'delegate', {
    phase: SigningEventPhase.STEP_12_BROADCAST_STARTED,
    status: 'running',
    message: 'Submitting delegate to relayer',
    interaction: { kind: 'none', overlay: 'none' },
  });
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: buildDelegateRelayerHeaders(auth),
      body: JSON.stringify(normalizedPayload),
      signal: signal || AbortSignal.timeout(DELEGATE_RELAYER_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    const error =
      err instanceof DOMException && err.name === 'TimeoutError'
        ? new Error('Relayer request timed out after 30 seconds')
        : err instanceof Error
          ? err
          : new Error(String(err));
    options?.onError?.(error);
    emitDelegateRelayError(options, error.message);
    await options?.afterCall?.(false);
    throw error;
  }
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {}
    const response = parseDelegateRelayerFailure(body, res.status);
    options?.onError?.(new Error(response.error));
    emitDelegateRelayError(options, response.error!);
    await options?.afterCall?.(false);
    return response;
  }
  let json: Record<string, unknown>;
  try {
    const parsed: unknown = await res.json();
    json = isObject(parsed) ? parsed : {};
  } catch (err: unknown) {
    const response: DelegateRouterApiResult = {
      ok: false,
      error: 'Relayer returned non-JSON response',
    };
    const error = err instanceof Error ? err : new Error(String(err));
    options?.onError?.(error);
    emitDelegateRelayError(options, response.error!);
    await options?.afterCall?.(false);
    return response;
  }
  const response: DelegateRouterApiResult = {
    ok: Boolean(json.ok ?? true),
    relayerTxHash:
      typeof json.relayerTxHash === 'string'
        ? json.relayerTxHash
        : typeof json.transactionId === 'string'
          ? json.transactionId
          : typeof json.txHash === 'string'
            ? json.txHash
            : undefined,
    status: typeof json.status === 'string' ? json.status : undefined,
    outcome: json.outcome,
    error: typeof json.error === 'string' ? json.error : undefined,
  };
  const success = response.ok !== false;
  if (success) {
    emitNearSigningEvent(options?.onEvent, 'delegate', {
      phase: SigningEventPhase.STEP_15_COMPLETED,
      status: 'succeeded',
      message: 'Delegate relayed successfully',
      interaction: { kind: 'none', overlay: 'none' },
    });
    await options?.afterCall?.(true, response);
  } else {
    const message = response.error || 'Relayer execution failed';
    options?.onError?.(new Error(message));
    emitDelegateRelayError(options, message);
    await options?.afterCall?.(false);
  }
  return response;
}

function emitDelegateRelayError(
  options: DelegateRelayHooksOptions | undefined,
  message: string,
): void {
  emitNearSigningEvent(options?.onEvent, 'delegate', {
    phase: SigningEventPhase.FAILED,
    status: 'failed',
    message,
    interaction: { kind: 'none', overlay: 'hide' },
    error: { message },
  });
}

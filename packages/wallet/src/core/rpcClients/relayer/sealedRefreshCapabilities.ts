import { __isWalletIframeHostMode } from '@/core/browser/walletIframe/host-mode';
import type { SeamsConfigsReadonly } from '@/core/types/seams';
import {
  SIGNING_SESSION_SEAL_ALG,
  SIGNING_SESSION_SEAL_GROUP_ID,
  type SigningSessionSealProtocol,
} from '@shared/utils/signingSessionSeal';

type SealedRefreshMode = 'none' | 'sealed_refresh_v1';

export type RelayerSigningSessionSealCapabilities =
  | { mode: 'none' }
  | {
      mode: 'sealed_refresh_v1';
      protocol: SigningSessionSealProtocol;
      currentKeyVersion: string;
    };

type VerifySealedRefreshStartupParityArgs = {
  configs: SeamsConfigsReadonly;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type FetchRelayerSigningSessionSealCapabilitiesArgs = {
  relayerUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 8_000;
const parityCheckByConfigKey = new Map<string, Promise<void>>();

function decodePlainObject(value: unknown): ReadonlyMap<string, unknown> | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    return null;
  }
  return new Map<string, unknown>(Object.entries(value));
}

function readOptionalNonEmptyString(
  fields: ReadonlyMap<string, unknown>,
  field: string,
): string | undefined {
  const value = fields.get(field);
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeMode(value: unknown): SealedRefreshMode | null {
  if (typeof value !== 'string') return null;
  const mode = value.trim().toLowerCase();
  if (mode === 'none') return 'none';
  if (mode === 'sealed_refresh_v1') return 'sealed_refresh_v1';
  return null;
}

function normalizeSigningSessionSealCapabilities(
  value: unknown,
): RelayerSigningSessionSealCapabilities | null {
  const fields = decodePlainObject(value);
  if (!fields) return null;

  const mode = normalizeMode(fields.get('mode'));
  if (!mode) return null;
  if (mode === 'none') return { mode: 'none' };

  const protocol = decodePlainObject(fields.get('protocol'));
  const algorithm = protocol ? readOptionalNonEmptyString(protocol, 'algorithm') : undefined;
  const groupId = protocol ? readOptionalNonEmptyString(protocol, 'groupId') : undefined;
  const currentKeyVersion = readOptionalNonEmptyString(fields, 'currentKeyVersion');
  if (
    algorithm !== SIGNING_SESSION_SEAL_ALG ||
    groupId !== SIGNING_SESSION_SEAL_GROUP_ID ||
    !currentKeyVersion
  ) {
    return null;
  }

  return {
    mode: 'sealed_refresh_v1',
    protocol: {
      algorithm: SIGNING_SESSION_SEAL_ALG,
      groupId: SIGNING_SESSION_SEAL_GROUP_ID,
    },
    currentKeyVersion,
  };
}

function parseWellKnownSigningSessionSealCapabilities(
  payload: unknown,
): RelayerSigningSessionSealCapabilities {
  const root = decodePlainObject(payload);
  if (!root) return { mode: 'none' };

  const capabilities = decodePlainObject(root.get('capabilities'));
  const fromCapabilities = normalizeSigningSessionSealCapabilities(
    capabilities?.get('signingSessionSeal'),
  );
  if (fromCapabilities) return fromCapabilities;

  return { mode: 'none' };
}

function shouldEnforceSealedRefreshParity(configs: SeamsConfigsReadonly): boolean {
  if (configs.signing.sessionPersistenceMode !== 'sealed_refresh_v1') return false;
  const appOriginWalletIframeMode =
    configs.wallet.mode === 'iframe' && !__isWalletIframeHostMode();
  return !appOriginWalletIframeMode;
}

function buildParityConfigKey(configs: SeamsConfigsReadonly): string {
  const relayerUrl = String(configs.network.relayer.url || '').trim();
  const mode = String(configs.signing.sessionPersistenceMode || '').trim().toLowerCase();
  const hostMode = __isWalletIframeHostMode() ? 'wallet-host' : 'app';
  const walletMode = configs.wallet.mode;
  return [
    relayerUrl,
    mode,
    SIGNING_SESSION_SEAL_ALG,
    SIGNING_SESSION_SEAL_GROUP_ID,
    hostMode,
    walletMode,
  ].join('|');
}

function normalizeTimeoutMs(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(250, Math.floor(parsed));
}

function createErrorWithCode(message: string, code: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function withTimeout(input: {
  timeoutMs: number;
  signal?: AbortSignal;
  task: (signal: AbortSignal) => Promise<RelayerSigningSessionSealCapabilities>;
}): Promise<RelayerSigningSessionSealCapabilities> {
  if (input.signal?.aborted) {
    throw createErrorWithCode('Parity check aborted', 'sealed_refresh_parity_aborted');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('timeout'), input.timeoutMs);
  const onAbort = () => {
    try {
      controller.abort(input.signal?.reason);
    } catch {}
  };
  input.signal?.addEventListener('abort', onAbort, { once: true });

  return input
    .task(controller.signal)
    .finally(() => {
      clearTimeout(timeoutId);
      input.signal?.removeEventListener('abort', onAbort);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error || 'Unknown error');
      if (controller.signal.aborted) {
        throw createErrorWithCode(
          `[sealed-refresh-parity] Failed to fetch relayer well-known capabilities: ${message}`,
          'sealed_refresh_parity_fetch_failed',
        );
      }
      throw error;
    });
}

export async function fetchRelayerSigningSessionSealCapabilities(
  args: FetchRelayerSigningSessionSealCapabilitiesArgs,
): Promise<RelayerSigningSessionSealCapabilities> {
  const relayerUrl = String(args.relayerUrl || '').trim();
  if (!relayerUrl) {
    throw createErrorWithCode(
      '[sealed-refresh-parity] Missing relayer URL for capability check',
      'sealed_refresh_parity_invalid_config',
    );
  }

  const fetchImpl = args.fetchImpl || fetch.bind(globalThis);
  const timeoutMs = normalizeTimeoutMs(args.timeoutMs, DEFAULT_TIMEOUT_MS);
  const wellKnownUrl = `${relayerUrl.replace(/\/+$/, '')}/.well-known/webauthn`;

  return await withTimeout({
    timeoutMs,
    task: async (signal) => {
      const response = await fetchImpl(wellKnownUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal,
      });

      if (!response.ok) {
        throw createErrorWithCode(
          `[sealed-refresh-parity] Well-known endpoint returned HTTP ${response.status}`,
          'sealed_refresh_parity_http_error',
        );
      }

      let payload: unknown = {};
      try {
        payload = await response.json();
      } catch {
        throw createErrorWithCode(
          '[sealed-refresh-parity] Well-known response is not valid JSON',
          'sealed_refresh_parity_invalid_payload',
        );
      }

      return parseWellKnownSigningSessionSealCapabilities(payload);
    },
  });
}

export async function verifySealedRefreshStartupParity(
  args: VerifySealedRefreshStartupParityArgs,
): Promise<void> {
  if (!shouldEnforceSealedRefreshParity(args.configs)) return;

  const configKey = buildParityConfigKey(args.configs);
  const existing = parityCheckByConfigKey.get(configKey);
  if (existing) {
    await existing;
    return;
  }

  const task = (async () => {
    const relayerUrl = String(args.configs.network.relayer.url || '').trim();
    const clientMode = args.configs.signing.sessionPersistenceMode;
    const server = await fetchRelayerSigningSessionSealCapabilities({
      relayerUrl,
      fetchImpl: args.fetchImpl,
      timeoutMs: args.timeoutMs,
    });

    const mismatches: string[] = [];
    if (server.mode !== clientMode) mismatches.push('mode');
    if (
      server.mode === 'sealed_refresh_v1' &&
      server.protocol.algorithm !== SIGNING_SESSION_SEAL_ALG
    ) {
      mismatches.push('algorithm');
    }
    if (
      server.mode === 'sealed_refresh_v1' &&
      server.protocol.groupId !== SIGNING_SESSION_SEAL_GROUP_ID
    ) {
      mismatches.push('groupId');
    }

    if (mismatches.length > 0) {
      throw createErrorWithCode(
        `[sealed-refresh-parity] Client/server mismatch for fields: ${mismatches.join(', ')}. ` +
          `client={mode:${clientMode},algorithm:${SIGNING_SESSION_SEAL_ALG},groupId:${SIGNING_SESSION_SEAL_GROUP_ID}} ` +
          `server={mode:${server.mode}${
            server.mode === 'sealed_refresh_v1'
              ? `,algorithm:${server.protocol.algorithm},groupId:${server.protocol.groupId}`
              : ''
          }}`,
        'sealed_refresh_parity_mismatch',
      );
    }
  })().catch((error: unknown) => {
    parityCheckByConfigKey.delete(configKey);
    throw error;
  });

  parityCheckByConfigKey.set(configKey, task);
  await task;
}

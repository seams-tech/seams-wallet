import type { WalletRegistrationSetupInput } from '../domains/walletRegistration/walletRegistrationInputs';
import type { WalletRegistrationSetupResponseV2 } from '../../core/threeRouteRegistrationContracts';
import type { RouteResponse } from './routeExecutionContext';
import {
  recordRegistrationServerTiming,
  registrationServerTimingHeaders,
} from '../cloudflare/d1/registration/d1RegistrationSetupSupport';

export interface WalletRegistrationSetupDispatcher {
  dispatch(input: WalletRegistrationSetupInput): Promise<RouteResponse | null>;
}

/** A transient storage fault outlived its retries. The same request can succeed later. */
const SETUP_STORAGE_UNAVAILABLE = {
  status: 503,
  message: 'Wallet registration setup is temporarily unavailable. Try again.',
} as const;

const SETUP_INTERNAL_FAILURE = {
  status: 500,
  message: 'Wallet registration setup failed',
} as const;

export async function dispatchWalletRegistrationSetup(
  context: {
    readonly dispatcher: WalletRegistrationSetupDispatcher | null;
    readonly local: {
      setupWalletRegistration(
        input: WalletRegistrationSetupInput,
      ): Promise<WalletRegistrationSetupResponseV2>;
    };
  },
  input: WalletRegistrationSetupInput,
): Promise<RouteResponse> {
  const serverTiming = input.serverTiming ?? [];
  const dispatchStartedAtMs = Date.now();
  const forwarded = await context.dispatcher?.dispatch(input);
  if (forwarded) return forwarded;
  recordRegistrationServerTiming(serverTiming, 'setup_dispatch', dispatchStartedAtMs);
  const result = await context.local.setupWalletRegistration(input);
  const headers = registrationServerTimingHeaders(serverTiming);
  if (result.ok) return { status: 200, body: result, ...(headers ? { headers } : {}) };
  const serverFailure =
    result.code === 'storage_unavailable'
      ? SETUP_STORAGE_UNAVAILABLE
      : result.code === 'internal'
        ? SETUP_INTERNAL_FAILURE
        : null;
  if (!serverFailure) return { status: 400, body: result, ...(headers ? { headers } : {}) };
  // The cause stays on the server. It can carry the storage driver's text.
  console.error('[wallet-registration] setup failed', {
    code: result.code,
    reason: result.message,
  });
  return {
    status: serverFailure.status,
    body: { ok: false, code: result.code, message: serverFailure.message },
    ...(headers ? { headers } : {}),
  };
}

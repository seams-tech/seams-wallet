import type { WalletRegistrationSetupInput } from '../domains/walletRegistration/walletRegistrationInputs';
import type { WalletRegistrationSetupResponseV2 } from '../../core/threeRouteRegistrationContracts';
import type { RouteResponse } from './routeExecutionContext';

export interface WalletRegistrationSetupDispatcher {
  dispatch(input: WalletRegistrationSetupInput): Promise<RouteResponse | null>;
}

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
  const forwarded = await context.dispatcher?.dispatch(input);
  if (forwarded) return forwarded;
  const result = await context.local.setupWalletRegistration(input);
  return { status: result.ok ? 200 : 400, body: result };
}

import { prewarmRelayerPreflights } from './relayerHttp';

export const WALLET_REGISTRATION_SETUP_PATH = '/wallets/register/setup';

/** Warm setup without loading the wallet runtime or sending credentials. */
export function prewarmWalletRegistrationSetup(relayerUrl: string): void {
  prewarmRelayerPreflights(relayerUrl, [WALLET_REGISTRATION_SETUP_PATH]);
}

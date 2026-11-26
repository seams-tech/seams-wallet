import type { EmailOtpWarmSessionTransport } from './workerRequests';
import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking';

declare const operationCredential: WalletSessionOperationCredentialV1;

const validEmailOtpWarmSessionTransport = {
  relayerUrl: 'https://relay.example',
  operationCredential,
  walletId: 'wallet.testnet',
} satisfies EmailOtpWarmSessionTransport;
void validEmailOtpWarmSessionTransport;

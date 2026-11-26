
import type { HttpTransport } from './http';
import type {
  AuthenticatorPort,
  DurableRecordStore,
  SecureSecretStore,
  SignerCryptoPort,
} from './ports';

export type RuntimePortsKind = 'browser';

export type ClockPort = {
  kind: 'clock';
  nowMs(): number;
};

export type RandomSource = {
  kind: 'random_source';
  randomBytes(length: number): Uint8Array;
};

export type RuntimePorts = {
  kind: RuntimePortsKind;
  storage: DurableRecordStore;
  secrets: SecureSecretStore;
  authenticator: AuthenticatorPort;
  signerCrypto: SignerCryptoPort;
  http: HttpTransport;
  clock: ClockPort;
  random: RandomSource;
};

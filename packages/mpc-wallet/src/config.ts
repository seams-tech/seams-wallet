import { BUILD_PATHS } from '@build-paths';

export const SIGNER_WORKER_MANAGER_CONFIG = {
  TIMEOUTS: {
    DEFAULT: 60_000, // 60s default fallback for worker operations
    TRANSACTION: 60_000, // 60s for contract verification + signing
    REGISTRATION: 60_000, // 60s for registration operations
  },
  WORKER: {
    URL: BUILD_PATHS.RUNTIME.SIGNER_WORKER,
    TYPE: 'module' as const,
    NAME: 'Web3AuthnSignerWorker',
  },
  ECDSA_DERIVATION_CLIENT_WORKER: {
    URL: BUILD_PATHS.RUNTIME.ECDSA_DERIVATION_CLIENT_WORKER,
    TYPE: 'module' as const,
    NAME: 'Web3AuthnEcdsaDerivationClientWorker',
  },
  ECDSA_PRESIGN_CLIENT_WORKER: {
    URL: BUILD_PATHS.RUNTIME.ECDSA_PRESIGN_CLIENT_WORKER,
    TYPE: 'module' as const,
    NAME: 'Web3AuthnEcdsaPresignClientWorker',
  },
  ECDSA_ONLINE_CLIENT_WORKER: {
    URL: BUILD_PATHS.RUNTIME.ECDSA_ONLINE_CLIENT_WORKER,
    TYPE: 'module' as const,
    NAME: 'Web3AuthnEcdsaOnlineClientWorker',
  },
  RETRY: {
    MAX_ATTEMPTS: 3,
    BACKOFF_MS: 1000,
  },
} as const;

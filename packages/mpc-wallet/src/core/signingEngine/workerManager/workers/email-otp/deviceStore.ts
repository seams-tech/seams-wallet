import { openDB } from 'idb';

/**
 * The IndexedDB database of the Email OTP worker. Only this worker reads or writes it.
 *
 * - `factors`: the device factor inputs, one for each enrollment (`deviceFactor.ts`).
 * - `ed25519_warm_seals`: S sealed under the signing-session seal of one Email OTP Wallet
 *   Session, one for each wallet (`ed25519WarmSeal.ts`).
 */
const DB_NAME = 'seams_email_otp_device_factors';

export const EMAIL_OTP_FACTOR_STORE = 'factors';
export const EMAIL_OTP_ED25519_WARM_SEAL_STORE = 'ed25519_warm_seals';

export function openEmailOtpDeviceStore() {
  return openDB(DB_NAME, 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        const factors = database.createObjectStore(EMAIL_OTP_FACTOR_STORE, {
          keyPath: ['walletId', 'factorNonceB64u'],
        });
        factors.createIndex('walletId', 'walletId');
      }
      if (oldVersion < 2) {
        database.createObjectStore(EMAIL_OTP_ED25519_WARM_SEAL_STORE, { keyPath: 'walletId' });
      }
    },
  });
}

/** A sign-in method that a journey uses. */
export type ConformanceMethod = 'passkey' | 'email_otp';

/** The account's first method, or the method that the journey added later. */
export type ConformanceMethodRole = 'registered' | 'added';

/**
 * One browser profile, with its own storage and authenticator, driven through one public API.
 * The journeys call only these steps. Each step checks its own result and throws on a wrong
 * one, so a driver for another API runs the same journeys with no change.
 */
export interface ConformanceDevice {
  /** Creates an account and its wallet with a first method, and waits until each chain is ready. */
  register(method: ConformanceMethod): Promise<void>;
  /** The account is signed in, and its session lists a method of the account. */
  expectSignedIn(): Promise<void>;
  /** Clears the storage of this browser, then signs in to the account with its passkey. */
  signInOnEmptyBrowser(): Promise<void>;
  /** Locks the wallet and reloads the page. The wallet stays locked. */
  lockAndReload(): Promise<void>;
  /** Unlocks the wallet with a method of the account. */
  unlock(method: ConformanceMethod, role: ConformanceMethodRole): Promise<void>;
  /** Reloads the page and keeps the storage. The Wallet Session stays open. */
  reload(): Promise<void>;
  /** Signs a NEAR transaction (Ed25519) and a Tempo transaction (ECDSA), and verifies both. */
  sign(): Promise<void>;
  /** Uses up the Wallet Session, then signs with a fresh proof of the method that holds it. */
  signWithFreshProof(): Promise<void>;
  /** Exports the ECDSA key. Each export asks for a fresh proof. */
  exportKey(): Promise<void>;
  /** Adds a method to the account while the wallet is unlocked. */
  addMethod(method: ConformanceMethod): Promise<void>;
  /** Removes the method that does not hold the session, with a fresh proof of the one that does. */
  removeMethod(role: ConformanceMethodRole): Promise<void>;
  /** The account refuses to remove its last method. */
  expectLastMethodKept(): Promise<void>;
  /** Opens a new browser profile and links it to the account with a passkey. */
  linkNewDevice(): Promise<ConformanceDevice>;
  /** Removes the device that this device linked. */
  removeLinkedDevice(): Promise<void>;
  /** This device can no longer sign. */
  expectCannotSign(): Promise<void>;
  /** Clears the storage of this browser and recovers the account with a recovery code. */
  recoverOnEmptyBrowser(): Promise<void>;
}

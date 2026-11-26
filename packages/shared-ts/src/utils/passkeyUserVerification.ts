/**
 * The Wallet server refuses every passkey registration and assertion whose
 * authenticator did not verify the user (the WebAuthn UV flag), for example a
 * security key with no PIN. It sends this code only when the ceremony is valid
 * in every other way, so the Wallet can tell the user what to change.
 */
export const PASSKEY_USER_VERIFICATION_REQUIRED_CODE = 'user_verification_required';

/**
 * The server sends this sentence as the message of the refusal. Many Wallet
 * paths pass on a server message but not its code, so the Wallet finds the
 * refusal by this text too. `core/ui/messages.ts` has its translation.
 */
export const PASSKEY_USER_VERIFICATION_REQUIRED_MESSAGE =
  'This passkey did not check a PIN or biometric. Use a passkey with a PIN or biometric, or set a PIN on your security key.';

/**
 * Byte facts that every stored passkey depends on. A credential made today keeps working only
 * when new code asks the authenticator for the same PRF salts and the same user handle.
 */

/** The two PRF salts, version 1. The PRF result of the first salt opens custody envelopes. */
export const PRF_FIRST_SALT_V1_HEX =
  '400c318b6695973659a1698ae580dfd8001d9951ba32c695e6349947504f3f84';
export const PRF_SECOND_SALT_V1_HEX =
  '26da50e5ac964a7ea084527fb647f6330b32de51a9af46524b006d8f7fe7f4d1';

export function hexToBase64Url(hex: string): string {
  return Buffer.from(hex, 'hex').toString('base64url');
}

export function bytesToBase64Url(bytes: BufferSource | undefined): string {
  if (!bytes) return '';
  const view = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
  return Buffer.from(view).toString('base64url');
}

/**
 * The WebAuthn user handle (`user.id`) of a wallet: the UTF-8 bytes of the wallet ID. The
 * server builds it this way for every option set it sends. The browser builds it itself only
 * for the first passkey of a new wallet; for a signer slot above 1 it adds ` (<slot>)`.
 */
export function walletUserHandleB64u(walletId: string, signerSlot?: number): string {
  const name = signerSlot === undefined || signerSlot === 1 ? walletId : `${walletId} (${signerSlot})`;
  return Buffer.from(name, 'utf8').toString('base64url');
}

import { type WebAuthnAuthenticatorDeviceInfo } from '@shared/utils/webauthnDeviceInfo';

export type WebAuthnAuthenticatorRecord = {
  version: 'webauthn_authenticator_v1';
  credentialIdB64u: string;
  credentialPublicKeyB64u: string;
  counter: number;
  createdAtMs: number;
  updatedAtMs: number;
  /**
   * Server-derived device metadata captured at registration verification.
   * Required so the authenticator listing can promise it; rows written before
   * device capture parse back as `Unknown device` at the store boundary.
   */
  deviceInfo: WebAuthnAuthenticatorDeviceInfo;
};

export interface WebAuthnAuthenticatorStore {
  get(userId: string, credentialIdB64u: string): Promise<WebAuthnAuthenticatorRecord | null>;
  put(userId: string, record: WebAuthnAuthenticatorRecord): Promise<void>;
  del(userId: string, credentialIdB64u: string): Promise<void>;
  /**
   * List all authenticators for a user.
   *
   * Optional because not all backing stores can efficiently enumerate keys.
   */
  list?(userId: string): Promise<WebAuthnAuthenticatorRecord[]>;
}

export type D1WebAuthnAuthenticatorRow = {
  readonly credential_id_b64u?: unknown;
  readonly credential_public_key_b64u?: unknown;
  readonly counter?: unknown;
  readonly created_at_ms?: unknown;
  readonly updated_at_ms?: unknown;
  readonly device_info_json?: unknown;
};

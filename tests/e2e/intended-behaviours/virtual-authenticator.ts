import type { CDPSession } from '@playwright/test';
import { isPlainObject } from '../../../packages/shared-ts/src/utils/validation';

const WEB_AUTHN_VIRTUAL_AUTHENTICATOR_OPTIONS = {
  protocol: 'ctap2',
  transport: 'internal',
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  hasPrf: true,
  automaticPresenceSimulation: true,
} as const;

/** The CDP virtual passkey authenticator, a platform authenticator with PRF. */
export class VirtualPasskeyAuthenticator {
  private constructor(
    private readonly session: CDPSession,
    private readonly authenticatorId: string,
  ) {}

  static async add(session: CDPSession): Promise<VirtualPasskeyAuthenticator> {
    const response: unknown = await session.send('WebAuthn.addVirtualAuthenticator', {
      options: WEB_AUTHN_VIRTUAL_AUTHENTICATOR_OPTIONS,
    });
    const authenticatorId = isPlainObject(response) ? response.authenticatorId : undefined;
    if (typeof authenticatorId !== 'string' || !authenticatorId) {
      throw new Error('WebAuthn virtual authenticator response has no authenticatorId');
    }
    return new VirtualPasskeyAuthenticator(session, authenticatorId);
  }

  /**
   * The private signing key of each stored credential, as base64 PKCS#8 keyed by the base64url
   * credential ID. A test signs with it to act as a raw CTAP client.
   */
  async signingKeys(): Promise<Record<string, string>> {
    const response: unknown = await this.session.send('WebAuthn.getCredentials', {
      authenticatorId: this.authenticatorId,
    });
    const credentials = isPlainObject(response) ? response.credentials : undefined;
    if (!Array.isArray(credentials)) {
      throw new Error('WebAuthn virtual authenticator credentials are unreadable');
    }
    const keys: Record<string, string> = {};
    for (const credential of credentials) {
      if (
        !isPlainObject(credential) ||
        typeof credential.credentialId !== 'string' ||
        typeof credential.privateKey !== 'string'
      ) {
        throw new Error('WebAuthn virtual authenticator credential is unreadable');
      }
      keys[Buffer.from(credential.credentialId, 'base64').toString('base64url')] =
        credential.privateKey;
    }
    return keys;
  }
}

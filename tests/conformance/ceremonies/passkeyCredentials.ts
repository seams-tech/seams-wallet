import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

/**
 * A software passkey for the server checks: a real P-256 key, a credential ID and a
 * signature counter. It makes the same JSON that a browser sends after
 * `navigator.credentials.create` and `navigator.credentials.get`.
 */
export type SoftwarePasskey = {
  readonly credentialIdB64u: string;
  /** The COSE public key, as the server stores it after registration. */
  readonly publicKeyB64u: string;
  readonly privateKey: KeyObject;
  counter: number;
};

/** The relying party and origin that the checks expect. */
export type CeremonyScope = {
  readonly rpId: string;
  readonly origin: string;
};

/** Parts of a ceremony that a check changes to make one fault. */
export type CeremonyOverrides = {
  readonly challengeB64u?: string;
  readonly origin?: string;
  /** The RP ID whose SHA-256 hash goes into the authenticator data. */
  readonly rpIdForHash?: string;
  readonly type?: string;
  /** Signs with another key, so the signature does not match the stored key. */
  readonly signingKey?: KeyObject;
  /** The counter in the authenticator data; the passkey's counter moves to it. */
  readonly counter?: number;
};

// Authenticator data flags: user present, user verified, attested credential data.
const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL = 0x40;

export function createSoftwarePasskey(): SoftwarePasskey {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = keys.publicKey.export({ format: 'jwk' });
  if (!jwk.x || !jwk.y) throw new Error('P-256 public key export has no coordinates');
  const cose = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x, 'base64url')],
      [-3, Buffer.from(jwk.y, 'base64url')],
    ]),
  );
  return {
    credentialIdB64u: randomBytes(16).toString('base64url'),
    publicKeyB64u: Buffer.from(cose).toString('base64url'),
    privateKey: keys.privateKey,
    counter: 0,
  };
}

export function otherSigningKey(): KeyObject {
  return generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
}

export function randomChallengeB64u(): string {
  return randomBytes(32).toString('base64url');
}

function clientDataJson(type: string, challengeB64u: string, origin: string): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge: challengeB64u, origin }));
}

function counterBytes(counter: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(counter);
  return bytes;
}

function rpIdHash(rpId: string): Buffer {
  return createHash('sha256').update(rpId).digest();
}

/** The registration JSON for an attestation of format `none`. */
export function registrationResponse(
  passkey: SoftwarePasskey,
  scope: CeremonyScope,
  challengeB64u: string,
  overrides: CeremonyOverrides = {},
): Record<string, unknown> {
  const credentialId = Buffer.from(passkey.credentialIdB64u, 'base64url');
  const credentialIdLength = Buffer.alloc(2);
  credentialIdLength.writeUInt16BE(credentialId.length);
  const authData = Buffer.concat([
    rpIdHash(overrides.rpIdForHash ?? scope.rpId),
    Buffer.from([FLAG_USER_PRESENT | FLAG_USER_VERIFIED | FLAG_ATTESTED_CREDENTIAL]),
    counterBytes(overrides.counter ?? passkey.counter),
    Buffer.alloc(16),
    credentialIdLength,
    credentialId,
    Buffer.from(passkey.publicKeyB64u, 'base64url'),
  ]);
  const attestationObject = isoCBOR.encode(
    new Map<string, string | Uint8Array | Map<string, number>>([
      ['fmt', 'none'],
      ['attStmt', new Map<string, number>()],
      ['authData', authData],
    ]),
  );
  const clientData = clientDataJson(
    overrides.type ?? 'webauthn.create',
    overrides.challengeB64u ?? challengeB64u,
    overrides.origin ?? scope.origin,
  );
  return {
    id: passkey.credentialIdB64u,
    rawId: passkey.credentialIdB64u,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: clientData.toString('base64url'),
      attestationObject: Buffer.from(attestationObject).toString('base64url'),
      transports: ['internal'],
    },
    clientExtensionResults: {},
  };
}

/** The assertion JSON. The passkey's counter moves to the counter it signs. */
export function assertionResponse(
  passkey: SoftwarePasskey,
  scope: CeremonyScope,
  challengeB64u: string,
  overrides: CeremonyOverrides = {},
): {
  id: string;
  rawId: string;
  type: string;
  authenticatorAttachment: string | null;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string | null;
  };
  clientExtensionResults: Record<string, unknown>;
} {
  const counter = overrides.counter ?? passkey.counter + 1;
  passkey.counter = counter;
  const authenticatorData = Buffer.concat([
    rpIdHash(overrides.rpIdForHash ?? scope.rpId),
    Buffer.from([FLAG_USER_PRESENT | FLAG_USER_VERIFIED]),
    counterBytes(counter),
  ]);
  const clientData = clientDataJson(
    overrides.type ?? 'webauthn.get',
    overrides.challengeB64u ?? challengeB64u,
    overrides.origin ?? scope.origin,
  );
  const signed = Buffer.concat([
    authenticatorData,
    createHash('sha256').update(clientData).digest(),
  ]);
  return {
    id: passkey.credentialIdB64u,
    rawId: passkey.credentialIdB64u,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: clientData.toString('base64url'),
      authenticatorData: authenticatorData.toString('base64url'),
      signature: sign('sha256', signed, overrides.signingKey ?? passkey.privateKey).toString(
        'base64url',
      ),
      userHandle: null,
    },
    clientExtensionResults: {},
  };
}

import type { WebAuthnAuthenticationCredential } from '../../../../core/types';
import { parseWebAuthnAuthenticationCredential } from '../../../auth/webAuthnCredentialCodecs';
import { parseUnixMs } from '@shared/passkey-custody/primitives';
import { isPlainObject, requireTrimmedString, toOptionalTrimmedString } from '@shared/utils/validation';

export type WalletCustodyOwnerProofWire =
  | {
      readonly kind: 'passkey';
      readonly walletId: string;
      readonly rpId: string;
      readonly credentialIdB64u: string;
      readonly challenge_digest: string;
      readonly webauthn_authentication: WebAuthnAuthenticationCredential;
    }
  | {
      readonly kind: 'email_otp';
      readonly provider_subject_id: string;
      readonly challenge_id: string;
      readonly otp_code: string;
      readonly challenge_digest: string;
    };

export function requireExactObjectFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  label: string,
): void {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} contains unsupported fields`);
  }
}

export function parseCustodyOwnerProof(value: unknown): WalletCustodyOwnerProofWire {
  if (!isPlainObject(value)) throw new Error('factorProof is required');
  const kind = toOptionalTrimmedString(value.kind);
  if (kind === 'passkey') {
    requireExactObjectFields(
      value,
      [
        'kind',
        'walletId',
        'rpId',
        'credentialIdB64u',
        'challenge_digest',
        'webauthn_authentication',
      ],
      'factorProof',
    );
    const webauthnAuthentication = parseWebAuthnAuthenticationCredential(
      value.webauthn_authentication,
    );
    if (!webauthnAuthentication) throw new Error('factorProof.webauthn_authentication is invalid');
    return {
      kind,
      walletId: requireTrimmedString(value.walletId, 'factorProof.walletId'),
      rpId: requireTrimmedString(value.rpId, 'factorProof.rpId'),
      credentialIdB64u: requireTrimmedString(
        value.credentialIdB64u,
        'factorProof.credentialIdB64u',
      ),
      challenge_digest: requireTrimmedString(
        value.challenge_digest,
        'factorProof.challenge_digest',
      ),
      webauthn_authentication: webauthnAuthentication,
    };
  }
  if (kind === 'email_otp') {
    requireExactObjectFields(
      value,
      ['kind', 'provider_subject_id', 'challenge_id', 'otp_code', 'challenge_digest'],
      'factorProof',
    );
    return {
      kind,
      provider_subject_id: requireTrimmedString(
        value.provider_subject_id,
        'factorProof.provider_subject_id',
      ),
      challenge_id: requireTrimmedString(value.challenge_id, 'factorProof.challenge_id'),
      otp_code: requireTrimmedString(value.otp_code, 'factorProof.otp_code'),
      challenge_digest: requireTrimmedString(
        value.challenge_digest,
        'factorProof.challenge_digest',
      ),
    };
  }
  throw new Error('factorProof.kind must be passkey or email_otp');
}

export function parseRecoveryBackupAcknowledgementRequest(body: unknown): {
  readonly walletId: string;
  readonly requestId: string;
  readonly expectedIssuedAtMs: number;
  readonly factorProof: unknown;
} {
  if (!isPlainObject(body)) throw new Error('acknowledgement body is required');
  requireExactObjectFields(
    body,
    ['expectedIssuedAtMs', 'factorProof', 'requestId', 'walletId'],
    'recovery backup acknowledgement',
  );
  return {
    walletId: requireTrimmedString(body.walletId, 'walletId'),
    requestId: requireTrimmedString(body.requestId, 'requestId'),
    expectedIssuedAtMs: parseUnixMs(body.expectedIssuedAtMs, 'expectedIssuedAtMs'),
    factorProof: body.factorProof,
  };
}

export function parseRecoveryStatusRequest(body: unknown): {
  readonly requestId: string;
  readonly factorProof: unknown;
} {
  if (!isPlainObject(body)) throw new Error('status body is required');
  requireExactObjectFields(body, ['factorProof', 'requestId'], 'recovery status');
  return {
    requestId: requireTrimmedString(body.requestId, 'requestId'),
    factorProof: body.factorProof,
  };
}

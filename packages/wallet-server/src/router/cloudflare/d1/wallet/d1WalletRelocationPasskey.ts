import { D1_BATCH_CAS_GUARD_SQL } from '../../../../storage/d1Sql';
import { CloudflareD1WebAuthnStore } from '../webauthn/d1WebAuthnStore';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { D1DatabaseLike } from '../../../../storage/tenantRoute';
import type { D1TenantScope } from '../../../../core/d1TenantStore';
import {
  decodeWebAuthnBase64UrlOrBase64,
  parseWebAuthnAuthenticationCredential,
  webAuthnCredentialIdB64uFromCredential,
} from '../../../auth/webAuthnCredentialCodecs';
import {
  readWalletRelocationOwner,
  type WalletRelocationFactorVerification,
} from './d1WalletRelocationOwner';
import { d1HostIsWithinWebAuthnRpId } from './d1WalletAuthMethodBoundary';
import {
  D1WalletRelocationChallenges,
  type WalletRelocationChallengeBinding,
} from './d1WalletRelocationChallenges';

// Verification alone grants no move authority. Commit these guards with the approval.
export async function verifyWalletRelocationPasskey(input: {
  readonly database: D1DatabaseLike;
  readonly scope: D1TenantScope;
  readonly binding: WalletRelocationChallengeBinding;
  readonly credential: unknown;
  readonly nowMs: number;
}): Promise<WalletRelocationFactorVerification> {
  const challenges = new D1WalletRelocationChallenges(input.database, input.scope);
  const challenge = await challenges.read(input.binding);
  if (
    !challenge ||
    challenge.state !== 'issued' ||
    !Number.isSafeInteger(input.nowMs) ||
    input.nowMs < challenge.createdAtMs ||
    input.nowMs >= challenge.expiresAtMs
  )
    return { kind: 'denied' };

  const credential = parseWebAuthnAuthenticationCredential(input.credential);
  if (!credential) return { kind: 'denied' };
  const credentialId = webAuthnCredentialIdB64uFromCredential(credential);
  if (!credentialId.ok) return { kind: 'denied' };
  const owner = await readWalletRelocationOwner(input.database, input.scope, input.binding);
  if (!owner || owner.method.kind !== 'passkey') return { kind: 'denied' };
  const { method, authority } = owner;
  if (
    method.credentialIdB64u !== credentialId.credentialIdB64u ||
    !d1HostIsWithinWebAuthnRpId(new URL(input.binding.origin).hostname, method.rpId)
  )
    return { kind: 'denied' };

  const authenticators = new CloudflareD1WebAuthnStore({
    database: input.database,
    ...input.scope,
  });
  const authenticator = await authenticators.readAuthenticator({
    userId: method.walletId,
    credentialIdB64u: method.credentialIdB64u,
  });
  if (!authenticator || authenticator.credentialPublicKeyB64u !== method.credentialPublicKeyB64u)
    return { kind: 'denied' };
  let newCounter: number;
  try {
    const verification = await verifyAuthenticationResponse({
      response: {
        id: credential.id,
        rawId: credential.rawId,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: credential.response.clientDataJSON,
          authenticatorData: credential.response.authenticatorData,
          signature: credential.response.signature,
          ...(credential.response.userHandle === null
            ? {}
            : { userHandle: credential.response.userHandle }),
        },
      },
      expectedChallenge: challenge.challengeB64u,
      expectedOrigin: input.binding.origin,
      expectedRPID: method.rpId,
      credential: {
        id: method.credentialIdB64u,
        publicKey: decodeWebAuthnBase64UrlOrBase64(
          method.credentialPublicKeyB64u,
          'passkey public key',
        ),
        counter: authenticator.counter,
      },
      requireUserVerification: true,
    });
    if (!verification.verified) return { kind: 'denied' };
    newCounter = verification.authenticationInfo.newCounter;
  } catch {
    return { kind: 'denied' };
  }
  return {
    kind: 'verified',
    authorityDigestB64u: authority.authorityDigestB64u,
    authorityRevocationEpoch: authority.revocationEpoch,
    commitPrerequisites: [
      ...owner.commitPrerequisites,
      input.database
        .prepare(
          `UPDATE webauthn_authenticators SET counter = ?, updated_at_ms = ?
        WHERE namespace = ? AND org_id = ? AND project_id = ? AND env_id = ?
          AND user_id = ? AND credential_id_b64u = ? AND counter = ?
          AND credential_public_key_b64u = ?`,
        )
        .bind(
          newCounter,
          input.nowMs,
          input.scope.namespace,
          input.scope.orgId,
          input.scope.projectId,
          input.scope.envId,
          method.walletId,
          method.credentialIdB64u,
          authenticator.counter,
          authenticator.credentialPublicKeyB64u,
        ),
      input.database.prepare(D1_BATCH_CAS_GUARD_SQL),
      ...challenges.prepareConsume(challenge, input.nowMs),
    ],
  };
}

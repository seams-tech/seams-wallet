import type { FetchRouterApiContext } from '../createFetchRouter';
import { json, jsonFailure, readJson } from '../../../framework/http';
import {
  parseSyncAccountOptionsRequest,
  parseSyncAccountVerifyRequest,
} from '../../../domains/syncAccount/syncAccountRequestValidation';
import {
  walletAuthAuthorityRef,
  type PasskeyWalletAuthAuthority,
} from '@shared/utils/walletAuthAuthority';
import { walletIdFromString } from '@shared/utils/registrationIds';
import {
  parsePrincipalId,
  parseWalletSessionMintId,
  parseAuthFactorId,
} from '@shared/authorization/capabilityKinds';
import { DEFAULT_WALLET_SESSION_TTL_MS } from '@shared/threshold/sessionPolicy';
import {
  parseWalletId,
  parseWebAuthnCredentialIdB64u,
  parseWebAuthnRpId,
  type WalletAuthMethodId,
} from '@shared/utils/domainIds';
import {
  parseSessionOrigin,
  parseVerifiedOwnerProofId,
} from '../../../../authorization/domain';
import { buildVerifiedWalletSessionPasskeyFactorResult } from '../../../../authorization/factorEvidence';
import { alphabetizeStringify } from '@shared/utils/digests';
import { sha256Utf8DigestB64u } from '@shared/utils/canonicalPrimitives';
import { issueSyncAccountBootstrapV1 } from './syncAccountBootstrap';

function syncAccountResponseStatus(result: { ok: boolean; verified?: boolean; code?: string }) {
  if (result.ok && result.verified) return 200;
  return syncAccountFailureStatus(result.code);
}

function syncAccountFailureStatus(code: string | undefined): number {
  switch (code) {
    case 'wallet_home_unavailable':
      return 503;
    case 'wallet_home_conflict':
      return 409;
    case 'internal':
      return 500;
    // The credential is valid and the request is well formed; the wallet's
    // Ed25519 signer just does not exist yet. Retryable, not a client error.
    case 'ed25519_not_provisioned':
      return 409;
    default:
      return 400;
  }
}

function passkeyWalletAuthAuthorityForMethod(input: {
  readonly walletId: string;
  readonly rpId: string;
  readonly credentialIdB64u: string;
  readonly walletAuthMethodId: WalletAuthMethodId;
}): PasskeyWalletAuthAuthority {
  const walletId = parseWalletId(input.walletId);
  const rpId = parseWebAuthnRpId(input.rpId);
  const credentialIdB64u = parseWebAuthnCredentialIdB64u(input.credentialIdB64u);
  if (!walletId.ok || !rpId.ok || !credentialIdB64u.ok) {
    throw new Error('Verified passkey Wallet Session authority identity is invalid');
  }
  return {
    walletId: walletId.value,
    factor: { kind: 'passkey', credentialIdB64u: credentialIdB64u.value },
    verifier: { kind: 'webauthn', rpId: rpId.value },
    bindingId: input.walletAuthMethodId,
  };
}

export async function handleSyncAccount(ctx: FetchRouterApiContext): Promise<Response | null> {
  if (ctx.method !== 'POST') return null;

  if (ctx.pathname === '/sync-account/options') {
    const body = await readJson(ctx.request);
    const parsed = parseSyncAccountOptionsRequest(body);
    if (!parsed.ok) return json(parsed.body, { status: parsed.status });
    const result = await ctx.service.webAuthn.createWebAuthnSyncAccountOptions(parsed.request);
    return json(result, { status: result.ok ? 200 : syncAccountFailureStatus(result.code) });
  }

  if (ctx.pathname === '/sync-account/verify') {
    const body = await readJson(ctx.request);
    const parsed = parseSyncAccountVerifyRequest({
      body,
      origin: ctx.request.headers.get('origin'),
    });
    if (!parsed.ok) return json(parsed.body, { status: parsed.status });
    const result = await ctx.service.webAuthn.verifyWebAuthnSyncAccount(parsed.request);
    let responseBody: unknown = result;
    if (result.ok && result.verified && result.thresholdEd25519) {
      // The minted session names the manifest its key set was registered
      // against. Verification resolves it from the signer record, so its
      // absence here is a server inconsistency, not a client error.
      const custodyKeyManifestDigestB64u = result.custodyKeyManifestDigestB64u;
      if (!custodyKeyManifestDigestB64u) {
        return jsonFailure(
          500,
          'internal',
          'Sync verification did not resolve the wallet key manifest',
        );
      }
      const thresholdEd25519 = result.thresholdEd25519;
      const walletId = String(result.walletId || '').trim();
      const nearAccountId = String(result.nearAccountId || '').trim();
      const nearEd25519SigningKeyId = String(result.nearEd25519SigningKeyId || '').trim();
      const signerSlot = Number(result.signerSlot);
      const walletBinding = result.walletBinding;
      const credentialIdB64u = String(result.credentialIdB64u || '').trim();
      if (
        !thresholdEd25519 ||
        !walletId ||
        !nearAccountId ||
        !nearEd25519SigningKeyId ||
        !Number.isSafeInteger(signerSlot) ||
        signerSlot < 1 ||
        !walletBinding ||
        !credentialIdB64u ||
        !String(result.publicKey || '').trim() ||
        !String(result.credentialPublicKeyB64u || '').trim() ||
        String(walletBinding.walletId) !== walletId ||
        String(walletBinding.nearAccountId) !== nearAccountId ||
        String(walletBinding.nearEd25519SigningKeyId) !== nearEd25519SigningKeyId ||
        walletBinding.signerSlot !== signerSlot
      ) {
        return jsonFailure(
          500,
          'internal',
          'verified passkey wallet is missing its Ed25519 Yao identity',
        );
      }
      const authority = passkeyWalletAuthAuthorityForMethod({
        walletId: walletBinding.walletId,
        rpId: walletBinding.rpId,
        credentialIdB64u,
        walletAuthMethodId: result.walletAuthMethodId,
      });
      const activeAuthority =
        await ctx.service.walletAuthMethods.resolveActivePasskeyAuthorityForVerifiedCredential({
          walletId: authority.walletId,
          rpId: authority.verifier.rpId,
          credentialIdB64u: authority.factor.credentialIdB64u,
        });
      if (
        !activeAuthority.ok ||
        activeAuthority.walletAuthority.authorityId !== result.walletAuthorityId ||
        activeAuthority.authMethod.walletAuthMethodId !== result.walletAuthMethodId
      ) {
        return jsonFailure(500, 'internal', 'Verified passkey wallet authority is unavailable');
      }
      const authorityRef = await walletAuthAuthorityRef({ authority });
      const principalId = parsePrincipalId(walletId);
      const mintId = parseWalletSessionMintId(parsed.request.challengeId);
      if (!principalId.ok || !mintId.ok) {
        return jsonFailure(500, 'internal', 'Verified passkey Wallet Session identity is invalid');
      }
      const issuedAtMs = Date.now();
      const expiresAtMs = issuedAtMs + DEFAULT_WALLET_SESSION_TTL_MS;
      const origin = parseSessionOrigin(parsed.request.expected_origin);
      const factorId = parseAuthFactorId(`passkey:${credentialIdB64u}`);
      const credentialId = parseWebAuthnCredentialIdB64u(credentialIdB64u);
      if (!factorId.ok || !credentialId.ok) {
        return jsonFailure(500, 'internal', 'Verified passkey factor identity is invalid');
      }
      const proof = await ctx.service.authorizedOperations.buildVerifiedOwnerProof({
        purpose: 'wallet_session',
        proofId: parseVerifiedOwnerProofId(`sync-account:${parsed.request.challengeId}`),
        factor: buildVerifiedWalletSessionPasskeyFactorResult({
          tenantId: ctx.service.authorizationSessions.tenantId,
          principalId: principalId.value,
          walletId: walletIdFromString(walletId),
          authorityRef,
          requestOrigin: origin,
          audience: origin,
          factorId: factorId.value,
          credentialIdB64u: credentialId.value,
          assertionDigest: await sha256Utf8DigestB64u(alphabetizeStringify(parsed.request)),
          verifiedAtMs: issuedAtMs,
          expiresAtMs,
        }),
      });
      if (proof.purpose !== 'wallet_session') {
        return jsonFailure(500, 'internal', 'Owner proof purpose is invalid');
      }
      const normalizedResult = {
        ok: true as const,
        verified: true as const,
        accountId: String(result.accountId || walletId),
        walletId,
        nearAccountId,
        nearEd25519SigningKeyId,
        walletAuthMethodId: result.walletAuthMethodId,
        walletAuthorityId: result.walletAuthorityId,
        foundingAuthority: activeAuthority.walletAuthority,
        foundingAuthMethod: activeAuthority.authMethod,
        custodyKeyManifestDigestB64u,
        walletBinding,
        rpId: walletBinding.rpId,
        signerSlot,
        publicKey: String(result.publicKey),
        ...(result.relayerKeyId ? { relayerKeyId: String(result.relayerKeyId) } : {}),
        credentialIdB64u,
        credentialPublicKeyB64u: String(result.credentialPublicKeyB64u),
        thresholdEd25519,
      };
      const bootstrap = await issueSyncAccountBootstrapV1({
        ctx,
        result: normalizedResult,
        authority,
        activeAuthority: activeAuthority.walletAuthority,
        foundingAuthMethod: activeAuthority.authMethod,
        walletAuthMethodId: activeAuthority.authMethod.walletAuthMethodId,
        authorityRef,
        proof,
        mintId: mintId.value,
        issuedAtMs,
        ecdsaThresholdSessionId: `sync-account-ecdsa:${parsed.request.challengeId}`,
        custody: { kind: 'read_verified_factor' },
      });
      if (bootstrap.kind === 'already_committed') {
        return json(
          {
            ok: false,
            code: 'already_committed',
            message: 'Wallet Session sync is already committed; retry the exact method',
            ...bootstrap.committed,
          },
          { status: 409 },
        );
      }
      if (bootstrap.kind === 'error') {
        return jsonFailure(bootstrap.status, bootstrap.code, bootstrap.message);
      }
      responseBody = bootstrap.body;
    }
    return json(responseBody, { status: syncAccountResponseStatus(result) });
  }

  return null;
}

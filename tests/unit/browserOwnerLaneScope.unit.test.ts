import { expect, test } from '@playwright/test';
import { BrowserSigningSurface } from '@/SeamsWeb/signingSurface/BrowserSigningSurface';
import { IndexedDBManager } from '@/core/indexedDB';
import { walletSessionAuthorizations } from '@/core/indexedDB/seamsWalletDB/walletSessionAuthorizationStore';
import type { ResolveSelectedWalletAuthorityResultV1 } from '@/core/indexedDB/seamsWalletDB/repositories';
import { buildFullOwnerPermissionsV1 } from '@shared/authorization/delegatedAuthority';
import {
  buildActiveWalletAuthorityV1,
  buildWalletSignerActivationSetV1,
  computeWalletAuthorityDigestB64u,
  computeWalletSignerActivationSetDigestB64u,
} from '@shared/authorization/walletAuthority';
import { parseDeviceId } from '@shared/authorization/capabilityKinds';
import { parseExactAdministeredSignerManifestV1 } from '@shared/device-linking/delegatedActivationPlan';
import { base64UrlEncode } from '@shared/utils/base64';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  parseLinkedDeviceEnrollmentId,
  parseLinkDeviceSessionId,
  parseWalletAuthMethodId,
  parseWalletAuthorityId,
  parseWalletId,
  parseWebAuthnCredentialIdB64u,
  parseWebAuthnRpId,
} from '@shared/utils/domainIds';
import { buildWalletAuthMethodRecordV2 } from '@shared/utils/registrationIntent';
import { buildMpcMaterialActivationRefFixture } from './helpers/ecdsaMaterialRef.fixtures';

type ResolvedOwnerAuthority = Extract<
  ResolveSelectedWalletAuthorityResultV1,
  { readonly kind: 'resolved' }
>;

function required<T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function buildSelectedEcdsaAuthority(): Promise<ResolvedOwnerAuthority> {
  const walletId = required(parseWalletId('wallet:expired-session-step-up'));
  const authorityId = required(parseWalletAuthorityId('authority:expired-session-step-up'));
  const walletAuthMethodId = required(
    parseWalletAuthMethodId('auth-method:expired-session-step-up'),
  );
  const manifest = parseExactAdministeredSignerManifestV1({
    kind: 'exact_administered_signer_manifest_v1',
    keyFamilies: ['ecdsa_secp256k1'],
    signers: [
      {
        kind: 'exact_administered_ecdsa_signer_v1',
        keyFamily: 'ecdsa_secp256k1',
        walletId,
        walletKeyId: 'wallet-key:expired-session-step-up',
        thresholdPublicKey33B64u: base64UrlEncode(
          new Uint8Array([2, ...new Uint8Array(32).fill(31)]),
        ),
        evmAddress: `0x${'1'.repeat(40)}`,
      },
    ],
  });
  const signerActivations = buildWalletSignerActivationSetV1({
    manifest,
    materialActivations: {
      keyFamilies: ['ecdsa_secp256k1'],
      ecdsa: buildMpcMaterialActivationRefFixture('expired-session-step-up'),
    },
  });
  const signerActivationSetDigestB64u =
    await computeWalletSignerActivationSetDigestB64u(signerActivations);
  const authorityWithPendingDigest = buildActiveWalletAuthorityV1({
    kind: 'wallet_authority_v1',
    authorityId,
    walletId,
    principal: {
      kind: 'owner_device',
      deviceId: required(parseDeviceId('device:expired-session-step-up')),
    },
    provenance: {
      kind: 'device_link',
      enrollmentId: required(
        parseLinkedDeviceEnrollmentId('enrollment:expired-session-step-up'),
      ),
      sourceAuthorityId: required(parseWalletAuthorityId('authority:founding-owner')),
      linkSessionId: required(parseLinkDeviceSessionId('link-session:expired-session-step-up')),
    },
    permissions: buildFullOwnerPermissionsV1(),
    signerActivations,
    signerActivationSetDigestB64u,
    authorityDigestB64u: parseDigestB64u(base64UrlEncode(new Uint8Array(32).fill(7))),
    revocationEpoch: 0,
    createdAtMs: 1,
    updatedAtMs: 2,
    state: 'active',
    activatedAtMs: 2,
  });
  const authority = buildActiveWalletAuthorityV1({
    kind: authorityWithPendingDigest.kind,
    authorityId: authorityWithPendingDigest.authorityId,
    walletId: authorityWithPendingDigest.walletId,
    principal: authorityWithPendingDigest.principal,
    provenance: authorityWithPendingDigest.provenance,
    permissions: authorityWithPendingDigest.permissions,
    signerActivations: authorityWithPendingDigest.signerActivations,
    signerActivationSetDigestB64u:
      authorityWithPendingDigest.signerActivationSetDigestB64u,
    authorityDigestB64u: await computeWalletAuthorityDigestB64u(authorityWithPendingDigest),
    revocationEpoch: authorityWithPendingDigest.revocationEpoch,
    createdAtMs: authorityWithPendingDigest.createdAtMs,
    updatedAtMs: authorityWithPendingDigest.updatedAtMs,
    state: authorityWithPendingDigest.state,
    activatedAtMs: authorityWithPendingDigest.activatedAtMs,
  });
  const authMethod = buildWalletAuthMethodRecordV2({
    version: 'wallet_auth_method_v2',
    walletAuthMethodId,
    walletId,
    walletAuthorityId: authorityId,
    kind: 'passkey',
    status: 'active',
    rpId: required(parseWebAuthnRpId('wallet.example.test')),
    credentialIdB64u: required(parseWebAuthnCredentialIdB64u('expired-session-credential')),
    credentialPublicKeyB64u: base64UrlEncode(new Uint8Array(65).fill(9)),
    counter: 0,
    createdAtMs: 1,
    updatedAtMs: 2,
    activatedAtMs: 2,
  });
  return {
    kind: 'resolved',
    selection: {
      kind: 'wallet_selection_v1',
      walletId,
      walletAuthMethodId,
      lockGeneration: 0,
      lockState: 'unlocked',
      updatedAtMs: 2,
    },
    authMethod,
    authority,
    signerMaterials: [],
    exportRoot: null,
  };
}

test('resolves the selected owner lane without requiring a live Wallet Session', async () => {
  const selected = await buildSelectedEcdsaAuthority();
  if (selected.authMethod.kind !== 'passkey') throw new Error('expected Passkey auth method');
  const surface = Object.create(BrowserSigningSurface.prototype) as BrowserSigningSurface;
  const originalResolveSelected = IndexedDBManager.resolveSelectedWalletAuthority;
  const originalReadExact = walletSessionAuthorizations.readExactActiveForWallet;
  let walletSessionRead = false;
  try {
    IndexedDBManager.resolveSelectedWalletAuthority = async () => selected;
    walletSessionAuthorizations.readExactActiveForWallet = async () => {
      walletSessionRead = true;
      throw new Error('expired Wallet Session must not gate owner-lane resolution');
    };

    await expect(surface.resolveSelectedOwnerLaneScope(selected.authority.walletId)).resolves.toEqual(
      {
        auth: {
          kind: 'passkey',
          rpId: selected.authMethod.rpId,
          credentialIdB64u: selected.authMethod.credentialIdB64u,
        },
        keyFamily: 'ecdsa',
      },
    );
    expect(walletSessionRead).toBe(false);
  } finally {
    IndexedDBManager.resolveSelectedWalletAuthority = originalResolveSelected;
    walletSessionAuthorizations.readExactActiveForWallet = originalReadExact;
  }
});

import { buildFullOwnerPermissionsV1 } from '@shared/authorization/delegatedAuthority';
import { parseVoiceIdDevicePublicKeyB64u } from '@shared/authorization/voiceIdDeviceAssertion';
import { requireParsed } from '@shared/passkey-custody/primitives';
import { base64UrlEncode } from '@shared/utils/base64';
import { sha256DigestB64u } from '@shared/utils/canonicalPrimitives';
import { allocateWalletAuthMethodId, parseWebAuthnCredentialIdB64u } from '@shared/utils/domainIds';
import { buildEmailOtpWalletAuthAuthority } from '@shared/utils/walletAuthAuthority';
import {
  buildWalletAuthMethodRecordV2,
  type ActivePasskeyWalletAuthMethodRecordV2,
  type WalletAuthMethodRecordV2,
} from '@shared/utils/walletAuthMethodRecord';
import type { LocalWalletAuthMethodRecord } from '@/core/indexedDB';
import { buildLinkedDeviceManagementAuthorityFixture } from '../../unit/helpers/linkedDeviceManagement.fixtures';

/* The method records that the D1 and IndexedDB fixtures store: one of each kind and status
   that today's stores admit, all on one wallet authority. */

export const RECORDS_WALLET_ID = 'wallet:conformance-records';
export const RECORDS_RP_ID = 'wallet.example.test';
export const RECORDS_EMAIL_HASH_HEX = 'a'.repeat(64);
export const RECORDS_VOICE_METHOD_ID = allocateWalletAuthMethodId('conformance-voiceid');

/** The founding authority and its active passkey method. */
export const recordsAuthority = buildLinkedDeviceManagementAuthorityFixture({
  label: 'conformance-records',
  permissions: buildFullOwnerPermissionsV1(),
  provenance: 'wallet_registration',
  identity: {
    walletId: RECORDS_WALLET_ID,
    authorityId: 'authority:conformance-records',
    walletAuthMethodId: 'auth-method:conformance-passkey-active',
    rpId: RECORDS_RP_ID,
  },
});

export function credentialId(fill: number) {
  return requireParsed(
    parseWebAuthnCredentialIdB64u(base64UrlEncode(new Uint8Array(32).fill(fill))),
    'credentialIdB64u',
  );
}

/** V2 rows: the active founder, a pending and a revoked passkey, Email OTP and VoiceID. */
export async function authMethodRecordsV2(
  active: ActivePasskeyWalletAuthMethodRecordV2,
): Promise<WalletAuthMethodRecordV2[]> {
  const devicePublicKeyB64u = parseVoiceIdDevicePublicKeyB64u(
    base64UrlEncode(new Uint8Array(32).fill(41)),
  );
  const common = {
    version: 'wallet_auth_method_v2',
    walletId: active.walletId,
    walletAuthorityId: active.walletAuthorityId,
    createdAtMs: 100,
    updatedAtMs: 300,
  } as const;
  const passkey = {
    kind: 'passkey',
    rpId: active.rpId,
    credentialPublicKeyB64u: active.credentialPublicKeyB64u,
    counter: 0,
  } as const;
  return [
    active,
    buildWalletAuthMethodRecordV2({
      ...common,
      ...passkey,
      walletAuthMethodId: allocateWalletAuthMethodId('conformance-passkey-pending'),
      credentialIdB64u: credentialId(42),
      status: 'pending_local_install',
    }),
    buildWalletAuthMethodRecordV2({
      ...common,
      ...passkey,
      walletAuthMethodId: allocateWalletAuthMethodId('conformance-passkey-revoked'),
      credentialIdB64u: credentialId(43),
      status: 'revoked',
      activatedAtMs: 200,
      revokedAtMs: 300,
    }),
    buildWalletAuthMethodRecordV2({
      ...common,
      walletAuthMethodId: allocateWalletAuthMethodId('conformance-email-otp'),
      kind: 'email_otp',
      emailHashHex: RECORDS_EMAIL_HASH_HEX,
      registrationAuthorityId: 'registration-authority:conformance',
      status: 'active',
      activatedAtMs: 200,
    }),
    buildWalletAuthMethodRecordV2({
      ...common,
      walletAuthMethodId: RECORDS_VOICE_METHOD_ID,
      kind: 'voiceid',
      devicePublicKeyB64u,
      deviceKeyId: await sha256DigestB64u(new Uint8Array(32).fill(41)),
      status: 'active',
      activatedAtMs: 200,
    }),
  ];
}

/** V1 rows of this device: an active and a revoked passkey, an active and a revoked Email OTP. */
export function localAuthMethodRecordsV1(
  active: ActivePasskeyWalletAuthMethodRecordV2,
): LocalWalletAuthMethodRecord[] {
  const passkey = {
    version: 'wallet_auth_method_v1',
    kind: 'passkey',
    walletId: active.walletId,
    rpId: active.rpId,
    credentialPublicKeyB64u: active.credentialPublicKeyB64u,
    counter: 0,
    createdAtMs: 100,
    updatedAtMs: 200,
  } as const;
  const emailOtp = (emailHashHex: string, status: 'active' | 'revoked') =>
    ({
      version: 'wallet_auth_method_v1',
      kind: 'email_otp',
      status,
      walletId: active.walletId,
      emailHashHex,
      registrationAuthorityId: 'registration-authority:conformance',
      createdAtMs: 100,
      updatedAtMs: 200,
      localStatus: 'synced',
      authority: buildEmailOtpWalletAuthAuthority({
        walletId: active.walletId,
        provider: 'email',
        providerUserId: 'owner@example.test',
        emailHashHex,
      }),
    }) as const;
  return [
    { ...passkey, status: 'active', credentialIdB64u: active.credentialIdB64u, localStatus: 'synced' },
    { ...passkey, status: 'revoked', credentialIdB64u: credentialId(43), localStatus: 'pending' },
    emailOtp(RECORDS_EMAIL_HASH_HEX, 'active'),
    emailOtp('c'.repeat(64), 'revoked'),
  ];
}

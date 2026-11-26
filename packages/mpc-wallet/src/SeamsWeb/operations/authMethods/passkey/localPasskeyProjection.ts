/**
 * The local projection of a passkey factor the server has already accepted.
 *
 * The local record mirrors a canonical owner credential the server has
 * verified and persisted.
 *
 * Persisting is deliberately separate from the finalize that produced it. The
 * server's record is the authority; this is a cache. A finalize that succeeded
 * but whose local write did not is recoverable — replaying the finalize returns
 * the same response and the projection can be written again.
 */
import { base64UrlDecode } from '@shared/utils/base64';
import {
  parseWalletAuthMethodId,
  parseWalletAuthorityId,
  parseWebAuthnCredentialIdB64u,
  parseWebAuthnRpId,
  type WalletAuthMethodId,
  type WalletAuthorityId,
} from '@shared/utils/domainIds';
import { type WalletId } from '@shared/utils/registrationIntent';
import {
  buildWalletAuthMethodRecordV2,
  type ActivePasskeyWalletAuthMethodRecordV2,
} from '@shared/utils/walletAuthMethodRecord';
import { IndexedDBManager, type LocalWalletAuthMethodRecord } from '@/core/indexedDB';

/** The finalize fields this projection is built from, whichever route returned them. */
type FinalizedPasskeyAuthMethodV1 = {
  readonly walletId: WalletId;
  readonly rpId: string;
  readonly credentialIdB64u: string;
  readonly credentialPublicKeyB64u: string;
  readonly counter: number;
};

function localPasskeyAuthMethodFromFinalizeV1(
  args: FinalizedPasskeyAuthMethodV1,
): LocalWalletAuthMethodRecord & { kind: 'passkey' } {
  const parsedRpId = parseWebAuthnRpId(args.rpId);
  if (!parsedRpId.ok) throw new Error(parsedRpId.error.message);
  const parsedCredentialId = parseWebAuthnCredentialIdB64u(args.credentialIdB64u);
  if (!parsedCredentialId.ok) throw new Error(parsedCredentialId.error.message);
  const credentialPublicKeyB64u = String(args.credentialPublicKeyB64u || '').trim();
  if (!credentialPublicKeyB64u) {
    throw new Error('Wallet add-passkey finalize omitted credential public key');
  }
  if (base64UrlDecode(credentialPublicKeyB64u).byteLength === 0) {
    throw new Error('Wallet add-passkey finalize returned an empty credential public key');
  }
  if (!Number.isSafeInteger(args.counter) || args.counter < 0) {
    throw new Error('Wallet add-passkey finalize returned an invalid credential counter');
  }
  const nowMs = Date.now();
  return {
    version: 'wallet_auth_method_v1',
    kind: 'passkey',
    status: 'active',
    localStatus: 'synced',
    walletId: args.walletId,
    rpId: parsedRpId.value,
    credentialIdB64u: parsedCredentialId.value,
    credentialPublicKeyB64u,
    counter: args.counter,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

/** Writes the projection for a factor the server has already accepted. */
export async function persistFinalizedPasskeyAuthMethodV1(
  args: FinalizedPasskeyAuthMethodV1,
): Promise<void> {
  await IndexedDBManager.upsertWalletAuthMethod(localPasskeyAuthMethodFromFinalizeV1(args));
}

/**
 * The full local install for a passkey added to a wallet that registered with
 * another family.
 *
 * Three records, and unlock needs all of them. It reads the profile, then the
 * profile's authenticators, then keeps only those whose credential belongs to
 * an ACTIVE V2 passkey method — so writing the V1 record alone leaves a wallet
 * that has the method on the server and cannot open with it locally. That is
 * precisely the state the first browser run found.
 *
 * The same-family addition never showed this: a passkey-registered wallet
 * already had a profile, an authenticator and a V2 record, so the gap was
 * invisible until a wallet arrived without them.
 */
export async function persistAddedCrossFamilyPasskeyV1(args: {
  readonly walletId: WalletId;
  readonly walletAuthMethodId: WalletAuthMethodId | string;
  readonly walletAuthorityId: WalletAuthorityId | string;
  readonly rpId: string;
  readonly credentialIdB64u: string;
  readonly credentialPublicKeyB64u: string;
  readonly counter: number;
  readonly signerSlot: number;
  readonly credential: { readonly id: string; readonly rawId: string };
}): Promise<void> {
  await persistFinalizedPasskeyAuthMethodV1(args);
  const walletAuthMethodId = parseWalletAuthMethodId(args.walletAuthMethodId);
  const walletAuthorityId = parseWalletAuthorityId(args.walletAuthorityId);
  if (!walletAuthMethodId.ok || !walletAuthorityId.ok) {
    throw new Error('added passkey identity is invalid');
  }
  await persistSyncedPasskeyAuthMethodV2({
    walletId: args.walletId,
    walletAuthMethodId: walletAuthMethodId.value,
    walletAuthorityId: walletAuthorityId.value,
    rpId: args.rpId,
    credentialIdB64u: args.credentialIdB64u,
    credentialPublicKeyB64u: args.credentialPublicKeyB64u,
    counter: args.counter,
  });
  /* The wallet keeps the profile it registered with — an addition changes how
     the wallet opens, not which signer it is — so only the credential the
     addition created is recorded here. */
  const nowIso = new Date().toISOString();
  await IndexedDBManager.upsertProfileAuthenticator({
    profileId: String(args.walletId),
    signerSlot: args.signerSlot,
    credentialId: args.credentialIdB64u,
    credentialPublicKey: base64UrlDecode(args.credentialPublicKeyB64u),
    registered: nowIso,
    syncedAt: nowIso,
  });
}

type SyncedPasskeyAuthMethodV2 = {
  readonly walletId: WalletId;
  readonly walletAuthMethodId: WalletAuthMethodId;
  readonly walletAuthorityId: WalletAuthorityId;
  readonly rpId: string;
  readonly credentialIdB64u: string;
  readonly credentialPublicKeyB64u: string;
  readonly counter: number;
};

function localPasskeyAuthMethodFromSyncV2(
  args: SyncedPasskeyAuthMethodV2,
): ActivePasskeyWalletAuthMethodRecordV2 {
  const rpId = parseWebAuthnRpId(args.rpId);
  const credentialIdB64u = parseWebAuthnCredentialIdB64u(args.credentialIdB64u);
  const walletAuthMethodId = parseWalletAuthMethodId(args.walletAuthMethodId);
  const walletAuthorityId = parseWalletAuthorityId(args.walletAuthorityId);
  const credentialPublicKeyB64u = String(args.credentialPublicKeyB64u || '').trim();
  if (!rpId.ok || !credentialIdB64u.ok || !walletAuthMethodId.ok || !walletAuthorityId.ok) {
    throw new Error('Synced passkey auth-method identity is invalid');
  }
  if (!credentialPublicKeyB64u || base64UrlDecode(credentialPublicKeyB64u).byteLength === 0) {
    throw new Error('Synced passkey auth method omitted credential public key');
  }
  if (!Number.isSafeInteger(args.counter) || args.counter < 0) {
    throw new Error('Synced passkey auth method returned an invalid credential counter');
  }
  const nowMs = Date.now();
  const record = buildWalletAuthMethodRecordV2({
    version: 'wallet_auth_method_v2',
    walletAuthMethodId: walletAuthMethodId.value,
    walletId: args.walletId,
    walletAuthorityId: walletAuthorityId.value,
    kind: 'passkey',
    status: 'active',
    rpId: rpId.value,
    credentialIdB64u: credentialIdB64u.value,
    credentialPublicKeyB64u,
    counter: args.counter,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    activatedAtMs: nowMs,
  });
  if (record.kind !== 'passkey' || record.status !== 'active') {
    throw new Error('Synced passkey auth method branch is invalid');
  }
  return record;
}

async function persistSyncedPasskeyAuthMethodV2(args: SyncedPasskeyAuthMethodV2): Promise<void> {
  await IndexedDBManager.upsertWalletAuthMethodV2(localPasskeyAuthMethodFromSyncV2(args));
}

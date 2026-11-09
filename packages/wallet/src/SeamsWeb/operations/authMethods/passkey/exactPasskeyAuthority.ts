import { IndexedDBManager } from '@/core/indexedDB';
import {
  exactWalletSessionAuthorityIdentity,
  type ExactWalletSessionAuthorization,
  type ExactWalletSessionAuthorityIdentity,
} from '@/core/signingEngine/session/persistence/walletSessionAuthorizationProjection';
import type { WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import {
  walletAuthAuthorityRef,
  type WalletAuthAuthorityRef,
} from '@shared/utils/walletAuthAuthority';
import type { ActivePasskeyWalletAuthMethodRecordV2 } from '@shared/utils/walletAuthMethodRecord';
import type { WalletAuthMethodId } from '@shared/utils/domainIds';
import type { ActiveWalletAuthorityV1 } from '@shared/authorization/walletAuthority';

/**
 * The wallet's one active passkey method for this credential. The local
 * auth-method store is the one source that names a wallet's methods: a method
 * id derived from the credential is not the id the wallet registered it under.
 */
export async function exactPasskeyWalletAuthMethodForCredential(args: {
  readonly walletId: WalletId;
  readonly rpId: string;
  readonly credentialIdB64u: string;
}): Promise<ActivePasskeyWalletAuthMethodRecordV2> {
  const records = await IndexedDBManager.listWalletAuthMethodsV2ForWallet(String(args.walletId));
  const matches = records.filter(
    (record): record is ActivePasskeyWalletAuthMethodRecordV2 =>
      record.kind === 'passkey' &&
      record.status === 'active' &&
      record.walletId === args.walletId &&
      String(record.rpId) === args.rpId &&
      String(record.credentialIdB64u) === args.credentialIdB64u,
  );
  const [record] = matches;
  if (matches.length !== 1 || !record) {
    throw new Error('passkey authority requires one exact active V2 auth method');
  }
  return record;
}

/** The authority reference of the wallet's active passkey method for this credential. */
export async function exactPasskeyWalletAuthAuthorityRefForCredential(args: {
  readonly walletId: WalletId;
  readonly rpId: string;
  readonly credentialIdB64u: string;
}): Promise<WalletAuthAuthorityRef> {
  const record = await exactPasskeyWalletAuthMethodForCredential(args);
  return await passkeyMethodAuthorityRef(record);
}

async function passkeyMethodAuthorityRef(
  record: ActivePasskeyWalletAuthMethodRecordV2,
): Promise<WalletAuthAuthorityRef> {
  return await walletAuthAuthorityRef({
    authority: {
      walletId: record.walletId,
      factor: {
        kind: 'passkey',
        credentialIdB64u: record.credentialIdB64u,
      },
      verifier: {
        kind: 'webauthn',
        rpId: record.rpId,
      },
      bindingId: record.walletAuthMethodId,
    },
  });
}

export type ValidatedPasskeyWalletSessionAuthority = {
  readonly reference: WalletAuthAuthorityRef;
  readonly identity: ExactWalletSessionAuthorityIdentity;
};

export async function resolveActivePasskeyWalletSessionAuthority(args: {
  readonly walletId: WalletId;
  readonly authorization: ExactWalletSessionAuthorization;
}): Promise<ValidatedPasskeyWalletSessionAuthority> {
  const authMethod = await IndexedDBManager.getWalletAuthMethodV2(
    args.authorization.record.authMethodId,
  );
  if (
    !authMethod ||
    authMethod.kind !== 'passkey' ||
    authMethod.status !== 'active' ||
    authMethod.walletId !== args.walletId ||
    authMethod.walletAuthorityId !== args.authorization.record.authorityId
  ) {
    throw new Error('Passkey Wallet Session authorization changed auth-method identity');
  }
  const authority = await IndexedDBManager.getWalletAuthority(authMethod.walletAuthorityId);
  if (
    !authority ||
    authority.state !== 'active' ||
    authority.walletId !== args.walletId ||
    authority.authorityId !== args.authorization.record.authorityId ||
    authority.authorityDigestB64u !== args.authorization.record.authorityDigestB64u ||
    authority.revocationEpoch !== args.authorization.record.authorityRevocationEpoch
  ) {
    throw new Error('Passkey Wallet Session authorization changed authority identity');
  }
  return {
    reference: await passkeyMethodAuthorityRef(authMethod),
    identity: exactWalletSessionAuthorityIdentity({
      authority,
      walletAuthMethodId: authMethod.walletAuthMethodId,
    }),
  };
}

/** Capture before the server operation so a delayed response cannot replace a newer authority. */
export async function readActivePasskeyAuthorityForRecovery(input: {
  readonly walletId: WalletId;
  readonly authMethodId: WalletAuthMethodId;
}): Promise<ActiveWalletAuthorityV1> {
  const method = await IndexedDBManager.getWalletAuthMethodV2(input.authMethodId);
  if (
    !method ||
    method.kind !== 'passkey' ||
    method.status !== 'active' ||
    method.walletId !== input.walletId
  ) {
    throw new Error('Passkey recovery requires its active authentication method');
  }
  const authority = await IndexedDBManager.getWalletAuthority(method.walletAuthorityId);
  if (!authority || authority.state !== 'active' || authority.walletId !== input.walletId) {
    throw new Error('Passkey recovery requires its active wallet authority');
  }
  return authority;
}

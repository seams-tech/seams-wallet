import { IndexedDBManager } from '@/core/indexedDB';
import type { WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { walletAuthAuthorityRef, type WalletAuthAuthorityRef } from '@shared/utils/walletAuthAuthority';
import type { ActivePasskeyWalletAuthMethodRecordV2 } from '@shared/utils/walletAuthMethodRecord';

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

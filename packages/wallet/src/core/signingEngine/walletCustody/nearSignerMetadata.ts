import { walletSessionAuthorizations } from '@/core/indexedDB';
import { resolveMlDsaPasskeyOwner } from './mlDsaOwner';
import { readMlDsaSignerMetadata } from '@/core/rpcClients/relayer/mlDsaInventory';
import type { WalletId } from '@shared/utils/domainIds';
import type { MlDsaSignerInventoryOutcome } from '@shared/near/mlDsaInventory';

/** Read public metadata in wallet origin. The operation credential never crosses the iframe boundary. */
export async function readNearSignerMetadata(input: {
  readonly walletId: WalletId;
  readonly relayerUrl: string;
}): Promise<MlDsaSignerInventoryOutcome> {
  const owner = await resolveMlDsaPasskeyOwner(input.walletId);
  if (owner.kind !== 'owner')
    return {
      kind: 'refused',
      code: 'unauthorized',
      message: 'Unlock a full-owner passkey to manage signing keys.',
    };
  const exact = await walletSessionAuthorizations.readExactWithOperationCredential({
    walletId: input.walletId,
    authorityId: owner.authority.authorityId,
    authMethodId: owner.authMethod.walletAuthMethodId,
  });
  if (
    exact.kind !== 'found' ||
    exact.record.expiresAtMs <= Date.now() ||
    exact.record.authorityDigestB64u !== owner.authority.authorityDigestB64u ||
    exact.record.authorityRevocationEpoch !== owner.authority.revocationEpoch
  )
    return {
      kind: 'refused',
      code: 'unauthorized',
      message: 'Unlock this wallet again to read its signing keys.',
    };
  const inventory = await readMlDsaSignerMetadata({
    relayerUrl: input.relayerUrl,
    walletId: input.walletId,
    credential: exact.operationCredential,
  });
  const current = await resolveMlDsaPasskeyOwner(input.walletId);
  if (
    current.kind !== 'owner' ||
    current.authority.authorityDigestB64u !== owner.authority.authorityDigestB64u ||
    current.authority.revocationEpoch !== owner.authority.revocationEpoch ||
    current.authMethod.walletAuthMethodId !== owner.authMethod.walletAuthMethodId
  )
    return {
      kind: 'refused',
      code: 'unauthorized',
      message: 'The wallet session changed. Open signing keys again.',
    };
  return inventory;
}

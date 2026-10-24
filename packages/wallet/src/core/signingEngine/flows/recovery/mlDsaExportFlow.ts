import type { PasskeyMpcExportPort } from '../../uiConfirm/uiConfirm.types';
import type { SigningEngineExportKeypairWithUIInput } from './keyExportFlow';
import type { Variant } from '@shared/utils/variant';
import { resolveFullWalletOwner } from '../../walletCustody/walletSigningOwner';
import { readPasskeyCustodySessionEnvelope } from '../../session/passkey/passkeyCustodySessionCache';
import { createExportUiRequestId, emitNearKeyExportViewerLifecycle } from './keyExportFlow';

export type MlDsaExportDependencies = {
  readonly relayerUrl: string;
  readonly passkeyMpcExport: PasskeyMpcExportPort;
};

export async function exportMlDsaKeyWithFreshAuthorization(
  deps: MlDsaExportDependencies,
  input: Variant<SigningEngineExportKeypairWithUIInput, 'kind', 'ml_dsa_65'> & {
    readonly flowId: string;
  },
): Promise<{ accountId: string; exportedSchemes: Array<'ml_dsa_65'> }> {
  const owner = await resolveFullWalletOwner(input.walletSession.walletId);
  if (owner.kind === 'refused' || owner.authMethod.kind !== 'passkey')
    throw new Error('ML-DSA export requires an unlocked full-owner passkey');
  const envelope = await readPasskeyCustodySessionEnvelope({
    walletId: String(input.walletSession.walletId),
    credentialIdB64u: owner.authMethod.credentialIdB64u,
  });
  if (!envelope || envelope.binding.kind !== 'wallet_custody_seed_v1')
    throw new Error('Unlock with a wallet custody owner before exporting ML-DSA');
  const result = await deps.passkeyMpcExport.exportPrivateKeysWithUi(
    {
      artifactKind: 'ml-dsa-65-fips-seed-export-v1',
      viewerSessionId: createExportUiRequestId('export-ml-dsa-viewer-session'),
      walletId: String(input.walletSession.walletId),
      nearAccountId: String(input.nearAccount.accountId),
      relayerUrl: deps.relayerUrl,
      rpId: owner.authMethod.rpId,
      credentialIdB64u: owner.authMethod.credentialIdB64u,
      signer: input.signer,
      envelope,
      variant: input.options.variant,
      theme: input.options.theme,
    },
    {
      onViewerLifecycle: emitNearKeyExportViewerLifecycle.bind(undefined, {
        flowId: input.flowId,
        walletId: input.walletSession.walletId,
        curve: 'ml_dsa_65',
        onEvent: input.options.onEvent,
      }),
    },
  );
  if (result.kind !== 'completed') throw new Error(result.error);
  if (result.exportedSchemes.length !== 1 || result.exportedSchemes[0] !== 'ml_dsa_65')
    throw new Error('The secure export worker returned a different key scheme');
  return { accountId: result.accountId, exportedSchemes: ['ml_dsa_65'] };
}

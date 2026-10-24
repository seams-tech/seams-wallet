import { walletSessionAuthorizations } from '@/core/indexedDB';
import { base64UrlDecode } from '@shared/utils/base64';
import { base58Encode } from '@shared/utils/base58';
import type { MlDsaSeedExportWorkerPayload } from '@/core/types/secure-confirm-worker';
import type { WorkerOperationContext } from '../../workerManager/executeWorkerOperation';
import type { EmailOtpExportAuthorizationDeps } from './keyExportConfirmation';
import { requestEmailOtpExportAuthorization } from '../../stepUpConfirmation/otpPrompt/exportAuthorization';
import { readUnlockedEd25519ExportRootLinkingCapabilityV1 } from '../../walletCustody/unlockedEd25519ExportRootCapability';
import { IndexedDBManager } from '@/core/indexedDB';
import type { PasskeyCustodyEnvelopeRecord } from '@shared/passkey-custody';
import type { PasskeyMpcExportPort } from '../../uiConfirm/uiConfirm.types';
import type { SigningEngineExportKeypairWithUIInput } from './keyExportFlow';
import type { Variant } from '@shared/utils/variant';
import { resolveFullWalletOwner } from '../../walletCustody/walletSigningOwner';
import { readPasskeyCustodySessionEnvelope } from '../../session/passkey/passkeyCustodySessionCache';
import { createExportUiRequestId, emitNearKeyExportViewerLifecycle } from './keyExportFlow';

export type MlDsaExportDependencies = {
  readonly workerContext: WorkerOperationContext;
  readonly touchConfirm: EmailOtpExportAuthorizationDeps['touchConfirm'];
  readonly requestExportChallenge: EmailOtpExportAuthorizationDeps['requestExportChallenge'];
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
  if (owner.kind === 'refused') throw new Error('ML-DSA export requires an unlocked full owner');
  let envelope: PasskeyCustodyEnvelopeRecord | null = null;
  let auth: MlDsaSeedExportWorkerPayload['auth'];
  if (owner.authMethod.kind === 'passkey') {
    envelope = await readPasskeyCustodySessionEnvelope({
      walletId: String(input.walletSession.walletId),
      credentialIdB64u: owner.authMethod.credentialIdB64u,
    });
    auth = {
      kind: 'passkey',
      rpId: owner.authMethod.rpId,
      credentialIdB64u: owner.authMethod.credentialIdB64u,
    };
  } else {
    const exact = await walletSessionAuthorizations.readExactActiveForWallet({
      walletId: owner.authority.walletId,
      authorityId: owner.authority.authorityId,
      authMethodId: owner.authMethod.walletAuthMethodId,
    });
    if (
      exact.kind !== 'found' ||
      exact.record.authorityDigestB64u !== owner.authority.authorityDigestB64u
    )
      throw new Error('Refresh the owner session before exporting');
    const capability = readUnlockedEd25519ExportRootLinkingCapabilityV1(
      String(owner.authority.walletId),
    );
    if (
      !capability ||
      capability.walletAuthMethodId !== owner.authMethod.walletAuthMethodId ||
      capability.walletSessionId !== exact.operationCredential.walletSessionId
    )
      throw new Error('Unlock the selected owner before exporting');
    envelope = await deps.workerContext.requestWorkerOperation({
      kind: 'walletCustodyCeremony',
      request: {
        type: 'readMlDsaExportEnvelope',
        payload: {
          capability,
          signingKeyId: input.signer.signingKeyId,
          publicKeyB64u: input.signer.publicKeyB64u,
        },
      },
    });
    const confirmation = await requestEmailOtpExportAuthorization({
      identity: {
        kind: 'near_account',
        walletId: owner.authority.walletId,
        nearAccountId: input.nearAccount.accountId,
      },
      chain: 'near',
      curve: 'ml_dsa_65',
      publicKey: `ml-dsa-65:${base58Encode(base64UrlDecode(input.signer.publicKeyB64u))}`,
      challengeSource: {
        requestChallenge: requestMlDsaExportChallenge.bind(
          undefined,
          deps,
          owner.authority.walletId,
        ),
      },
      confirmer: {
        requestUserConfirmation: deps.touchConfirm.requestUserConfirmation.bind(deps.touchConfirm),
      },
    });
    auth = {
      kind: 'email_otp',
      walletAuthMethodId: owner.authMethod.walletAuthMethodId,
      sessionAuth: exact.operationCredential,
      challengeId: confirmation.challengeId,
      otpCode: confirmation.otpCode,
    };
  }
  if (owner.authority.provenance.kind === 'device_link') {
    const selected = await IndexedDBManager.resolveSelectedWalletAuthority(
      String(input.walletSession.walletId),
    );
    if (
      selected.kind !== 'resolved' ||
      selected.authority.authorityId !== owner.authority.authorityId ||
      selected.authMethod.walletAuthMethodId !== owner.authMethod.walletAuthMethodId
    )
      throw new Error('The linked export owner changed');
    envelope = null;
    for (const root of selected.exportRoots) {
      const binding = root.envelope.binding;
      if (
        binding.kind === 'ml_dsa_65_owner_root_v1' &&
        binding.mlDsaSigningKeyId === input.signer.signingKeyId &&
        binding.registeredPublicKeyB64u === input.signer.publicKeyB64u &&
        binding.keyManifestDigestB64u === input.signer.keyManifestDigestB64u
      )
        envelope = root.envelope;
    }
  }
  if (
    !envelope ||
    (envelope.binding.kind !== 'wallet_custody_seed_v1' &&
      envelope.binding.kind !== 'ml_dsa_65_owner_root_v1')
  )
    throw new Error('This device has no export root for the selected ML-DSA key');
  const result = await deps.passkeyMpcExport.exportPrivateKeysWithUi(
    {
      artifactKind: 'ml-dsa-65-fips-seed-export-v1',
      viewerSessionId: createExportUiRequestId('export-ml-dsa-viewer-session'),
      walletId: String(input.walletSession.walletId),
      nearAccountId: String(input.nearAccount.accountId),
      relayerUrl: deps.relayerUrl,
      auth,
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

function requestMlDsaExportChallenge(
  deps: MlDsaExportDependencies,
  walletId: import('@shared/utils/domainIds').WalletId,
) {
  return deps.requestExportChallenge({ kind: 'wallet_export_challenge', walletId, chain: 'near' });
}

import { IndexedDBManager } from '@/core/indexedDB';
import { IndexedDbEcdsaCapabilityManifestStore } from '@/core/indexedDB/seamsWalletDB/ecdsaCapabilityManifestStore';
import { copyWalletCustodyEcdsaContinuityToAuthMethod } from '@/core/indexedDB/seamsWalletDB/walletCustodyEcdsaContinuity';
import { openEcdsaRoleLocalSigningMaterialWasm } from '@/core/signingEngine/threshold/crypto/ecdsaDerivationClientWasm';
import type { WorkerOperationContext } from '@/core/signingEngine/workerManager/executeWorkerOperation';
import { mpcMaterialActivationRefsEqual } from '@shared/utils/domainIds';
import type { AuthMethodSessionInstaller } from './hostPlugin';
import type { resolveAuthMethodSessionIdentity } from './sessionIdentity';

/** Called after the factor opened the authenticated wallet seed envelope. */
export async function installAuthMethodEcdsaMaterial(
  unlocked: Parameters<AuthMethodSessionInstaller>[0],
  identity: Awaited<ReturnType<typeof resolveAuthMethodSessionIdentity>>,
  workerCtx: WorkerOperationContext,
): Promise<void> {
  const activation = identity.authority.signerActivations.ecdsa;
  if (!activation) {
    if (unlocked.near.kind !== 'ready') throw new Error('This wallet has no active signer.');
    return;
  }
  const subjects = unlocked.walletSession.capabilitySubjects.filter(isEcdsaSignSubject);
  if (
    subjects.length !== 1 ||
    subjects[0]?.kind !== 'sign' ||
    !mpcMaterialActivationRefsEqual(subjects[0].materialActivation, activation.materialActivation)
  ) {
    throw new Error('ECDSA material does not belong to this Wallet Session.');
  }
  unlocked.signal.throwIfAborted();
  const store = new IndexedDbEcdsaCapabilityManifestStore();
  const selector = {
    authority: identity.ref,
    capability: activation.materialActivation.capability,
  };
  let lookup = await store.lookup(selector);
  if (lookup.kind === 'missing') {
    // A newly enabled method has a seed envelope but no ECDSA access record.
    // Project the same activation from an active sibling method on this authority.
    const listed = await store.listActiveWalletCapabilitySubjects(identity.method.walletId);
    if (listed.kind !== 'resolved') throw new Error('ECDSA material inventory is unavailable.');
    let copied = false;
    for (const source of listed.subjects) {
      if (source.authority.walletAuthMethodId === identity.method.walletAuthMethodId) continue;
      const sourceLookup = await store.lookup(source);
      if (
        sourceLookup.kind !== 'active' ||
        !mpcMaterialActivationRefsEqual(
          sourceLookup.manifest.activation.materialActivation,
          activation.materialActivation,
        )
      )
        continue;
      const method = await IndexedDBManager.getWalletAuthMethodV2(
        source.authority.walletAuthMethodId,
      );
      if (
        !method ||
        method.status !== 'active' ||
        method.walletAuthorityId !== identity.authority.authorityId
      )
        continue;
      await copyWalletCustodyEcdsaContinuityToAuthMethod({
        walletId: identity.method.walletId,
        walletAuthorityId: identity.authority.authorityId,
        sourceWalletAuthMethodId: method.walletAuthMethodId,
        targetAuthority: identity.ref,
      });
      copied = true;
      break;
    }
    if (!copied)
      throw new Error(
        'Unlock with a passkey or Email OTP once to restore ECDSA material on this device.',
      );
    lookup = await store.lookup(selector);
  }
  if (
    lookup.kind !== 'active' ||
    !mpcMaterialActivationRefsEqual(
      lookup.manifest.activation.materialActivation,
      activation.materialActivation,
    )
  ) {
    throw new Error('ECDSA material changed during VoiceID unlock.');
  }
  unlocked.signal.throwIfAborted();
  const opened = await openEcdsaRoleLocalSigningMaterialWasm({
    workerCtx,
    authority: identity.ref,
    materialActivation: activation.materialActivation,
  });
  if (!opened.ok) throw new Error('ECDSA material could not be opened for VoiceID.');
  unlocked.signal.throwIfAborted();
}

function isEcdsaSignSubject(
  subject: Parameters<AuthMethodSessionInstaller>[0]['walletSession']['capabilitySubjects'][number],
): boolean {
  return subject.kind === 'sign' && subject.keyFamily === 'ecdsa_secp256k1';
}

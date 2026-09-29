import { IndexedDbEcdsaCapabilityManifestStore } from '@/core/indexedDB/seamsWalletDB/ecdsaCapabilityManifestStore';
import type { EcdsaWalletActivationSelectorListResult } from '@/core/indexedDB/seamsWalletDB/ecdsaCapabilityManifestStore';
import type { EvmFamilyEcdsaWalletUnlockSubject } from '@/core/signingEngine/session/identity/walletUnlockSubject';
import { type WalletId } from '@shared/utils/domainIds';

export type {
  EvmFamilyEcdsaWalletUnlockSubject,
  EvmFamilyEcdsaWalletUnlockSubjectSet,
} from '@/core/signingEngine/session/identity/walletUnlockSubject';

export type WalletUnlockCapabilitySubjectResolutionFailure =
  | 'capability_subject_lookup_failed'
  | 'invalid_capability_subject';

const ecdsaCapabilityManifestStore = new IndexedDbEcdsaCapabilityManifestStore();

async function listEvmFamilyEcdsaWalletUnlockSubjects(walletId: WalletId): Promise<
  | {
      readonly kind: 'resolved';
      readonly subjects: readonly EvmFamilyEcdsaWalletUnlockSubject[];
    }
  | {
      readonly kind: 'failed';
      readonly reason: WalletUnlockCapabilitySubjectResolutionFailure;
      readonly subjects?: never;
    }
> {
  const resolved = await ecdsaCapabilityManifestStore.listActiveWalletCapabilitySubjects(walletId);
  if (resolved.kind === 'persistence_unavailable') {
    return {
      kind: 'failed',
      reason: 'capability_subject_lookup_failed',
    };
  }
  if (resolved.kind === 'invalid_current_state') {
    return {
      kind: 'failed',
      reason: 'invalid_capability_subject',
    };
  }
  const subjects: EvmFamilyEcdsaWalletUnlockSubject[] = [];
  for (const subject of resolved.subjects) {
    subjects.push({
      kind: 'evm_family_ecdsa_wallet',
      walletId,
      capability: subject.capability,
      authority: subject.authority,
      ecdsaThresholdKeyId: subject.ecdsaThresholdKeyId,
    });
  }
  return {
    kind: 'resolved',
    subjects,
  };
}

export async function resolveEvmFamilyEcdsaWalletUnlockSubjects(walletId: WalletId): Promise<
  | {
      readonly kind: 'resolved';
      readonly subjects: readonly EvmFamilyEcdsaWalletUnlockSubject[];
    }
  | {
      readonly kind: 'failed';
      readonly reason: WalletUnlockCapabilitySubjectResolutionFailure;
      readonly subjects?: never;
    }
> {
  return await listEvmFamilyEcdsaWalletUnlockSubjects(walletId);
}

export async function resolveEcdsaActivationJournalSelectors(
  walletId: WalletId,
): Promise<EcdsaWalletActivationSelectorListResult> {
  return await ecdsaCapabilityManifestStore.listWalletActivationJournalSelectors(walletId);
}

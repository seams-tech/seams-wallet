import type { LoginHooksOptions } from '@/core/types/sdkSentEvents';
import { type AccountId } from '@/core/types/accountIds';
import type { WorkerOperationContext } from '@/core/signingEngine/workerManager/executeWorkerOperation';
import type { EcdsaCapabilitySelector } from '@/core/indexedDB/seamsWalletDB/ecdsaCapabilityManifestRecords';
import { type WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import {
  type CanonicalThresholdEcdsaWarmSessionContext,
  type WalletUnlockSelection,
} from '@/core/signingEngine/session/passkey/unlockEcdsaWarmupPlanner';
import type { NearEd25519SigningKeyId } from '@shared/utils/registrationIds';
import { reconcileCanonicalEcdsaActivationWasm } from '@/core/signingEngine/threshold/crypto/ecdsaDerivationClientWasm';
import { type WalletUnlockSubject, type WalletUnlockSubjectSet } from '../walletUnlockSubject';

export function resolveLoginWalletUnlockSelection(
  selection: LoginHooksOptions['unlockSelection'] | undefined,
): WalletUnlockSelection {
  switch (selection?.mode) {
    case 'ed25519_only':
      return { mode: 'ed25519_only', ed25519: true };
    case 'ecdsa_only':
      return { mode: 'ecdsa_only', ecdsa: true };
    case 'ed25519_and_ecdsa':
    case undefined:
      return { mode: 'ed25519_and_ecdsa', ed25519: true, ecdsa: true };
  }
  return assertNeverLoginState(selection);
}

export function resolveLoginWalletUnlockSelectionForSubjectSet(args: {
  selection: LoginHooksOptions['unlockSelection'] | undefined;
  subjectSet: WalletUnlockSubjectSet;
}): WalletUnlockSelection {
  if (args.selection) return resolveLoginWalletUnlockSelection(args.selection);
  let hasNearEd25519 = false;
  let hasEvmFamilyEcdsa = false;
  for (const subject of args.subjectSet.subjects) {
    switch (subject.kind) {
      case 'near_ed25519_wallet':
        hasNearEd25519 = true;
        break;
      case 'evm_family_ecdsa_wallet':
        hasEvmFamilyEcdsa = true;
        break;
      default:
        return assertNeverLoginState(subject);
    }
  }
  if (hasNearEd25519 && hasEvmFamilyEcdsa) {
    return { mode: 'ed25519_and_ecdsa', ed25519: true, ecdsa: true };
  }
  if (hasNearEd25519) return { mode: 'ed25519_only', ed25519: true };
  if (hasEvmFamilyEcdsa) return { mode: 'ecdsa_only', ecdsa: true };
  throw new Error('[login] wallet unlock subject set has no supported capability');
}

type NearEd25519WalletSubject = Extract<WalletUnlockSubject, { kind: 'near_ed25519_wallet' }>;

type EvmFamilyEcdsaWalletSubject = Extract<
  WalletUnlockSubject,
  { kind: 'evm_family_ecdsa_wallet' }
>;

export type ResolvedLoginWalletBinding = {
  kind: 'near_ed25519_capable_wallet';
  walletId: WalletId;
  subjectSet: WalletUnlockSubjectSet;
  nearAccountId: AccountId;
  nearEd25519SigningKeyId: NearEd25519SigningKeyId;
  signerSlot: NearEd25519WalletSubject['signerSlot'];
};

export type ResolvedLoginEcdsaOnlyWallet = {
  kind: 'evm_family_ecdsa_only_wallet';
  walletId: WalletId;
  subjectSet: WalletUnlockSubjectSet;
  ecdsaSubjects: readonly [EvmFamilyEcdsaWalletSubject, ...EvmFamilyEcdsaWalletSubject[]];
  nearAccountId?: never;
  nearEd25519SigningKeyId?: never;
};

export type ResolvedLoginWalletIdentity = ResolvedLoginWalletBinding | ResolvedLoginEcdsaOnlyWallet;

function isNearEd25519WalletSubject(
  subject: WalletUnlockSubject,
): subject is NearEd25519WalletSubject {
  return subject.kind === 'near_ed25519_wallet';
}

function isEvmFamilyEcdsaWalletSubject(
  subject: WalletUnlockSubject,
): subject is EvmFamilyEcdsaWalletSubject {
  return subject.kind === 'evm_family_ecdsa_wallet';
}

export function selectNearEd25519WalletSubject(
  subjectSet: WalletUnlockSubjectSet,
): NearEd25519WalletSubject | null {
  const nearSubjects = subjectSet.subjects.filter(isNearEd25519WalletSubject);
  if (nearSubjects.length === 0) return null;
  if (nearSubjects.length > 1) {
    throw new Error('[WalletSession] multiple NEAR Ed25519 subjects found for wallet session');
  }
  return nearSubjects[0] || null;
}

export function resolveLoginWalletIdentity(args: {
  subjectSet: WalletUnlockSubjectSet;
  selection: WalletUnlockSelection;
}): ResolvedLoginWalletIdentity {
  const nearSubject = selectNearEd25519WalletSubject(args.subjectSet);
  const ecdsaSubjects = args.subjectSet.subjects.filter(isEvmFamilyEcdsaWalletSubject);
  for (const subject of args.subjectSet.subjects) {
    if (String(subject.walletId) !== String(args.subjectSet.walletId)) {
      throw new Error('[login] wallet unlock subject belongs to a different wallet');
    }
  }

  switch (args.selection.mode) {
    case 'ed25519_only':
      if (!nearSubject || ecdsaSubjects.length !== 0) {
        throw new Error('[login] NEAR Ed25519 unlock requires one exact NEAR subject set');
      }
      return {
        kind: 'near_ed25519_capable_wallet',
        walletId: args.subjectSet.walletId,
        subjectSet: args.subjectSet,
        nearAccountId: nearSubject.nearAccountId,
        nearEd25519SigningKeyId: nearSubject.nearEd25519SigningKeyId,
        signerSlot: nearSubject.signerSlot,
      };
    case 'ecdsa_only': {
      const [firstEcdsaSubject, ...remainingEcdsaSubjects] = ecdsaSubjects;
      if (nearSubject || !firstEcdsaSubject) {
        throw new Error('[login] ECDSA-only unlock requires exact ECDSA subjects');
      }
      return {
        kind: 'evm_family_ecdsa_only_wallet',
        walletId: args.subjectSet.walletId,
        subjectSet: args.subjectSet,
        ecdsaSubjects: [firstEcdsaSubject, ...remainingEcdsaSubjects],
      };
    }
    case 'ed25519_and_ecdsa':
      if (!nearSubject || ecdsaSubjects.length === 0) {
        throw new Error('[login] combined unlock requires exact NEAR and ECDSA subjects');
      }
      return {
        kind: 'near_ed25519_capable_wallet',
        walletId: args.subjectSet.walletId,
        subjectSet: args.subjectSet,
        nearAccountId: nearSubject.nearAccountId,
        nearEd25519SigningKeyId: nearSubject.nearEd25519SigningKeyId,
        signerSlot: nearSubject.signerSlot,
      };
  }
  return assertNeverLoginState(args.selection);
}

export function requireNearLoginWalletBinding(
  identity: ResolvedLoginWalletIdentity,
): ResolvedLoginWalletBinding {
  if (identity.kind === 'near_ed25519_capable_wallet') return identity;
  throw new Error('[login] NEAR Ed25519 warm-up requires an exact NEAR subject');
}

export function assertEcdsaWarmupMatchesUnlockSubjects(args: {
  identity: ResolvedLoginWalletIdentity;
  context: CanonicalThresholdEcdsaWarmSessionContext;
}): void {
  const allowedThresholdKeyIds = new Set<string>();
  for (const subject of args.identity.subjectSet.subjects) {
    if (subject.kind === 'evm_family_ecdsa_wallet') {
      allowedThresholdKeyIds.add(String(subject.ecdsaThresholdKeyId));
    }
  }
  if (allowedThresholdKeyIds.size === 0) {
    throw new Error('[login] ECDSA warm-up requires an exact ECDSA unlock subject');
  }
  for (const warmKey of args.context.ecdsaKeys) {
    const thresholdKeyId = String(warmKey.key?.ecdsaThresholdKeyId || '').trim();
    if (thresholdKeyId && !allowedThresholdKeyIds.has(thresholdKeyId)) {
      throw new Error('[login] ECDSA warm-up key does not match the unlock subject set');
    }
  }
}

type CanonicalEcdsaActivationReconciliationSummary =
  | {
      readonly kind: 'settled';
      readonly didFinalize: boolean;
      readonly code?: never;
    }
  | {
      readonly kind: 'pending';
      readonly didFinalize: boolean;
      readonly code?: never;
    }
  | {
      readonly kind: 'failed';
      readonly didFinalize: boolean;
      readonly code: 'corrupt' | 'persistence_unavailable';
    };

export function ecdsaActivationSelectorsFromSubjectSet(
  subjectSet: WalletUnlockSubjectSet,
): readonly EcdsaCapabilitySelector[] {
  const selectors: EcdsaCapabilitySelector[] = [];
  for (const subject of subjectSet.subjects) {
    if (subject.kind !== 'evm_family_ecdsa_wallet') continue;
    selectors.push({
      capability: subject.capability,
      authority: subject.authority,
    });
  }
  return selectors;
}

export async function reconcileCanonicalEcdsaActivationSelectors(args: {
  readonly workerCtx: WorkerOperationContext;
  readonly selectors: readonly EcdsaCapabilitySelector[];
}): Promise<CanonicalEcdsaActivationReconciliationSummary> {
  let didFinalize = false;
  let pending = false;
  for (const selector of args.selectors) {
    const result = await reconcileCanonicalEcdsaActivationWasm({
      workerCtx: args.workerCtx,
      command: {
        kind: 'reconcile_canonical_ecdsa_activation_v1',
        capability: selector.capability,
        authority: selector.authority,
      },
    });
    switch (result.kind) {
      case 'canonical_ecdsa_activation_reconciliation_absent_v1':
        break;
      case 'canonical_ecdsa_activation_reconciliation_finalized_v1':
        didFinalize = true;
        break;
      case 'canonical_ecdsa_activation_reconciliation_pending_v1':
        pending = true;
        break;
      case 'canonical_ecdsa_activation_reconciliation_failed_v1':
        return {
          kind: 'failed',
          didFinalize,
          code: result.code,
        };
      default:
        assertNeverLoginState(result);
    }
  }
  return pending ? { kind: 'pending', didFinalize } : { kind: 'settled', didFinalize };
}

export function reportNonSettledEcdsaActivationReconciliation(
  result: CanonicalEcdsaActivationReconciliationSummary,
): void {
  switch (result.kind) {
    case 'settled':
      return;
    case 'pending':
      console.warn('[login] ECDSA activation remains prepared and requires confirmation');
      return;
    case 'failed':
      console.warn('[login] ECDSA activation reconciliation failed without changing active state', {
        code: result.code,
      });
      return;
  }
  assertNeverLoginState(result);
}

export function assertNeverLoginState(value: never): never {
  throw new Error(`[login] unexpected state: ${String(value)}`);
}

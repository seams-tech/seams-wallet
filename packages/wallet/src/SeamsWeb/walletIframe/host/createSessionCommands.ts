import { unlockPendingRegistration } from '@/SeamsWeb/operations/auth/unlockPendingRegistration';
import {
  readPendingEcdsaRegistrationForWallet,
  resumePendingNearRegistrations,
  type PendingRegistrationRecoverySigningSurface,
} from '@/SeamsWeb/operations/registration/pendingRegistrationRecovery';
import type { WalletSessionStatusReadScope } from '@/core/rpcClients/relayer/walletSessionAuthorizationStatus';
import type { Variant } from '@shared/utils/variant';
import type { RouterAbEcdsaDerivationLoginPresignaturePrefillResult } from '@/core/signingEngine/session/warmCapabilities/ecdsaLoginPrefill';
import type {
  ThresholdEcdsaChainTarget,
  WalletSessionRef,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { toWalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { LoginHooksOptions } from '@/core/types/sdkSentEvents';
import type {
  GetRecentUnlocksResult,
  LoginAndCreateSessionResult,
  WalletSession,
} from '@/core/types/seams';
import {
  getWalletSession as getSessionCore,
  getRecentUnlocks as getRecentUnlocksCore,
  unlockResolvedWalletSubjectSet as unlockCoreWithSubjectSet,
  lock as lockCore,
} from '@/SeamsWeb/operations/auth/login';
import { IndexedDBManager } from '@/core/indexedDB';
import type { LocalWalletAuthMethodRecordV2 } from '@/core/indexedDB/passkeyClientDB.types';
import { SIGNER_AUTH_METHODS } from '@shared/utils/signerDomain';
import type {
  WalletAuthWebContext,
  WalletIframeWarmupSurface,
} from '@/SeamsWeb/signingSurface/types';
import type { WalletSessionCommands } from '@/SeamsWeb/publicApi/auth';
import {
  resolveWalletUnlockSubjectSet,
  type WalletUnlockCapabilityFamilyScope,
  type WalletUnlockSubject,
  type WalletUnlockSubjectSet,
} from '@/SeamsWeb/operations/auth/walletUnlockSubject';

type WalletHostAuthContext = WalletAuthWebContext & {
  signingEngine: Pick<WalletIframeWarmupSurface, 'warmCriticalResources'> &
    PendingRegistrationRecoverySigningSurface;
};

export function createWalletHostSessionCommands(
  getContext: () => WalletHostAuthContext,
): WalletSessionCommands {
  return {
    unlock: unlock.bind(null, getContext),
    lock: lock.bind(null, getContext),
    getSession: getSession.bind(null, getContext),
    getRecentUnlocks: getRecentUnlocks.bind(null, getContext),
    hasPasskey: hasPasskey,
  };
}

function isActivePasskey(record: LocalWalletAuthMethodRecordV2): boolean {
  return record.kind === SIGNER_AUTH_METHODS.passkey && record.status === 'active';
}

function walletUnlockCapabilityScope(
  selection: LoginHooksOptions['unlockSelection'] | undefined,
): WalletUnlockCapabilityFamilyScope {
  switch (selection?.mode) {
    case 'ed25519_only':
      return { kind: 'near_ed25519_only' };
    case 'ecdsa_only':
      return { kind: 'evm_family_ecdsa_only' };
    case 'ed25519_and_ecdsa':
    case undefined:
      return { kind: 'all_registered_mpc' };
  }
  throw new Error('wallet unlock selection is unsupported');
}

async function requireWalletUnlockSubjectSet(args: {
  relayerUrl: string;
  walletId: string;
  selection: LoginHooksOptions['unlockSelection'] | undefined;
}): Promise<WalletUnlockSubjectSet> {
  let resolution = await resolveWalletUnlockSubjectSet({
    walletId: args.walletId,
    requestedCapabilityFamilies: walletUnlockCapabilityScope(args.selection),
  });
  if (resolution.kind === 'missing_requested_capability_subject') {
    await resumePendingNearRegistrations({ relayerUrl: args.relayerUrl });
    resolution = await resolveWalletUnlockSubjectSet({
      walletId: args.walletId,
      requestedCapabilityFamilies: walletUnlockCapabilityScope(args.selection),
    });
  }
  switch (resolution.kind) {
    case 'resolved':
      return resolution.subjectSet;
    case 'missing_requested_capability_subject':
      throw new Error('wallet unlock is missing the requested capability subject');
    case 'capability_subject_resolution_failed':
      throw new Error(`wallet unlock subject resolution failed: ${resolution.reason}`);
  }
  resolution satisfies never;
  throw new Error('wallet unlock subject resolution returned an unknown result');
}

function selectNearSubjectForActivation(
  subjectSet: WalletUnlockSubjectSet,
): Variant<WalletUnlockSubject, 'kind', 'near_ed25519_wallet'> | null {
  let match: Variant<WalletUnlockSubject, 'kind', 'near_ed25519_wallet'> | null = null;
  for (const subject of subjectSet.subjects) {
    if (subject.kind !== 'near_ed25519_wallet') continue;
    if (match) {
      throw new Error('wallet unlock resolved multiple NEAR Ed25519 subjects');
    }
    match = subject;
  }
  return match;
}

async function unlock(
  getContext: () => WalletHostAuthContext,
  walletId: string,
  options?: LoginHooksOptions,
): Promise<LoginAndCreateSessionResult> {
  const resolvedWalletId = String(walletId || '').trim();
  if (!resolvedWalletId) throw new Error('unlock requires walletId');

  const context = getContext();
  const pending = await readPendingEcdsaRegistrationForWallet(toWalletId(resolvedWalletId));
  if (pending) return await unlockPendingRegistration({ context, pending, options });

  const subjectSet = await requireWalletUnlockSubjectSet({
    relayerUrl: context.configs.network.relayer.url,
    walletId: resolvedWalletId,
    selection: options?.unlockSelection,
  });
  const result = await unlockCoreWithSubjectSet(context, subjectSet, options);
  if (result?.success) {
    const nearSubject = selectNearSubjectForActivation(subjectSet);
    if (nearSubject) {
      await context.signingEngine.activateAuthenticatedWalletState({
        walletId: nearSubject.walletId,
        nearAccountId: nearSubject.nearAccountId,
        signerSlot: nearSubject.signerSlot,
        nearClient: context.nearClient,
      });
    }
  }
  await context.signingEngine.warmCriticalResources({ kind: 'none' });

  return result;
}

async function lock(getContext: () => WalletHostAuthContext): Promise<void> {
  await lockCore(getContext());
}

async function getSession(
  getContext: () => WalletHostAuthContext,
  walletId?: string,
): Promise<WalletSession> {
  return await getSessionCore(getContext(), walletId);
}

async function hasPasskey(walletId: string): Promise<boolean> {
  const resolvedWalletId = String(walletId || '').trim();
  if (!resolvedWalletId) return false;

  try {
    const records = await IndexedDBManager.listWalletAuthMethodsV2ForWallet(resolvedWalletId);
    return records.some(isActivePasskey);
  } catch {
    return false;
  }
}

async function getRecentUnlocks(
  getContext: () => WalletHostAuthContext,
): Promise<GetRecentUnlocksResult> {
  return await getRecentUnlocksCore(getContext());
}

export async function prefillWalletHostPresignatures(
  getContext: () => WalletHostAuthContext,
  args: {
    walletSession: WalletSessionRef;
    chainTarget: ThresholdEcdsaChainTarget;
  },
  statusReads: WalletSessionStatusReadScope,
): Promise<RouterAbEcdsaDerivationLoginPresignaturePrefillResult> {
  const walletId = toWalletId(args.walletSession.walletId);
  return await getContext().signingEngine.scheduleRouterAbEcdsaDerivationLoginPresignaturePrefill(
    {
      walletId,
      chainTarget: args.chainTarget,
    },
    statusReads,
  );
}

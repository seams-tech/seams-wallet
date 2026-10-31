import type {
  GetRecentUnlocksResult,
  RecentUnlockAccount,
  WalletAuthenticationState,
} from '@/core/types/seams';
import type { RecentUnlocksWebContext } from '@/SeamsWeb/signingSurface/types';
import { readEmailOtpProviderSubjectForWalletV1 } from '@/core/signingEngine/threshold/ed25519/yaoPublicCapabilityReferences';
import { parseVerifiedEmailAddress } from '@shared/utils/domainIds';
import { IndexedDBManager } from '@/core/indexedDB';
import type { ClientUserData } from '@/core/accountData/near/nearAccountData.types';
import type {
  LocalWalletAuthMethodProjectionV2,
  WalletSelectionRecordV1,
} from '@/core/indexedDB/passkeyClientDB.types';
import { type WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { SIGNER_AUTH_METHODS } from '@shared/utils/signerDomain';
import { resolveLinkedDeviceNearUnlockSubject } from './authority';
import { assertNeverLoginState } from './identity';

function recentUnlockAccountFromUser(user: ClientUserData): RecentUnlockAccount {
  const walletId = String(user.walletId || '').trim();
  if (!walletId) {
    throw new Error('[login] recent unlock account is missing walletId');
  }
  const displayName = String(user.loginDisplayName || '').trim() || walletId;
  return {
    walletId,
    nearAccountId: user.nearAccountId,
    displayName,
    signerSlot: user.signerSlot,
    ...(typeof user.lastLogin === 'number' ? { lastLogin: user.lastLogin } : {}),
    authMethod: user.authMethod || null,
  };
}

async function recentUnlockAccountFromLinkedDeviceSelection(
  selection: WalletSelectionRecordV1,
): Promise<RecentUnlockAccount | null> {
  const resolved = await IndexedDBManager.resolveSelectedWalletAuthority(
    String(selection.walletId),
  ).catch(() => null);
  if (
    !resolved ||
    resolved.kind !== 'resolved' ||
    resolved.selection.walletAuthMethodId !== selection.walletAuthMethodId ||
    resolved.authMethod.status !== 'active' ||
    resolved.authority.state !== 'active' ||
    resolved.authority.provenance.kind !== 'device_link'
  ) {
    return null;
  }
  const nearSubject = await resolveLinkedDeviceNearUnlockSubject({
    walletId: selection.walletId,
    authMethod: resolved.authMethod,
    authority: resolved.authority,
    signerMaterials: resolved.signerMaterials,
  });
  if (nearSubject.kind !== 'resolved') return null;
  let authMethod: RecentUnlockAccount['authMethod'];
  switch (resolved.authMethod.kind) {
    case SIGNER_AUTH_METHODS.passkey:
      authMethod = SIGNER_AUTH_METHODS.passkey;
      break;
    case SIGNER_AUTH_METHODS.emailOtp:
      authMethod = SIGNER_AUTH_METHODS.emailOtp;
      break;
    case 'voiceid':
      return null;
    default:
      return assertNeverLoginState(resolved.authMethod);
  }
  return {
    walletId: String(selection.walletId),
    nearAccountId: nearSubject.subject.nearAccountId,
    displayName: String(selection.walletId),
    signerSlot: nearSubject.subject.signerSlot,
    lastLogin: selection.updatedAtMs,
    authMethod,
  };
}

function recentUnlockAccountKey(account: RecentUnlockAccount): string {
  return `${account.walletId}:${account.authMethod ?? ''}`;
}

function latestRecentUnlockAccount(
  accounts: readonly RecentUnlockAccount[],
): RecentUnlockAccount | null {
  let latest: RecentUnlockAccount | null = null;
  for (const account of accounts) {
    if (!latest || (account.lastLogin ?? 0) > (latest.lastLogin ?? 0)) latest = account;
  }
  return latest;
}

/**
 * List recently used accounts from IndexedDB.
 *
 * Used for account picker UIs and initial app bootstrap state.
 */
export async function getRecentUnlocks(
  context: RecentUnlocksWebContext,
): Promise<GetRecentUnlocksResult> {
  const [allUsersData, selections, lastUsedUser] = await Promise.all([
    context.signingEngine.getAllUsers(),
    IndexedDBManager.listWalletSelections(),
    context.signingEngine.getLastUser(),
  ]);
  const linkedAccounts = (
    await Promise.all(selections.map(recentUnlockAccountFromLinkedDeviceSelection))
  ).filter((account): account is RecentUnlockAccount => account !== null);
  const accountsByWalletAuthMethod = new Map<string, RecentUnlockAccount>();
  for (const user of allUsersData) {
    const account = recentUnlockAccountFromUser(user);
    accountsByWalletAuthMethod.set(recentUnlockAccountKey(account), account);
  }
  for (const account of linkedAccounts) {
    accountsByWalletAuthMethod.set(recentUnlockAccountKey(account), account);
  }
  const accounts = [...accountsByWalletAuthMethod.values()];
  const walletIds = [
    ...new Set([
      ...accounts.map((account) => account.walletId),
      ...selections.map((selection) => String(selection.walletId)),
    ]),
  ];
  const accountIds = [...new Set(accounts.map((account) => account.nearAccountId))];
  const legacyLastUsedAccount = lastUsedUser ? recentUnlockAccountFromUser(lastUsedUser) : null;
  const lastUsedAccount = latestRecentUnlockAccount([
    ...linkedAccounts,
    ...(legacyLastUsedAccount ? [legacyLastUsedAccount] : []),
  ]);
  return {
    walletIds,
    accountIds,
    accounts,
    lastUsedAccount,
  };
}

export type LocalLoginAuthMethod =
  | {
      readonly walletId: WalletId;
      readonly authMethod: 'passkey';
      readonly emailAddress?: never;
    }
  | {
      readonly walletId: WalletId;
      readonly authMethod: 'email_otp';
      readonly emailAddress: string | null;
    };

function localLoginAuthMethod(
  projection: LocalWalletAuthMethodProjectionV2,
): LocalLoginAuthMethod | null {
  if (projection.record.status !== 'active') return null;
  switch (projection.kind) {
    case 'passkey':
      return { walletId: projection.record.walletId, authMethod: 'passkey' };
    case 'email_otp': {
      const emailAddress =
        projection.presentation.email.kind === 'verified'
          ? String(projection.presentation.email.address)
          : null;
      return {
        walletId: projection.record.walletId,
        authMethod: 'email_otp',
        emailAddress,
      };
    }
    case 'voiceid':
      return null;
    default:
      return assertNeverLoginState(projection);
  }
}

function projectLocalLoginAuthMethods(
  projections: readonly LocalWalletAuthMethodProjectionV2[],
): LocalLoginAuthMethod[] {
  const methods: LocalLoginAuthMethod[] = [];
  for (const projection of projections) {
    const method = localLoginAuthMethod(projection);
    if (method) methods.push(method);
  }
  return methods;
}

async function localLoginAuthMethodsForWallet(walletId: WalletId): Promise<LocalLoginAuthMethod[]> {
  const projections =
    await IndexedDBManager.listLocalWalletAuthMethodProjectionsV2ForWallet(walletId);
  const migrated = await migrateLegacyEmailOtpLocalPresentation(walletId, projections);
  return projectLocalLoginAuthMethods(migrated);
}

function needsLegacyEmailOtpPresentationMigration(
  projection: LocalWalletAuthMethodProjectionV2,
): projection is Extract<LocalWalletAuthMethodProjectionV2, { readonly kind: 'email_otp' }> {
  return (
    projection.kind === 'email_otp' &&
    projection.record.status === 'active' &&
    projection.presentation.email.kind === 'unavailable'
  );
}

async function migrateLegacyEmailOtpLocalPresentation(
  walletId: WalletId,
  projections: readonly LocalWalletAuthMethodProjectionV2[],
): Promise<LocalWalletAuthMethodProjectionV2[]> {
  const candidates: Extract<LocalWalletAuthMethodProjectionV2, { readonly kind: 'email_otp' }>[] =
    [];
  for (const projection of projections) {
    if (needsLegacyEmailOtpPresentationMigration(projection)) candidates.push(projection);
  }
  if (candidates.length === 0) return [...projections];

  // Older installations retained this verified identity only on the local
  // Ed25519 lane. The repository accepts it only when it hashes to the V2 method.
  const providerSubject = await readEmailOtpProviderSubjectForWalletV1(IndexedDBManager, walletId);
  const emailAddress = parseVerifiedEmailAddress(providerSubject);
  if (!emailAddress.ok) return [...projections];

  let retained = false;
  for (const candidate of candidates) {
    const result = await IndexedDBManager.retainVerifiedEmailOtpLocalPresentation({
      walletId,
      walletAuthMethodId: candidate.record.walletAuthMethodId,
      emailAddress: emailAddress.value,
    });
    switch (result.kind) {
      case 'retained':
        retained = true;
        break;
      case 'not_retained':
        break;
      default:
        assertNeverLoginState(result);
    }
  }
  if (!retained) return [...projections];
  return await IndexedDBManager.listLocalWalletAuthMethodProjectionsV2ForWallet(walletId);
}

export async function listLocalLoginAuthMethods(): Promise<LocalLoginAuthMethod[]> {
  const walletIds = await IndexedDBManager.listWalletSelectionWalletIds();
  const methodsByWallet = await Promise.all(
    [...new Set(walletIds)].map(localLoginAuthMethodsForWallet),
  );
  return methodsByWallet.flat();
}

/** Lock clears authentication and volatile signing material. */
export type LockOperationContext = {
  signingEngine: {
    readWalletAuthenticationState(): WalletAuthenticationState;
    advanceWalletLockGeneration(walletId: WalletId): Promise<number>;
    retireActiveWalletSessionAuthorizationForLock(walletId: WalletId): Promise<void>;
    clearWalletAuthenticationIfCurrent(expected: WalletAuthenticationState): boolean;
    getNonceCoordinator(): { clearAll(): void };
    clearThresholdEcdsaSigningQueue(): void;
    clearVolatileWarmSigningMaterial(walletId?: WalletId): Promise<void>;
  };
};

export async function lock(context: LockOperationContext): Promise<void> {
  const { signingEngine } = context;
  const authentication = signingEngine.readWalletAuthenticationState();
  let failure: unknown;
  let failed = false;
  let authenticationCleared = false;
  let walletIds: readonly WalletId[] = [];
  try {
    walletIds =
      authentication.kind === 'authenticated'
        ? [authentication.walletId]
        : await IndexedDBManager.listWalletSelectionWalletIds();
  } catch (error: unknown) {
    failure = error;
    failed = true;
  }
  for (const walletId of walletIds) {
    try {
      await signingEngine.advanceWalletLockGeneration(walletId);
    } catch (error: unknown) {
      failure = error;
      failed = true;
    }
    try {
      await signingEngine.retireActiveWalletSessionAuthorizationForLock(walletId);
    } catch (error: unknown) {
      if (!failed) {
        failure = error;
        failed = true;
      }
    }
  }
  try {
    authenticationCleared = signingEngine.clearWalletAuthenticationIfCurrent(authentication);
  } catch (error: unknown) {
    if (!failed) {
      failure = error;
      failed = true;
    }
  }
  if (authenticationCleared) {
    try {
      signingEngine.getNonceCoordinator().clearAll();
    } catch {}
    try {
      signingEngine.clearThresholdEcdsaSigningQueue();
    } catch {}
  }
  try {
    await signingEngine.clearVolatileWarmSigningMaterial(
      authentication.kind === 'authenticated' ? authentication.walletId : undefined,
    );
  } catch (error: unknown) {
    if (!failed) {
      failure = error;
      failed = true;
    }
  }
  if (failed) throw failure;
}

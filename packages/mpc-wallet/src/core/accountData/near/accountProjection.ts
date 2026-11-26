import type { AccountId } from '../../types/accountIds';
import { toAccountId } from '../../types/accountIds';
import {
  SIGNER_AUTH_METHODS,
  SIGNER_KINDS,
  type WalletAuthMethod,
} from '@shared/utils/signerDomain';
import { toTrimmedString } from '@shared/utils/validation';
import type { ClientUserData } from './nearAccountData.types';
import {
  getLastSelectedProfileAccountByChain,
  resolveProfileAccountProjection,
  type ProfileAccountProjectionPort,
  type ProfileLastSelectionPort,
} from '../../indexedDB/profileAccountProjection';
import type {
  AccountSignerRecord,
  ChainAccountRecord,
  ProfileContinuitySnapshot,
  ProfileRecord,
  UpsertProfileInput,
  UserPreferences,
} from '../../indexedDB/passkeyClientDB.types';
import type {
  ActivateAccountSignerInput,
  ActivateAccountSignerResult,
} from '../../indexedDB/accountSignerLifecycle';
import { getNearChainCandidates } from './accountRefs';
import { normalizeIndexedDbAccountAddress as normalizeAccountAddress } from '../../indexedDB/normalization';

export type NearAccountClientDbPort = ProfileAccountProjectionPort &
  ProfileLastSelectionPort & {
    setLastProfileStateForProfile: (profileId: string, activeSignerSlot: number) => Promise<void>;
    listChainAccountsByChain: (chainIdKey: string) => Promise<ChainAccountRecord[]>;
    getProfileContinuitySnapshot: (profileId: string) => Promise<ProfileContinuitySnapshot | null>;
    upsertProfile: (input: UpsertProfileInput) => Promise<ProfileRecord>;
    getAccountSigner: (args: {
      chainIdKey: string;
      accountAddress: string;
      signerId: string;
    }) => Promise<AccountSignerRecord | null>;
    activateAccountSigner: (
      input: ActivateAccountSignerInput,
    ) => Promise<ActivateAccountSignerResult>;
    updatePreferences: (args: {
      profileId: string;
      preferences: Partial<UserPreferences>;
      eventAccountId?: AccountId | null;
    }) => Promise<void>;
  };

function toWalletAuthMethod(authMethod: unknown): WalletAuthMethod | null {
  if (authMethod === SIGNER_AUTH_METHODS.emailOtp) return SIGNER_AUTH_METHODS.emailOtp;
  if (authMethod === SIGNER_AUTH_METHODS.passkey) return SIGNER_AUTH_METHODS.passkey;
  return null;
}

function signerLoginDisplayName(args: {
  walletId: string;
  authMethod: WalletAuthMethod | null;
  metadata: Record<string, unknown>;
}): string {
  if (args.authMethod === SIGNER_AUTH_METHODS.emailOtp) {
    const email = toTrimmedString(args.metadata.email || '');
    if (email) return email;
  }
  return args.walletId;
}

export async function getNearAccountProjection(
  clientDB: NearAccountClientDbPort,
  nearAccountId: AccountId,
  signerSlot?: number,
): Promise<ClientUserData | null> {
  const accountId = toAccountId(nearAccountId);
  const accountAddress = normalizeAccountAddress(accountId);
  if (!accountAddress) return null;
  const projection = await resolveProfileAccountProjection(clientDB, {
    accountRefs: getNearChainCandidates(accountId).map((chainIdKey) => ({
      chainIdKey,
      accountAddress,
    })),
    signerSlot,
  });
  if (!projection) return null;

  const metadata = projection.selectedSigner.metadata || {};
  const passkeyCredentialRawId =
    typeof metadata.passkeyCredentialRawId === 'string'
      ? metadata.passkeyCredentialRawId
      : projection.selectedSigner.signerId;
  const passkeyCredentialId =
    typeof metadata.passkeyCredentialId === 'string'
      ? metadata.passkeyCredentialId
      : projection.profile.passkeyCredential?.id || passkeyCredentialRawId;
  const operationalPublicKey =
    typeof metadata.operationalPublicKey === 'string' ? metadata.operationalPublicKey : '';
  const nearEd25519SigningKeyId = toTrimmedString(metadata.nearEd25519SigningKeyId || '');
  if (!nearEd25519SigningKeyId) return null;
  const walletId = toTrimmedString(metadata.walletId || '');
  if (!walletId) return null;
  const authMethod = toWalletAuthMethod(projection.selectedSigner.signerAuthMethod);

  return {
    walletId,
    nearAccountId: accountId,
    loginDisplayName: signerLoginDisplayName({
      walletId,
      authMethod,
      metadata,
    }),
    signerSlot: projection.selectedSigner.signerSlot,
    version: 2,
    registeredAt: projection.profile.createdAt,
    lastLogin: projection.profile.updatedAt,
    lastUpdated: projection.profile.updatedAt,
    operationalPublicKey,
    nearEd25519SigningKeyId,
    passkeyCredential: {
      id: passkeyCredentialId,
      rawId: passkeyCredentialRawId,
    },
    authMethod,
    preferences: projection.profile.preferences,
  };
}

export async function getLastSelectedNearAccount(
  clientDB: ProfileLastSelectionPort,
): Promise<{ nearAccountId: AccountId; profileId: string; signerSlot: number } | null> {
  const last = await getLastSelectedProfileAccountByChain(clientDB, {
    chainIdKeys: ['near:testnet', 'near:mainnet'],
  });
  if (!last?.chainAccount?.accountAddress) return null;
  let nearAccountId: AccountId;
  try {
    nearAccountId = toAccountId(last.chainAccount.accountAddress);
  } catch {
    return null;
  }
  return {
    nearAccountId,
    profileId: last.profileId,
    signerSlot: last.signerSlot,
  };
}

export async function getLastSelectedNearAccountProjection(
  clientDB: NearAccountClientDbPort,
): Promise<ClientUserData | null> {
  const last = await getLastSelectedNearAccount(clientDB).catch(() => null);
  if (!last) return null;
  return getNearAccountProjection(clientDB, last.nearAccountId, last.signerSlot);
}

export async function listNearAccountProjections(
  clientDB: NearAccountClientDbPort,
): Promise<ClientUserData[]> {
  const [nearTestnetRows, nearMainnetRows] = await Promise.all([
    clientDB.listChainAccountsByChain('near:testnet'),
    clientDB.listChainAccountsByChain('near:mainnet'),
  ]);

  const accountCandidates = new Set<AccountId>();
  for (const row of [...nearTestnetRows, ...nearMainnetRows]) {
    const candidate = toTrimmedString(row.accountAddress || '');
    if (!candidate) continue;
    try {
      accountCandidates.add(toAccountId(candidate));
    } catch {}
  }

  const users: ClientUserData[] = [];
  const seenSignerRefs = new Set<string>();
  for (const accountId of accountCandidates) {
    const projection = await resolveProfileAccountProjection(clientDB, {
      accountRefs: getNearChainCandidates(accountId).map((chainIdKey) => ({
        chainIdKey,
        accountAddress: normalizeAccountAddress(accountId),
      })),
    }).catch(() => null);
    if (!projection) continue;

    const activeSigners = projection.activeSigners
      .filter(
        (signer) =>
          signer.signerKind === SIGNER_KINDS.thresholdEd25519 &&
          toWalletAuthMethod(signer.signerAuthMethod),
      )
      .slice()
      .sort((a, b) => a.signerSlot - b.signerSlot);
    for (const signer of activeSigners) {
      const signerSlot = Number(signer.signerSlot);
      if (!Number.isSafeInteger(signerSlot) || signerSlot < 1) continue;
      const signerRef = `${String(accountId)}:${signerSlot}`;
      if (seenSignerRefs.has(signerRef)) continue;
      seenSignerRefs.add(signerRef);
      const projected = await getNearAccountProjection(clientDB, accountId, signerSlot).catch(
        () => null,
      );
      if (projected) users.push(projected);
    }
  }
  return users;
}

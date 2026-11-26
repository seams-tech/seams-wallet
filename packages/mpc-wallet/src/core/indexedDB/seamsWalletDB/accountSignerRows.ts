import { toTrimmedString } from '@shared/utils/validation';
import { SIGNER_KINDS } from '@shared/utils/signerDomain';
import type {
  AccountSignerRecord,
  AccountSignerStatus,
  ChainAccountRecord,
  UpsertChainAccountInput,
} from '../passkeyClientDB.types';
import {
  parseStoredNonEmptyString,
  signerChainTargetKey,
  normalizeIndexedDbAccountAddress,
  normalizeIndexedDbAccountModel,
  normalizeIndexedDbChainIdKey,
  toIndexedDbChainTargetKey,
} from '../normalization';

type ChainAccountProjectionRow = {
  wallet_id: string;
  near_account_id: string;
  signer_slot: number;
  profile_id: string;
  chain_id_key: string;
  account_address: string;
  account_model: string;
  is_primary: boolean;
  updated_at: number;
  record: ChainAccountRecord;
};

export type WalletSignerRow = {
  wallet_signer_id: string;
  wallet_id: string;
  kind: string;
  chain_target_key: string;
  near_signer_slot?: number;
  near_ed25519_signing_key_id?: string;
  key_handle?: string;
  ecdsa_threshold_key_id?: string;
  threshold_owner_address?: string;
  status: AccountSignerStatus;
  updated_at: number;
  record: AccountSignerRecord;
};

export const CHAIN_ACCOUNT_PROJECTION_SIGNER_SLOT = 0;

export function chainAccountProjectionId(args: {
  chainIdKey: string;
  accountAddress: string;
}): string {
  return `${args.chainIdKey}\0${args.accountAddress}`;
}

export function walletSignerId(args: {
  chainIdKey: string;
  accountAddress: string;
  signerId: string;
}): string {
  return [args.chainIdKey, args.accountAddress, args.signerId].join('\0');
}

export function normalizeEcdsaChainTargetKey(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return '';
  const kind = toTrimmedString(Reflect.get(value, 'kind') || '');
  const chainId = Number(Reflect.get(value, 'chainId'));
  if (!Number.isSafeInteger(chainId) || chainId <= 0) return '';
  if (kind === 'evm') {
    if (toTrimmedString(Reflect.get(value, 'namespace') || '') !== 'eip155') return '';
    return toIndexedDbChainTargetKey({
      kind: 'evm',
      namespace: 'eip155',
      chainId,
      networkSlug: toTrimmedString(Reflect.get(value, 'networkSlug') || ''),
    });
  }
  if (kind === 'tempo') {
    return toIndexedDbChainTargetKey({
      kind: 'tempo',
      chainId,
      networkSlug: toTrimmedString(Reflect.get(value, 'networkSlug') || ''),
    });
  }
  return '';
}

type WalletSignerScalarMirrors = {
  chainTargetKey: string;
  nearSignerSlot?: number;
  nearEd25519SigningKeyId?: string;
  keyHandle?: string;
  ecdsaThresholdKeyId?: string;
  thresholdOwnerAddress?: string;
};

function walletSignerScalarMirrors(record: AccountSignerRecord): WalletSignerScalarMirrors {
  if (record.signerKind === SIGNER_KINDS.thresholdEcdsa) {
    const metadata = record.metadata || {};
    const keyHandle = toTrimmedString(metadata.keyHandle || '');
    const ecdsaThresholdKeyId = toTrimmedString(metadata.ecdsaThresholdKeyId || '');
    const thresholdOwnerAddress = normalizeIndexedDbAccountAddress(
      metadata.thresholdOwnerAddress || '',
    );
    const chainTargetKey = normalizeEcdsaChainTargetKey(metadata.chainTarget);
    if (!keyHandle || !ecdsaThresholdKeyId || !thresholdOwnerAddress || !chainTargetKey) {
      throw new Error(
        '[SeamsWalletDB] threshold ECDSA signer requires keyHandle, ecdsaThresholdKeyId, thresholdOwnerAddress, and chainTarget',
      );
    }
    return {
      chainTargetKey,
      keyHandle,
      ecdsaThresholdKeyId,
      thresholdOwnerAddress,
    };
  }

  const signerSlot = Number(record.signerSlot);
  if (!Number.isSafeInteger(signerSlot) || signerSlot < 1) {
    throw new Error('[SeamsWalletDB] Ed25519 signer requires a positive signerSlot');
  }
  const nearEd25519SigningKeyId = toTrimmedString(record.metadata?.nearEd25519SigningKeyId || '');
  if (!nearEd25519SigningKeyId) {
    throw new Error('[SeamsWalletDB] Ed25519 signer requires nearEd25519SigningKeyId');
  }
  return {
    chainTargetKey: signerChainTargetKey({
      chainIdKey: record.chainIdKey,
      accountAddress: record.accountAddress,
    }),
    nearSignerSlot: signerSlot,
    nearEd25519SigningKeyId,
  };
}

export function chainAccountProjectionRow(
  input: UpsertChainAccountInput,
  existing?: ChainAccountRecord,
): ChainAccountProjectionRow {
  const profileId = toTrimmedString(input.profileId || '');
  const chainIdKey = normalizeIndexedDbChainIdKey(input.chainIdKey);
  const accountAddress = normalizeIndexedDbAccountAddress(input.accountAddress);
  const accountModel = normalizeIndexedDbAccountModel(input.accountModel);
  if (!profileId || !chainIdKey || !accountAddress) {
    throw new Error('[SeamsWalletDB] profileId, chainIdKey, and accountAddress are required');
  }
  if (!accountModel) {
    throw new Error('[SeamsWalletDB] accountModel is required');
  }
  const now = Date.now();
  const record: ChainAccountRecord = {
    profileId,
    chainIdKey,
    accountAddress,
    accountModel,
    isPrimary: input.isPrimary ?? existing?.isPrimary ?? false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return {
    wallet_id: profileId,
    near_account_id: chainAccountProjectionId({ chainIdKey, accountAddress }),
    signer_slot: CHAIN_ACCOUNT_PROJECTION_SIGNER_SLOT,
    profile_id: profileId,
    chain_id_key: chainIdKey,
    account_address: accountAddress,
    account_model: accountModel,
    is_primary: !!record.isPrimary,
    updated_at: record.updatedAt,
    record,
  };
}

function parseStoredChainAccountRecord(value: unknown): ChainAccountRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const profileId = parseStoredNonEmptyString(Reflect.get(value, 'profileId'));
  const chainIdKey = normalizeIndexedDbChainIdKey(Reflect.get(value, 'chainIdKey'));
  const accountAddress = normalizeIndexedDbAccountAddress(Reflect.get(value, 'accountAddress'));
  const accountModel = normalizeIndexedDbAccountModel(Reflect.get(value, 'accountModel'));
  const createdAt = Reflect.get(value, 'createdAt');
  const updatedAt = Reflect.get(value, 'updatedAt');
  const isPrimary = Reflect.get(value, 'isPrimary');
  if (
    !profileId ||
    !chainIdKey ||
    !accountAddress ||
    !accountModel ||
    !Number.isSafeInteger(createdAt) ||
    Number(createdAt) < 0 ||
    !Number.isSafeInteger(updatedAt) ||
    Number(updatedAt) < 0 ||
    (isPrimary !== undefined && typeof isPrimary !== 'boolean')
  ) {
    return null;
  }
  return {
    profileId,
    chainIdKey,
    accountAddress,
    accountModel,
    ...(isPrimary === undefined ? {} : { isPrimary }),
    createdAt: Number(createdAt),
    updatedAt: Number(updatedAt),
  };
}

export function parseChainAccountProjectionRow(value: unknown): ChainAccountRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = parseStoredChainAccountRecord(Reflect.get(value, 'record'));
  if (!record) return null;
  if (Reflect.get(value, 'wallet_id') !== record.profileId) return null;
  if (Reflect.get(value, 'profile_id') !== record.profileId) return null;
  if (Reflect.get(value, 'chain_id_key') !== record.chainIdKey) return null;
  if (Reflect.get(value, 'account_address') !== record.accountAddress) return null;
  if (Reflect.get(value, 'account_model') !== record.accountModel) return null;
  if (Reflect.get(value, 'is_primary') !== !!record.isPrimary) return null;
  if (Reflect.get(value, 'updated_at') !== record.updatedAt) return null;
  if (
    Reflect.get(value, 'near_account_id') !==
    chainAccountProjectionId({
      chainIdKey: record.chainIdKey,
      accountAddress: record.accountAddress,
    })
  ) {
    return null;
  }
  return record;
}

export function accountSignerRow(record: AccountSignerRecord): WalletSignerRow {
  const profileId = toTrimmedString(record.profileId || '');
  const chainIdKey = normalizeIndexedDbChainIdKey(record.chainIdKey);
  const accountAddress = normalizeIndexedDbAccountAddress(record.accountAddress);
  const signerId = toTrimmedString(record.signerId || '');
  const signerKind = toTrimmedString(record.signerKind || '');
  if (!profileId || !chainIdKey || !accountAddress || !signerId || !signerKind) {
    throw new Error(
      '[SeamsWalletDB] signer requires profileId, chainIdKey, accountAddress, signerId, and signerKind',
    );
  }
  const mirrors = walletSignerScalarMirrors({
    ...record,
    profileId,
    chainIdKey,
    accountAddress,
    signerId,
  });
  const isActive = record.status === 'active';
  return {
    wallet_signer_id: walletSignerId({ chainIdKey, accountAddress, signerId }),
    wallet_id: profileId,
    kind: signerKind,
    chain_target_key: mirrors.chainTargetKey,
    ...(isActive && mirrors.nearSignerSlot != null
      ? { near_signer_slot: mirrors.nearSignerSlot }
      : {}),
    ...(isActive && mirrors.nearEd25519SigningKeyId
      ? { near_ed25519_signing_key_id: mirrors.nearEd25519SigningKeyId }
      : {}),
    ...(isActive && mirrors.keyHandle ? { key_handle: mirrors.keyHandle } : {}),
    ...(isActive && mirrors.ecdsaThresholdKeyId
      ? { ecdsa_threshold_key_id: mirrors.ecdsaThresholdKeyId }
      : {}),
    ...(isActive && mirrors.thresholdOwnerAddress
      ? { threshold_owner_address: mirrors.thresholdOwnerAddress }
      : {}),
    status: record.status,
    updated_at: record.updatedAt,
    record: {
      ...record,
      profileId,
      chainIdKey,
      accountAddress,
      signerId,
    },
  };
}

function parseStoredAccountSignerRecord(value: unknown): AccountSignerRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const profileId = parseStoredNonEmptyString(Reflect.get(value, 'profileId'));
  const chainIdKey = normalizeIndexedDbChainIdKey(Reflect.get(value, 'chainIdKey'));
  const accountAddress = normalizeIndexedDbAccountAddress(Reflect.get(value, 'accountAddress'));
  const signerId = parseStoredNonEmptyString(Reflect.get(value, 'signerId'));
  const signerSlot = Reflect.get(value, 'signerSlot');
  const signerType = parseStoredNonEmptyString(Reflect.get(value, 'signerType'));
  const signerKind = Reflect.get(value, 'signerKind');
  const signerAuthMethod = Reflect.get(value, 'signerAuthMethod');
  const signerSource = Reflect.get(value, 'signerSource');
  const status = Reflect.get(value, 'status');
  const addedAt = Reflect.get(value, 'addedAt');
  const updatedAt = Reflect.get(value, 'updatedAt');
  if (
    !profileId ||
    !chainIdKey ||
    !accountAddress ||
    !signerId ||
    !Number.isSafeInteger(signerSlot) ||
    Number(signerSlot) < 1 ||
    !signerType ||
    (signerKind !== SIGNER_KINDS.thresholdEd25519 && signerKind !== SIGNER_KINDS.thresholdEcdsa) ||
    (signerAuthMethod !== 'passkey' && signerAuthMethod !== 'email_otp') ||
    (signerSource !== 'passkey_registration' &&
      signerSource !== 'email_otp_registration' &&
      signerSource !== 'self_hosted_import') ||
    (status !== 'active' && status !== 'pending' && status !== 'revoked') ||
    !Number.isSafeInteger(addedAt) ||
    Number(addedAt) < 0 ||
    !Number.isSafeInteger(updatedAt) ||
    Number(updatedAt) < 0
  ) {
    return null;
  }
  const metadataRaw = Reflect.get(value, 'metadata');
  let metadata: Record<string, unknown> | undefined;
  if (metadataRaw !== undefined) {
    if (metadataRaw === null || typeof metadataRaw !== 'object' || Array.isArray(metadataRaw)) {
      return null;
    }
    metadata = {};
    for (const key of Object.keys(metadataRaw)) {
      metadata[key] = Reflect.get(metadataRaw, key);
    }
  }
  const removedAt = Reflect.get(value, 'removedAt');
  const revocationReason = Reflect.get(value, 'revocationReason');
  if (
    (removedAt !== undefined && (!Number.isSafeInteger(removedAt) || Number(removedAt) < 0)) ||
    (revocationReason !== undefined && typeof revocationReason !== 'string')
  ) {
    return null;
  }
  return {
    profileId,
    chainIdKey,
    accountAddress,
    signerId,
    signerSlot: Number(signerSlot),
    signerType,
    signerKind,
    signerAuthMethod,
    signerSource,
    status,
    addedAt: Number(addedAt),
    updatedAt: Number(updatedAt),
    ...(removedAt === undefined ? {} : { removedAt: Number(removedAt) }),
    ...(revocationReason === undefined ? {} : { revocationReason }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

export function parseAccountSignerRow(value: unknown): AccountSignerRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = parseStoredAccountSignerRecord(Reflect.get(value, 'record'));
  if (!record) return null;
  if (
    Reflect.get(value, 'wallet_signer_id') !==
    walletSignerId({
      chainIdKey: record.chainIdKey,
      accountAddress: record.accountAddress,
      signerId: record.signerId,
    })
  ) {
    return null;
  }
  if (Reflect.get(value, 'wallet_id') !== record.profileId) return null;
  if (Reflect.get(value, 'kind') !== record.signerKind) return null;
  let mirrors: WalletSignerScalarMirrors;
  try {
    mirrors = walletSignerScalarMirrors(record);
  } catch {
    return null;
  }
  const requiresActiveMirrors = record.status === 'active';
  if (record.signerKind === SIGNER_KINDS.thresholdEd25519) {
    const chainTargetKey = Reflect.get(value, 'chain_target_key');
    const nearSignerSlot = Reflect.get(value, 'near_signer_slot');
    const nearEd25519SigningKeyId = Reflect.get(value, 'near_ed25519_signing_key_id');
    if (chainTargetKey !== undefined && chainTargetKey !== mirrors.chainTargetKey) {
      return null;
    }
    if (requiresActiveMirrors && nearSignerSlot !== mirrors.nearSignerSlot) {
      return null;
    }
    if (
      !requiresActiveMirrors &&
      nearSignerSlot !== undefined &&
      nearSignerSlot !== mirrors.nearSignerSlot
    ) {
      return null;
    }
    if (requiresActiveMirrors && nearEd25519SigningKeyId !== mirrors.nearEd25519SigningKeyId) {
      return null;
    }
    if (
      !requiresActiveMirrors &&
      nearEd25519SigningKeyId !== undefined &&
      nearEd25519SigningKeyId !== mirrors.nearEd25519SigningKeyId
    ) {
      return null;
    }
  } else if (
    requiresActiveMirrors &&
    Reflect.get(value, 'chain_target_key') !== mirrors.chainTargetKey
  ) {
    return null;
  } else if (
    !requiresActiveMirrors &&
    Reflect.get(value, 'chain_target_key') !== undefined &&
    Reflect.get(value, 'chain_target_key') !== mirrors.chainTargetKey
  ) {
    return null;
  }
  const keyHandle = Reflect.get(value, 'key_handle');
  const ecdsaThresholdKeyId = Reflect.get(value, 'ecdsa_threshold_key_id');
  const thresholdOwnerAddress = Reflect.get(value, 'threshold_owner_address');
  if (requiresActiveMirrors && keyHandle !== mirrors.keyHandle) return null;
  if (!requiresActiveMirrors && keyHandle !== undefined && keyHandle !== mirrors.keyHandle) {
    return null;
  }
  if (requiresActiveMirrors && ecdsaThresholdKeyId !== mirrors.ecdsaThresholdKeyId) {
    return null;
  }
  if (
    !requiresActiveMirrors &&
    ecdsaThresholdKeyId !== undefined &&
    ecdsaThresholdKeyId !== mirrors.ecdsaThresholdKeyId
  ) {
    return null;
  }
  if (requiresActiveMirrors && thresholdOwnerAddress !== mirrors.thresholdOwnerAddress) {
    return null;
  }
  if (
    !requiresActiveMirrors &&
    thresholdOwnerAddress !== undefined &&
    thresholdOwnerAddress !== mirrors.thresholdOwnerAddress
  ) {
    return null;
  }
  if (Reflect.get(value, 'status') !== record.status) return null;
  if (Reflect.get(value, 'updated_at') !== record.updatedAt) return null;
  return record;
}

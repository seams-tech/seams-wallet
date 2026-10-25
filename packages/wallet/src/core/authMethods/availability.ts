import { IndexedDBManager } from '@/core/indexedDB';
import type { WalletAuthMethodId, WalletId } from '@shared/utils/domainIds';
import { requireRecord } from '@shared/utils/validation';
import { rejectUnknownFields } from '@shared/utils/exactRecord';

import type { AuthMethodAvailability } from './availabilityTypes';

export function availabilityKey(walletId: WalletId, methodId: WalletAuthMethodId): string {
  return `wallet-auth-method-availability:${encodeURIComponent(walletId)}:${encodeURIComponent(methodId)}`;
}

export async function readAuthMethodEnabled(
  walletId: WalletId,
  methodId: WalletAuthMethodId,
): Promise<boolean> {
  const raw = await IndexedDBManager.getAppState(availabilityKey(walletId, methodId));
  return parseStoredAuthMethodAvailability(raw).enabled;
}

export function parseStoredAuthMethodAvailability(raw: unknown): {
  enabled: boolean;
  revision: string;
} {
  if (raw === undefined || raw === null) return { enabled: true, revision: 'initial' };
  const record = requireRecord(raw, 'authentication method availability');
  rejectUnknownFields(record, ['kind', 'revision'], 'authentication method availability');
  if (record.kind !== 'enabled' && record.kind !== 'disabled') {
    throw new Error('Authentication method availability is invalid.');
  }
  if (record.revision !== undefined && (typeof record.revision !== 'string' || !record.revision))
    throw new Error('Authentication method availability revision is invalid.');
  return { enabled: record.kind === 'enabled', revision: record.revision ?? 'initial' };
}

export async function writeAuthMethodEnabled(
  walletId: WalletId,
  methodId: WalletAuthMethodId,
  enabled: boolean,
): Promise<void> {
  await IndexedDBManager.setAppState(availabilityKey(walletId, methodId), {
    kind: enabled ? 'enabled' : 'disabled',
    revision: crypto.randomUUID(),
  });
}

export async function readVoiceIdAvailability(walletId: WalletId): Promise<AuthMethodAvailability> {
  const selected = await IndexedDBManager.resolveSelectedWalletAuthority(walletId);
  if (selected.kind !== 'resolved') return { kind: 'not_enrolled' };
  const methods = await IndexedDBManager.listWalletAuthMethodsV2ForWallet(walletId);
  const active = methods.filter(isActiveVoiceMethod.bind(null, selected.authority.authorityId));
  if (active.length === 0) return { kind: 'not_enrolled' };
  if (active.length !== 1) throw new Error('Select the device authority before managing VoiceID.');
  const method = active[0];
  const enabled = await readAuthMethodEnabled(walletId, method.walletAuthMethodId);
  return enabled
    ? { kind: 'enabled', walletAuthMethodId: method.walletAuthMethodId }
    : { kind: 'disabled', walletAuthMethodId: method.walletAuthMethodId };
}

function isActiveVoiceMethod(
  authorityId: string,
  method: Awaited<ReturnType<typeof IndexedDBManager.listWalletAuthMethodsV2ForWallet>>[number],
): boolean {
  return (
    method.walletAuthorityId === authorityId &&
    method.kind === 'voiceid' &&
    method.status === 'active'
  );
}

export async function hasOtherActiveAuthMethod(
  walletId: WalletId,
  methodId: WalletAuthMethodId,
): Promise<boolean> {
  const current = await IndexedDBManager.getWalletAuthMethodV2(methodId);
  if (!current || current.walletId !== walletId) return false;
  const methods = await IndexedDBManager.listWalletAuthMethodsV2ForWallet(walletId);
  for (const method of methods) {
    if (
      method.walletAuthorityId === current.walletAuthorityId &&
      method.walletAuthMethodId !== methodId &&
      method.status === 'active' &&
      method.kind !== 'voiceid'
    )
      return true;
  }
  return false;
}

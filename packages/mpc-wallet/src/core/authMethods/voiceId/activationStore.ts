import {
  parseWalletAuthMethodRecordV2,
  type ActiveVoiceIdWalletAuthMethodRecordV2,
} from '@shared/utils/walletAuthMethodRecord';
import type { WalletAuthMethodId, WalletId } from '@shared/utils/domainIds';
import { alphabetizeStringify } from '@shared/utils/digests';
import { rejectUnknownFields } from '@shared/utils/exactRecord';
import { requireRecord } from '@shared/utils/validation';
import { parsePendingVoiceIdActivation, type PendingVoiceIdActivation } from './activation';

const ACTIVATION_KEY_PREFIX = 'voiceid-activation-v1:';

type StoredActivation =
  | { readonly kind: 'pending'; readonly pending: PendingVoiceIdActivation }
  | {
      readonly kind: 'active';
      readonly pending: PendingVoiceIdActivation;
      readonly authMethod: ActiveVoiceIdWalletAuthMethodRecordV2;
    };

export type VoiceIdActivationStoragePort = {
  getAppState(key: string): Promise<unknown | undefined>;
  setAppState(key: string, value: unknown): Promise<void>;
  listAppStateEntriesByPrefix(
    prefix: string,
  ): Promise<ReadonlyArray<{ key: string; value: unknown }>>;
  upsertWalletAuthMethodV2(record: ActiveVoiceIdWalletAuthMethodRecordV2): Promise<void>;
};

function activationKey(walletId: WalletId, walletAuthMethodId: WalletAuthMethodId): string {
  return `${ACTIVATION_KEY_PREFIX}${encodeURIComponent(walletId)}:${encodeURIComponent(walletAuthMethodId)}`;
}

function walletActivationPrefix(walletId: WalletId): string {
  return `${ACTIVATION_KEY_PREFIX}${encodeURIComponent(walletId)}:`;
}

function samePending(left: PendingVoiceIdActivation, right: PendingVoiceIdActivation): boolean {
  return alphabetizeStringify(left) === alphabetizeStringify(right);
}

async function parseStoredActivation(raw: unknown): Promise<StoredActivation | null> {
  if (raw === undefined || raw === null) return null;
  const record = requireRecord(raw, 'stored VoiceID activation');
  switch (record.kind) {
    case 'pending':
      rejectUnknownFields(record, ['kind', 'pending'], 'stored VoiceID activation');
      return { kind: 'pending', pending: await parsePendingVoiceIdActivation(record.pending) };
    case 'active': {
      rejectUnknownFields(record, ['kind', 'pending', 'authMethod'], 'stored VoiceID activation');
      const pending = await parsePendingVoiceIdActivation(record.pending);
      const authMethod = parseWalletAuthMethodRecordV2(record.authMethod);
      if (
        !authMethod ||
        authMethod.kind !== 'voiceid' ||
        authMethod.status !== 'active' ||
        authMethod.walletId !== pending.walletId ||
        authMethod.walletAuthMethodId !== pending.walletAuthMethodId ||
        authMethod.deviceKeyId !== pending.deviceKeyId ||
        authMethod.devicePublicKeyB64u !== pending.devicePublicKeyB64u
      ) {
        throw new Error('Stored VoiceID activation method is invalid.');
      }
      return { kind: 'active', pending, authMethod };
    }
    default:
      throw new Error('Stored VoiceID activation lifecycle is invalid.');
  }
}

export class VoiceIdActivationStore {
  constructor(private readonly storage: VoiceIdActivationStoragePort) {}

  async persistPending(pending: PendingVoiceIdActivation): Promise<void> {
    const key = activationKey(pending.walletId, pending.walletAuthMethodId);
    const existing = await parseStoredActivation(await this.storage.getAppState(key));
    if (existing) {
      if (existing.kind === 'pending' && samePending(existing.pending, pending)) return;
      throw new Error('A different VoiceID activation already owns this method ID.');
    }
    await this.storage.setAppState(key, { kind: 'pending', pending });
  }

  async persistActive(
    authMethod: ActiveVoiceIdWalletAuthMethodRecordV2,
    pending: PendingVoiceIdActivation,
  ): Promise<void> {
    const key = activationKey(pending.walletId, pending.walletAuthMethodId);
    const existing = await parseStoredActivation(await this.storage.getAppState(key));
    if (!existing || !samePending(existing.pending, pending)) {
      throw new Error('VoiceID activation has no matching pending record.');
    }
    if (
      authMethod.walletId !== pending.walletId ||
      authMethod.walletAuthMethodId !== pending.walletAuthMethodId ||
      authMethod.deviceKeyId !== pending.deviceKeyId ||
      authMethod.devicePublicKeyB64u !== pending.devicePublicKeyB64u
    ) {
      throw new Error('VoiceID server method does not match pending activation.');
    }
    await this.storage.upsertWalletAuthMethodV2(authMethod);
    await this.storage.setAppState(key, { kind: 'active', pending, authMethod });
  }

  async readPending(
    walletId: WalletId,
    walletAuthMethodId: WalletAuthMethodId,
  ): Promise<PendingVoiceIdActivation | null> {
    const record = await parseStoredActivation(
      await this.storage.getAppState(activationKey(walletId, walletAuthMethodId)),
    );
    if (!record || record.kind === 'active') return null;
    if (
      record.pending.walletId !== walletId ||
      record.pending.walletAuthMethodId !== walletAuthMethodId
    ) {
      throw new Error('Stored VoiceID activation key does not match its record.');
    }
    return record.pending;
  }

  async listPending(walletId: WalletId): Promise<readonly PendingVoiceIdActivation[]> {
    const entries = await this.storage.listAppStateEntriesByPrefix(
      walletActivationPrefix(walletId),
    );
    const pending: PendingVoiceIdActivation[] = [];
    for (const entry of entries) {
      const record = await parseStoredActivation(entry.value);
      if (!record) continue;
      if (
        record.pending.walletId !== walletId ||
        activationKey(walletId, record.pending.walletAuthMethodId) !== entry.key
      ) {
        throw new Error('Stored VoiceID activation key does not match its record.');
      }
      if (record.kind === 'pending') pending.push(record.pending);
    }
    return pending;
  }
}

import { ConfirmationConfig, DEFAULT_CONFIRMATION_CONFIG } from '../../types/signer-worker';
import type { AccountSignerRecord, IndexedDBEvent, UserPreferences } from '../../indexedDB';
import { getLastSelectedNearAccount } from '../../accountData/near/accountProjection';
import type { ProfileLastSelectionPort } from '../../indexedDB/profileAccountProjection';
import { toWalletId, type WalletId } from '../interfaces/ecdsaChainTarget';

export type UserPreferencesStorePort = ProfileLastSelectionPort & {
  isDisabled: () => boolean;
  onChange: (callback: (event: IndexedDBEvent) => void) => () => void;
  listAccountSignersByProfile: (args: {
    profileId: string;
    status?: AccountSignerRecord['status'];
  }) => Promise<AccountSignerRecord[]>;
  getWalletPreferences: (walletId: WalletId) => Promise<Partial<UserPreferences>>;
  updateWalletPreferences: (args: {
    walletId: WalletId;
    preferences: Partial<UserPreferences>;
  }) => Promise<UserPreferences | null>;
};

type UserPreferencesManagerDeps = {
  store: UserPreferencesStorePort;
};

function accountSignerMetadataWalletId(signer: AccountSignerRecord): WalletId | null {
  const walletId = String(signer.metadata?.walletId || '').trim();
  if (!walletId) return null;
  try {
    return toWalletId(walletId);
  } catch {
    return null;
  }
}

function uniqueWalletIdsFromAccountSigners(signers: readonly AccountSignerRecord[]): WalletId[] {
  const walletIds: WalletId[] = [];
  const seen = new Set<string>();
  for (const signer of signers) {
    const walletId = accountSignerMetadataWalletId(signer);
    if (!walletId) continue;
    const key = String(walletId);
    if (seen.has(key)) continue;
    seen.add(key);
    walletIds.push(walletId);
  }
  return walletIds;
}

async function resolveWalletIdForLastSelectedProfile(args: {
  store: UserPreferencesStorePort;
  profileId: string;
}): Promise<WalletId | null> {
  const signers = await args.store
    .listAccountSignersByProfile({
      profileId: args.profileId,
      status: 'active',
    })
    .catch(() => []);
  const walletIds = uniqueWalletIdsFromAccountSigners(signers);
  return walletIds.length === 1 ? walletIds[0]! : null;
}

export class UserPreferencesManager {
  private confirmationConfigChangeListeners: Set<(config: ConfirmationConfig) => void> = new Set();
  private currentWalletChangeListeners: Set<(walletId: WalletId | null) => void> = new Set();

  private currentWalletId: WalletId | null = null;
  private lifecycle: { kind: 'active'; revision: number } | { kind: 'disposed' } = {
    kind: 'active',
    revision: 0,
  };
  private writeQueue: Promise<void> = Promise.resolve();
  private confirmationConfig: ConfirmationConfig = DEFAULT_CONFIRMATION_CONFIG;
  private unsubscribeFromIndexedDB?: () => void;

  constructor(private readonly deps: UserPreferencesManagerDeps) {
    this.subscribeToIndexedDBChanges();
  }

  onConfirmationConfigChange(callback: (config: ConfirmationConfig) => void): () => void {
    this.confirmationConfigChangeListeners.add(callback);
    return () => {
      this.confirmationConfigChangeListeners.delete(callback);
    };
  }

  onCurrentWalletChange(callback: (walletId: WalletId | null) => void): () => void {
    this.currentWalletChangeListeners.add(callback);
    return () => {
      this.currentWalletChangeListeners.delete(callback);
    };
  }

  private notifyConfirmationConfigChange(config: ConfirmationConfig): void {
    if (this.confirmationConfigChangeListeners.size === 0) return;
    for (const listener of this.confirmationConfigChangeListeners) {
      try {
        listener(config);
      } catch {}
    }
  }

  private notifyCurrentWalletChange(walletId: WalletId | null): void {
    if (this.currentWalletChangeListeners.size === 0) return;
    for (const listener of this.currentWalletChangeListeners) {
      try {
        listener(walletId);
      } catch {}
    }
  }

  private sanitizeConfirmationConfig(
    config?: Partial<ConfirmationConfig> | null,
  ): Partial<ConfirmationConfig> {
    if (!config) return {};
    const { uiMode, behavior, autoProceedDelay } = config;
    const next: Partial<ConfirmationConfig> = {};
    if (uiMode != null) next.uiMode = uiMode;
    if (behavior != null) next.behavior = behavior;
    if (autoProceedDelay != null) next.autoProceedDelay = autoProceedDelay;
    return next;
  }

  private mergeConfirmationConfig(
    base: Partial<ConfirmationConfig>,
    patch: Partial<ConfirmationConfig>,
  ): ConfirmationConfig {
    const merged = { ...base, ...patch };
    return {
      uiMode: merged.uiMode ?? DEFAULT_CONFIRMATION_CONFIG.uiMode,
      behavior: merged.behavior ?? DEFAULT_CONFIRMATION_CONFIG.behavior,
      autoProceedDelay: merged.autoProceedDelay ?? DEFAULT_CONFIRMATION_CONFIG.autoProceedDelay,
    };
  }

  async initFromIndexedDB(): Promise<void> {
    await this.loadUserSettings().catch((error) => {
      console.warn('[SigningEngine]: Failed to initialize user settings:', error);
    });
  }

  private subscribeToIndexedDBChanges(): void {
    this.unsubscribeFromIndexedDB = this.deps.store.onChange((event) => {
      void this.handleIndexedDBEvent(event).catch((error) => {
        console.warn('[SigningEngine]: Error handling IndexedDB event:', error);
      });
    });
  }

  private async handleIndexedDBEvent(event: IndexedDBEvent): Promise<void> {
    switch (event.type) {
      case 'preferences-updated':
      case 'user-updated':
        if (this.currentWalletId && String(event.accountId) === String(this.currentWalletId)) {
          await this.reloadUserSettings();
        }
        break;
      case 'user-deleted':
        if (this.currentWalletId && String(event.accountId) === String(this.currentWalletId)) {
          this.invalidateReads();
          this.currentWalletId = null;
          this.confirmationConfig = DEFAULT_CONFIRMATION_CONFIG;
          this.notifyCurrentWalletChange(null);
          this.notifyConfirmationConfigChange(this.confirmationConfig);
        }
        break;
    }
  }

  destroy(): void {
    this.lifecycle = { kind: 'disposed' };
    if (this.unsubscribeFromIndexedDB) {
      this.unsubscribeFromIndexedDB();
      this.unsubscribeFromIndexedDB = undefined;
    }
    this.confirmationConfigChangeListeners.clear();
    this.currentWalletChangeListeners.clear();
  }

  getCurrentWalletId(): WalletId | null {
    return this.currentWalletId;
  }

  getConfirmationConfig(): ConfirmationConfig {
    return this.confirmationConfig;
  }

  setCurrentWallet(walletId: WalletId): void {
    this.invalidateReads();
    const previous = this.currentWalletId;
    this.currentWalletId = walletId;
    if (previous !== walletId) {
      this.confirmationConfig = DEFAULT_CONFIRMATION_CONFIG;
      this.notifyCurrentWalletChange(walletId);
      this.notifyConfirmationConfigChange(this.confirmationConfig);
    }
    if (!this.deps.store.isDisabled()) {
      void this.loadSettingsForWallet(walletId).catch(() => undefined);
    }
  }

  projectCurrentWallet(walletId: WalletId): void {
    const previous = this.currentWalletId;
    this.setCurrentWallet(walletId);
    if (previous && String(previous) === String(walletId)) {
      this.notifyCurrentWalletChange(walletId);
    }
  }

  private assertActive(): void {
    if (this.lifecycle.kind === 'disposed') throw new Error('Wallet preferences are disposed');
  }

  private invalidateReads(): number {
    if (this.lifecycle.kind === 'disposed') throw new Error('Wallet preferences are disposed');
    return ++this.lifecycle.revision;
  }

  private async loadSettingsForWallet(walletId: WalletId): Promise<void> {
    if (this.deps.store.isDisabled()) return;
    const revision = this.invalidateReads();
    const preferences = await this.deps.store.getWalletPreferences(walletId);
    if (
      this.lifecycle.kind !== 'active' ||
      this.lifecycle.revision !== revision ||
      this.currentWalletId !== walletId
    )
      return;
    this.confirmationConfig = this.mergeConfirmationConfig(
      DEFAULT_CONFIRMATION_CONFIG,
      this.sanitizeConfirmationConfig(preferences.confirmationConfig),
    );
    this.notifyConfirmationConfigChange(this.confirmationConfig);
  }

  async reloadUserSettings(): Promise<void> {
    const walletId = this.getCurrentWalletId();
    if (!walletId) return;
    await this.loadSettingsForWallet(walletId);
  }

  setConfirmBehavior(behavior: 'requireClick' | 'skipClick'): Promise<void> {
    return this.setConfirmationConfig({ behavior });
  }

  setConfirmationConfig(config: Partial<ConfirmationConfig>): Promise<void> {
    this.invalidateReads();
    const walletId = this.currentWalletId;
    const patch = this.sanitizeConfirmationConfig(config);
    const write = this.writeQueue.then(this.commitConfirmationConfig.bind(this, walletId, patch));
    this.writeQueue = write.then(settledPreferenceWrite, settledPreferenceWrite);
    return write;
  }

  private async commitConfirmationConfig(
    walletId: WalletId | null,
    patch: Partial<ConfirmationConfig>,
  ): Promise<void> {
    this.assertActive();
    let base = this.confirmationConfig;
    if (walletId !== null) {
      if (this.deps.store.isDisabled()) throw new Error('Wallet preference storage is unavailable');
      const stored = await this.deps.store.getWalletPreferences(walletId);
      base = this.mergeConfirmationConfig(
        DEFAULT_CONFIRMATION_CONFIG,
        this.sanitizeConfirmationConfig(stored.confirmationConfig),
      );
    }
    const next = this.mergeConfirmationConfig(base, patch);
    if (walletId !== null) {
      this.assertActive();
      const persisted = await this.deps.store.updateWalletPreferences({
        walletId,
        preferences: { confirmationConfig: next },
      });
      if (persisted === null) throw new Error('Wallet preference target does not exist');
    }
    if (this.lifecycle.kind === 'active' && this.currentWalletId === walletId) {
      this.invalidateReads();
      this.confirmationConfig = next;
      this.notifyConfirmationConfigChange(next);
    }
  }

  async loadUserSettings(): Promise<void> {
    if (this.deps.store.isDisabled()) return;
    const revision = this.invalidateReads();
    const last = await getLastSelectedNearAccount(this.deps.store).catch(() => null);
    if (!last) {
      console.debug('[SigningEngine]: No last user found, using default settings');
      return;
    }
    const walletId = await resolveWalletIdForLastSelectedProfile({
      store: this.deps.store,
      profileId: last.profileId,
    });
    if (!walletId) {
      console.debug('[SigningEngine]: Last profile has no wallet-bound signer metadata');
      return;
    }
    if (this.lifecycle.kind !== 'active' || this.lifecycle.revision !== revision) return;
    this.currentWalletId = walletId;
    this.confirmationConfig = DEFAULT_CONFIRMATION_CONFIG;
    this.notifyCurrentWalletChange(walletId);
    this.notifyConfirmationConfigChange(this.confirmationConfig);
    await this.loadSettingsForWallet(walletId);
  }
}

function settledPreferenceWrite(): void {}

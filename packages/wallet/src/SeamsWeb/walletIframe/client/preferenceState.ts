import type { WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { DEFAULT_CONFIRMATION_CONFIG, type ConfirmationConfig } from '@/core/types/signer-worker';
import type { PreferencesCapability } from '@/SeamsWeb/signingSurface/types';

/** The display state shared by preference controls and the iframe coordinator. */
export type PreferenceState = Pick<
  PreferencesCapability,
  | 'setCurrentWallet'
  | 'getCurrentWalletId'
  | 'getConfirmationConfig'
  | 'onConfirmationConfigChange'
  | 'onCurrentWalletChange'
> & {
  applyWalletHostConfirmationConfig(input: {
    walletId: WalletId | null;
    confirmationConfig: ConfirmationConfig;
  }): void;
};

/** Application-origin projection. It has no persistence or signing dependencies. */
export class ClientPreferenceState implements PreferenceState {
  private currentWalletId: WalletId | null = null;
  private readonly confirmed = new Map<WalletId | null, ConfirmationConfig>();
  private readonly pending = new Map<
    number,
    { walletId: WalletId | null; patch: Partial<ConfirmationConfig> }
  >();
  private readonly configurationListeners = new Set<(config: ConfirmationConfig) => void>();
  private readonly walletListeners = new Set<(walletId: WalletId | null) => void>();
  private disposed = false;

  getCurrentWalletId(): WalletId | null {
    return this.currentWalletId;
  }

  getConfirmationConfig(): ConfirmationConfig {
    let config = {
      ...(this.confirmed.get(this.currentWalletId) ??
        this.confirmed.get(null) ??
        DEFAULT_CONFIRMATION_CONFIG),
    };
    for (const write of this.pending.values()) {
      if (write.walletId === null || write.walletId === this.currentWalletId) {
        config = { ...config, ...write.patch };
      }
    }
    return config;
  }

  setCurrentWallet(walletId: WalletId): void {
    if (this.disposed || this.currentWalletId === walletId) return;
    this.currentWalletId = walletId;
    for (const listener of this.walletListeners) {
      try {
        listener(walletId);
      } catch {}
    }
    this.notifyConfiguration();
  }

  beginWrite(id: number, walletId: WalletId | null, patch: Partial<ConfirmationConfig>): void {
    this.pending.set(id, { walletId, patch });
    this.notifyConfiguration();
  }

  settleWrite(id: number, succeeded: boolean): void {
    const write = this.pending.get(id);
    if (!write) return;
    if (succeeded) {
      const previous =
        this.confirmed.get(write.walletId) ??
        this.confirmed.get(null) ??
        DEFAULT_CONFIRMATION_CONFIG;
      this.confirmed.set(write.walletId, { ...previous, ...write.patch });
    }
    this.pending.delete(id);
    this.notifyConfiguration();
  }

  private notifyConfiguration(): void {
    if (this.disposed) return;
    for (const listener of this.configurationListeners) {
      try {
        listener(this.getConfirmationConfig());
      } catch {}
    }
  }

  applyWalletHostConfirmationConfig(input: {
    walletId: WalletId | null;
    confirmationConfig: ConfirmationConfig;
  }): void {
    if (this.disposed) return;
    if (input.walletId && this.currentWalletId === null) this.setCurrentWallet(input.walletId);
    const config = input.confirmationConfig;
    this.confirmed.set(input.walletId, {
      uiMode: config.uiMode ?? DEFAULT_CONFIRMATION_CONFIG.uiMode,
      behavior: config.behavior ?? DEFAULT_CONFIRMATION_CONFIG.behavior,
      autoProceedDelay: config.autoProceedDelay ?? DEFAULT_CONFIRMATION_CONFIG.autoProceedDelay,
    });
    this.notifyConfiguration();
  }

  onConfirmationConfigChange(listener: (config: ConfirmationConfig) => void): () => void {
    if (!this.disposed) this.configurationListeners.add(listener);
    return this.removeConfigurationListener.bind(this, listener);
  }

  onCurrentWalletChange(listener: (walletId: WalletId | null) => void): () => void {
    if (!this.disposed) this.walletListeners.add(listener);
    return this.removeWalletListener.bind(this, listener);
  }

  dispose(): void {
    this.disposed = true;
    this.pending.clear();
    this.configurationListeners.clear();
    this.walletListeners.clear();
  }

  private removeConfigurationListener(listener: (config: ConfirmationConfig) => void): void {
    this.configurationListeners.delete(listener);
  }

  private removeWalletListener(listener: (walletId: WalletId | null) => void): void {
    this.walletListeners.delete(listener);
  }
}

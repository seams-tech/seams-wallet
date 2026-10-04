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
  private confirmationConfig: ConfirmationConfig = { ...DEFAULT_CONFIRMATION_CONFIG };
  private readonly configurationListeners = new Set<(config: ConfirmationConfig) => void>();
  private readonly walletListeners = new Set<(walletId: WalletId | null) => void>();
  private disposed = false;

  getCurrentWalletId(): WalletId | null {
    return this.currentWalletId;
  }

  getConfirmationConfig(): ConfirmationConfig {
    return { ...this.confirmationConfig };
  }

  setCurrentWallet(walletId: WalletId): void {
    if (this.disposed || this.currentWalletId === walletId) return;
    this.currentWalletId = walletId;
    for (const listener of this.walletListeners) {
      try {
        listener(walletId);
      } catch {}
    }
  }

  applyWalletHostConfirmationConfig(input: {
    walletId: WalletId | null;
    confirmationConfig: ConfirmationConfig;
  }): void {
    if (this.disposed) return;
    if (input.walletId) this.setCurrentWallet(input.walletId);
    const config = input.confirmationConfig;
    this.confirmationConfig = {
      uiMode: config.uiMode ?? DEFAULT_CONFIRMATION_CONFIG.uiMode,
      behavior: config.behavior ?? DEFAULT_CONFIRMATION_CONFIG.behavior,
      autoProceedDelay: config.autoProceedDelay ?? DEFAULT_CONFIRMATION_CONFIG.autoProceedDelay,
    };
    for (const listener of this.configurationListeners) {
      listener(this.getConfirmationConfig());
    }
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

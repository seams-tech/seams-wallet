import type { ConfirmationConfig } from '@/core/types/signer-worker';
import type { PreferenceState } from '@/SeamsWeb/walletIframe/client/preferenceState';
import type { WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { PreferencesCapability } from '@/SeamsWeb/signingSurface/types';
import type { WalletIframeCoordinator } from '@/SeamsWeb/walletIframe/coordinator';

type WalletIframeConfirmBehaviorWrite = {
  walletIframe: WalletIframeCoordinator;
  walletId: WalletId | null;
  behavior: 'requireClick' | 'skipClick';
};

type WalletIframeConfirmationConfigWrite = {
  walletIframe: WalletIframeCoordinator;
  walletId: WalletId | null;
  config: Partial<ConfirmationConfig>;
};

function applyLocalWalletIframeConfirmationConfigPatch(
  userPreferences: PreferenceState,
  patch: Partial<ConfirmationConfig>,
): void {
  userPreferences.applyWalletHostConfirmationConfig({
    walletId: userPreferences.getCurrentWalletId(),
    confirmationConfig: {
      ...userPreferences.getConfirmationConfig(),
      ...patch,
    },
  });
}

function absorbPreferenceWriteError(): void {}

async function sendWalletIframeConfirmBehaviorWrite(
  args: WalletIframeConfirmBehaviorWrite,
): Promise<void> {
  const router = await args.walletIframe.requireRouter(args.walletId ?? undefined);
  await router.setConfirmBehavior(args.behavior, args.walletId);
}

async function sendWalletIframeConfirmationConfigWrite(
  args: WalletIframeConfirmationConfigWrite,
): Promise<void> {
  const router = await args.walletIframe.requireRouter(args.walletId ?? undefined);
  await router.setConfirmationConfig(args.config, args.walletId);
}

export function createApplicationPreferences(
  state: PreferenceState,
  walletIframe: WalletIframeCoordinator,
): PreferencesCapability {
  const preferences = new ApplicationPreferences(state, walletIframe);
  return {
    setCurrentWallet: state.setCurrentWallet.bind(state),
    getCurrentWalletId: state.getCurrentWalletId.bind(state),
    onConfirmationConfigChange: state.onConfirmationConfigChange.bind(state),
    onCurrentWalletChange: state.onCurrentWalletChange.bind(state),
    getConfirmationConfig: state.getConfirmationConfig.bind(state),
    setConfirmBehavior: preferences.setConfirmBehavior.bind(preferences),
    setConfirmationConfig: preferences.setConfirmationConfig.bind(preferences),
  };
}

class ApplicationPreferences {
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(
    private readonly state: PreferenceState,
    private readonly walletIframe: WalletIframeCoordinator,
  ) {}

  setConfirmBehavior(behavior: 'requireClick' | 'skipClick'): void {
    const walletId = this.state.getCurrentWalletId();
    applyLocalWalletIframeConfirmationConfigPatch(this.state, { behavior });
    this.pendingWrite = this.pendingWrite.catch(absorbPreferenceWriteError).then(
      sendWalletIframeConfirmBehaviorWrite.bind(null, {
        walletIframe: this.walletIframe,
        walletId,
        behavior,
      }),
    );
    void this.pendingWrite.catch(absorbPreferenceWriteError);
  }

  setConfirmationConfig(config: Partial<ConfirmationConfig>): void {
    const walletId = this.state.getCurrentWalletId();
    applyLocalWalletIframeConfirmationConfigPatch(this.state, config);
    this.pendingWrite = this.pendingWrite.catch(absorbPreferenceWriteError).then(
      sendWalletIframeConfirmationConfigWrite.bind(null, {
        walletIframe: this.walletIframe,
        walletId,
        config: { ...config },
      }),
    );
    void this.pendingWrite.catch(absorbPreferenceWriteError);
  }
}

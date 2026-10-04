import type { ConfirmationConfig } from '@/core/types/signer-worker';
import type { WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { PreferencesCapability } from '@/SeamsWeb/signingSurface/types';
import type { WalletIframeCoordinator } from '@/SeamsWeb/walletIframe/coordinator';
import type { ClientPreferenceState } from './preferenceState';
import { toError } from '@shared/utils/errors';

type PreferenceWriteSettlement =
  | { kind: 'applied'; error?: never }
  | { kind: 'failed'; error: Error };

type PreferenceWriteState = { kind: 'pending'; error?: never } | PreferenceWriteSettlement;

class PreferenceWrite {
  state: PreferenceWriteState = { kind: 'pending' };
  readonly settled: Promise<void>;
  private resolve!: () => void;

  constructor(
    readonly id: number,
    readonly walletId: WalletId | null,
    readonly patch: Partial<ConfirmationConfig>,
  ) {
    this.settled = new Promise<void>(this.captureResolution.bind(this));
  }

  settle(state: PreferenceWriteSettlement): void {
    if (this.state.kind !== 'pending') return;
    this.state = state;
    this.resolve();
  }

  private captureResolution(resolve: () => void): void {
    this.resolve = resolve;
  }
}

function disposedPreferenceError(): Error {
  return Object.assign(new Error('Wallet preference synchronization is disposed'), {
    code: 'connection_closed',
  });
}

export function createApplicationPreferences(
  state: ClientPreferenceState,
  walletIframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
): {
  capability: PreferencesCapability;
  beforeSigning: (walletId: WalletId) => Promise<void>;
  dispose: () => void;
} {
  const preferences = new ApplicationPreferences(state, walletIframe);
  return {
    capability: {
      setCurrentWallet: state.setCurrentWallet.bind(state),
      getCurrentWalletId: state.getCurrentWalletId.bind(state),
      onConfirmationConfigChange: state.onConfirmationConfigChange.bind(state),
      onCurrentWalletChange: state.onCurrentWalletChange.bind(state),
      getConfirmationConfig: state.getConfirmationConfig.bind(state),
      setConfirmBehavior: preferences.setConfirmBehavior.bind(preferences),
      setConfirmationConfig: preferences.setConfirmationConfig.bind(preferences),
      flush: preferences.flush.bind(preferences),
    },
    beforeSigning: preferences.beforeSigning.bind(preferences),
    dispose: preferences.dispose.bind(preferences),
  };
}

class ApplicationPreferences {
  private queue: Promise<void> = Promise.resolve();
  private readonly writes = new Map<number, PreferenceWrite>();
  private nextId = 0;
  private disposed = false;

  constructor(
    private readonly state: ClientPreferenceState,
    private readonly walletIframe: Pick<WalletIframeCoordinator, 'requireRouter'>,
  ) {}

  setConfirmBehavior(behavior: 'requireClick' | 'skipClick'): void {
    this.setConfirmationConfig({ behavior });
  }

  setConfirmationConfig(config: Partial<ConfirmationConfig>): void {
    if (this.disposed) throw disposedPreferenceError();
    const patch: Partial<ConfirmationConfig> = {};
    if (config.behavior !== undefined) patch.behavior = config.behavior;
    if (config.uiMode !== undefined) patch.uiMode = config.uiMode;
    if (config.autoProceedDelay !== undefined) patch.autoProceedDelay = config.autoProceedDelay;
    const write = new PreferenceWrite(++this.nextId, this.state.getCurrentWalletId(), patch);
    this.writes.set(write.id, write);
    this.state.beginWrite(write.id, write.walletId, patch);
    this.queue = this.queue.then(this.send.bind(this, write));
  }

  flush(): Promise<void> {
    return this.awaitWrites([...this.writes.values()]);
  }

  beforeSigning(walletId: WalletId): Promise<void> {
    const relevant: PreferenceWrite[] = [];
    for (const write of this.writes.values()) {
      if (write.walletId === null || write.walletId === walletId) relevant.push(write);
    }
    return this.awaitWrites(relevant);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const error = disposedPreferenceError();
    for (const write of this.writes.values()) {
      if (write.state.kind === 'pending') {
        this.state.settleWrite(write.id, false);
        write.settle({ kind: 'failed', error });
      }
    }
    this.state.dispose();
  }

  private async send(write: PreferenceWrite): Promise<void> {
    if (write.state.kind !== 'pending') return;
    try {
      const router = await this.walletIframe.requireRouter(write.walletId ?? undefined);
      if (this.disposed) throw disposedPreferenceError();
      await router.setConfirmationConfig(write.patch, write.walletId);
      if (this.disposed) throw disposedPreferenceError();
      this.state.settleWrite(write.id, true);
      write.settle({ kind: 'applied' });
      this.writes.delete(write.id);
    } catch (error: unknown) {
      this.state.settleWrite(write.id, false);
      write.settle({ kind: 'failed', error: toError(error) });
    }
  }

  private async awaitWrites(writes: readonly PreferenceWrite[]): Promise<void> {
    if (this.disposed) throw disposedPreferenceError();
    const errors: Error[] = [];
    for (const write of writes) {
      await write.settled;
      if (write.state.kind === 'failed') {
        errors.push(write.state.error);
      }
    }
    for (const write of writes) {
      if (write.state.kind === 'failed') this.writes.delete(write.id);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1)
      throw new AggregateError(errors, 'Wallet preference synchronization failed');
  }
}

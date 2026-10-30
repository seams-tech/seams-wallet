import type { ExternalNearController } from '@/externalNear/controller';
import type { ExternalNearConnection, ExternalNearWalletId } from '@/externalNear/types';
import type { ExternalEvmController } from '@/externalEvm/controller';
import type { ExternalEvmConnection, ExternalEvmWallet } from '@/externalEvm/types';
import { nearWalletName } from '@/externalNear/wallets';
import { hotWalletIcon, meteorWalletIcon } from '../externalWalletBrandImages';
import type { SeamsWeb } from '@/SeamsWeb';
import {
  parseWalletAlternatives,
  type WalletAlternatives,
  type WalletAlternativeDescriptor,
  type WalletConnectionRequest,
  type WalletConnectionResult,
} from '@/SeamsWeb/walletIframe/shared/walletAlternatives';
import type { HostedAuthMenuSessionId } from '@/SeamsWeb/walletIframe/shared/messages';

type WalletAlternativeAppearance = {
  label?: string;
  description?: string;
  icon?: string;
};

export type WalletAlternative = WalletAlternativeAppearance &
  (
    | {
        kind: 'near';
        wallet: ExternalNearWalletId;
        controller: ExternalNearController;
        onConnected: (connection: ExternalNearConnection) => void;
      }
    | {
        kind: 'evm';
        wallet: ExternalEvmWallet;
        controller: ExternalEvmController;
        onConnected: (connection: ExternalEvmConnection) => void;
      }
  );

export type WalletAlternativesConfig = Readonly<{
  primary: readonly WalletAlternative[];
  secondary: readonly WalletAlternative[];
}>;

function walletAlternativeId(alternative: WalletAlternative): string {
  switch (alternative.kind) {
    case 'near':
      return `near:${alternative.wallet}`;
    case 'evm':
      return `evm:${alternative.wallet.id}`;
    default:
      return assertNeverAlternative(alternative);
  }
}

function descriptor(alternative: WalletAlternative): WalletAlternativeDescriptor {
  let label: string;
  let icon: string | null;
  switch (alternative.kind) {
    case 'near':
      label = nearWalletName(alternative.wallet);
      icon = nearWalletIcon(alternative.wallet);
      break;
    case 'evm':
      label = alternative.wallet.name;
      icon = alternative.wallet.icon;
      break;
    default:
      return assertNeverAlternative(alternative);
  }
  return {
    id: walletAlternativeId(alternative),
    label: alternative.label ?? label,
    description: alternative.description ?? 'Use your existing wallet',
    icon: alternative.icon ?? icon,
  };
}

export function describeWalletAlternatives(
  config: WalletAlternativesConfig | undefined,
): WalletAlternatives {
  const parsed = parseWalletAlternatives({
    primary: (config?.primary ?? []).map(descriptor),
    secondary: (config?.secondary ?? []).map(descriptor),
  });
  if (!parsed)
    throw new Error('Wallet alternatives must have unique identifiers and valid display data');
  return parsed;
}

type ConnectionAttempt =
  | {
      kind: 'pending';
      alternative: WalletAlternative;
      request: WalletConnectionRequest;
      notify?: never;
    }
  | {
      kind: 'connected';
      alternative: WalletAlternative;
      request: WalletConnectionRequest;
      notify: () => void;
    };

/** Owns application-origin requests for exactly one hosted menu session. */
export class WalletAlternativesBroker {
  private state: ConnectionAttempt | { kind: 'idle' } | { kind: 'inactive' } = { kind: 'inactive' };
  private unsubscribe: (() => void) | null = null;
  private readonly seen = new Set<string>();

  constructor(
    private readonly api: SeamsWeb['authMenu'],
    private readonly sessionId: HostedAuthMenuSessionId,
    private readonly config: { current: WalletAlternativesConfig | undefined },
  ) {}

  start(): void {
    if (
      !this.config.current ||
      this.config.current.primary.length + this.config.current.secondary.length === 0
    )
      return;
    this.state = { kind: 'idle' };
    this.unsubscribe = this.api.onWalletConnectionRequest(this.receive);
  }

  cleanup(): void {
    const previous = this.state;
    this.state = { kind: 'inactive' };
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (previous.kind === 'pending' || previous.kind === 'connected') {
      previous.alternative.controller.disconnect();
    }
  }

  complete(alternativeId: string): void {
    const attempt = this.state;
    if (attempt.kind !== 'connected' || attempt.request.walletId !== alternativeId) return;
    this.state = { kind: 'idle' };
    attempt.notify();
  }

  private receive = (request: WalletConnectionRequest): void => {
    if (
      this.state.kind !== 'idle' ||
      request.authMenuSessionId !== this.sessionId ||
      this.seen.has(request.connectionRequestId)
    )
      return;
    this.seen.add(request.connectionRequestId);
    const rows = [
      ...(this.config.current?.primary ?? []),
      ...(this.config.current?.secondary ?? []),
    ];
    const alternative = rows.find(matchesRequest.bind(null, request));
    if (!alternative) return;
    const attempt: ConnectionAttempt = { kind: 'pending', alternative, request };
    this.state = attempt;
    void this.connect(attempt);
  };

  private async connect(attempt: Extract<ConnectionAttempt, { kind: 'pending' }>): Promise<void> {
    const alternative = attempt.alternative;
    let resolution: WalletConnectionResult;
    try {
      switch (alternative.kind) {
        case 'near': {
          const result = await alternative.controller.connect(alternative.wallet);
          if (this.state !== attempt) return;
          if (result.ok) {
            this.state = {
              kind: 'connected',
              alternative,
              request: attempt.request,
              notify: alternative.onConnected.bind(null, result.value),
            };
            resolution = { kind: 'connected' };
          } else {
            this.state = { kind: 'idle' };
            resolution = { kind: 'failed', message: result.message };
          }
          break;
        }
        case 'evm': {
          const result = await alternative.controller.connect(alternative.wallet.id);
          if (this.state !== attempt) return;
          if (result.ok) {
            this.state = {
              kind: 'connected',
              alternative,
              request: attempt.request,
              notify: alternative.onConnected.bind(null, result.value),
            };
            resolution = { kind: 'connected' };
          } else {
            this.state = { kind: 'idle' };
            resolution =
              result.code === 'rejected'
                ? { kind: 'cancelled' }
                : { kind: 'failed', message: result.message };
          }
          break;
        }
        default:
          return assertNeverAlternative(alternative);
      }
    } catch {
      if (this.state !== attempt) return;
      this.state = { kind: 'idle' };
      resolution = { kind: 'failed', message: 'Unable to connect this wallet.' };
    }
    try {
      await this.api.resolveWalletConnection({
        authMenuSessionId: this.sessionId,
        connectionRequestId: attempt.request.connectionRequestId,
        result: resolution,
      });
    } catch {
      this.cleanup();
    }
  }
}

function matchesRequest(request: WalletConnectionRequest, alternative: WalletAlternative): boolean {
  return request.walletId === walletAlternativeId(alternative);
}

function nearWalletIcon(wallet: ExternalNearWalletId): string | null {
  switch (wallet) {
    case 'meteor':
      return meteorWalletIcon;
    case 'hot':
      return hotWalletIcon;
    case 'intear':
      return null;
    default:
      return assertNeverAlternative(wallet);
  }
}

const controllerIds = new WeakMap<object, number>();
let nextControllerId = 0;

function controllerId(alternative: WalletAlternative): number {
  const current = controllerIds.get(alternative.controller);
  if (current !== undefined) return current;
  const id = ++nextControllerId;
  controllerIds.set(alternative.controller, id);
  return id;
}

export function walletAlternativesControllerKey(
  config: WalletAlternativesConfig | undefined,
): string {
  return JSON.stringify(
    [...(config?.primary ?? []), ...(config?.secondary ?? [])].map(controllerId),
  );
}

function assertNeverAlternative(value: never): never {
  throw new Error(`Unexpected wallet alternative: ${String(value)}`);
}

import type { ExternalNearController } from '@/externalNear/controller';
import type { ExternalNearConnection, ExternalNearWalletId } from '@/externalNear/types';
import type { ExternalEvmController } from '@/externalEvm/controller';
import type { ExternalEvmConnection, ExternalEvmWallet } from '@/externalEvm/types';
import type { Variant } from '@shared/utils/variant';
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

function describeWalletAlternative(alternative: WalletAlternative): WalletAlternativeDescriptor {
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
    primary: (config?.primary ?? []).map(describeWalletAlternative),
    secondary: (config?.secondary ?? []).map(describeWalletAlternative),
  });
  if (!parsed) {
    throw new Error('Wallet alternatives must have unique identifiers and valid display data');
  }
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

type PendingConnectionAttempt = Variant<ConnectionAttempt, 'kind', 'pending'>;

type WalletAlternativeConnectionResult =
  | { readonly kind: 'connected'; readonly notify: () => void; readonly message?: never }
  | { readonly kind: 'cancelled'; readonly notify?: never; readonly message?: never }
  | { readonly kind: 'failed'; readonly message: string; readonly notify?: never };

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
    ) {
      return;
    }
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
    if (attempt.kind !== 'connected' || attempt.request.alternativeId !== alternativeId) {
      return;
    }
    this.state = { kind: 'idle' };
    attempt.notify();
  }

  private receive = (request: WalletConnectionRequest): void => {
    if (
      this.state.kind !== 'idle' ||
      request.authMenuSessionId !== this.sessionId ||
      this.seen.has(request.connectionRequestId)
    ) {
      return;
    }
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

  private async connect(attempt: PendingConnectionAttempt): Promise<void> {
    const result = await connectWalletAlternative(attempt.alternative);
    if (this.state !== attempt) {
      return;
    }
    let resolution: WalletConnectionResult;
    switch (result.kind) {
      case 'connected':
        this.state = {
          kind: 'connected',
          alternative: attempt.alternative,
          request: attempt.request,
          notify: result.notify,
        };
        resolution = { kind: 'connected' };
        break;
      case 'cancelled':
      case 'failed':
        this.state = { kind: 'idle' };
        resolution = result;
        break;
      default:
        return assertNeverAlternative(result);
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

async function connectWalletAlternative(
  alternative: WalletAlternative,
): Promise<WalletAlternativeConnectionResult> {
  try {
    switch (alternative.kind) {
      case 'near': {
        const result = await alternative.controller.connect(alternative.wallet);
        if (!result.ok) {
          return { kind: 'failed', message: result.message };
        }
        return {
          kind: 'connected',
          notify: alternative.onConnected.bind(null, result.value),
        };
      }
      case 'evm': {
        const result = await alternative.controller.connect(alternative.wallet.id);
        if (result.ok) {
          return {
            kind: 'connected',
            notify: alternative.onConnected.bind(null, result.value),
          };
        }
        if (result.code === 'rejected') {
          return { kind: 'cancelled' };
        }
        return { kind: 'failed', message: result.message };
      }
      default:
        return assertNeverAlternative(alternative);
    }
  } catch {
    return { kind: 'failed', message: 'Unable to connect this wallet.' };
  }
}

function matchesRequest(request: WalletConnectionRequest, alternative: WalletAlternative): boolean {
  return request.alternativeId === walletAlternativeId(alternative);
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

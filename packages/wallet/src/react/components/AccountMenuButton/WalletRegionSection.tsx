import React, { Component } from 'react';
import { base64UrlEncode } from '@shared/utils/base64';
import type { WalletId } from '@shared/utils/domainIds';
import type { ExclusiveUnion, Variant } from '@shared/utils/variant';
import {
  parseWalletMoveId,
  type WalletMoveRequest,
  type WalletMoveStatus,
  type WalletPlacement,
  type WalletPlacementCapability,
  type WalletRegion,
} from '@/SeamsWeb/publicApi/placement';

type Props = {
  readonly walletId: WalletId;
  readonly placement: WalletPlacementCapability;
  readonly onAvailability: (available: boolean) => void;
};
type State = ExclusiveUnion<
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly placement: Variant<WalletPlacement, 'state', 'settled'>;
      readonly selected: WalletRegion;
    }
  | { readonly kind: 'submitting'; readonly request: WalletMoveRequest }
  | { readonly kind: 'uncertain'; readonly request: WalletMoveRequest; readonly message: string }
  | { readonly kind: 'progress'; readonly status: WalletMoveStatus }
  | { readonly kind: 'unavailable'; readonly message: string }
>;

const REGIONS: ReadonlyArray<{ readonly value: WalletRegion; readonly label: string }> = [
  { value: 'US', label: 'United States' },
  { value: 'WEUR', label: 'Western Europe' },
  { value: 'APAC', label: 'Asia Pacific' },
  { value: 'OC', label: 'Oceania' },
];

function regionName(value: WalletRegion): string {
  return REGIONS.find(matchesRegion.bind(null, value))!.label;
}

function matchesRegion(value: string, region: (typeof REGIONS)[number]): boolean {
  return region.value === value;
}

function renderRegion(region: (typeof REGIONS)[number]): React.ReactNode {
  return (
    <option key={region.value} value={region.value}>
      {region.label}
    </option>
  );
}

function progressText(status: WalletMoveStatus): string {
  if (status.state === 'completed') return 'Your wallet is in the new region.';
  const progress = status.move.progress;
  if (progress.execution.state === 'blocked')
    return 'The move needs service recovery. Your wallet data remains preserved. You can lock this wallet while recovery continues.';
  if (progress.execution.state === 'retry_wait')
    return 'The service will retry this stage. Closing or locking this wallet does not cancel the move.';
  switch (progress.state) {
    case 'freezing':
      return 'Preparing your wallet';
    case 'copying':
      return 'Transferring wallet data';
    case 'verified':
      return 'Checking the new region';
    case 'activating':
      return 'Activating the new region';
    case 'cleanup':
      return 'The new region is active. Source cleanup continues.';
    default:
      return assertNever(progress);
  }
}

function statusText(state: State): string {
  switch (state.kind) {
    case 'progress':
      return progressText(state.status);
    case 'loading':
      return 'Checking wallet placement…';
    case 'submitting':
      return 'Preparing your wallet';
    case 'ready':
    case 'uncertain':
    case 'unavailable':
      return '';
    default:
      return assertNever(state);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected wallet region state: ${String(value)}`);
}

export class WalletRegionSection extends Component<Props, { readonly view: State }> {
  state: { readonly view: State } = { view: { kind: 'loading' } };
  private mounted = false;
  private requestRevision = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  componentDidMount(): void {
    this.mounted = true;
    this.props.onAvailability(false);
    void this.load();
  }

  componentWillUnmount(): void {
    this.mounted = false;
    if (this.timer !== null) clearTimeout(this.timer);
  }

  private commit(state: State): void {
    if (!this.mounted) return;
    this.setState({ view: state });
    this.props.onAvailability(state.kind === 'ready');
  }

  private load = async (): Promise<void> => {
    const revision = ++this.requestRevision;
    this.commit({ kind: 'loading' });
    try {
      const last = await this.props.placement.getLastMoveRequest(this.props.walletId);
      if (!this.mounted || revision !== this.requestRevision) return;
      const result = await this.props.placement.get(this.props.walletId);
      if (!this.mounted || revision !== this.requestRevision) return;
      if (!result.ok || result.placement.state === 'unavailable') {
        if (last !== null) {
          await this.readMove(last);
          return;
        }
        this.commit({
          kind: 'unavailable',
          message:
            'Unable to check wallet placement. Unlock this wallet or reconnect to try again.',
        });
        return;
      }
      if (result.placement.state === 'moving') {
        this.showProgress(result.placement);
        return;
      }
      if (last !== null && last.expectedGeneration >= result.placement.generation) {
        this.commit({
          kind: 'uncertain',
          request: last,
          message: 'Reconnecting to check progress. The previous request may have been accepted.',
        });
        await this.readMove(last);
        return;
      }
      this.commit({
        kind: 'ready',
        placement: result.placement,
        selected: result.placement.region,
      });
    } catch {
      if (!this.mounted || revision !== this.requestRevision) return;
      this.commit({
        kind: 'unavailable',
        message: 'Unable to check wallet placement. Reconnect to try again.',
      });
    }
  };

  private select = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    if (this.state.view.kind !== 'ready') return;
    const region = REGIONS.find(matchesRegion.bind(null, event.currentTarget.value));
    if (!region) return;
    this.commit({ kind: 'ready', placement: this.state.view.placement, selected: region.value });
  };

  private submit = async (): Promise<void> => {
    const state = this.state.view;
    if (
      state.kind !== 'ready' ||
      state.selected === state.placement.region ||
      state.placement.nextMoveAtMs > Date.now()
    )
      return;
    const request: WalletMoveRequest = {
      walletId: this.props.walletId,
      moveId: parseWalletMoveId(
        `wmove_${base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))}`,
      ),
      destinationRegion: state.selected,
      expectedGeneration: state.placement.generation,
    };
    await this.send(request);
  };

  private retry = async (): Promise<void> => {
    if (this.state.view.kind !== 'uncertain') return;
    await this.send(this.state.view.request);
  };

  private async send(request: WalletMoveRequest): Promise<void> {
    const revision = ++this.requestRevision;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.commit({ kind: 'submitting', request });
    try {
      const result = await this.props.placement.move(request);
      if (!this.mounted || revision !== this.requestRevision) return;
      if (result.ok) {
        this.showProgress(result.status);
        return;
      }
    } catch {
      // An absent reply does not establish whether admission succeeded.
    }
    if (!this.mounted || revision !== this.requestRevision) return;
    this.commit({
      kind: 'uncertain',
      request,
      message: 'Reconnecting to check progress. Retry this same request to continue.',
    });
    if (this.mounted) this.timer = setTimeout(this.poll, 1500);
  }

  private showProgress(status: WalletMoveStatus): void {
    this.commit({ kind: 'progress', status });
    if (this.mounted && status.state === 'moving') {
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = setTimeout(this.poll, 1500);
    }
  }

  private poll = async (): Promise<void> => {
    this.timer = null;
    const state = this.state.view;
    if (state.kind === 'uncertain') {
      await this.readMove(state.request);
      return;
    }
    if (state.kind !== 'progress' || state.status.state !== 'moving') return;
    const move = state.status.move;
    await this.readMove({
      walletId: this.props.walletId,
      moveId: move.moveId,
      destinationRegion: move.destinationRegion,
      expectedGeneration: move.sourceGeneration,
    });
  };

  private async readMove(request: WalletMoveRequest): Promise<void> {
    const revision = this.requestRevision;
    try {
      const result = await this.props.placement.getMove(request.walletId, request.moveId);
      if (!this.mounted || revision !== this.requestRevision) return;
      if (result.ok) {
        this.showProgress(result.status);
        return;
      }
    } catch {
      // Keep the exact locator when progress cannot be read.
    }
    if (!this.mounted || revision !== this.requestRevision) return;
    this.commit({
      kind: 'uncertain',
      request,
      message: 'Reconnecting to check progress. Unlock this wallet if authentication expired.',
    });
    if (this.mounted) this.timer = setTimeout(this.poll, 1500);
  }

  render(): React.ReactNode {
    const state = this.state.view;
    return (
      <section aria-label="Wallet region">
        <p role="status">{statusText(state)}</p>
        {this.renderContent(state)}
      </section>
    );
  }

  private renderContent(state: State): React.ReactNode {
    switch (state.kind) {
      case 'loading':
      case 'submitting':
        return <p>You can lock this wallet. An accepted move continues on the server.</p>;
      case 'unavailable':
        return (
          <>
            <p role="alert">{state.message}</p>
            <button type="button" className="seams-settings-action" onClick={this.load}>
              Check again
            </button>
          </>
        );
      case 'uncertain':
        return (
          <>
            <p role="alert">{state.message}</p>
            <button type="button" className="seams-settings-action" onClick={this.retry}>
              Retry same move
            </button>
          </>
        );
      case 'progress': {
        const active =
          state.status.state === 'completed' ||
          state.status.move.progress.availability === 'active';
        return (
          <p>
            {active
              ? 'Lock this wallet, then unlock it again before signing. Another move must wait until cleanup completes.'
              : 'Signing and wallet changes are paused. Closing or locking this wallet does not cancel the move.'}
          </p>
        );
      }
      case 'ready':
        return (
          <>
            <p>
              Current region: <strong>{regionName(state.placement.region)}</strong>
            </p>
            <label>
              Destination region{' '}
              <select value={state.selected} onChange={this.select}>
                {REGIONS.map(renderRegion)}
              </select>
            </label>
            <p>
              Moving your wallet ends signing sessions on all devices. After the move, unlock your
              wallet again to sign.
            </p>
            {state.placement.nextMoveAtMs > Date.now() ? (
              <p>
                Another move is available after{' '}
                {new Date(state.placement.nextMoveAtMs).toLocaleString()}.
              </p>
            ) : null}
            <button
              type="button"
              className="seams-settings-action"
              disabled={
                state.selected === state.placement.region ||
                state.placement.nextMoveAtMs > Date.now()
              }
              onClick={this.submit}
            >
              Move wallet
            </button>
          </>
        );
      default:
        return assertNever(state);
    }
  }
}

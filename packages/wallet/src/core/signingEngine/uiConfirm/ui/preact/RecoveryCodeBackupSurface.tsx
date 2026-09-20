/** @jsxImportSource preact */
import { Component, createRef } from 'preact';
import type { WalletRecoveryCodeStatusResult } from '@/core/rpcClients/relayer/walletRecoveryRotate';
import type { WalletRecoveryCodeBackupRequestV1 } from '@/core/types/sdkSentEvents';

export type RecoveryCodeBackupExperience =
  | {
      readonly kind: 'direct_backup';
      readonly request: WalletRecoveryCodeBackupRequestV1;
    }
  | {
      readonly kind: 'account_menu';
      readonly walletId: string;
      readonly loadStatus: () => Promise<WalletRecoveryCodeStatusResult>;
      readonly loadPendingBackup: () => Promise<WalletRecoveryCodeBackupRequestV1 | null>;
    };

export type RecoveryBackupCloseDetail =
  | { readonly kind: 'dismissed' }
  | { readonly kind: 'recovery_codes'; readonly acknowledged: boolean };

export type RecoveryBackupStage = 'summary' | 'opening' | 'recovery_codes';

type SummaryLoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly status: WalletRecoveryCodeStatusResult }
  | { readonly kind: 'error'; readonly message: string };

type SummaryViewState = {
  readonly kind: 'summary' | 'opening';
  readonly walletId: string;
  readonly loadState: SummaryLoadState;
  readonly actionError: string | null;
};

type RecoveryCodeViewState =
  | SummaryViewState
  | { readonly kind: 'recovery_codes'; readonly request: WalletRecoveryCodeBackupRequestV1 };

type RecoveryCodeBackupSurfaceProps = {
  readonly experience: RecoveryCodeBackupExperience;
  readonly onClose: (detail: RecoveryBackupCloseDetail) => void;
  readonly onStageChange: (stage: RecoveryBackupStage) => void;
};

type RecoveryCodeBackupSurfaceState = {
  readonly viewState: RecoveryCodeViewState;
  readonly acknowledged: boolean;
  readonly statusMessage: string;
  readonly copied: boolean;
};

const COPIED_FLASH_MS = 1_800;

function assertNever(value: never): never {
  throw new Error(`Unhandled recovery-code state: ${String(value)}`);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function initialViewState(experience: RecoveryCodeBackupExperience): RecoveryCodeViewState {
  switch (experience.kind) {
    case 'direct_backup':
      return { kind: 'recovery_codes', request: experience.request };
    case 'account_menu':
      return {
        kind: 'summary',
        walletId: experience.walletId,
        loadState: { kind: 'loading' },
        actionError: null,
      };
    default:
      return assertNever(experience);
  }
}

function initialState(experience: RecoveryCodeBackupExperience): RecoveryCodeBackupSurfaceState {
  return {
    viewState: initialViewState(experience),
    acknowledged: false,
    statusMessage: '',
    copied: false,
  };
}

function stageForState(state: RecoveryCodeViewState): RecoveryBackupStage {
  switch (state.kind) {
    case 'summary':
    case 'opening':
    case 'recovery_codes':
      return state.kind;
    default:
      return assertNever(state);
  }
}

function statusLabel(status: WalletRecoveryCodeStatusResult): string {
  switch (status.kind) {
    case 'ready':
      return status.pendingLocalBackup || status.backupOutstanding ? 'Backup needed' : 'Backed up';
    case 'no_recovery_set':
      return 'No recovery set';
    case 'unauthorized':
      return 'Authorization required';
    case 'transport_failed':
      return 'Could not load';
    default:
      return assertNever(status);
  }
}

function canViewPendingRecoveryCodes(loadState: SummaryLoadState): boolean {
  if (loadState.kind !== 'loaded') return true;
  switch (loadState.status.kind) {
    case 'ready':
      return loadState.status.pendingLocalBackup;
    case 'unauthorized':
    case 'transport_failed':
      return true;
    case 'no_recovery_set':
      return false;
    default:
      return assertNever(loadState.status);
  }
}

function recoveryStatusFailureMessage(loadState: SummaryLoadState): string | null {
  if (loadState.kind === 'error') return loadState.message;
  if (loadState.kind !== 'loaded') return null;
  switch (loadState.status.kind) {
    case 'unauthorized':
    case 'transport_failed':
      return loadState.status.message;
    case 'ready':
    case 'no_recovery_set':
      return null;
    default:
      return assertNever(loadState.status);
  }
}

function statusValue(loadState: SummaryLoadState): string {
  switch (loadState.kind) {
    case 'loading':
      return 'Loading';
    case 'error':
      return 'Could not load';
    case 'loaded':
      return statusLabel(loadState.status);
    default:
      return assertNever(loadState);
  }
}

function activeCodesValue(loadState: SummaryLoadState): string {
  return loadState.kind === 'loaded' && loadState.status.kind === 'ready'
    ? `${loadState.status.activeCodeCount} / ${loadState.status.totalCodeCount}`
    : '—';
}

function safeWalletId(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.-]/g, '_') || 'wallet';
}

function backupText(walletId: string, recoveryCodes: readonly string[]): string {
  const lines = [
    'Seams wallet recovery codes',
    '',
    `Wallet: ${walletId}`,
    '',
    'Save these codes somewhere private. Each code can be used once.',
    '',
  ];
  for (const [index, code] of recoveryCodes.entries()) {
    lines.push(`${String(index + 1).padStart(2, '0')}  ${code}`);
  }
  return `${lines.join('\n')}\n`;
}

function recoveryCloseLabel(
  request: WalletRecoveryCodeBackupRequestV1,
  acknowledged: boolean,
): string {
  if (acknowledged) return 'Finish backup';
  if (request.continuation === 'registration_may_defer') return 'Back up later';
  return 'Close';
}

function renderRecoveryCodeItem(code: string, index: number) {
  return (
    <li class="recovery-code-item" key={`${index}-${code}`}>
      <span class="recovery-code-index">{index + 1}</span>
      <span class="recovery-code-value">{code}</span>
    </li>
  );
}

export class RecoveryCodeBackupSurface extends Component<
  RecoveryCodeBackupSurfaceProps,
  RecoveryCodeBackupSurfaceState
> {
  state = initialState(this.props.experience);
  private readonly root = createRef<HTMLDivElement>();
  private active = false;
  private loadGeneration = 0;
  private copiedResetTimer: number | null = null;
  private focusFrame: number | null = null;

  componentDidMount(): void {
    this.active = true;
    this.loadGeneration += 1;
    this.notifyStage();
    this.beginAccountStatus(this.props.experience, this.loadGeneration);
  }

  componentWillReceiveProps(nextProps: RecoveryCodeBackupSurfaceProps): void {
    if (nextProps.experience === this.props.experience) return;
    this.loadGeneration += 1;
    this.clearFocusFrame();
    this.clearCopiedFlash();
    this.setState(initialState(nextProps.experience));
    this.beginAccountStatus(nextProps.experience, this.loadGeneration);
  }

  componentDidUpdate(
    _previousProps: Readonly<RecoveryCodeBackupSurfaceProps>,
    previous: Readonly<RecoveryCodeBackupSurfaceState>,
  ): void {
    if (stageForState(previous.viewState) !== stageForState(this.state.viewState)) {
      this.notifyStage();
    }
    if (
      previous.viewState.kind !== 'recovery_codes' &&
      this.state.viewState.kind === 'recovery_codes'
    ) {
      this.focusTitleAfterRender();
    }
  }

  componentWillUnmount(): void {
    this.active = false;
    this.loadGeneration += 1;
    this.clearFocusFrame();
    this.clearCopiedFlash();
  }

  render() {
    const viewState = this.state.viewState;
    const stage = stageForState(viewState);
    const content =
      viewState.kind === 'recovery_codes'
        ? this.renderRecoveryCodes(viewState.request)
        : this.renderSummary(viewState);
    return (
      <div
        ref={this.root}
        class="seams-recovery-code-backup-viewer"
        data-seams-recovery-entry={this.props.experience.kind}
        data-seams-recovery-stage={stage}
      >
        {content}
      </div>
    );
  }

  private notifyStage(): void {
    this.props.onStageChange(stageForState(this.state.viewState));
  }

  private beginAccountStatus(
    experience: RecoveryCodeBackupExperience,
    generation: number,
  ): void {
    if (experience.kind !== 'account_menu') return;
    void this.loadSummaryStatus(experience, generation);
  }

  private async loadSummaryStatus(
    experience: Extract<RecoveryCodeBackupExperience, { kind: 'account_menu' }>,
    generation: number,
  ): Promise<void> {
    try {
      const status = await experience.loadStatus();
      this.updateSummaryLoadState(generation, { kind: 'loaded', status });
    } catch (error: unknown) {
      this.updateSummaryLoadState(generation, {
        kind: 'error',
        message: errorMessage(error, 'Could not load recovery-code status'),
      });
    }
  }

  private updateSummaryLoadState(generation: number, loadState: SummaryLoadState): void {
    if (!this.active || generation !== this.loadGeneration) return;
    const current = this.state.viewState;
    if (current.kind !== 'summary' && current.kind !== 'opening') return;
    this.setState({ viewState: { ...current, loadState } });
  }

  private readonly retryStatus = (): void => {
    const experience = this.props.experience;
    if (experience.kind !== 'account_menu') return;
    const current = this.state.viewState;
    if (current.kind !== 'summary') return;
    const generation = ++this.loadGeneration;
    this.setState({ viewState: { ...current, loadState: { kind: 'loading' }, actionError: null } });
    void this.loadSummaryStatus(experience, generation);
  };

  private readonly openRecoveryCodes = async (): Promise<void> => {
    const experience = this.props.experience;
    const current = this.state.viewState;
    if (experience.kind !== 'account_menu' || current.kind !== 'summary') return;
    const generation = this.loadGeneration;
    this.setState({ viewState: { ...current, kind: 'opening', actionError: null } });
    try {
      const request = await experience.loadPendingBackup();
      if (!this.active || generation !== this.loadGeneration) return;
      if (!request) {
        this.setState({
          viewState: {
            ...current,
            actionError: 'Recovery codes are no longer available on this device.',
          },
        });
        return;
      }
      this.setState({ viewState: { kind: 'recovery_codes', request } });
    } catch (error: unknown) {
      if (!this.active || generation !== this.loadGeneration) return;
      this.setState({
        viewState: {
          ...current,
          actionError: errorMessage(error, 'Could not open recovery codes'),
        },
      });
    }
  };

  private readonly closeSummary = (): void => {
    this.props.onClose({ kind: 'dismissed' });
  };

  private readonly closeRecoveryCodes = (): void => {
    this.props.onClose({ kind: 'recovery_codes', acknowledged: this.state.acknowledged });
  };

  private readonly onAcknowledgementChange = (event: Event): void => {
    if (!(event.currentTarget instanceof HTMLInputElement)) return;
    this.setState({ acknowledged: event.currentTarget.checked });
  };

  private readonly download = (): void => {
    const viewState = this.state.viewState;
    if (viewState.kind !== 'recovery_codes') return;
    const view = this.root.current?.ownerDocument.defaultView;
    if (!view) return;
    const { walletId, recoveryCodes } = viewState.request;
    try {
      const url = view.URL.createObjectURL(
        new view.Blob([backupText(walletId, recoveryCodes)], {
          type: 'text/plain;charset=utf-8',
        }),
      );
      const anchor = view.document.createElement('a');
      anchor.href = url;
      anchor.download = `seams-wallet-recovery-codes-${safeWalletId(walletId)}.txt`;
      try {
        anchor.click();
      } finally {
        view.setTimeout(() => view.URL.revokeObjectURL(url), 0);
      }
      this.setState({ statusMessage: 'Recovery codes downloaded.' });
    } catch {
      this.setState({ statusMessage: 'Unable to download the codes. Copy them or try again.' });
    }
  };

  private readonly copy = async (): Promise<void> => {
    const viewState = this.state.viewState;
    if (viewState.kind !== 'recovery_codes' || !this.active) return;
    const { walletId, recoveryCodes } = viewState.request;
    const generation = this.loadGeneration;
    try {
      await navigator.clipboard.writeText(backupText(walletId, recoveryCodes));
      if (!this.active || generation !== this.loadGeneration) return;
      this.setState({ statusMessage: 'Recovery codes copied.' });
      this.flashCopied();
    } catch {
      if (!this.active || generation !== this.loadGeneration) return;
      this.setState({ statusMessage: 'Unable to copy the codes. Download them or try again.' });
    }
  };

  private flashCopied(): void {
    const view = this.root.current?.ownerDocument.defaultView;
    if (!view) return;
    if (this.copiedResetTimer !== null) view.clearTimeout(this.copiedResetTimer);
    this.setState({ copied: true });
    this.copiedResetTimer = view.setTimeout(() => {
      this.copiedResetTimer = null;
      if (this.active) this.setState({ copied: false });
    }, COPIED_FLASH_MS);
  }

  private clearCopiedFlash(): void {
    const view = this.root.current?.ownerDocument.defaultView;
    if (view && this.copiedResetTimer !== null) view.clearTimeout(this.copiedResetTimer);
    this.copiedResetTimer = null;
  }

  private clearFocusFrame(): void {
    const view = this.root.current?.ownerDocument.defaultView;
    if (view && this.focusFrame !== null) view.cancelAnimationFrame(this.focusFrame);
    this.focusFrame = null;
  }

  private focusTitleAfterRender(): void {
    const view = this.root.current?.ownerDocument.defaultView;
    if (!view) return;
    this.clearFocusFrame();
    this.focusFrame = view.requestAnimationFrame(() => {
      this.focusFrame = null;
      if (this.active) this.root.current?.querySelector<HTMLElement>('.recovery-backup-title')?.focus();
    });
  }

  private renderSummary(state: SummaryViewState) {
    const statusFailure = recoveryStatusFailureMessage(state.loadState);
    const showViewCodesButton = canViewPendingRecoveryCodes(state.loadState);
    const opening = state.kind === 'opening';
    return (
      <>
        <button
          type="button"
          class="recovery-summary-close"
          aria-label="Close recovery codes"
          onClick={this.closeSummary}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
        <h1 id="seams-wallet-recovery-title" class="recovery-backup-title" tabIndex={-1}>
          Wallet recovery codes
        </h1>
        <p id="seams-wallet-recovery-description" class="recovery-backup-description">
          View and save the recovery codes retained by this wallet after registration.
        </p>
        <div class="recovery-summary-body">
          <div class="recovery-summary-row">
            <span class="recovery-summary-label">Wallet</span>
            <span class="recovery-summary-value">{state.walletId}</span>
          </div>
          <div class="recovery-summary-row">
            <span class="recovery-summary-label">Status</span>
            <span class="recovery-summary-value">{statusValue(state.loadState)}</span>
          </div>
          <div class="recovery-summary-row">
            <span class="recovery-summary-label">Active codes</span>
            <span class="recovery-summary-value">{activeCodesValue(state.loadState)}</span>
          </div>
          {showViewCodesButton && (
            <button
              type="button"
              class="recovery-backup-button primary recovery-summary-open"
              disabled={opening}
              onClick={this.openRecoveryCodes}
            >
              {opening ? (
                <>
                  Opening recovery codes
                  <span class="recovery-summary-ellipsis" aria-hidden="true">
                    <span>.</span>
                    <span>.</span>
                    <span>.</span>
                  </span>
                </>
              ) : (
                'View recovery codes'
              )}
            </button>
          )}
          <p class="recovery-summary-live-status" role="status" aria-live="polite">
            {state.loadState.kind === 'loading' ? 'Loading recovery-code status…' : ''}
          </p>
          {statusFailure && <p class="recovery-summary-error" role="alert">{statusFailure}</p>}
          {state.actionError && <p class="recovery-summary-error" role="alert">{state.actionError}</p>}
          {state.loadState.kind === 'error' && (
            <button type="button" class="recovery-backup-button secondary" onClick={this.retryStatus}>
              Retry status
            </button>
          )}
        </div>
      </>
    );
  }

  private renderRecoveryCodes(request: WalletRecoveryCodeBackupRequestV1) {
    const description =
      request.continuation === 'registration_may_defer'
        ? 'These ten single-use codes recover every signing key in this wallet. Save them now, or back them up later from Recovery Codes in the account menu.'
        : 'These ten single-use codes recover every signing key in this wallet. Save them somewhere private.';
    return (
      <>
        <h1 id="seams-wallet-recovery-title" class="recovery-backup-title" tabIndex={-1}>
          Save your wallet recovery codes
        </h1>
        <p id="seams-wallet-recovery-description" class="recovery-backup-description">
          {description}
        </p>
        <ol class="recovery-code-list">
          {request.recoveryCodes.map(renderRecoveryCodeItem)}
        </ol>
        <div class="recovery-backup-actions">
          <button type="button" class="recovery-backup-button primary" onClick={this.download}>
            Download codes
          </button>
          <button
            type="button"
            class={`recovery-backup-button primary recovery-backup-copy${this.state.copied ? ' copied' : ''}`}
            onClick={this.copy}
          >
            <CopyIcon />
            Copy codes
          </button>
        </div>
        <label class="recovery-backup-acknowledgement">
          <input
            type="checkbox"
            data-seams-wallet-recovery-backup-acknowledgement
            checked={this.state.acknowledged}
            onChange={this.onAcknowledgementChange}
          />
          I saved these recovery codes (these codes will not be shown again).
        </label>
        <p class="recovery-backup-status" role="status">
          {this.state.statusMessage}
        </p>
        <div class="recovery-backup-footer">
          <button
            type="button"
            class={`recovery-backup-button ${this.state.acknowledged ? 'primary' : 'secondary'}`}
            data-seams-wallet-recovery-backup-close
            onClick={this.closeRecoveryCodes}
          >
            {recoveryCloseLabel(request, this.state.acknowledged)}
          </button>
        </div>
      </>
    );
  }
}

function CopyIcon() {
  return (
    <span class="copy-icon" aria-hidden="true">
      <span class="copy-icon-check">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <span class="copy-icon-copy">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <rect width="14" height="14" x="8" y="8" rx="2" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
      </span>
    </span>
  );
}

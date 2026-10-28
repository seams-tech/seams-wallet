import { Component, createRef, type CSSProperties, type ReactNode } from 'react';
import type { ExternalNearController } from '@/externalNear/controller';
import type { ExternalNearConnection, ExternalNearWalletId } from '@/externalNear/types';
import { nearWalletName } from '@/externalNear/wallets';
import { SEAMS_STANDARD_WORDMARK_PATH } from '@/core/signingEngine/uiConfirm/ui/seamsWordmarkPaths';
import { useSeams } from '@/react/context';
import { WalletText, useWalletLocale } from '@/react/context/WalletLocale';
import { walletDisplayText } from '@/core/ui/messages';
import { Theme, useTheme } from '../theme';
import { WalletIcon } from '../AccountMenuButton/icons/WalletIcon';
import { HostedSeamsAuthMenu } from './shell';
import type { HostedAuthMenuOutcome, HostedSeamsAuthMenuProps } from './types';
import './WalletConnectorMenu.css';

export type WalletConnectorOptionAppearance = {
  label?: string;
  description?: string;
  icon?: ReactNode;
};

export type WalletConnectorMenuProps = {
  /** Uses the controller's enabled wallets and their order. The app owns the connection. */
  externalNear?: {
    controller: ExternalNearController;
    onConnected: (connection: ExternalNearConnection) => void;
  };
  /** Options for the hosted auth menu. Registration is the default entry screen. */
  authMenu?: Omit<HostedSeamsAuthMenuProps, 'onOutcome' | 'placeholder' | 'initialHeightCssPx'>;
  onOutcome: HostedSeamsAuthMenuProps['onOutcome'];
  onClose?: () => void;
  title?: string;
  description?: string;
  closeLabel?: string;
  /** Customize the built-in Seams row and each enabled external wallet row. */
  options?: Partial<Record<'seams' | ExternalNearWalletId, WalletConnectorOptionAppearance>>;
  className?: string;
  style?: CSSProperties;
};

type ConnectorView =
  | { kind: 'choices'; error: string | null; initialHeightCssPx?: never }
  | { kind: 'auth'; initialHeightCssPx: number; error?: never };

type ConnectorPanelState = { view: ConnectorView };

type PendingConnection = {
  controller: ExternalNearController;
  wallet: ExternalNearWalletId;
};

type ConnectorPanelProps = WalletConnectorMenuProps & {
  prepareAuthMenu: () => void;
  locale: import('@/core/ui/locale').WalletLocale;
};

/** Default wallet selection UI. Authentication stays on the isolated wallet origin. */
export function WalletConnectorMenu(props: WalletConnectorMenuProps) {
  const { seams } = useSeams();
  const { theme, tokens } = useTheme();
  const locale = useWalletLocale();
  return (
    <Theme tag="div" theme={theme} tokens={{ [theme]: tokens }}>
      <ConnectorPanel {...props} locale={locale} prepareAuthMenu={seams.authMenu.prepare} />
    </Theme>
  );
}

class ConnectorPanel extends Component<ConnectorPanelProps, ConnectorPanelState> {
  state: ConnectorPanelState = { view: { kind: 'choices', error: null } };
  private readonly root = createRef<HTMLDivElement>();
  private readonly content = createRef<HTMLDivElement>();
  private readonly heading = createRef<HTMLHeadingElement>();
  private observer: ResizeObserver | null = null;
  private unsubscribe: (() => void) | null = null;
  private pending: PendingConnection | null = null;

  componentDidMount(): void {
    this.subscribe();
    this.observer = new ResizeObserver(this.measure);
    if (this.content.current) this.observer.observe(this.content.current);
    this.measure();
  }

  getSnapshotBeforeUpdate(): number {
    return this.root.current?.offsetHeight ?? 0;
  }

  componentDidUpdate(
    previous: ConnectorPanelProps,
    previousState: ConnectorPanelState,
    previousHeight: number,
  ): void {
    if (previous.externalNear?.controller !== this.props.externalNear?.controller) {
      this.unsubscribe?.();
      this.cancelPending();
      this.subscribe();
    }
    if (previousState.view.kind === 'auth' && this.state.view.kind === 'choices') {
      const root = this.root.current;
      if (root) {
        root.style.height = `${previousHeight}px`;
        root.getBoundingClientRect();
      }
      this.heading.current?.focus({ preventScroll: true });
    }
    this.measure();
  }

  componentWillUnmount(): void {
    this.observer?.disconnect();
    this.unsubscribe?.();
    this.cancelPending();
  }

  private subscribe(): void {
    this.unsubscribe = this.props.externalNear?.controller.subscribe(this.refreshWallets) ?? null;
  }

  private refreshWallets = (): void => {
    if (
      this.pending &&
      !this.pending.controller.getSnapshot().wallets.includes(this.pending.wallet)
    ) {
      this.cancelPending();
    }
    this.forceUpdate();
  };

  private cancelPending(): void {
    const pending = this.pending;
    this.pending = null;
    pending?.controller.disconnect();
  }

  private measure = (): void => {
    const root = this.root.current;
    const content = this.content.current;
    if (!root || !content) return;
    root.style.height = this.state.view.kind === 'auth' ? 'auto' : `${content.offsetHeight}px`;
  };

  private prepare = (): void => {
    this.props.prepareAuthMenu();
  };

  private openAuthMenu = (): void => {
    const root = this.root.current;
    if (this.pending || !root || this.state.view.kind !== 'choices') return;
    this.setState({ view: { kind: 'auth', initialHeightCssPx: root.offsetHeight } });
  };

  private handleOutcome = (outcome: HostedAuthMenuOutcome): void => {
    switch (outcome.kind) {
      case 'cancelled':
        this.setState({ view: { kind: 'choices', error: null } });
        this.props.onClose?.();
        break;
      case 'failed':
        this.setState({ view: { kind: 'choices', error: outcome.message } });
        break;
      case 'authenticated':
      case 'registered':
      case 'account_synced':
        break;
      default:
        return assertNever(outcome);
    }
    this.props.onOutcome(outcome);
  };

  private close = (): void => {
    this.cancelPending();
    if (this.state.view.kind === 'auth') {
      this.setState({ view: { kind: 'choices', error: null } });
    }
    this.props.onClose?.();
  };

  private connect = async (wallet: ExternalNearWalletId): Promise<void> => {
    const external = this.props.externalNear;
    if (!external || this.pending) return;
    const pending = { controller: external.controller, wallet };
    this.pending = pending;
    this.setState({ view: { kind: 'choices', error: null } });
    const result = await external.controller.connect(wallet);
    if (this.pending !== pending) return;
    this.pending = null;
    if (!result.ok) {
      this.setState({ view: { kind: 'choices', error: result.message } });
      return;
    }
    // Closing the menu after success must preserve the app's established connection.
    this.props.externalNear?.onConnected(result.value);
  };

  private renderChoices() {
    const { options, externalNear } = this.props;
    const snapshot = externalNear?.controller.getSnapshot();
    const busy = this.state.view.kind === 'auth' || (snapshot?.busy ?? false);
    const seamsOption = options?.seams;
    const rows: ReactNode[] = [];
    for (const wallet of snapshot?.wallets ?? []) {
      const appearance = options?.[wallet];
      const unavailable = wallet === 'hot' && externalNear?.controller.network !== 'mainnet';
      rows.push(
        <ConnectorOption
          key={wallet}
          label={appearance?.label ?? `Connect ${nearWalletName(wallet)}`}
          description={
            unavailable ? 'Mainnet only' : (appearance?.description ?? 'Use your existing wallet')
          }
          icon={appearance?.icon ?? <WalletIcon width={28} height={28} />}
          disabled={busy || unavailable}
          external
          onClick={this.connect.bind(this, wallet)}
        />,
      );
    }
    return (
      <div className="seams-wallet-connector-choices">
        <h2 ref={this.heading} tabIndex={-1}>
          <WalletText copy={this.props.title ?? 'Connect wallet'} />
        </h2>
        <p>
          <WalletText copy={this.props.description ?? 'Choose how you’d like to get started.'} />
        </p>
        <div className="seams-wallet-connector-options">
          <ConnectorOption
            label={seamsOption?.label ?? 'Create a Seams Wallet'}
            description={seamsOption?.description ?? 'Get started with a passkey'}
            icon={seamsOption?.icon ?? <SeamsConnectorIcon />}
            disabled={busy}
            external={false}
            onClick={this.openAuthMenu}
            onPrepare={this.prepare}
          />
          {rows}
        </div>
        {snapshot?.busy && (
          <p role="status">
            <WalletText message="Complete the request in your wallet." />
          </p>
        )}
        {this.state.view.kind === 'choices' && this.state.view.error && (
          <p className="seams-wallet-connector-error" role="alert">
            {this.state.view.error}
          </p>
        )}
      </div>
    );
  }

  render() {
    let content: ReactNode;
    switch (this.state.view.kind) {
      case 'choices':
        content = this.renderChoices();
        break;
      case 'auth':
        content = (
          <HostedSeamsAuthMenu
            {...this.props.authMenu}
            initialMode={this.props.authMenu?.initialMode ?? 'register'}
            initialHeightCssPx={this.state.view.initialHeightCssPx}
            placeholder={this.renderChoices()}
            onOutcome={this.handleOutcome}
          />
        );
        break;
      default:
        return assertNever(this.state.view);
    }
    return (
      <div
        ref={this.root}
        className={`seams-wallet-connector ${this.props.className ?? ''}`}
        style={this.props.style}
        data-connector-view={this.state.view.kind}
      >
        {this.props.onClose && (
          <button
            type="button"
            className="seams-wallet-connector-close"
            aria-label={walletDisplayText(this.props.locale, this.props.closeLabel ?? 'Close')}
            onClick={this.close}
          >
            <ConnectorArrow kind="close" />
          </button>
        )}
        <div ref={this.content} className="seams-wallet-connector-content">
          {content}
        </div>
      </div>
    );
  }
}

function ConnectorOption(props: {
  label: string;
  description: string;
  icon: ReactNode;
  disabled: boolean;
  external: boolean;
  onClick: () => void;
  onPrepare?: () => void;
}) {
  return (
    <button
      type="button"
      className="seams-wallet-connector-option"
      disabled={props.disabled}
      onClick={props.onClick}
      onPointerEnter={props.onPrepare}
      onFocus={props.onPrepare}
      onTouchStart={props.onPrepare}
    >
      <span className="seams-wallet-connector-icon" aria-hidden="true">
        {props.icon}
      </span>
      <span className="seams-wallet-connector-label">
        <strong>
          <WalletText copy={props.label} />
        </strong>
        <small>
          <WalletText copy={props.description} />
        </small>
      </span>
      <ConnectorArrow kind={props.external ? 'external' : 'forward'} />
    </button>
  );
}

function ConnectorArrow({ kind }: { kind: 'forward' | 'external' | 'close' }) {
  let path: string;
  switch (kind) {
    case 'forward':
      path = 'M5 12h14m-5-5 5 5-5 5';
      break;
    case 'external':
      path = 'M7 17 17 7M7 7h10v10';
      break;
    case 'close':
      path = 'm6 6 12 12M6 18 18 6';
      break;
    default:
      return assertNever(kind);
  }
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

function SeamsConnectorIcon() {
  return (
    <svg width="36" height="36" viewBox="1130 0 300 282" aria-hidden="true" fill="currentColor">
      <path d={SEAMS_STANDARD_WORDMARK_PATH} />
    </svg>
  );
}

function assertNever(value: never): never {
  throw new Error(`Unexpected wallet connector state: ${String(value)}`);
}

import React, { Component } from 'react';
import { createPortal } from 'react-dom';
import { walletText } from '@/core/ui/messages';
import { useWalletLocale } from '../../context/WalletLocale';
import { Theme, useTheme } from '../theme';

type AccountSettingsDialogProps = {
  presentation: 'modal' | 'drawer';
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

type DialogProps = AccountSettingsDialogProps &
  Pick<ReturnType<typeof useTheme>, 'theme' | 'tokens'> & {
    label: string;
  };

type DialogState =
  | { kind: 'closed'; content?: never }
  | { kind: 'open'; content: React.ReactNode }
  | { kind: 'closing'; content: React.ReactNode };

type SettingsDialogState = { dialog: DialogState };

const DRAWER_DURATION_MS = 240;
const DRAWER_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)';

function ignoreCancelledAnimation(): void {}

function assertNever(value: never): never {
  throw new Error(`Unsupported settings dialog state: ${String(value)}`);
}

function isBackdrop(event: React.MouseEvent<HTMLDialogElement>): boolean {
  if (event.target !== event.currentTarget) return false;
  const bounds = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  );
}

class SettingsDialog extends Component<DialogProps, SettingsDialogState> {
  state: SettingsDialogState = { dialog: { kind: 'closed' } };
  private dialog: HTMLDialogElement | null = null;
  private motion: Animation | null = null;
  private startedOutside = false;

  static getDerivedStateFromProps(
    props: DialogProps,
    state: SettingsDialogState,
  ): SettingsDialogState | null {
    if (props.isOpen) return { dialog: { kind: 'open', content: props.children } };
    switch (state.dialog.kind) {
      case 'closed':
        return null;
      case 'open':
        if (props.presentation === 'modal') return { dialog: { kind: 'closed' } };
        return { dialog: { kind: 'closing', content: state.dialog.content } };
      case 'closing':
        return props.presentation === 'modal' ? { dialog: { kind: 'closed' } } : null;
      default:
        return assertNever(state.dialog);
    }
  }

  componentDidMount(): void {
    this.syncDialog('closed', this.props.presentation);
  }

  componentDidUpdate(previousProps: DialogProps, previousState: SettingsDialogState): void {
    this.syncDialog(previousState.dialog.kind, previousProps.presentation);
  }

  componentWillUnmount(): void {
    this.clearMotion();
    this.dialog?.close();
  }

  private setDialog = (dialog: HTMLDialogElement | null): void => {
    if (dialog === this.dialog) return;
    this.clearMotion();
    this.dialog?.close();
    this.dialog = dialog;
  };

  private clearMotion(): void {
    this.motion?.cancel();
    this.motion = null;
  }

  private syncDialog(
    previous: DialogState['kind'],
    presentation: DialogProps['presentation'],
  ): void {
    const dialog = this.dialog;
    if (!dialog) return;
    dialog.inert = this.state.dialog.kind === 'closing';
    if (!dialog.open) dialog.showModal();
    if (this.props.presentation === 'modal') {
      this.clearMotion();
      return;
    }
    if (previous === this.state.dialog.kind && presentation === this.props.presentation) return;
    if (previous === 'closing' && this.state.dialog.kind === 'open') {
      dialog
        .querySelector<HTMLButtonElement>('.seams-account-close')
        ?.focus({ preventScroll: true });
    }
    this.animateDrawer(previous === 'closed' || presentation !== this.props.presentation);
  }

  private animateDrawer(entering: boolean): void {
    const dialog = this.dialog;
    if (!dialog) return;
    const computed = getComputedStyle(dialog);
    const offset = computed.getPropertyValue('--seams-account-drawer-offset').trim();
    const from = entering ? offset : computed.transform;
    this.clearMotion();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (this.state.dialog.kind === 'closing') this.setState({ dialog: { kind: 'closed' } });
      return;
    }
    const to = this.state.dialog.kind === 'closing' ? offset : 'none';
    const animation = dialog.animate([{ transform: from }, { transform: to }], {
      duration: DRAWER_DURATION_MS,
      easing: DRAWER_EASING,
      fill: 'both',
    });
    this.motion = animation;
    void animation.finished.then(this.finishMotion.bind(this, animation), ignoreCancelledAnimation);
  }

  private finishMotion(animation: Animation): void {
    if (this.motion !== animation) return;
    if (this.state.dialog.kind === 'closing') {
      this.setState({ dialog: { kind: 'closed' } });
      return;
    }
    this.clearMotion();
  }

  private requestClose = (): void => {
    if (this.state.dialog.kind === 'open') this.props.onClose();
  };

  private rememberBackdrop = (event: React.PointerEvent<HTMLDialogElement>): void => {
    this.startedOutside = isBackdrop(event);
  };

  private closeBackdrop = (event: React.MouseEvent<HTMLDialogElement>): void => {
    const shouldClose = this.startedOutside && isBackdrop(event);
    this.startedOutside = false;
    if (!shouldClose) return;
    event.stopPropagation();
    this.requestClose();
  };

  private cancelDialog = (event: React.SyntheticEvent<HTMLDialogElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    this.requestClose();
  };

  render(): React.JSX.Element | null {
    if (this.state.dialog.kind === 'closed' || typeof document === 'undefined') return null;
    return createPortal(
      <Theme tag="div" theme={this.props.theme} tokens={{ [this.props.theme]: this.props.tokens }}>
        <dialog
          ref={this.setDialog}
          data-seams-root=""
          data-presentation={this.props.presentation}
          data-state={this.state.dialog.kind}
          className="seams-account-dialog"
          aria-label={this.props.label}
          onCancel={this.cancelDialog}
          onPointerDown={this.rememberBackdrop}
          onClick={this.closeBackdrop}
        >
          {this.state.dialog.content}
        </dialog>
      </Theme>,
      document.body,
    );
  }
}

export function AccountSettingsDialog(props: AccountSettingsDialogProps) {
  const locale = useWalletLocale();
  const { theme, tokens } = useTheme();
  return (
    <SettingsDialog
      presentation={props.presentation}
      isOpen={props.isOpen}
      onClose={props.onClose}
      theme={theme}
      tokens={tokens}
      label={walletText(locale, 'Wallet settings')}
    >
      {props.children}
    </SettingsDialog>
  );
}

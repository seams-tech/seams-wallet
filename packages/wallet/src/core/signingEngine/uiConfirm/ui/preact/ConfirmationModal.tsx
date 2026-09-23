/** @jsxImportSource preact */
import { Component, createRef, type ComponentChildren } from 'preact';

export type ConfirmationModalProps = {
  context: 'standalone' | 'wallet-iframe';
  label: string;
  onCancel: () => void;
  children: ComponentChildren;
};

let nextModalId = 0;

export function ConfirmationModal(props: ConfirmationModalProps) {
  return <ModalShell key={props.context} {...props} />;
}

class ModalShell extends Component<ConfirmationModalProps> {
  private readonly dialog = createRef<HTMLDialogElement>();
  private readonly hosted = createRef<HTMLDivElement>();
  private readonly containerId = `seams-confirmation-modal-${++nextModalId}`;

  componentDidMount(): void {
    if (this.props.context === 'standalone') {
      this.dialog.current?.showModal();
    } else {
      this.hosted.current?.focus({ preventScroll: true });
    }
  }

  componentWillUnmount(): void {
    // Native close releases document inertness and restores the opener's focus.
    this.dialog.current?.close();
  }

  private cancel = (event: Event): void => {
    // The controller owns two-phase close; a cancel intent leaves the UI mounted.
    event.preventDefault();
    event.stopPropagation();
    this.props.onCancel();
  };

  private backdropClick = (event: MouseEvent): void => {
    const dialog = this.dialog.current;
    if (!dialog || event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    ) {
      this.cancel(event);
    }
  };

  private hostedKeyDown = (event: KeyboardEvent): void => {
    if (!event.defaultPrevented && event.key === 'Escape') this.cancel(event);
  };

  render() {
    if (this.props.context === 'standalone') {
      return (
        <dialog
          ref={this.dialog}
          class="seams-confirmation-modal"
          aria-label={this.props.label}
          onCancel={this.cancel}
          onClick={this.backdropClick}
        >
          <div id={this.containerId} class="modal-container-root">
            {this.props.children}
          </div>
        </dialog>
      );
    }
    return (
      <div
        ref={this.hosted}
        class="seams-confirmation-modal seams-confirmation-modal--hosted"
        tabIndex={-1}
        onKeyDown={this.hostedKeyDown}
      >
        <div id={this.containerId} class="modal-container-root">
          {this.props.children}
        </div>
      </div>
    );
  }
}

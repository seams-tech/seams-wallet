/** @jsxImportSource preact */
import { render } from 'preact';
import type { AppearanceConfig } from '@/core/types/seams';
import type { CspStylesheetManager } from '@/core/browser/walletIframe/csp-stylesheet';
import { confirmationDocumentStyles } from './confirmation-styles';
import { appearanceTokenCssRule } from '../appearance-token-vars';
import { ConfirmationContent, type ConfirmationContentModel } from './ConfirmationContent';
import { ConfirmationModal } from './ConfirmationModal';
import { ConfirmationDrawer } from './ConfirmationDrawer';
import { TransactionReceipt } from './TransactionReceipt';
import { receiptIsPending, type TransactionReceiptModel } from '../transaction-receipt';

export { normalizeConfirmationModel } from '../confirmation-model';

export type ConfirmSurfaceModel = {
  appearance: AppearanceConfig;
  content: ConfirmationContentModel;
};

export type ConfirmationSurfaceHandle = {
  readonly element: HTMLElement;
  update(model: ConfirmSurfaceModel): void;
  showReceipt(model: TransactionReceiptModel): void;
  close(): void;
  dispose(): void;
};

type MountConfirmationInput = {
  parent: HTMLElement;
  presentation: {
    variant: 'modal' | 'drawer';
    context: 'standalone' | 'wallet-iframe';
  };
  model: ConfirmSurfaceModel;
  onClosed: () => void;
};

type SurfaceState =
  | { kind: 'mounted' | 'closing'; model: ConfirmSurfaceModel; onClosed: () => void }
  | { kind: 'disposed'; model?: never; onClosed?: never };

let nextSurfaceId = 0;

class MountedConfirmationSurface implements ConfirmationSurfaceHandle {
  readonly element: HTMLElement;
  private readonly styles: CspStylesheetManager;
  private readonly presentation: MountConfirmationInput['presentation'];
  private state: SurfaceState;
  private receipt: TransactionReceiptModel | null = null;

  constructor(input: MountConfirmationInput) {
    const document = input.parent.ownerDocument;
    this.styles = confirmationDocumentStyles(document);
    this.presentation = {
      variant: input.presentation.variant,
      context: input.presentation.context,
    };
    this.state = { kind: 'mounted', model: input.model, onClosed: input.onClosed };
    this.element = document.createElement('div');
    this.element.id = `seams-confirmation-surface-${++nextSurfaceId}`;
    this.element.className = 'seams-wallet-ui seams-confirmation-surface';
    this.element.dataset.seamsConfirmSurface = input.presentation.context;
    this.element.dataset.seamsConfirmVariant = input.presentation.variant;
    this.element.addEventListener('cancel', this.cancel);
    input.parent.appendChild(this.element);
    try {
      this.update(input.model);
    } catch (error) {
      this.remove();
      throw error;
    }
  }

  update(model: ConfirmSurfaceModel): void {
    if (this.state.kind !== 'mounted') return;
    this.state.model = model;
    this.element.dataset.confirmationKind = model.content.kind;
    this.element.dataset.theme = model.appearance.theme.mode;
    this.styles.setDynamicRule(
      this.element.id,
      appearanceTokenCssRule(this.element.id, model.appearance),
    );
    this.renderSurface();
  }

  close(): void {
    if (this.state.kind !== 'mounted') return;
    this.state = { kind: 'closing', model: this.state.model, onClosed: this.state.onClosed };
    if (this.presentation.variant === 'modal') this.dispose();
    else this.renderSurface();
  }

  showReceipt(model: TransactionReceiptModel): void {
    if (this.state.kind !== 'mounted' || this.state.model.content.kind !== 'transaction') return;
    const viewChanged = this.receipt?.view !== model.view;
    this.receipt = model;
    this.element.dataset.receiptView = model.view;
    this.element.dataset.seamsConfirmSurface = 'wallet-iframe';
    this.element.dataset.seamsConfirmVariant = 'modal';
    this.renderSurface();
    if (viewChanged && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.element.querySelector('.seams-transaction-receipt, .seams-transaction-toast')?.animate(
        [{ opacity: 0 }, { opacity: 1 }], { duration: 180, delay: 140, fill: 'backwards', easing: 'ease-out' },
      );
    }
  }

  dispose = (): void => {
    if (this.state.kind === 'disposed') return;
    const onClosed = this.state.onClosed;
    this.remove();
    onClosed();
  };

  private remove(): void {
    this.state = { kind: 'disposed' };
    this.element.removeEventListener('cancel', this.cancel);
    render(null, this.element);
    this.styles.deleteDynamicRule(this.element.id);
    this.element.remove();
  }

  private cancel = (): void => {
    if (this.state.kind !== 'mounted') return;
    if (this.receipt) {
      if (receiptIsPending(this.receipt.state)) this.receipt.onView('toast');
      else this.receipt.onDismiss();
      return;
    }
    const content = this.state.model.content;
    if (content.kind === 'registration') content.registration.onCancel();
    else content.transaction.onCancel();
  };

  private confirm = (): void => {
    if (this.state.kind !== 'mounted') return;
    const content = this.state.model.content;
    const decision =
      content.kind === 'registration'
        ? content.registration.decision
        : content.transaction.decision;
    if (decision.kind === 'ready') decision.onConfirm();
  };

  private submitOtp = (code: string, challengeId: string): void => {
    if (this.state.kind !== 'mounted') return;
    const content = this.state.model.content;
    if (content.kind === 'transaction' && content.prompt.kind === 'email') {
      content.prompt.email.onSubmit(code, challengeId);
    }
  };

  private renderSurface(): void {
    const state = this.state;
    if (state.kind === 'disposed') return;
    const source = state.model.content;
    const model = this.contentModel(source, state.kind === 'closing');
    const content = this.receipt && source.kind === 'transaction' ? (
      <TransactionReceipt
        receipt={this.receipt}
        data={source.review}
        explorers={source.transaction.explorers}
      />
    ) : (
      <ConfirmationContent
        model={model}
        styles={this.styles}
        variant={this.presentation.variant}
      />
    );
    const label =
      source.kind === 'registration' ? source.registration.heading : source.header.heading;
    if (this.receipt || this.presentation.variant === 'modal') {
      render(
        <ConfirmationModal context={this.receipt ? 'wallet-iframe' : this.presentation.context} label={label} onCancel={this.cancel}>
          {content}
        </ConfirmationModal>,
        this.element,
      );
      return;
    }
    const decision =
      source.kind === 'registration' ? source.registration.decision : source.transaction.decision;
    render(
      <ConfirmationDrawer
        context={this.presentation.context}
        label={label}
        errorMessage={
          source.kind === 'registration'
            ? source.registration.errorMessage
            : source.transaction.errorMessage
        }
        styles={this.styles}
        state={
          state.kind === 'closing'
            ? { kind: 'closing', onClosed: this.dispose }
            : { kind: 'open', interaction: decision.kind === 'ready' ? 'ready' : 'busy' }
        }
        onCancel={this.cancel}
      >
        {content}
      </ConfirmationDrawer>,
      this.element,
    );
  }

  private contentModel(
    source: ConfirmationContentModel,
    closing: boolean,
  ): ConfirmationContentModel {
    switch (source.kind) {
      case 'registration':
        return {
          kind: 'registration',
          registration: {
            ...source.registration,
            decision:
              !closing && source.registration.decision.kind === 'ready'
                ? { kind: 'ready', onConfirm: this.confirm }
                : { kind: 'creating' },
            onCancel: this.cancel,
          },
        };
      case 'transaction':
        return {
          kind: 'transaction',
          header: source.header,
          body: source.body,
          review: source.review,
          prompt:
            source.prompt.kind === 'email'
              ? {
                  kind: 'email',
                  email: {
                    prompt: source.prompt.email.prompt,
                    verification: closing ? { kind: 'pending' } : source.prompt.email.verification,
                    onSubmit: this.submitOtp,
                  },
                }
              : source.prompt,
          transaction: {
            ...source.transaction,
            decision:
              !closing && source.transaction.decision.kind === 'ready'
                ? { kind: 'ready', onConfirm: this.confirm }
                : { kind: 'preparing' },
            onCancel: this.cancel,
          },
        };
      default:
        return assertNever(source);
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected confirmation content: ${String(value)}`);
}

export function mountConfirmationSurface(input: MountConfirmationInput): ConfirmationSurfaceHandle {
  return new MountedConfirmationSurface(input);
}

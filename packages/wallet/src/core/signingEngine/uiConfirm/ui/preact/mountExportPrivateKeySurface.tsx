/** @jsxImportSource preact */
import { render } from 'preact';
import type { AppearanceConfig } from '@/core/types/seams';
import { WalletIframeDomEvents } from '@/core/browser/walletIframe/events';
import type { CspStylesheetManager } from '@/core/browser/walletIframe/csp-stylesheet';
import { confirmationDocumentStyles } from './confirmation-styles';
import { appearanceTokenCssRule } from '../appearance-token-vars';
import { ConfirmationModal } from './ConfirmationModal';
import { ConfirmationDrawer } from './ConfirmationDrawer';
import { ExportPrivateKeySurface, type ExportPrivateKeyViewModel } from './ExportPrivateKeySurface';

export type ExportSurfaceModel = {
  variant: 'modal' | 'drawer';
  appearance: AppearanceConfig;
  content: ExportPrivateKeyViewModel;
};

type MountExportInput = {
  parent: HTMLElement;
  context: 'standalone' | 'wallet-iframe';
  model: ExportSurfaceModel;
  onClosed: () => void;
};

export type ExportSurfaceHandle = {
  readonly element: HTMLElement;
  update(model: ExportSurfaceModel): void;
  dispose(): void;
};

type ExportSurfaceState =
  | { kind: 'mounted'; onClosed: () => void }
  | { kind: 'disposed'; onClosed?: never };

let nextExportId = 0;

class MountedExportSurface implements ExportSurfaceHandle {
  readonly element: HTMLElement;
  private readonly styles: CspStylesheetManager;
  private readonly context: MountExportInput['context'];
  private state: ExportSurfaceState;

  constructor(input: MountExportInput) {
    this.styles = confirmationDocumentStyles(input.parent.ownerDocument);
    this.context = input.context;
    this.state = { kind: 'mounted', onClosed: input.onClosed };
    this.element = input.parent.ownerDocument.createElement('div');
    this.element.id = `seams-export-surface-${++nextExportId}`;
    this.element.className = 'seams-wallet-ui seams-export-surface';
    this.element.dataset.seamsExportSurface = input.context;
    this.element.addEventListener(WalletIframeDomEvents.TX_CONFIRMER_CANCEL, this.handleCancel);
    input.parent.appendChild(this.element);
    try {
      this.update(input.model);
    } catch (error) {
      this.remove();
      throw error;
    }
  }

  update(model: ExportSurfaceModel): void {
    if (this.state.kind === 'disposed') return;
    this.element.dataset.theme = model.appearance.theme.mode;
    this.element.dataset.seamsExportVariant = model.variant;
    this.styles.setDynamicRule(
      this.element.id,
      appearanceTokenCssRule(this.element.id, model.appearance),
    );
    if (model.variant === 'modal') {
      render(
        <ConfirmationModal context={this.context} label="Exported Keys" onCancel={this.dispose}>
          <button
            type="button"
            class="seams-export-modal-close"
            aria-label="Close exported keys"
            onClick={this.dispose}
          >
            ×
          </button>
          <ExportPrivateKeySurface model={model.content} />
        </ConfirmationModal>,
        this.element,
      );
      return;
    }
    render(
      <ConfirmationDrawer
        context={this.context}
        label="Exported Keys"
        dismissOnBackdrop={false}
        styles={this.styles}
        state={{ kind: 'open', interaction: 'ready' }}
        onCancel={this.dispose}
      >
        <ExportPrivateKeySurface model={model.content} />
      </ConfirmationDrawer>,
      this.element,
    );
  }

  dispose = (): void => {
    if (this.state.kind === 'disposed') return;
    const onClosed = this.state.onClosed;
    this.remove();
    onClosed();
  };

  private handleCancel = (): void => {
    this.dispose();
  };

  private remove(): void {
    this.state = { kind: 'disposed' };
    this.element.removeEventListener(WalletIframeDomEvents.TX_CONFIRMER_CANCEL, this.handleCancel);
    render(null, this.element);
    this.styles.deleteDynamicRule(this.element.id);
    this.element.remove();
  }
}

export function mountExportPrivateKeySurface(input: MountExportInput): ExportSurfaceHandle {
  return new MountedExportSurface(input);
}

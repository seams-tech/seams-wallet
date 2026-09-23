/** @jsxImportSource preact */
import { Component, createRef, type ComponentChildren } from 'preact';
import type { CspStylesheetManager } from '@/core/browser/walletIframe/csp-stylesheet';
import type { TreeNode } from '../transaction-display/tree';
import {
  createSurfaceHeightReflow,
  CONFIRM_SURFACE_HEIGHT_DRIVEN_VAR,
  type SurfaceHeightReflow,
} from '../confirm-surface-resize';
import { TransactionTree } from './TransactionTree';
import type { ExplorerUrls } from './TransactionLabel';

export type ConfirmContentDecision =
  | { kind: 'preparing'; onConfirm?: never; formId?: never }
  | { kind: 'ready'; onConfirm: () => void; formId?: never }
  | { kind: 'form'; formId: string; onConfirm?: never };

export type ConfirmContentProps = {
  tree: TreeNode | null;
  theme: 'light' | 'dark';
  explorers: ExplorerUrls;
  styles: CspStylesheetManager;
  decision: ConfirmContentDecision;
  confirmText: string;
  cancelText: string;
  cancelInHeader?: boolean;
  confirmIcon?: ComponentChildren;
  errorMessage?: string;
  onCancel: () => void;
  onBack?: () => void;
  onTreeToggle?: (nodeId: string, open: boolean) => void;
  onCopy?: (value: string) => void;
};

let nextContentId = 0;

function stopDragStart(event: Event): void {
  event.stopPropagation();
}

export class ConfirmContent extends Component<ConfirmContentProps, { armed: boolean }> {
  state = { armed: false };
  private readonly id = `seams-confirm-content-${++nextContentId}`;
  private readonly root = createRef<HTMLDivElement>();
  private readonly reflow: SurfaceHeightReflow;
  private frame: number | null = null;
  private capturedBeforeUpdate = false;
  private reflowEnabled = true;

  constructor(props: ConfirmContentProps) {
    super(props);
    this.reflow = createSurfaceHeightReflow({
      reason: 'tx-body',
      element: this.getReflowElement,
      setHeightCssPx: this.setHeight,
    });
  }

  private getReflowElement = (): HTMLElement | null => {
    const root = this.root.current;
    return root?.closest<HTMLElement>('.modal-container-root, .seams-confirmation-drawer') ?? root;
  };

  private setHeight = (height: number): void => {
    const element = this.getReflowElement();
    const selector = element?.id ? `#${element.id}` : `#${this.id}`;
    this.props.styles.setDynamicDeclarations(this.id, selector, {
      [CONFIRM_SURFACE_HEIGHT_DRIVEN_VAR]: `${height}px`,
    });
  };

  componentDidMount(): void {
    this.reflowEnabled = this.getReflowElement() === this.root.current;
    this.frame = this.root.current!.ownerDocument.defaultView!.requestAnimationFrame(
      this.afterFirstPaint,
    );
  }

  private afterFirstPaint = (): void => {
    this.frame = this.root.current!.ownerDocument.defaultView!.requestAnimationFrame(this.arm);
  };

  private arm = (): void => {
    this.frame = null;
    this.setState({ armed: true });
  };

  componentWillReceiveProps(): void {
    if (!this.reflowEnabled) return;
    this.reflow.capture();
    this.capturedBeforeUpdate = true;
  }

  componentWillUpdate(): void {
    if (!this.reflowEnabled) return;
    if (this.capturedBeforeUpdate) return;
    this.reflow.capture();
  }

  componentDidUpdate(previous: ConfirmContentProps): void {
    if (!this.reflowEnabled) return;
    this.capturedBeforeUpdate = false;
    if (previous.styles !== this.props.styles) previous.styles.deleteDynamicRule(this.id);
    this.reflow.commit();
  }

  componentWillUnmount(): void {
    if (this.frame !== null)
      this.root.current?.ownerDocument.defaultView?.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.reflow.dispose();
    this.props.styles.deleteDynamicRule(this.id);
  }

  private confirm = (): void => {
    if (this.state.armed && this.props.decision.kind === 'ready') this.props.decision.onConfirm();
  };

  private cancel = (): void => {
    this.props.onCancel();
  };

  render(): ComponentChildren {
    const preparing = this.props.decision.kind === 'preparing';
    return (
      <div
        class="seams-tx-confirm-content"
        onPointerDown={stopDragStart}
        onMouseDown={stopDragStart}
        onTouchStart={stopDragStart}
      >
        <div id={this.id} ref={this.root} class="txc-root">
          {this.props.errorMessage && (
            <div class="error" role="alert">
              {this.props.errorMessage}
            </div>
          )}
          {this.props.tree && (
            <div class="tooltip-width">
              <TransactionTree
                node={this.props.tree}
                theme={this.props.theme}
                explorers={this.props.explorers}
                styles={this.props.styles}
                showShadow={false}
                onToggle={this.props.onTreeToggle}
                onCopy={this.props.onCopy}
              />
            </div>
          )}
          <div class="actions">
            {!this.props.cancelInHeader && (
              <button type="button" class="cancel" onClick={this.cancel}>
                {this.props.cancelText}
              </button>
            )}
            <button
              type={this.props.decision.kind === 'form' ? 'submit' : 'button'}
              form={this.props.decision.kind === 'form' ? this.props.decision.formId : undefined}
              class={`confirm${preparing ? ' loading' : ''}`}
              onClick={this.confirm}
              disabled={preparing || !this.state.armed}
            >
              {preparing ? (
                <>
                  <span class="loading-indicator" role="progressbar" aria-label="Loading" />
                  <span>Loading...</span>
                </>
              ) : (
                <>
                  {this.props.confirmIcon}
                  {this.props.confirmText}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

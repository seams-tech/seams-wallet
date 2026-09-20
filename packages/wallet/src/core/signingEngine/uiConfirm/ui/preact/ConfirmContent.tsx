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
  errorMessage?: string;
  onCancel: () => void;
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

  constructor(props: ConfirmContentProps) {
    super(props);
    this.reflow = createSurfaceHeightReflow({
      reason: 'tx-body',
      element: this.getRoot,
      setHeightCssPx: this.setHeight,
    });
  }

  private getRoot = (): HTMLElement | null => this.root.current;

  private setHeight = (height: number): void => {
    this.props.styles.setDynamicDeclarations(this.id, `#${this.id}`, {
      [CONFIRM_SURFACE_HEIGHT_DRIVEN_VAR]: `${height}px`,
    });
  };

  componentDidMount(): void {
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

  getSnapshotBeforeUpdate(): null {
    this.reflow.capture();
    return null;
  }

  componentDidUpdate(previous: ConfirmContentProps): void {
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
          {this.props.errorMessage && <div class="error">{this.props.errorMessage}</div>}
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
            <button type="button" class="cancel" onClick={this.cancel}>
              {this.props.cancelText}
            </button>
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
                this.props.confirmText
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

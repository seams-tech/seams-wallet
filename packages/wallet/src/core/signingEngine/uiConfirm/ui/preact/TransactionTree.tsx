/** @jsxImportSource preact */
import { Component, createRef, type ComponentChildren } from 'preact';
import type { CspStylesheetManager } from '@/core/browser/walletIframe/csp-stylesheet';
import type { TreeNode } from '../transaction-display/tree';
import { announceClampedSurfaceResize } from '../confirm-surface-resize';
import { TransactionLabel, transactionLabelTitle, type ExplorerUrls } from './TransactionLabel';
import { copySurfaceText } from './clipboard';

type TreeInteractions = {
  styles: CspStylesheetManager;
  explorers: ExplorerUrls;
  onToggle?: (nodeId: string, open: boolean) => void;
  onCopy?: (value: string) => void;
};

export type TransactionTreeProps = TreeInteractions & {
  node: TreeNode;
  theme: 'light' | 'dark';
  showShadow: boolean;
};

type NodeProps = TreeInteractions & { node: TreeNode; depth: number };
type NodeState = { mode: 'decoded' | 'raw'; copied: boolean };
const drivenClasses = ['anim-h', 'anim-h-active', 'anim-h-driven'];
const motionClasses = [...drivenClasses, 'anim-h-hold'];
let nextNodeId = 0;

function Chevron() {
  return (
    <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M6 3l5 5-5 5z" />
    </svg>
  );
}

function hasContentVariants(node: TreeNode): boolean {
  return (
    !!node.contentVariants?.decoded &&
    !!node.contentVariants.raw &&
    node.contentVariants.decoded !== node.contentVariants.raw
  );
}

function renderChild(interactions: TreeInteractions, depth: number, node: TreeNode) {
  return (
    <TransactionNode
      key={node.id}
      node={node}
      depth={depth}
      styles={interactions.styles}
      explorers={interactions.explorers}
      onToggle={interactions.onToggle}
      onCopy={interactions.onCopy}
    />
  );
}

export function TransactionTree(props: TransactionTreeProps): ComponentChildren {
  if (!props.node.children?.length) return null;
  const content = (
    <div class="tooltip-tree-root">
      <div class="tooltip-tree-children">
        {props.node.children.map(renderChild.bind(null, props, 1))}
      </div>
    </div>
  );
  return (
    <div class="seams-tx-tree" data-theme={props.theme}>
      {props.showShadow ? <div class="tooltip-border-outer">{content}</div> : content}
    </div>
  );
}

class TransactionNode extends Component<NodeProps, NodeState> {
  state: NodeState = {
    mode: this.props.node.contentVariants?.defaultMode === 'raw' ? 'raw' : 'decoded',
    copied: false,
  };
  private readonly id = `seams-tree-node-${++nextNodeId}`;
  private readonly details = createRef<HTMLDetailsElement>();
  private readonly shell = createRef<HTMLDivElement>();
  private disposed = false;
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;
  private frame: number | null = null;
  private motionTimer: ReturnType<typeof setTimeout> | null = null;
  private motion: { body: HTMLElement; open: boolean } | null = null;
  private modeHeight: number | null = null;

  componentDidUpdate(previous: NodeProps): void {
    if (previous.styles !== this.props.styles) previous.styles.deleteDynamicRule(this.id);
    if (this.modeHeight !== null && this.shell.current) {
      const shell = this.shell.current;
      const fromCssPx = this.modeHeight;
      this.modeHeight = null;
      shell.classList.remove(...drivenClasses);
      const toCssPx = shell.getBoundingClientRect().height;
      shell.classList.add(...drivenClasses);
      const claimed = announceClampedSurfaceResize({
        reason: `${this.props.node.id}:file-content-mode`,
        element: shell,
        drivenClasses,
        fromCssPx,
        toCssPx,
        setHeightCssPx: this.setHeight,
        onSettled: this.releaseHeight,
      });
      if (!claimed) {
        shell.classList.remove(...drivenClasses);
        this.releaseHeight();
      }
    }
  }

  componentWillUnmount(): void {
    this.disposed = true;
    if (this.copiedTimer !== null) clearTimeout(this.copiedTimer);
    if (this.motionTimer !== null) clearTimeout(this.motionTimer);
    if (this.frame !== null)
      this.details.current?.ownerDocument.defaultView?.cancelAnimationFrame(this.frame);
    this.motion?.body.removeEventListener('transitionend', this.onTransitionEnd);
    this.motion = null;
    this.releaseHeight();
  }

  private setHeight = (height: number): void => {
    if (this.disposed) return;
    this.props.styles.setDynamicDeclarations(this.id, `#${this.id}`, {
      '--seams-tree__anim-target': `${height}px`,
    });
  };

  private releaseHeight = (): void => {
    this.props.styles.deleteDynamicRule(this.id);
  };

  private clearCopied = (): void => {
    this.copiedTimer = null;
    if (!this.disposed) this.setState({ copied: false });
  };

  private copy = async (event: MouseEvent): Promise<void> => {
    event.preventDefault();
    event.stopPropagation();
    const value = this.props.node.copyValue;
    if (!value) return;
    const root = (event.currentTarget as HTMLElement).closest('.seams-tx-tree');
    if (!root) return;
    try {
      if (!(await copySurfaceText(root, value))) return;
      if (this.disposed) return;
      if (this.copiedTimer !== null) clearTimeout(this.copiedTimer);
      this.setState({ copied: true });
      this.copiedTimer = setTimeout(this.clearCopied, 2000);
      this.props.onCopy?.(value);
    } catch {
      // Clipboard rejection leaves the control available for another attempt.
    }
  };

  private toggleMode = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (!hasContentVariants(this.props.node)) return;
    if (this.shell.current) {
      this.modeHeight = this.shell.current.getBoundingClientRect().height;
      this.setHeight(this.modeHeight);
      this.shell.current.classList.add(...drivenClasses);
    }
    this.setState({ mode: this.state.mode === 'decoded' ? 'raw' : 'decoded' });
  };

  private toggle = (event: MouseEvent): void => {
    const target = event.target as Element;
    if (target.closest('a, button')) {
      event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const details = this.details.current;
    if (!details || this.motion) return;
    const body = details.querySelector<HTMLElement>(':scope > .folder-children');
    const open = !details.open;
    const reduced = details.ownerDocument.defaultView!.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (!body || reduced) {
      details.open = open;
      this.props.onToggle?.(this.props.node.id, open);
      return;
    }
    this.motion = { body, open };
    const height = open ? 0 : body.getBoundingClientRect().height;
    this.setHeight(height);
    body.classList.add('anim-h', 'anim-h-active', 'anim-h-hold');
    details.open = true;
    void body.offsetHeight;
    this.frame = details.ownerDocument.defaultView!.requestAnimationFrame(this.startMotion);
  };

  private startMotion = (): void => {
    this.frame = null;
    if (!this.motion || this.disposed) return;
    const { body, open } = this.motion;
    const fromCssPx = body.getBoundingClientRect().height;
    const toCssPx = open ? body.scrollHeight : 0;
    const claimed = announceClampedSurfaceResize({
      reason: this.props.node.id,
      element: body,
      drivenClasses,
      fromCssPx,
      toCssPx,
      setHeightCssPx: this.setHeight,
      onSettled: this.finishMotion,
    });
    if (claimed) return;
    body.addEventListener('transitionend', this.onTransitionEnd);
    body.classList.remove('anim-h-hold');
    this.setHeight(toCssPx);
    this.motionTimer = setTimeout(this.finishMotion, open ? 200 : 250);
  };

  private onTransitionEnd = (event: TransitionEvent): void => {
    if (event.target === this.motion?.body && event.propertyName === 'height') this.finishMotion();
  };

  private finishMotion = (): void => {
    if (this.disposed || !this.motion) return;
    const { body, open } = this.motion;
    this.motion = null;
    if (this.motionTimer !== null) clearTimeout(this.motionTimer);
    this.motionTimer = null;
    body.removeEventListener('transitionend', this.onTransitionEnd);
    body.classList.remove(...motionClasses);
    if (this.details.current) this.details.current.open = open;
    this.releaseHeight();
    this.props.onToggle?.(this.props.node.id, open);
  };

  private label(chevron: boolean): ComponentChildren {
    const node = this.props.node;
    return (
      <span
        class={`label${node.type === 'file' ? ' label-action-node' : ''}`}
        hidden={node.hideLabel}
      >
        {chevron && !node.hideChevron && <Chevron />}
        <span class="label-text" title={transactionLabelTitle(node)}>
          <TransactionLabel node={node} explorers={this.props.explorers} />
        </span>
        {node.type === 'file' && node.copyValue && (
          <button
            type="button"
            class="copy-badge"
            data-copied={String(this.state.copied)}
            onClick={this.copy}
            title={this.state.copied ? 'Copied' : 'Copy'}
          >
            {this.state.copied ? 'copied' : 'copy'}
          </button>
        )}
      </span>
    );
  }

  render(): ComponentChildren {
    const { node, depth } = this.props;
    const rowClass = `row summary-row depth-${Math.max(0, depth - 1)}`;
    if (node.type === 'file' && !node.content) {
      return (
        <div
          id={this.id}
          class={`row file-row depth-${Math.max(0, depth - 1)}`}
          data-no-elbow={String(!!node.hideLabel)}
        >
          <span class="indent" />
          {this.label(false)}
        </div>
      );
    }
    const variants = hasContentVariants(node);
    const content =
      variants && node.contentVariants ? node.contentVariants[this.state.mode] : node.content;
    const toggleLabel = this.state.mode === 'decoded' ? 'bytes' : 'decoded';
    return (
      <details
        id={this.id}
        ref={this.details}
        class={`tree-node ${node.type}`}
        open={!!node.open}
        data-node-id={node.id}
      >
        <summary class={rowClass} data-no-elbow={String(!!node.hideLabel)} onClick={this.toggle}>
          <span class="indent" />
          {this.label(true)}
          {node.type === 'file' && (
            <div ref={this.shell} class={`file-content-shell${variants ? ' has-mode-toggle' : ''}`}>
              {variants && (
                <button
                  type="button"
                  class="file-content-mode-toggle"
                  title={`Show ${toggleLabel}`}
                  aria-label={`Show ${toggleLabel}`}
                  onClick={this.toggleMode}
                >
                  {toggleLabel}
                </button>
              )}
              <div class="file-content">{content}</div>
            </div>
          )}
        </summary>
        {node.type === 'folder' && !!node.children?.length && (
          <div class="folder-children">
            {node.children.map(renderChild.bind(null, this.props, depth + 1))}
          </div>
        )}
      </details>
    );
  }
}

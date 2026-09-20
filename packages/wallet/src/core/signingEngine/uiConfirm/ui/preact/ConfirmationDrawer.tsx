/** @jsxImportSource preact */
import { Component, createRef, type ComponentChildren } from 'preact';
import type { CspStylesheetManager } from '@/core/browser/walletIframe/csp-stylesheet';
import { drawerDragTranslate, shouldDismissDrawerDrag } from '../drawer-gesture';

type DrawerState =
  | { kind: 'open'; interaction: 'ready' | 'busy'; onClosed?: never }
  | { kind: 'closing'; interaction?: never; onClosed: () => void };

export type ConfirmationDrawerProps = {
  context: 'standalone' | 'wallet-iframe';
  label: string;
  errorMessage?: string;
  dismissOnBackdrop?: boolean;
  state: DrawerState;
  styles: CspStylesheetManager;
  onCancel: () => void;
  children: ComponentChildren;
};

type Gesture =
  | { kind: 'idle' }
  | { kind: 'pending'; pointerId: number; startY: number }
  | {
      kind: 'dragging';
      pointerId: number;
      startY: number;
      lastY: number;
      startedAt: number;
      lastTime: number;
      velocity: number;
      rest: number;
      translate: number;
      height: number;
    };

let nextDrawerId = 0;

export function ConfirmationDrawer(props: ConfirmationDrawerProps) {
  return <DrawerShell key={props.context} {...props} />;
}

class DrawerShell extends Component<ConfirmationDrawerProps, { settled: boolean }> {
  state = { settled: false };
  private readonly id = `seams-confirmation-drawer-${++nextDrawerId}`;
  private readonly dialog = createRef<HTMLDialogElement>();
  private readonly sheet = createRef<HTMLElement>();
  private readonly body = createRef<HTMLDivElement>();
  private readonly content = createRef<HTMLDivElement>();
  private observer: ResizeObserver | null = null;
  private frame: number | null = null;
  private closeTimer: number | null = null;
  private gesture: Gesture = { kind: 'idle' };
  private lifetime: 'active' | 'disposed' = 'active';
  private closeReported = false;
  private suppressPointerClick = false;

  componentDidMount(): void {
    const sheet = this.sheet.current!;
    const win = sheet.ownerDocument.defaultView!;
    this.dialog.current?.showModal();
    if (!this.dialog.current) sheet.focus({ preventScroll: true });
    this.observer = new ResizeObserver(this.scheduleMeasure);
    this.observer.observe(this.content.current!);
    this.observer.observe(sheet);
    win.addEventListener('resize', this.scheduleMeasure);
    win.visualViewport?.addEventListener('resize', this.scheduleMeasure);
    this.measure();
    this.frame = win.requestAnimationFrame(this.openAfterLayout);
    if (this.props.state.kind === 'closing') this.startClose();
  }

  private openAfterLayout = (): void => {
    this.frame = null;
    this.setState({ settled: true });
  };

  componentDidUpdate(previous: ConfirmationDrawerProps): void {
    if (previous.styles !== this.props.styles) {
      previous.styles.deleteDynamicRule(this.id);
      previous.styles.deleteDynamicRule(`${this.id}-drag`);
      this.resetGesture();
      this.measure();
    }
    if (previous.state.kind !== this.props.state.kind) {
      if (this.props.state.kind === 'closing') this.startClose();
      else {
        this.clearCloseTimer();
        this.closeReported = false;
      }
    }
    if (this.props.state.kind === 'open' && this.props.state.interaction === 'busy') {
      this.resetGesture();
    }
  }

  componentWillUnmount(): void {
    this.lifetime = 'disposed';
    this.resetGesture();
    const win = this.sheet.current!.ownerDocument.defaultView!;
    if (this.frame !== null) win.cancelAnimationFrame(this.frame);
    this.clearCloseTimer();
    this.observer?.disconnect();
    win.removeEventListener('resize', this.scheduleMeasure);
    win.visualViewport?.removeEventListener('resize', this.scheduleMeasure);
    this.props.styles.deleteDynamicRule(this.id);
    this.dialog.current?.close();
  }

  private scheduleMeasure = (): void => {
    if (this.lifetime === 'disposed' || this.frame !== null) return;
    this.frame = this.sheet.current!.ownerDocument.defaultView!.requestAnimationFrame(
      this.measureFrame,
    );
  };

  private measureFrame = (): void => {
    this.frame = null;
    this.measure();
  };

  private measure(): void {
    if (this.gesture.kind !== 'idle') return;
    const sheet = this.sheet.current!;
    const content = this.content.current!;
    const contentBottom = Math.round(
      content.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top,
    );
    const rest =
      this.props.context === 'standalone' ? Math.max(0, sheet.offsetHeight - contentBottom) : 0;
    this.props.styles.setDynamicDeclarations(this.id, `#${this.id}`, {
      '--seams-drawer-rest': `${rest}px`,
    });
  }

  private startClose(): void {
    this.resetGesture();
    this.clearCloseTimer();
    // Completion must also work when reduced motion or interrupted layout prevents transitionend.
    const win = this.sheet.current!.ownerDocument.defaultView!;
    const delay = win.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150;
    this.closeTimer = win.setTimeout(this.reportClosed, delay);
  }

  private clearCloseTimer(): void {
    if (this.closeTimer !== null) {
      this.sheet.current!.ownerDocument.defaultView!.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  private reportClosed = (): void => {
    this.clearCloseTimer();
    if (this.lifetime === 'disposed' || this.closeReported || this.props.state.kind !== 'closing')
      return;
    this.closeReported = true;
    this.props.state.onClosed();
  };

  private transitionEnd = (event: TransitionEvent): void => {
    if (event.target === this.sheet.current && event.propertyName === 'transform')
      this.reportClosed();
  };

  private cancel = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    if (this.props.state.kind === 'open') this.props.onCancel();
  };

  private backdropClick = (event: MouseEvent): void => {
    if (
      this.props.dismissOnBackdrop !== false &&
      event.target === this.dialog.current &&
      this.canDrag()
    )
      this.cancel(event);
  };

  private keyDown = (event: KeyboardEvent): void => {
    if (!event.defaultPrevented && event.key === 'Escape') this.cancel(event);
  };

  private canDrag(): boolean {
    return this.props.state.kind === 'open' && this.props.state.interaction === 'ready';
  }

  private pointerDown = (event: PointerEvent): void => {
    this.clearClickSuppression();
    if (!this.canDrag() || this.gesture.kind !== 'idle' || !event.isPrimary || event.button !== 0)
      return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        'a, input, textarea, select, summary, button:not(.seams-drawer-handle), [data-seams-drawer-no-drag]',
      )
    )
      return;
    this.gesture = { kind: 'pending', pointerId: event.pointerId, startY: event.clientY };
    const doc = this.sheet.current!.ownerDocument;
    doc.addEventListener('pointermove', this.pointerMove, { passive: false });
    doc.addEventListener('pointerup', this.pointerUp);
    doc.addEventListener('pointercancel', this.pointerCancel);
  };

  private pointerMove = (event: PointerEvent): void => {
    let gesture = this.gesture;
    if (gesture.kind === 'idle' || gesture.pointerId !== event.pointerId) return;
    const sheet = this.sheet.current!;
    if (gesture.kind === 'pending') {
      if (Math.abs(event.clientY - gesture.startY) < 8 || this.body.current!.scrollTop > 0) return;
      const win = sheet.ownerDocument.defaultView!;
      const rest = new DOMMatrixReadOnly(win.getComputedStyle(sheet).transform).m42;
      gesture = {
        kind: 'dragging',
        pointerId: gesture.pointerId,
        startY: gesture.startY,
        lastY: gesture.startY,
        startedAt: event.timeStamp,
        lastTime: event.timeStamp,
        velocity: 0,
        rest,
        translate: rest,
        height: sheet.offsetHeight,
      };
      this.gesture = gesture;
      sheet.setPointerCapture(event.pointerId);
      sheet.classList.add('is-dragging');
    }
    const elapsed = event.timeStamp - gesture.lastTime;
    if (elapsed > 0) gesture.velocity = (event.clientY - gesture.lastY) / elapsed;
    gesture.lastY = event.clientY;
    gesture.lastTime = event.timeStamp;
    gesture.translate = drawerDragTranslate({
      startTranslatePx: gesture.rest,
      deltaPx: event.clientY - gesture.startY,
      restTranslatePx: gesture.rest,
      sheetHeightPx: gesture.height,
      viewportHeightPx: sheet.ownerDocument.defaultView!.innerHeight,
      minimumOverpullPx: 160,
    });
    this.props.styles.setDynamicDeclarations(`${this.id}-drag`, `#${this.id}`, {
      '--seams-drawer-drag': `${gesture.translate}px`,
    });
    event.preventDefault();
  };

  private pointerUp = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (gesture.kind === 'idle' || gesture.pointerId !== event.pointerId) return;
    const dismiss =
      gesture.kind === 'dragging' &&
      shouldDismissDrawerDrag({
        velocityPxPerMs: gesture.velocity,
        totalDeltaPx: gesture.lastY - gesture.startY,
        durationMs: event.timeStamp - gesture.startedAt,
        translatePx: gesture.translate,
        sheetHeightPx: gesture.height,
      });
    if (gesture.kind === 'dragging') {
      this.suppressPointerClick = true;
      event.preventDefault();
    }
    this.resetGesture();
    if (dismiss && this.props.state.kind === 'open') this.props.onCancel();
  };

  private pointerCancel = (event: PointerEvent): void => {
    if (this.gesture.kind !== 'idle' && this.gesture.pointerId === event.pointerId) {
      if (this.gesture.kind === 'dragging') this.suppressPointerClick = true;
      this.resetGesture();
    }
  };

  private clearClickSuppression = (): void => {
    this.suppressPointerClick = false;
  };

  private suppressDragClick = (event: MouseEvent): void => {
    if (!this.suppressPointerClick || event.detail === 0) return;
    this.suppressPointerClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  private resetGesture(): void {
    const sheet = this.sheet.current!;
    const previous = this.gesture;
    this.gesture = { kind: 'idle' };
    if (previous.kind !== 'idle' && sheet.hasPointerCapture(previous.pointerId))
      sheet.releasePointerCapture(previous.pointerId);
    sheet.classList.remove('is-dragging');
    const doc = sheet.ownerDocument;
    doc.removeEventListener('pointermove', this.pointerMove);
    doc.removeEventListener('pointerup', this.pointerUp);
    doc.removeEventListener('pointercancel', this.pointerCancel);
    this.props.styles.deleteDynamicRule(`${this.id}-drag`);
    if (this.lifetime === 'active') this.scheduleMeasure();
  }

  render() {
    const open = this.state.settled && this.props.state.kind === 'open';
    const classes = ['seams-confirmation-drawer'];
    if (open) classes.push('is-open');
    if (this.gesture.kind === 'dragging') classes.push('is-dragging');
    const sheet = (
      <section
        ref={this.sheet}
        id={this.id}
        class={classes.join(' ')}
        data-context={this.props.context}
        tabIndex={-1}
        onPointerDownCapture={this.pointerDown}
        onClickCapture={this.suppressDragClick}
        onLostPointerCapture={this.pointerCancel}
        onTransitionEnd={this.transitionEnd}
        onKeyDown={this.keyDown}
      >
        <div class="seams-drawer-controls">
          <button
            type="button"
            class="seams-drawer-handle"
            aria-label="Dismiss confirmation"
            disabled={!this.canDrag()}
            onClick={this.cancel}
          >
            <span />
          </button>
          <button
            type="button"
            class="seams-drawer-close"
            aria-label="Close"
            disabled={!this.canDrag()}
            onClick={this.cancel}
          >
            ×
          </button>
        </div>
        <div class="seams-drawer-body" ref={this.body}>
          {this.props.errorMessage && <div class="error">{this.props.errorMessage}</div>}
          <div class="seams-drawer-content" ref={this.content}>
            {this.props.children}
          </div>
        </div>
      </section>
    );
    if (this.props.context === 'wallet-iframe') return sheet;
    return (
      <dialog
        class="seams-drawer-dialog"
        ref={this.dialog}
        aria-label={this.props.label}
        onCancel={this.cancel}
        onClick={this.backdropClick}
        onClickCapture={this.suppressDragClick}
        onPointerDownCapture={this.clearClickSuppression}
      >
        {sheet}
      </dialog>
    );
  }
}

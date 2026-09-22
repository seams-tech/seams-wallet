/** @jsxImportSource preact */
import { Component, createRef, type ComponentChildren } from 'preact';
import { announceClampedSurfaceResize } from '../confirm-surface-resize';
import { confirmationDocumentStyles } from './confirmation-styles';

let nextDisclosureId = 0;

export class ReviewDisclosure extends Component<{ label: string; children: ComponentChildren; initiallyOpen?: boolean }> {
  private readonly root = createRef<HTMLDetailsElement>();
  private readonly id = `seams-review-disclosure-${++nextDisclosureId}`;
  componentDidMount(): void {
    if (this.root.current) this.root.current.open = this.props.initiallyOpen ?? false;
  }
  private motion: { kind: 'local'; opening: boolean; size: Animation; fade: Animation } | { kind: 'hosted'; opening: boolean } | null = null;

  componentWillUnmount(): void {
    this.clearMotion();
    if (this.root.current) confirmationDocumentStyles(this.root.current.ownerDocument).deleteDynamicRule(this.id);
  }

  private clearMotion(): void {
    if (!this.motion) return;
    if (this.motion.kind === 'local') {
      this.motion.size.onfinish = null;
      this.motion.size.cancel();
      this.motion.fade.cancel();
    }
    this.motion = null;
    this.root.current?.removeAttribute('data-resizing');
  }

  private setHeight = (height: number): void => {
    const details = this.root.current;
    if (!details) return;
    confirmationDocumentStyles(details.ownerDocument).setDynamicDeclarations(this.id, `#${this.id}`, { '--seams-review-disclosure-height': `${height}px` });
  };

  private finish = (): void => {
    if (this.root.current && this.motion) {
      this.root.current.open = this.motion.opening;
      this.root.current.removeAttribute('data-closing');
    }
    this.clearMotion();
  };

  private toggle = (event: MouseEvent): void => {
    const details = this.root.current;
    if (!details) return;
    event.preventDefault();
    if (this.motion?.kind === 'hosted') return;
    const opening = this.motion ? !this.motion.opening : !details.open;
    const body = details.lastElementChild;
    if (!(body instanceof HTMLElement)) return;
    const height = details.open ? body.getBoundingClientRect().height : 0;
    this.clearMotion();
    details.toggleAttribute('data-closing', !opening);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !details.animate) {
      details.open = opening;
      details.removeAttribute('data-closing');
      return;
    }
    details.open = true;
    details.setAttribute('data-resizing', '');
    const target = opening ? body.scrollHeight : 0;
    this.motion = { kind: 'hosted', opening };
    if (announceClampedSurfaceResize({ element: body, reason: 'review-details', fromCssPx: height, toCssPx: target,
      drivenClasses: ['seams-review-disclosure-driven'], setHeightCssPx: this.setHeight, onSettled: this.finish })) return;
    const size = body.animate([{ height: `${height}px`, overflow: 'hidden' }, { height: `${target}px`, overflow: 'hidden' }], {
      duration: opening ? 220 : 180, easing: 'cubic-bezier(.2,0,0,1)', fill: 'both',
    });
    const fade = body.animate(opening ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], {
      duration: opening ? 180 : 100, easing: 'ease-out', fill: 'both',
    });
    this.motion = { kind: 'local', opening, size, fade };
    size.onfinish = this.finish;
  };

  render() {
    return <details ref={this.root} class="seams-review-technical">
      <summary onClick={this.toggle}>{this.props.label}<svg class="seams-review-caret" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg></summary>
      <div id={this.id}>{this.props.children}</div>
    </details>;
  }
}

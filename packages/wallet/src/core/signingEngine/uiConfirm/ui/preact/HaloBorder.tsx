/** @jsxImportSource preact */
import { Component, createRef, type ComponentChildren } from 'preact';
import type { CspStylesheetManager } from '@/core/browser/walletIframe/csp-stylesheet';

type HaloBorderProps = {
  animated: boolean;
  styles: CspStylesheetManager;
  children: ComponentChildren;
  durationMs?: number;
  innerPadding?: string;
};

let nextHaloId = 0;

export class HaloBorder extends Component<HaloBorderProps> {
  private readonly id = `seams-halo-${++nextHaloId}`;
  private readonly element = createRef<HTMLDivElement>();
  private motion: MediaQueryList | null = null;
  private frame: number | null = null;
  private startedAt: number | null = null;
  private angle: string | null = null;

  componentDidMount(): void {
    this.motion = this.element.current!.ownerDocument.defaultView!.matchMedia(
      '(prefers-reduced-motion: no-preference)',
    );
    this.motion.addEventListener('change', this.updateAnimation);
    this.syncDynamicStyles();
    this.updateAnimation();
  }

  componentDidUpdate(previous: HaloBorderProps): void {
    if (previous.styles !== this.props.styles) previous.styles.deleteDynamicRule(this.id);
    if (previous.innerPadding !== this.props.innerPadding) this.syncDynamicStyles();
    if (
      previous.animated !== this.props.animated ||
      previous.durationMs !== this.props.durationMs ||
      previous.styles !== this.props.styles
    ) {
      this.updateAnimation();
    }
  }

  componentWillUnmount(): void {
    this.cancelFrame();
    this.motion?.removeEventListener('change', this.updateAnimation);
    this.motion = null;
    this.props.styles.deleteDynamicRule(this.id);
  }

  private cancelFrame(): void {
    const window = this.element.current?.ownerDocument.defaultView;
    if (this.frame !== null) window?.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.startedAt = null;
  }

  private updateAnimation = (): void => {
    this.cancelFrame();
    this.angle = null;
    this.syncDynamicStyles();
    if (this.props.animated && this.motion?.matches) {
      this.frame = this.element.current!.ownerDocument.defaultView!.requestAnimationFrame(
        this.tick,
      );
    }
  };

  private tick = (timestamp: number): void => {
    if (!this.element.current || !this.props.animated || !this.motion?.matches) return;
    this.startedAt ??= timestamp;
    const configuredDuration = this.props.durationMs;
    const duration =
      configuredDuration && Number.isFinite(configuredDuration) && configuredDuration > 0
        ? configuredDuration
        : 1150;
    const angle = (((timestamp - this.startedAt) % duration) / duration) * 360;
    this.angle = `${angle}deg`;
    this.syncDynamicStyles();
    this.frame = this.element.current.ownerDocument.defaultView!.requestAnimationFrame(this.tick);
  };

  private syncDynamicStyles(): void {
    const declarations: Record<string, string> = {};
    if (this.props.innerPadding) declarations['--inner-padding'] = this.props.innerPadding;
    if (this.angle) declarations['--halo-angle'] = this.angle;
    if (Object.keys(declarations).length === 0) {
      this.props.styles.deleteDynamicRule(this.id);
      return;
    }
    this.props.styles.setDynamicDeclarations(this.id, `#${this.id}`, declarations);
  }

  render(): ComponentChildren {
    return (
      <div id={this.id} ref={this.element} class="seams-halo-border">
        <div class={`halo-root${this.props.animated ? ' animated' : ''}`}>
          <div class="halo-inner">
            <div class="halo-outer">
              {this.props.animated && <div class="halo-ring" aria-hidden="true" />}
              <div class="halo-content">{this.props.children}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

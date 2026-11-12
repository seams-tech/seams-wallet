/* An anchored Wallet card paints from the wallet iframe's <body>-level <dialog> over an element
   that the app places in its own layout (the anchor). The anchor reserves the card's space, and
   the app hears the card's size and readiness through events, so it can show the card as one
   step of its own dialog.

   The anchor also carries two internal details that earlier apps read: the card's height as
   --seams-auth-menu-height, and data-seams-auth-menu-ready once the card is painted. */

import {
  anchorWalletIframeModalGeometry,
  type WalletIframeModalGeometry,
} from './surface/geometry';
import {
  WALLET_STEP_TRANSITION_LIMIT_MS,
  walletStepExitForDismissal,
  walletStepTransitionTimes,
  type WalletStepChrome,
  type WalletStepControl,
  type WalletStepEvents,
  type WalletStepExit,
  type WalletStepSize,
  type WalletStepTransition,
  type WalletStepTransitionTimes,
  type WalletStepProgress,
  type WalletSurfaceControl,
} from '../shared/walletStep';
import { asRecord } from '@shared/utils/validation';
import type { HostedAuthMenuOutcome } from '../shared/messages';

const ANCHOR_HEIGHT_CSS_VAR = '--seams-auth-menu-height';
const PLACEHOLDER_OPACITY_CSS_VAR = '--seams-auth-menu-placeholder-opacity';
const READY_ATTRIBUTE = 'data-seams-auth-menu-ready';

/**
 * `page`: the card paints in the page's own stacking order, as page content does.
 * `top`: the card paints in the browser's top layer, above all app content, and the rest of the
 * page is inert while it shows.
 */
export type AnchoredSurfaceLayer = 'page' | 'top';

export type AnchoredSurfaceOptions = WalletStepEvents &
  Readonly<{
    anchor: HTMLElement;
    layer: AnchoredSurfaceLayer;
    chrome: WalletStepChrome;
    /** The card draws Minimize, and a press hides it until `restore`. */
    minimize?: boolean;
    transition?: WalletStepTransition;
    /**
     * Checks on every frame whether the whole card is in view and uncovered, and reports each
     * change to the Wallet host, which holds the card's controls until then.
     */
    view?: Readonly<{ check: () => boolean; report: (unobstructed: boolean) => void }>;
  }>;

/** How a request of an anchored card settled. */
export type AnchoredSurfaceSettlement =
  | Readonly<{ kind: 'result'; result: unknown }>
  | Readonly<{ kind: 'error'; error: unknown }>;

// Result kinds of the card's flows that report a failure rather than a finished job.
const FAILED_RESULT_KINDS = new Set([
  'failed',
  'refused',
  'unavailable',
  'not_submitted',
  'submission_unknown',
  'reverted',
  'unresolved',
]);

function isCancellation(error: unknown): boolean {
  return asRecord(error)?.code === 'cancelled';
}

/**
 * The events, layer and transition times of an anchored card. The call gives the anchor and the
 * chrome.
 */
export type AnchoredSurfaceStep = WalletStepEvents &
  Readonly<{ layer?: AnchoredSurfaceLayer; transition?: WalletStepTransition }>;

export type AnchoredSurfaceMetrics = {
  topCssPx: number;
  leftCssPx: number;
  layoutWidthCssPx: number;
  heightCssPx: number;
  visualScale: number;
};

/** The anchor's viewport rect and zoom. A zero height is valid: the card brings its own. */
export function anchoredSurfaceMetrics(
  anchor: HTMLElement | undefined,
): AnchoredSurfaceMetrics | null {
  if (!anchor?.isConnected) return null;
  const rect = anchor.getBoundingClientRect();
  const layoutWidthCssPx = anchor.offsetWidth;
  if (
    !Number.isFinite(rect.top) ||
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height < 0 ||
    !Number.isFinite(layoutWidthCssPx) ||
    layoutWidthCssPx <= 0
  ) {
    return null;
  }
  return {
    topCssPx: rect.top,
    leftCssPx: rect.left,
    layoutWidthCssPx,
    heightCssPx: rect.height,
    visualScale: rect.width / layoutWidthCssPx,
  };
}

/** Reserves the card's height in the app's layout. */
export function publishAnchoredSurfaceHeight(anchor: HTMLElement, heightCssPx: number): void {
  if (!anchor.isConnected || !Number.isFinite(heightCssPx) || heightCssPx <= 0) return;
  const next = `${Math.round(heightCssPx)}px`;
  // Writing an unchanged value would still dirty layout, and this runs on every frame.
  if (anchor.style.getPropertyValue(ANCHOR_HEIGHT_CSS_VAR) === next) return;
  anchor.style.setProperty(ANCHOR_HEIGHT_CSS_VAR, next);
}

/** A new card waits behind the anchor's placeholder. */
export function resetAnchoredSurfaceAnchor(anchor: HTMLElement): void {
  anchor.style.setProperty(PLACEHOLDER_OPACITY_CSS_VAR, '1');
  anchor.removeAttribute(READY_ATTRIBUTE);
}

/** The card ended: it is gone, the placeholder stays hidden and the height stays reserved. */
export function endAnchoredSurfaceAnchor(anchor: HTMLElement): void {
  anchor.style.setProperty(PLACEHOLDER_OPACITY_CSS_VAR, '0');
  anchor.removeAttribute(READY_ATTRIBUTE);
}

function markAnchorReady(anchor: HTMLElement): void {
  anchor.style.setProperty(PLACEHOLDER_OPACITY_CSS_VAR, '0');
  anchor.setAttribute(READY_ATTRIBUTE, 'true');
}

function sameSize(left: WalletStepSize | null, right: WalletStepSize): boolean {
  return left?.width === right.width && left?.height === right.height;
}

/** The anchor's place in document coordinates, which a page scroll does not change. */
function anchorPositionKey(anchor: HTMLElement): string {
  if (!anchor.isConnected) return 'detached';
  const rect = anchor.getBoundingClientRect();
  const visual = window.visualViewport;
  return [
    rect.top + window.scrollY,
    rect.left + window.scrollX,
    rect.width,
    rect.height,
    visual?.offsetTop ?? 0,
    visual?.offsetLeft ?? 0,
    visual?.scale ?? 1,
  ].join(',');
}

/** How an auth-menu card ended, for its step events. */
export function authMenuStepExit(
  outcome: HostedAuthMenuOutcome,
  anchored: AnchoredSurface,
): WalletStepExit {
  switch (outcome.kind) {
    case 'cancelled':
      return outcome.reason === 'close_button' ? anchored.dismissalExit() : { kind: 'cancelled' };
    case 'failed':
      return { kind: 'failed' };
    default:
      return { kind: 'completed' };
  }
}

function pageScrollOffsetCssPx(axis: 'x' | 'y'): number {
  const value = axis === 'x' ? window.scrollX : window.scrollY;
  return Number.isFinite(value) ? value : 0;
}

/**
 * An anchored dialog is position:absolute, so it takes DOCUMENT coordinates. Scrolling then
 * moves it with the page on the compositor thread (no fixed-position lag), and because anchor
 * viewport movement and the scroll offset cancel out, scroll events re-derive identical geometry
 * and the render pipeline short-circuits.
 */
export function documentCoordinateGeometry(
  geometry: WalletIframeModalGeometry,
): WalletIframeModalGeometry {
  return {
    ...geometry,
    topCssPx: Math.round(geometry.topCssPx + pageScrollOffsetCssPx('y')),
    leftCssPx: Math.round(geometry.leftCssPx + pageScrollOffsetCssPx('x')),
  };
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** An app callback cannot interrupt the card. */
function notify<T>(callback: ((value: T) => void) | undefined, value: T): void {
  try {
    callback?.(value);
  } catch (error) {
    console.error('[SEAMS] An anchored Wallet card event handler failed', error);
  }
}

type AnchoredSurfacePhase =
  | { readonly kind: 'loading' }
  /** onEnter ran: the app places the anchor, and then the card shows. */
  | { readonly kind: 'entering' }
  | { readonly kind: 'shown' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'exited' };

/**
 * One anchored card. It follows the anchor on every frame while it shows, so a dialog that moves
 * or animates (a transform, a transition, a resize) carries the card with it.
 */
export class AnchoredSurface {
  private phase: AnchoredSurfacePhase = { kind: 'loading' };
  private size: WalletStepSize | null = null;
  private frame: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private position = '';
  private unobstructed: boolean | null = null;
  private dismissedInCard = false;
  /** The chrome control that the person pressed, as the Wallet host reported it. */
  private pressed: WalletStepControl | null = null;
  /** The person pressed Minimize: the card is hidden, and its request goes on. */
  private hidden = false;
  /** How long the card waits and fades. The overlay runs the fades. */
  readonly transition: WalletStepTransitionTimes;

  constructor(
    readonly options: AnchoredSurfaceOptions,
    private readonly render: () => void,
  ) {
    this.transition = walletStepTransitionTimes(options.transition);
    resetAnchoredSurfaceAnchor(options.anchor);
  }

  get anchor(): HTMLElement {
    return this.options.anchor;
  }

  /** The card stays hidden until it has a size and the app has placed the anchor for it. */
  get revealed(): boolean {
    return this.phase.kind === 'shown' || this.phase.kind === 'ready';
  }

  get measuredHeightCssPx(): number | null {
    return this.size?.height ?? null;
  }

  /** Starts following the anchor. */
  start(): void {
    if (this.phase.kind === 'exited' || this.frame !== null) return;
    this.frame = requestAnimationFrame(this.track);
  }

  /** A trusted measurement of the card, before the router renders it. */
  measured(size: WalletStepSize): void {
    if (this.phase.kind === 'exited') return;
    const previous = this.size;
    this.size = size;
    if (this.phase.kind === 'loading') {
      this.phase = { kind: 'entering' };
      publishAnchoredSurfaceHeight(this.anchor, size.height);
      notify(this.options.onEnter, size);
      // The app has at least one frame to place the anchor before the card shows.
      const showNextFrame = (): void => {
        this.timer = null;
        requestAnimationFrame(this.reveal);
      };
      const wait = prefersReducedMotion() ? 0 : this.transition.enterDelayMs;
      if (wait > 0) this.timer = setTimeout(showNextFrame, wait);
      else showNextFrame();
      return;
    }
    if (!sameSize(previous, size)) notify(this.options.onResize, size);
  }

  /**
   * The dialog geometry of the card: the anchor's place, the card's own height. Null when the
   * anchor has no layout box.
   */
  place(
    resolved: WalletIframeModalGeometry,
  ): { geometry: WalletIframeModalGeometry; visualScale: number } | null {
    let metrics = anchoredSurfaceMetrics(this.anchor);
    if (!metrics) return null;
    // The anchored card is inline content, so the visual viewport never sizes it:
    // browser zoom shrinks the viewport's CSS px, and deriving height (or taking the
    // small_visual_viewport fallback) from it made the card reflow under zoom while
    // the rest of the page just scaled. Height comes from the child's own measurement.
    // Before the measurement the hidden dialog covers whatever the anchor reserves
    // itself: a guessed height would move the app's layout twice. The card stays
    // hidden until the app has had a frame to place the anchor.
    const measured = this.revealed ? this.measuredHeightCssPx : null;
    const heightCssPx =
      measured ?? (metrics.heightCssPx > 0 ? metrics.heightCssPx : resolved.heightCssPx);
    const base: WalletIframeModalGeometry =
      resolved.kind === 'viewport_fallback' || measured == null
        ? {
            kind: measured != null ? 'centered_modal' : 'provisional_centered_modal',
            widthCssPx: resolved.widthCssPx,
            heightCssPx,
            topCssPx: resolved.topCssPx,
            leftCssPx: resolved.leftCssPx,
          }
        : { ...resolved, heightCssPx };
    // The card paints from a <body>-level dialog, so it reserves no layout space of
    // its own. Publish its height to the anchor, which does sit in the page flow, so
    // following content is pushed down instead of being covered.
    //
    // Reserve BEFORE re-measuring. Hosts commonly centre the block containing the
    // anchor, so changing the reserved height moves the anchor's top; if the geometry
    // were derived from the pre-reflow rect, the dialog would change its height now
    // and its top on a later tick, reading as two separate movements instead of one
    // in-place resize. Height does not depend on the anchor, so this settles in one pass.
    if (measured != null) publishAnchoredSurfaceHeight(this.anchor, measured);
    metrics = anchoredSurfaceMetrics(this.anchor) ?? metrics;
    return {
      geometry: anchorWalletIframeModalGeometry(base, {
        topCssPx: metrics.topCssPx,
        leftCssPx: metrics.leftCssPx,
        widthCssPx: metrics.layoutWidthCssPx,
        heightCssPx: base.heightCssPx,
      }),
      visualScale: metrics.visualScale,
    };
  }

  /** The person ended the card with its own Back, Close or cancel control. */
  dismissed(): void {
    this.dismissedInCard = true;
  }

  /** The card is minimized: the overlay hides it, and the page is not inert. */
  get minimized(): boolean {
    return this.hidden;
  }

  /**
   * The Wallet host reports a control of the card: Back or Close that the person pressed, before
   * the card ends, Minimize that the person pressed, or the card's ask to show again.
   */
  controlPressed(control: WalletSurfaceControl): void {
    if (control === 'minimize') this.minimize();
    else if (control === 'restore') this.restore();
    else this.pressed = control;
  }

  /** The Wallet host reports the stage of a card with Minimize. */
  progressed(progress: WalletStepProgress): void {
    if (this.exited || this.options.minimize !== true) return;
    notify(this.options.onProgress, progress);
  }

  private minimize(): void {
    if (this.exited || this.options.minimize !== true || this.hidden) return;
    this.hidden = true;
    this.render();
    notify(this.options.onMinimize, this.restore);
  }

  /**
   * Shows the minimized card again. The app hears it first, so it can show its dialog around
   * the card before the card fades in over it.
   */
  readonly restore = (): void => {
    if (this.exited || !this.hidden) return;
    this.hidden = false;
    notify(this.options.onRestore, undefined);
    this.render();
  };

  /** How a card that the person dismissed ended: Back or Close. */
  dismissalExit(): WalletStepExit {
    return walletStepExitForDismissal(this.options.chrome, this.pressed);
  }

  /** How the card ended, from its request's settlement. It carries no approval data. */
  exitFor(settlement: AnchoredSurfaceSettlement): WalletStepExit {
    if (this.dismissedInCard) return this.dismissalExit();
    if (settlement.kind === 'error') {
      return { kind: isCancellation(settlement.error) ? 'cancelled' : 'failed' };
    }
    const result = asRecord(settlement.result);
    if (result?.kind === 'cancelled') return this.dismissalExit();
    if (result?.success === false || FAILED_RESULT_KINDS.has(String(result?.kind))) {
      return { kind: 'failed' };
    }
    return { kind: 'completed' };
  }

  /** The router painted the revealed card at the anchor. */
  painted(): void {
    if (this.revealed) markAnchorReady(this.anchor);
  }

  /**
   * The card ended. Back and Close run now. onExit runs in the first frame after `gone`, when
   * the overlay has faded the card out and hidden it.
   */
  finish(exit: WalletStepExit, gone: Promise<void>): void {
    if (this.phase.kind === 'exited') return;
    this.phase = { kind: 'exited' };
    this.stop();
    endAnchoredSurfaceAnchor(this.anchor);
    if (exit.kind === 'back') notify(this.options.onBack, undefined);
    if (exit.kind === 'closed') notify(this.options.onClose, undefined);
    const onExit = (): void => notify(this.options.onExit, exit);
    // A card that some other surface keeps on screen still ends for the app within a second.
    const limit = new Promise<void>((resolve) =>
      setTimeout(resolve, WALLET_STEP_TRANSITION_LIMIT_MS),
    );
    void Promise.race([gone, limit]).then(() => requestAnimationFrame(onExit));
  }

  private readonly reveal = (): void => {
    if (this.phase.kind !== 'entering') return;
    this.phase = { kind: 'shown' };
    this.render();
    const ready = this.ready;
    this.timer = setTimeout(
      requestAnimationFrame.bind(null, ready),
      prefersReducedMotion() ? 0 : this.transition.fadeInMs,
    );
  };

  private readonly ready = (): void => {
    this.timer = null;
    if (this.phase.kind !== 'shown') return;
    this.phase = { kind: 'ready' };
    notify(this.options.onReady, undefined);
  };

  private readonly track = (): void => {
    this.frame = null;
    if (this.phase.kind === 'exited') return;
    const position = anchorPositionKey(this.anchor);
    if (position !== this.position) {
      this.position = position;
      // A render can end the card, when the anchor has left the document.
      this.render();
    }
    this.checkView();
    if (!this.exited) this.frame = requestAnimationFrame(this.track);
  };

  private checkView(): void {
    const view = this.options.view;
    if (!view || this.exited) return;
    const unobstructed = this.revealed && view.check();
    if (unobstructed === this.unobstructed) return;
    this.unobstructed = unobstructed;
    view.report(unobstructed);
  }

  private get exited(): boolean {
    return this.phase.kind === 'exited';
  }

  private stop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

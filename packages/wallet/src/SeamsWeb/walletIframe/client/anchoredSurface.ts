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
import type {
  WalletStepChrome,
  WalletStepEvents,
  WalletStepExit,
  WalletStepSize,
} from '../shared/walletStep';

const ANCHOR_HEIGHT_CSS_VAR = '--seams-auth-menu-height';
const PLACEHOLDER_OPACITY_CSS_VAR = '--seams-auth-menu-placeholder-opacity';
const READY_ATTRIBUTE = 'data-seams-auth-menu-ready';

/** How long an anchored card fades in after its first size, and out after it ends. */
export const ANCHORED_SURFACE_FADE_MS = 150;

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
  }>;

/** The events and layer of an anchored card. The call gives the anchor and the chrome. */
export type AnchoredSurfaceStep = WalletStepEvents & Readonly<{ layer?: AnchoredSurfaceLayer }>;

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
  /** onEnter ran: the app has one frame to place the anchor before the card shows. */
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

  constructor(
    readonly options: AnchoredSurfaceOptions,
    private readonly render: () => void,
  ) {
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
      requestAnimationFrame(this.reveal);
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

  /** The router painted the revealed card at the anchor. */
  painted(): void {
    if (this.revealed) markAnchorReady(this.anchor);
  }

  /** The card ended. Back and Close run now; onExit runs when the card has faded out. */
  finish(exit: WalletStepExit): void {
    if (this.phase.kind === 'exited') return;
    const shown = this.revealed;
    this.phase = { kind: 'exited' };
    this.stop();
    endAnchoredSurfaceAnchor(this.anchor);
    if (exit.kind === 'back') notify(this.options.onBack, undefined);
    if (exit.kind === 'closed') notify(this.options.onClose, undefined);
    const onExit = (): void => notify(this.options.onExit, exit);
    // The overlay hides the dialog when its fade finishes; the frame after that has no card.
    if (shown && !prefersReducedMotion()) {
      setTimeout(requestAnimationFrame.bind(null, onExit), ANCHORED_SURFACE_FADE_MS);
    } else queueMicrotask(onExit);
  }

  private readonly reveal = (): void => {
    if (this.phase.kind !== 'entering') return;
    this.phase = { kind: 'shown' };
    this.render();
    const ready = this.ready;
    this.timer = setTimeout(
      requestAnimationFrame.bind(null, ready),
      prefersReducedMotion() ? 0 : ANCHORED_SURFACE_FADE_MS,
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
    if (!this.exited) this.frame = requestAnimationFrame(this.track);
  };

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

import type { AppearanceConfigInput } from '@/core/types/seams';
import type { HostedAuthMenuSessionId } from '../../shared/messages';
import type { TransactionReviewRect } from '../../shared/transactionReview';
import type { RequestSurfaceIdentity } from '../surface/domain';
import {
  walletIframeSurfaceGeometryEqual,
  type WalletIframeSurfaceGeometry,
} from '../surface/geometry';
import type { WalletIframeSurfaceRenderMode } from '../surface/renderer';
import {
  WALLET_CARD_RESIZE_EASING,
  WALLET_CARD_RESIZE_MS,
  walletStepTransitionTimes,
  type WalletStepTransitionTimes,
} from '../../shared/walletStep';
import {
  clearDialogGeometry,
  setTransactionReviewAppearance,
  clearTransactionReviewAppearance,
  ensureOverlayDialog,
  OverlayStyleClasses,
  setDialogGeometry,
  setDialogAnchored,
  setDialogPresentation,
  setHidden,
  setVisible,
  pinDialogIframe,
  releaseDialogIframe,
} from './overlay-styles';

type OverlayRenderMode = WalletIframeSurfaceRenderMode;

type OverlayDismissReason = 'backdrop' | 'escape';

type OverlayDismissEvent = {
  identity: RequestSurfaceIdentity;
  authMenuSessionId?: HostedAuthMenuSessionId;
  reason: OverlayDismissReason;
  generation: number;
};

export type OverlayControllerState = {
  visible: boolean;
  mode: 'hidden' | 'compact_modal' | 'bottom_drawer' | 'viewport_fallback';
  dialogOpen: boolean;
  generation: number;
};

type PointerCapture = {
  pointerId: number;
  generation: number;
};

type OverlayControllerOptions = {
  ensureIframe: (mountParent?: HTMLElement) => HTMLIFrameElement;
  onDismiss?: (event: OverlayDismissEvent) => void | Promise<void>;
};

type ReviewHandoff =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'animating';
      readonly destination: 'review' | 'wallet';
      readonly outgoing: Animation;
      readonly incoming: Animation;
      readonly sections: Animation[];
      readonly timer: ReturnType<typeof setTimeout>;
      onReady: (() => void) | null;
    };

type TransactionReviewReveal = {
  readonly origin: TransactionReviewRect | null;
  readonly onVisible: (rect: TransactionReviewRect | null) => void;
};

type AnchoredFadeTimes = Pick<WalletStepTransitionTimes, 'fadeInMs' | 'fadeOutMs'>;

type SurfaceRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

// The single motion for a measured request modal: the child never animates
// its own layout height while the box hugs it, it fills whatever box this
// ease has made (confirm-surface-resize.ts), so this is the duration a user
// sees for a tree expand or a content swap.
const SURFACE_RESIZE_DURATION_MS = WALLET_CARD_RESIZE_MS;
const REVIEW_HANDOFF_DURATION_MS = 320;

function finiteSurfaceRect(rect: DOMRect): SurfaceRect | null {
  if (
    !Number.isFinite(rect.top) ||
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return null;
  }
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

/**
 * An anchored card keeps the position that tracks its anchor, so only its size eases. Its rect is
 * the layout size, which a pinch-zoom scale does not change.
 */
function surfaceResizeRect(dialog: HTMLDialogElement, anchored: boolean): SurfaceRect | null {
  if (!anchored) return finiteSurfaceRect(dialog.getBoundingClientRect());
  const { offsetWidth: width, offsetHeight: height } = dialog;
  return width > 0 && height > 0 ? { top: 0, left: 0, width, height } : null;
}

function surfaceResizeKeyframes(
  origin: SurfaceRect,
  destination: SurfaceRect,
  sizeOnly: boolean,
): Keyframe[] {
  const frame = (rect: SurfaceRect): Keyframe => ({
    ...(sizeOnly ? {} : { top: `${rect.top}px`, left: `${rect.left}px` }),
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  return [frame(origin), frame(destination)];
}

function surfaceViewportRect(rect: SurfaceRect): TransactionReviewRect {
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
}

function reviewOriginKeyframes(origin: TransactionReviewRect, destination: SurfaceRect): Keyframe[] {
  const x = origin.x - destination.left;
  const y = origin.y - destination.top;
  const scaleX = origin.width / destination.width;
  const scaleY = origin.height / destination.height;
  return [
    { transformOrigin: 'top left', transform: `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY})` },
    { transformOrigin: 'top left', transform: 'none' },
  ];
}

function assertNever(value: never): never {
  throw new Error(`Unhandled wallet iframe overlay mode: ${String(value)}`);
}

function presentationKind(
  mode: Exclude<OverlayRenderMode, { kind: 'hidden' }>,
): 'modal' | 'drawer' {
  switch (mode.kind) {
    case 'compact_transaction_review':
    case 'compact_request_modal':
    case 'compact_auth_menu':
      return 'modal';
    case 'compact_request_drawer':
      return 'drawer';
    default:
      return assertNever(mode);
  }
}

function geometryKind(
  geometry: WalletIframeSurfaceGeometry,
): 'provisional' | 'measured' | 'fallback' {
  switch (geometry.kind) {
    case 'hidden':
      throw new Error('Visible wallet iframe overlay cannot use hidden geometry');
    case 'provisional_centered_modal':
    case 'provisional_bottom_drawer':
      return 'provisional';
    case 'centered_modal':
    case 'bottom_drawer':
      return 'measured';
    case 'viewport_fallback':
      return 'fallback';
    default:
      return assertNever(geometry);
  }
}

function diagnosticsMode(mode: OverlayRenderMode): OverlayControllerState['mode'] {
  switch (mode.kind) {
    case 'hidden':
      return 'hidden';
    case 'compact_transaction_review':
    case 'compact_request_modal':
    case 'compact_auth_menu':
      return mode.geometry.kind === 'viewport_fallback' ? 'viewport_fallback' : 'compact_modal';
    case 'compact_request_drawer':
      return mode.geometry.kind === 'viewport_fallback' ? 'viewport_fallback' : 'bottom_drawer';
    default:
      return assertNever(mode);
  }
}

function sameIdentity(left: OverlayRenderMode, right: OverlayRenderMode): boolean {
  if (left.kind === 'hidden' || right.kind === 'hidden') return left.kind === right.kind;
  if (
    left.identity.surfaceId !== right.identity.surfaceId ||
    left.identity.requestId !== right.identity.requestId
  ) {
    return false;
  }
  if (left.kind === 'compact_auth_menu' || right.kind === 'compact_auth_menu') {
    return (
      left.kind === 'compact_auth_menu' &&
      right.kind === 'compact_auth_menu' &&
      left.authMenuSessionId === right.authMenuSessionId
    );
  }
  return true;
}

function isOutsideRect(event: PointerEvent, rect: DOMRect): boolean {
  return (
    event.clientX <= rect.left ||
    event.clientX >= rect.right ||
    event.clientY <= rect.top ||
    event.clientY >= rect.bottom
  );
}

function ignoreDismissFailure(error: unknown): void {
  void error;
}

/**
 * Top-layer elements that open after a top-layer card: popovers, modal dialogs and a fullscreen
 * element. Each one paints above the card.
 */
class LaterTopLayer {
  private readonly opened = new Set<Element>();
  private card: HTMLDialogElement | null = null;
  private observer: MutationObserver | null = null;

  watch(card: HTMLDialogElement): void {
    this.stop();
    this.card = card;
    document.addEventListener('toggle', this.onToggle, true);
    document.addEventListener('fullscreenchange', this.onFullscreen);
    this.observer = new MutationObserver(this.onDialogs);
    this.observer.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ['open'],
    });
  }

  stop(): void {
    this.card = null;
    this.opened.clear();
    document.removeEventListener('toggle', this.onToggle, true);
    document.removeEventListener('fullscreenchange', this.onFullscreen);
    this.observer?.disconnect();
    this.observer = null;
  }

  /** A later modal dialog or fullscreen element covers all; a popover covers its own box. */
  covers(card: DOMRect): boolean {
    for (const element of this.opened) {
      if (!element.isConnected || !isOpenTopLayer(element)) {
        this.opened.delete(element);
        continue;
      }
      if (element instanceof HTMLDialogElement || element === document.fullscreenElement) {
        return true;
      }
      const box = element.getBoundingClientRect();
      if (
        box.left < card.right &&
        box.right > card.left &&
        box.top < card.bottom &&
        box.bottom > card.top
      ) {
        return true;
      }
    }
    return false;
  }

  private note(element: Element | null | undefined): void {
    if (element && element !== this.card && !this.card?.contains(element)) {
      this.opened.add(element);
    }
  }

  private readonly onToggle = (event: Event): void => {
    if ((event as ToggleEvent).newState === 'open' && event.target instanceof Element) {
      this.note(event.target);
    }
  };

  private readonly onFullscreen = (): void => {
    this.note(document.fullscreenElement);
  };

  private readonly onDialogs = (records: MutationRecord[]): void => {
    for (const record of records) {
      if (record.target instanceof HTMLDialogElement && record.target.open) {
        this.note(record.target);
      }
    }
  };
}

function isOpenTopLayer(element: Element): boolean {
  return (
    element.matches(':popover-open') ||
    (element instanceof HTMLDialogElement && element.matches(':modal')) ||
    element === document.fullscreenElement
  );
}

export class OverlayController {
  private readonly ensureIframe: (mountParent?: HTMLElement) => HTMLIFrameElement;
  private dismissHandler: ((event: OverlayDismissEvent) => void | Promise<void>) | undefined;
  private dialog: HTMLDialogElement | null = null;
  private iframe: HTMLIFrameElement | null = null;
  private reviewSlot: HTMLDivElement | null = null;
  private mode: OverlayRenderMode = { kind: 'hidden' };
  private visible = false;
  private generation = 0;
  private pointerCapture: PointerCapture | null = null;
  private restoreFocus: HTMLElement | null = null;
  // Dialog close events can arrive after the next surface is visible. Count
  // programmatic closes so a stale event cannot dismiss that newer request.
  private pendingProgrammaticCloseEvents = 0;
  private listenersInstalled = false;
  private lastAppliedGeometry: WalletIframeSurfaceGeometry | null = null;
  private authMenuVisualScale = 1;
  private lastAppliedAuthMenuVisualScale = 1;
  private dialogDisplayMode: 'modal' | 'nonmodal' | null = null;
  private pendingRevealFrame: number | null = null;
  private reviewHandoff: ReviewHandoff = { kind: 'idle' };
  private surfaceResizeAnimation: Animation | null = null;
  private surfaceResizeTimer: ReturnType<typeof setTimeout> | null = null;
  private reviewReveal: TransactionReviewReveal | null = null;
  private anchoredFade: Animation | null = null;
  private anchoredFadeTimes: AnchoredFadeTimes = walletStepTransitionTimes(undefined);
  private goneWaiters: Array<() => void> = [];
  private readonly laterTopLayer = new LaterTopLayer();

  constructor(opts: OverlayControllerOptions) {
    this.ensureIframe = opts.ensureIframe;
    this.dismissHandler = opts.onDismiss;
  }

  setDismissHandler(handler: (event: OverlayDismissEvent) => void | Promise<void>): void {
    this.dismissHandler = handler;
  }

  prepare(): HTMLIFrameElement {
    return this.ensureDialog().iframe;
  }

  getTransactionReviewSlot(): HTMLElement {
    const { dialog } = this.ensureDialog();
    if (!this.reviewSlot) {
      this.reviewSlot = document.createElement('div');
      this.reviewSlot.className = 'seams-transaction-review-slot';
      this.reviewSlot.id = `${dialog.id}-review`;
      this.reviewSlot.hidden = true;
      this.reviewSlot.inert = true;
      dialog.appendChild(this.reviewSlot);
    }
    return this.reviewSlot;
  }

  setTransactionReviewReveal(reveal: TransactionReviewReveal | null): void {
    this.reviewReveal = reveal;
  }

  /**
   * True when the shown card's whole box is in the visual viewport, fully opaque, and on top at
   * each sample point. A card that any page element or later top-layer element covers fails.
   */
  isSurfaceUnobstructed(): boolean {
    const { dialog, iframe } = this;
    if (!dialog || !iframe || !this.visible || this.anchoredFade?.playState === 'running') {
      return false;
    }
    if (dialog.classList.contains(OverlayStyleClasses.PROVISIONAL)) return false;
    if (getComputedStyle(dialog).opacity !== '1') return false;
    const rect = iframe.getBoundingClientRect();
    const visual = window.visualViewport;
    const left = visual?.offsetLeft ?? 0;
    const top = visual?.offsetTop ?? 0;
    const right = left + (visual?.width ?? window.innerWidth);
    const bottom = top + (visual?.height ?? window.innerHeight);
    if (
      rect.width <= 0 ||
      rect.left < left - 0.5 ||
      rect.top < top - 0.5 ||
      rect.right > right + 0.5 ||
      rect.bottom > bottom + 0.5
    ) {
      return false;
    }
    // A modal card makes the rest of the page inert, and hit testing skips inert elements: a
    // popover or dialog opened later paints above the card but never answers elementFromPoint.
    if (this.laterTopLayer.covers(rect)) return false;
    for (const x of [0.04, 0.5, 0.96]) {
      for (const y of [0.04, 0.5, 0.96]) {
        const hit = document.elementFromPoint(
          rect.left + rect.width * x,
          rect.top + rect.height * y,
        );
        if (hit !== iframe) return false;
      }
    }
    return true;
  }

  /** Resolves when the shown card has left the screen, or when another card takes its place. */
  whenSurfaceGone(): Promise<void> {
    if (!this.visible && !this.anchoredFade) return Promise.resolve();
    return new Promise((resolve) => this.goneWaiters.push(resolve));
  }

  private settleGone(): void {
    const waiters = this.goneWaiters;
    this.goneWaiters = [];
    for (const resolve of waiters) resolve();
  }

  getSurfaceRect(): TransactionReviewRect | null {
    const rect = this.dialog && finiteSurfaceRect(this.dialog.getBoundingClientRect());
    return rect ? surfaceViewportRect(rect) : null;
  }

  setReviewAppearance(appearance: AppearanceConfigInput | undefined): void {
    setTransactionReviewAppearance(this.ensureDialog().dialog, appearance);
  }

  setAuthMenuVisualScale(scale: number): void {
    this.authMenuVisualScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  }

  apply(mode: OverlayRenderMode): void {
    switch (mode.kind) {
      case 'hidden':
        this.hideOverlay();
        return;
      case 'compact_transaction_review':
      case 'compact_request_modal':
      case 'compact_request_drawer':
      case 'compact_auth_menu':
        this.applyVisible(mode);
        return;
      default:
        return assertNever(mode);
    }
  }

  private ensureDialog(): { dialog: HTMLDialogElement; iframe: HTMLIFrameElement } {
    if (!this.dialog) {
      const dialog = document.createElement('dialog');
      ensureOverlayDialog(dialog);
      dialog.addEventListener('cancel', this.handleCancel);
      dialog.addEventListener('close', this.handleClose);
      dialog.addEventListener('pointerdown', this.handlePointerDown);
      dialog.addEventListener('pointerup', this.handlePointerUp);
      window.addEventListener('pointerup', this.handlePointerUp);
      window.addEventListener('pointercancel', this.handlePointerCancel);
      this.listenersInstalled = true;
      this.dialog = dialog;
    }
    const dialog = this.dialog;
    ensureOverlayDialog(dialog);
    if (!dialog.isConnected) {
      document.body.appendChild(dialog);
    }
    const iframe = this.ensureIframe(dialog);
    this.iframe = iframe;
    if (iframe.parentElement !== dialog) {
      if (iframe.isConnected) {
        throw new Error('Wallet iframe cannot be reparented after it has been mounted');
      }
      dialog.appendChild(iframe);
    }
    return { dialog, iframe };
  }

  private applyVisible(mode: Exclude<OverlayRenderMode, { kind: 'hidden' }>): void {
    const { dialog, iframe } = this.ensureDialog();
    const iframeSize = { widthCssPx: iframe.clientWidth, heightCssPx: iframe.clientHeight };
    let requestResizeDestination: SurfaceRect | null = null;
    const identityChanged = !sameIdentity(this.mode, mode);
    const handoffFromReview =
      !identityChanged &&
      this.mode.kind === 'compact_transaction_review' &&
      mode.kind === 'compact_request_modal';
    const returnToReview =
      !identityChanged &&
      this.mode.kind === 'compact_request_modal' &&
      mode.kind === 'compact_transaction_review';
    this.cancelAnchoredFade();
    const authMenu = mode.kind === 'compact_auth_menu';
    const anchored = mode.anchoredLayer !== null;
    // A confirm or VoiceID card in an app's dialog eases its size as the Wallet modal does. The
    // anchored sign-in menu animates inside its frame, so its size applies at once.
    const easedAnchoredCard = mode.anchoredLayer === 'top' && mode.kind === 'compact_request_modal';
    const previousGeometryKind = this.lastAppliedGeometry
      ? geometryKind(this.lastAppliedGeometry)
      : null;
    const nextGeometryKind = geometryKind(mode.geometry);
    const revealMeasuredRequestModal =
      mode.kind === 'compact_request_modal' &&
      previousGeometryKind === 'provisional' &&
      nextGeometryKind !== 'provisional';
    const geometryChanged =
      !this.lastAppliedGeometry ||
      !walletIframeSurfaceGeometryEqual(this.lastAppliedGeometry, mode.geometry);
    const authMenuScaleChanged =
      anchored && Math.abs(this.lastAppliedAuthMenuVisualScale - this.authMenuVisualScale) > 0.001;
    const animateAuthMenuResize =
      anchored &&
      !identityChanged &&
      geometryChanged &&
      this.lastAppliedGeometry !== null &&
      geometryKind(this.lastAppliedGeometry) !== 'provisional' &&
      geometryKind(mode.geometry) !== 'provisional';
    const requestResizeOrigin =
      (mode.kind === 'compact_request_modal' || mode.kind === 'compact_transaction_review') &&
      (!anchored || easedAnchoredCard) &&
      !identityChanged &&
      geometryChanged &&
      previousGeometryKind === 'measured' &&
      nextGeometryKind === 'measured'
        ? surfaceResizeRect(dialog, anchored)
        : null;
    if (identityChanged) {
      this.cancelReviewHandoff();
      this.cancelPendingReveal();
      this.cancelSurfaceResize();
      this.generation += 1;
      this.pointerCapture = null;
      this.settleGone();
      if (mode.anchoredLayer === 'top') this.laterTopLayer.watch(dialog);
      else this.laterTopLayer.stop();
    }
    this.mode = mode;
    this.visible = true;

    setVisible(iframe);
    setDialogPresentation(dialog, presentationKind(mode), geometryKind(mode.geometry));
    setDialogAnchored(dialog, {
      authMenu,
      layer: mode.anchoredLayer,
      animateResize: animateAuthMenuResize,
    });
    if (geometryChanged || authMenuScaleChanged) {
      if (geometryChanged) this.cancelSurfaceResize();
      // Keep the iframe at the origin while the destination is written and
      // read, so the frame never lays out at the final size ahead of the ease.
      if (requestResizeOrigin) {
        pinDialogIframe(dialog, {
          widthCssPx: requestResizeOrigin.width,
          heightCssPx: requestResizeOrigin.height,
        });
      }
      setDialogGeometry(dialog, mode.geometry, anchored ? this.authMenuVisualScale : 1);
      this.lastAppliedGeometry = mode.geometry;
      this.lastAppliedAuthMenuVisualScale = anchored ? this.authMenuVisualScale : 1;
      requestResizeDestination = requestResizeOrigin ? surfaceResizeRect(dialog, anchored) : null;
      if (requestResizeOrigin && requestResizeDestination) {
        this.startSurfaceResize(
          requestResizeOrigin,
          requestResizeDestination,
          handoffFromReview || returnToReview ? REVIEW_HANDOFF_DURATION_MS : SURFACE_RESIZE_DURATION_MS,
          anchored,
        );
      }
      if (requestResizeOrigin) releaseDialogIframe(dialog);
    }
    const reviewing = mode.kind === 'compact_transaction_review';
    // A review handed to another surface of the same request keeps one opaque shell.
    if (reviewing) dialog.setAttribute('data-transaction-review', '');
    else if (identityChanged) dialog.removeAttribute('data-transaction-review');
    if (handoffFromReview) this.startReviewHandoff('wallet');
    if (returnToReview) this.startReviewHandoff('review');
    const handingOff = this.reviewHandoff.kind === 'animating';
    if (handingOff && requestResizeDestination) {
      // Keep responsive content at rest while the surrounding shell changes size.
      pinDialogIframe(dialog, reviewing ? iframeSize : {
        widthCssPx: requestResizeDestination.width,
        heightCssPx: requestResizeDestination.height,
      });
    }
    iframe.inert = reviewing || handingOff;
    iframe.classList.toggle('seams-review-wallet-inactive', reviewing);
    iframe.setAttribute('aria-hidden', String(reviewing || handingOff));
    if (reviewing) iframe.setAttribute('tabindex', '-1');
    else iframe.removeAttribute('tabindex');
    const slot = this.getTransactionReviewSlot();
    slot.hidden = !reviewing && !handingOff;
    slot.inert = !reviewing || handingOff;
    slot.setAttribute('aria-hidden', String(!reviewing || handingOff));
    if (returnToReview && !handingOff) this.focusReview();
    iframe.setAttribute('title', mode.presentation.title);
    dialog.setAttribute('aria-label', mode.presentation.title);
    dialog.classList.remove(OverlayStyleClasses.HIDDEN);

    if (revealMeasuredRequestModal && !anchored) {
      this.scheduleMeasuredReveal();
    }
    if (anchored && previousGeometryKind === 'provisional' && nextGeometryKind !== 'provisional') {
      this.fadeAnchored(dialog, 'in');
    }
    this.syncDialogInteractivity();
  }

  private syncDialogInteractivity(): void {
    const dialog = this.dialog;
    const mode = this.mode;
    if (!dialog || mode.kind === 'hidden') return;
    const preparing =
      geometryKind(mode.geometry) === 'provisional' || this.pendingRevealFrame !== null;
    if (!dialog.open || (!preparing && dialog.inert)) this.captureFocusForDialog();
    dialog.inert = preparing;
    dialog.setAttribute('aria-hidden', String(preparing));
    // A top-layer card is modal: it paints above all app content, and the page is inert.
    const modal =
      !preparing && (mode.anchoredLayer ? mode.anchoredLayer === 'top' : mode.focusTrap);
    dialog.setAttribute('aria-modal', String(modal));
    const displayMode = modal ? 'modal' : 'nonmodal';
    if (dialog.open && this.dialogDisplayMode !== displayMode) {
      this.closeDialogProgrammatically(dialog);
      this.dialogDisplayMode = null;
    }
    if (!dialog.open) {
      if (preparing) {
        // A loading iframe stays rendered for measurement. The open property leaves
        // page focus in place, while show() in Chromium clears it for an inert dialog.
        dialog.open = true;
        this.dialogDisplayMode = displayMode;
        return;
      }
      this.showDialog(dialog, displayMode);
      // Each browser's showModal() picks a different initial control.
      if (mode.kind === 'compact_transaction_review') this.focusReview();
    }
    if (mode.kind === 'compact_transaction_review') this.finishReviewReveal(dialog);
  }

  private finishReviewReveal(dialog: HTMLDialogElement): void {
    const reveal = this.reviewReveal;
    if (!reveal) return;
    this.reviewReveal = null;
    const destination = finiteSurfaceRect(dialog.getBoundingClientRect());
    if (reveal.origin && destination) this.startReviewOrigin(reveal.origin, destination);
    reveal.onVisible(destination ? surfaceViewportRect(destination) : null);
  }

  private startReviewOrigin(origin: TransactionReviewRect, destination: SurfaceRect): void {
    const dialog = this.dialog;
    if (!dialog || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.cancelSurfaceResize();
    // A transform leaves layout alone, so the review keeps its width and its measurement.
    const animation = dialog.animate(reviewOriginKeyframes(origin, destination), {
      duration: REVIEW_HANDOFF_DURATION_MS,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    });
    this.reviewSlot?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }], {
      duration: REVIEW_HANDOFF_DURATION_MS,
      easing: 'ease-out',
    });
    this.surfaceResizeAnimation = animation;
    this.surfaceResizeTimer = setTimeout(
      this.cancelSurfaceResize.bind(this),
      REVIEW_HANDOFF_DURATION_MS,
    );
    animation.addEventListener('finish', this.handleSurfaceResizeFinished, { once: true });
  }

  activateAfterReviewHandoff(onReady: () => void): void {
    if (this.reviewHandoff.kind === 'animating') {
      this.reviewHandoff.onReady = onReady;
    } else {
      onReady();
    }
  }

  private startReviewHandoff(destination: 'review' | 'wallet'): void {
    this.cancelReviewHandoff();
    if (!this.iframe || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const options = {
      duration: REVIEW_HANDOFF_DURATION_MS,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'both',
    } as const;
    const review = this.getTransactionReviewSlot().firstElementChild;
    if (!review) return;
    const outgoingElement = destination === 'wallet' ? review : this.iframe;
    const incomingElement = destination === 'wallet' ? this.iframe : review;
    const direction = destination === 'wallet' ? 1 : -1;
    const outgoing = outgoingElement.animate([
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: `translateY(${-8 * direction}px)`, offset: 0.55 },
      { opacity: 0, transform: `translateY(${-8 * direction}px)` },
    ], options);
    const incoming = incomingElement.animate([
      { opacity: 0, transform: `translateY(${12 * direction}px)` },
      { opacity: 1, transform: 'translateY(0)' },
    ], options);
    const sections: Animation[] = [];
    let order = 0;
    for (const section of review.children) {
      const entering = destination === 'review';
      const delay = Math.min(order, 3) * 25;
      sections.push(section.animate([
        { opacity: entering ? 0 : 1, transform: entering ? 'translateY(8px)' : 'translateY(0)' },
        { opacity: entering ? 1 : 0, transform: entering ? 'translateY(0)' : 'translateY(-6px)' },
      ], {
        duration: entering ? 220 : 140,
        delay,
        easing: 'ease-out',
        fill: 'both',
      }));
      order += 1;
    }
    this.reviewHandoff = {
      kind: 'animating',
      destination,
      outgoing,
      incoming,
      sections,
      timer: setTimeout(this.finishReviewHandoff.bind(this), REVIEW_HANDOFF_DURATION_MS),
      onReady: null,
    };
    incoming.addEventListener('finish', this.handleReviewHandoffFinished, { once: true });
  }

  private readonly handleReviewHandoffFinished = (event: Event): void => {
    if (
      this.reviewHandoff.kind !== 'animating' ||
      event.currentTarget !== this.reviewHandoff.incoming
    )
      return;
    this.finishReviewHandoff();
  };

  private finishReviewHandoff(): void {
    if (this.reviewHandoff.kind !== 'animating') return;
    const onReady = this.reviewHandoff.onReady;
    const reviewing = this.reviewHandoff.destination === 'review';
    this.cancelReviewHandoff();
    if (this.reviewSlot) {
      this.reviewSlot.hidden = !reviewing;
      this.reviewSlot.inert = !reviewing;
      this.reviewSlot.setAttribute('aria-hidden', String(!reviewing));
    }
    if (this.iframe) {
      this.iframe.inert = reviewing;
      this.iframe.setAttribute('aria-hidden', String(reviewing));
    }
    if (reviewing) this.focusReview();
    onReady?.();
  }

  private focusReview(): void {
    this.reviewSlot
      ?.querySelector<HTMLElement>('[tabindex="-1"], button')
      ?.focus({ preventScroll: true });
  }

  private cancelReviewHandoff(): void {
    if (this.reviewHandoff.kind !== 'animating') return;
    clearTimeout(this.reviewHandoff.timer);
    this.reviewHandoff.outgoing.cancel();
    this.reviewHandoff.incoming.cancel();
    for (const animation of this.reviewHandoff.sections) animation.cancel();
    if (this.dialog) releaseDialogIframe(this.dialog);
    this.reviewHandoff = { kind: 'idle' };
  }

  private scheduleMeasuredReveal(): void {
    this.cancelPendingReveal();
    this.dialog?.classList.add(OverlayStyleClasses.REVEAL_PENDING);
    this.pendingRevealFrame = window.requestAnimationFrame(this.revealMeasuredSurface);
  }

  private readonly revealMeasuredSurface = (): void => {
    this.pendingRevealFrame = null;
    this.dialog?.classList.remove(OverlayStyleClasses.REVEAL_PENDING);
    this.syncDialogInteractivity();
  };

  private startSurfaceResize(
    origin: SurfaceRect,
    destination: SurfaceRect,
    duration: number,
    sizeOnly: boolean,
  ): void {
    const dialog = this.dialog;
    if (!dialog || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.cancelSurfaceResize();
    const animation = dialog.animate(surfaceResizeKeyframes(origin, destination, sizeOnly), {
      duration,
      easing: WALLET_CARD_RESIZE_EASING,
    });
    this.surfaceResizeAnimation = animation;
    this.surfaceResizeTimer = setTimeout(
      this.cancelSurfaceResize.bind(this),
      duration,
    );
    animation.addEventListener('finish', this.handleSurfaceResizeFinished, { once: true });
  }

  private readonly handleSurfaceResizeFinished = (event: Event): void => {
    if (event.currentTarget !== this.surfaceResizeAnimation) return;
    this.cancelSurfaceResize();
  };

  private cancelPendingReveal(): void {
    if (this.pendingRevealFrame !== null) window.cancelAnimationFrame(this.pendingRevealFrame);
    this.pendingRevealFrame = null;
    this.dialog?.classList.remove(OverlayStyleClasses.REVEAL_PENDING);
  }

  private cancelSurfaceResize(): void {
    if (this.surfaceResizeTimer) clearTimeout(this.surfaceResizeTimer);
    this.surfaceResizeTimer = null;
    this.surfaceResizeAnimation?.cancel();
    this.surfaceResizeAnimation = null;
  }

  private showDialog(dialog: HTMLDialogElement, displayMode: 'modal' | 'nonmodal'): void {
    if (displayMode === 'nonmodal') {
      if (typeof dialog.show !== 'function') {
        throw new Error('Wallet iframe overlay requires native HTMLDialogElement.show support');
      }
      dialog.show();
      this.dialogDisplayMode = 'nonmodal';
      return;
    }
    if (typeof dialog.showModal !== 'function') {
      throw new Error('Wallet iframe overlay requires native HTMLDialogElement.showModal support');
    }
    dialog.showModal();
    this.dialogDisplayMode = 'modal';
  }

  private closeDialogProgrammatically(dialog: HTMLDialogElement): void {
    this.pendingProgrammaticCloseEvents += 1;
    dialog.close();
  }

  private hideOverlay(): void {
    const wasVisible = this.visible;
    // An anchored card that was on screen fades out before the dialog hides.
    const fadeOut =
      wasVisible &&
      this.mode.kind !== 'hidden' &&
      this.mode.anchoredLayer !== null &&
      this.lastAppliedGeometry !== null &&
      geometryKind(this.lastAppliedGeometry) !== 'provisional';
    this.cancelReviewHandoff();
    this.cancelPendingReveal();
    this.cancelSurfaceResize();
    this.cancelAnchoredFade();
    this.generation += 1;
    this.pointerCapture = null;
    this.mode = { kind: 'hidden' };
    this.visible = false;
    this.reviewReveal = null;
    this.lastAppliedGeometry = null;
    this.authMenuVisualScale = 1;
    this.lastAppliedAuthMenuVisualScale = 1;
    if (!this.dialog) {
      return;
    }
    if (fadeOut && this.fadeAnchored(this.dialog, 'out')) {
      this.dialog.inert = true;
      return;
    }
    this.hideDialog(wasVisible);
  }

  private hideDialog(wasVisible: boolean): void {
    if (!this.dialog) return;
    if (this.reviewSlot) {
      this.reviewSlot.hidden = true;
      this.reviewSlot.inert = true;
    }
    const iframe = this.iframe;
    if (iframe) {
      setHidden(iframe);
      iframe.setAttribute('aria-hidden', 'true');
      iframe.setAttribute('tabindex', '-1');
      iframe.removeAttribute('title');
    }
    this.dialog.removeAttribute('aria-label');
    this.dialog.classList.add(OverlayStyleClasses.HIDDEN);
    this.dialog.classList.remove(OverlayStyleClasses.REVEAL_PENDING);
    clearDialogGeometry(this.dialog);
    if (this.dialog.open) {
      this.closeDialogProgrammatically(this.dialog);
    }
    this.dialogDisplayMode = null;
    this.laterTopLayer.stop();
    if (wasVisible) {
      this.restoreCapturedFocus();
    }
    this.settleGone();
  }

  /** How long the anchored card on screen fades in, and how long it fades out when it ends. */
  setAnchoredFadeTimes(times: AnchoredFadeTimes): void {
    this.anchoredFadeTimes = times;
  }

  /** Fades an anchored card in or out. Returns false when no fade runs. */
  private fadeAnchored(dialog: HTMLDialogElement, direction: 'in' | 'out'): boolean {
    this.cancelAnchoredFade();
    const { fadeInMs, fadeOutMs } = this.anchoredFadeTimes;
    const duration = direction === 'in' ? fadeInMs : fadeOutMs;
    if (duration <= 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return false;
    }
    const fade = dialog.animate(
      direction === 'in' ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }],
      {
        duration,
        easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
        fill: direction === 'out' ? 'forwards' : 'none',
      },
    );
    this.anchoredFade = fade;
    if (direction === 'out') {
      fade.addEventListener('finish', this.handleAnchoredFadeOut, { once: true });
    }
    return true;
  }

  private readonly handleAnchoredFadeOut = (event: Event): void => {
    if (event.currentTarget !== this.anchoredFade) return;
    this.anchoredFade = null;
    (event.currentTarget as Animation).cancel();
    if (this.dialog) this.dialog.inert = false;
    this.hideDialog(true);
  };

  /** A new card stops the fade: the dialog is shown again at once. */
  private cancelAnchoredFade(): void {
    const fade = this.anchoredFade;
    if (!fade) return;
    this.anchoredFade = null;
    fade.removeEventListener('finish', this.handleAnchoredFadeOut);
    fade.cancel();
  }

  private captureFocusForDialog(): void {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      this.dialog &&
      !this.dialog.contains(active)
    ) {
      this.restoreFocus = active;
    }
  }

  private restoreCapturedFocus(): void {
    const focusTarget = this.restoreFocus;
    this.restoreFocus = null;
    if (!focusTarget || !focusTarget.isConnected || focusTarget.matches('[inert]')) return;
    focusTarget.focus({ preventScroll: true });
  }

  private activeDismissEvent(reason: OverlayDismissReason): OverlayDismissEvent | null {
    if (this.mode.kind === 'hidden') return null;
    const event: OverlayDismissEvent = {
      identity: this.mode.identity,
      reason,
      generation: this.generation,
    };
    if (this.mode.kind === 'compact_auth_menu') {
      event.authMenuSessionId = this.mode.authMenuSessionId;
    }
    return event;
  }

  private requestDismiss(reason: OverlayDismissReason): void {
    // A card over an app element ends through its own controls, not a click beside it.
    if (reason === 'backdrop' && this.mode.kind !== 'hidden' && this.mode.anchoredLayer) return;
    const event = this.activeDismissEvent(reason);
    if (!event || !this.dismissHandler) return;
    void Promise.resolve(this.dismissHandler(event)).catch(ignoreDismissFailure);
  }

  private handleCancel = (event: Event): void => {
    event.preventDefault();
    this.requestDismiss('escape');
  };

  private handleClose = (): void => {
    if (this.pendingProgrammaticCloseEvents > 0) {
      this.pendingProgrammaticCloseEvents -= 1;
      return;
    }
    this.dialogDisplayMode = null;
    if (this.visible) this.requestDismiss('escape');
  };

  private handlePointerDown = (event: PointerEvent): void => {
    if (!this.visible || this.mode.kind === 'hidden' || !this.dialog) return;
    const dialogRect = this.dialog.getBoundingClientRect();
    const iframe = this.ensureIframe();
    const iframeRect = iframe.getBoundingClientRect();
    if (!isOutsideRect(event, dialogRect) || !isOutsideRect(event, iframeRect)) {
      this.pointerCapture = null;
      return;
    }
    this.pointerCapture = { pointerId: event.pointerId, generation: this.generation };
  };

  private handlePointerUp = (event: PointerEvent): void => {
    const capture = this.pointerCapture;
    this.pointerCapture = null;
    if (
      !capture ||
      capture.pointerId !== event.pointerId ||
      capture.generation !== this.generation
    ) {
      return;
    }
    if (!this.dialog || this.mode.kind === 'hidden') return;
    const dialogRect = this.dialog.getBoundingClientRect();
    const iframeRect = this.ensureIframe().getBoundingClientRect();
    if (isOutsideRect(event, dialogRect) && isOutsideRect(event, iframeRect)) {
      this.requestDismiss('backdrop');
    }
  };

  private handlePointerCancel = (event: PointerEvent): void => {
    if (this.pointerCapture?.pointerId === event.pointerId) {
      this.pointerCapture = null;
    }
  };

  getState(): OverlayControllerState {
    return {
      visible: this.visible,
      mode: diagnosticsMode(this.mode),
      dialogOpen: this.dialog?.open ?? false,
      generation: this.generation,
    };
  }

  dispose(): void {
    this.cancelAnchoredFade();
    this.laterTopLayer.stop();
    this.settleGone();
    this.cancelReviewHandoff();
    this.cancelPendingReveal();
    this.cancelSurfaceResize();
    this.generation += 1;
    this.pointerCapture = null;
    this.mode = { kind: 'hidden' };
    this.visible = false;
    this.lastAppliedGeometry = null;
    this.dialogDisplayMode = null;
    this.restoreFocus = null;
    const dialog = this.dialog;
    if (!dialog) {
      this.dismissHandler = undefined;
      return;
    }
    if (this.listenersInstalled) {
      dialog.removeEventListener('cancel', this.handleCancel);
      dialog.removeEventListener('close', this.handleClose);
      dialog.removeEventListener('pointerdown', this.handlePointerDown);
      dialog.removeEventListener('pointerup', this.handlePointerUp);
      window.removeEventListener('pointerup', this.handlePointerUp);
      window.removeEventListener('pointercancel', this.handlePointerCancel);
    }
    if (dialog.open) {
      dialog.close();
    }
    clearDialogGeometry(dialog);
    clearTransactionReviewAppearance(dialog);
    dialog.remove();
    this.dialog = null;
    this.iframe = null;
    this.reviewSlot = null;
    this.listenersInstalled = false;
    this.dismissHandler = undefined;
  }
}

export default OverlayController;

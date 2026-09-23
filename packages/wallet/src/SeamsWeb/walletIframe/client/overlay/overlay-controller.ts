import type { AppearanceConfigInput } from '@/core/types/seams';
import type { HostedAuthMenuSessionId } from '../../shared/messages';
import type { RequestSurfaceIdentity } from '../surface/domain';
import {
  walletIframeSurfaceGeometryEqual,
  type WalletIframeSurfaceGeometry,
} from '../surface/geometry';
import type { WalletIframeSurfaceRenderMode } from '../surface/renderer';
import {
  clearDialogGeometry,
  setTransactionReviewAppearance,
  clearTransactionReviewAppearance,
  ensureOverlayDialog,
  OverlayStyleClasses,
  setDialogGeometry,
  setDialogAuthMenu,
  setDialogPresentation,
  setHidden,
  setVisible,
  pinDialogIframe,
  releaseDialogIframe,
} from './overlay-styles';

export type OverlayRenderMode = WalletIframeSurfaceRenderMode;

export type OverlayDismissReason = 'backdrop' | 'escape';

export type OverlayDismissEvent = {
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
      readonly timer: ReturnType<typeof setTimeout>;
      onReady: (() => void) | null;
    };

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
const SURFACE_RESIZE_DURATION_MS = 180;

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

function surfaceResizeKeyframes(origin: SurfaceRect, destination: SurfaceRect): Keyframe[] {
  return [
    {
      top: `${origin.top}px`,
      left: `${origin.left}px`,
      width: `${origin.width}px`,
      height: `${origin.height}px`,
    },
    {
      top: `${destination.top}px`,
      left: `${destination.left}px`,
      width: `${destination.width}px`,
      height: `${destination.height}px`,
    },
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
    const identityChanged = !sameIdentity(this.mode, mode);
    const handoffFromReview =
      !identityChanged &&
      this.mode.kind === 'compact_transaction_review' &&
      mode.kind === 'compact_request_modal';
    const returnToReview =
      !identityChanged &&
      this.mode.kind === 'compact_request_modal' &&
      mode.kind === 'compact_transaction_review';
    const authMenu = mode.kind === 'compact_auth_menu';
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
      authMenu && Math.abs(this.lastAppliedAuthMenuVisualScale - this.authMenuVisualScale) > 0.001;
    const animateAuthMenuResize =
      authMenu &&
      !identityChanged &&
      geometryChanged &&
      this.lastAppliedGeometry !== null &&
      geometryKind(this.lastAppliedGeometry) !== 'provisional' &&
      geometryKind(mode.geometry) !== 'provisional';
    const requestResizeOrigin =
      (mode.kind === 'compact_request_modal' || mode.kind === 'compact_transaction_review') &&
      !identityChanged &&
      geometryChanged &&
      previousGeometryKind === 'measured' &&
      nextGeometryKind === 'measured'
        ? finiteSurfaceRect(dialog.getBoundingClientRect())
        : null;
    if (identityChanged) {
      this.cancelReviewHandoff();
      this.cancelPendingReveal();
      this.cancelSurfaceResize();
      this.generation += 1;
      this.pointerCapture = null;
      this.captureFocusForDialog();
    }
    this.mode = mode;
    this.visible = true;

    if (revealMeasuredRequestModal) {
      dialog.classList.add(OverlayStyleClasses.REVEAL_PENDING);
    }
    setVisible(iframe);
    setDialogPresentation(dialog, presentationKind(mode), geometryKind(mode.geometry));
    setDialogAuthMenu(dialog, authMenu, animateAuthMenuResize);
    dialog.setAttribute('aria-modal', authMenu || !mode.focusTrap ? 'false' : 'true');
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
      setDialogGeometry(dialog, mode.geometry, authMenu ? this.authMenuVisualScale : 1);
      this.lastAppliedGeometry = mode.geometry;
      this.lastAppliedAuthMenuVisualScale = authMenu ? this.authMenuVisualScale : 1;
      const requestResizeDestination = requestResizeOrigin
        ? finiteSurfaceRect(dialog.getBoundingClientRect())
        : null;
      if (requestResizeOrigin && requestResizeDestination) {
        this.startSurfaceResize(requestResizeOrigin, requestResizeDestination);
      }
      if (requestResizeOrigin) releaseDialogIframe(dialog);
    }
    const reviewing = mode.kind === 'compact_transaction_review';
    if (reviewing) dialog.setAttribute('data-transaction-review', '');
    else if (!this.mode || !('identity' in this.mode) || identityChanged)
      dialog.removeAttribute('data-transaction-review');
    if (handoffFromReview) this.startReviewHandoff('wallet');
    if (returnToReview) this.startReviewHandoff('review');
    const handingOff = this.reviewHandoff.kind === 'animating';
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

    const requestedDisplayMode = authMenu || !mode.focusTrap ? 'nonmodal' : 'modal';
    if (dialog.open && this.dialogDisplayMode !== requestedDisplayMode) {
      this.closeDialogProgrammatically(dialog);
      this.dialogDisplayMode = null;
    }
    if (!dialog.open) {
      this.showDialog(dialog, requestedDisplayMode);
    }
    if (revealMeasuredRequestModal) {
      this.scheduleMeasuredReveal();
    }
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
      duration: SURFACE_RESIZE_DURATION_MS,
      easing: 'linear',
      fill: 'both',
    } as const;
    const review = this.getTransactionReviewSlot().firstElementChild;
    if (!review) return;
    const outgoingElement = destination === 'wallet' ? review : this.iframe;
    const incomingElement = destination === 'wallet' ? this.iframe : review;
    const outgoing = outgoingElement.animate([{ opacity: 1 }, { opacity: 0 }], options);
    const incoming = incomingElement.animate([{ opacity: 0 }, { opacity: 1 }], options);
    this.reviewHandoff = {
      kind: 'animating',
      destination,
      outgoing,
      incoming,
      timer: setTimeout(this.finishReviewHandoff.bind(this), SURFACE_RESIZE_DURATION_MS),
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
    this.reviewHandoff = { kind: 'idle' };
  }

  private scheduleMeasuredReveal(): void {
    this.cancelPendingReveal();
    this.pendingRevealFrame = window.requestAnimationFrame(this.revealMeasuredSurface);
  }

  private readonly revealMeasuredSurface = (): void => {
    this.pendingRevealFrame = null;
    const dialog = this.dialog;
    if (
      !dialog ||
      !this.visible ||
      this.mode.kind !== 'compact_request_modal' ||
      geometryKind(this.mode.geometry) === 'provisional'
    ) {
      return;
    }
    dialog.classList.remove(OverlayStyleClasses.REVEAL_PENDING);
  };

  private startSurfaceResize(origin: SurfaceRect, destination: SurfaceRect): void {
    const dialog = this.dialog;
    if (!dialog || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.cancelSurfaceResize();
    const animation = dialog.animate(surfaceResizeKeyframes(origin, destination), {
      duration: SURFACE_RESIZE_DURATION_MS,
      easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
    });
    this.surfaceResizeAnimation = animation;
    this.surfaceResizeTimer = setTimeout(
      this.cancelSurfaceResize.bind(this),
      SURFACE_RESIZE_DURATION_MS,
    );
    animation.addEventListener('finish', this.handleSurfaceResizeFinished, { once: true });
  }

  private readonly handleSurfaceResizeFinished = (event: Event): void => {
    if (event.currentTarget !== this.surfaceResizeAnimation) return;
    this.cancelSurfaceResize();
  };

  private cancelPendingReveal(): void {
    if (this.pendingRevealFrame === null) return;
    window.cancelAnimationFrame(this.pendingRevealFrame);
    this.pendingRevealFrame = null;
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
    this.cancelReviewHandoff();
    this.cancelPendingReveal();
    this.cancelSurfaceResize();
    this.generation += 1;
    this.pointerCapture = null;
    this.mode = { kind: 'hidden' };
    this.visible = false;
    this.lastAppliedGeometry = null;
    this.authMenuVisualScale = 1;
    this.lastAppliedAuthMenuVisualScale = 1;
    if (!this.dialog) {
      return;
    }
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
    if (wasVisible) {
      this.restoreCapturedFocus();
    }
  }

  private captureFocusForDialog(): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && this.dialog && !this.dialog.contains(active)) {
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
    const event = this.activeDismissEvent(reason);
    if (!event || !this.dismissHandler) return;
    void Promise.resolve(this.dismissHandler(event)).catch(ignoreDismissFailure);
  }

  private handleCancel = (event: Event): void => {
    event.preventDefault();
    this.requestDismiss('escape');
  };

  private handleClose = (): void => {
    this.dialogDisplayMode = null;
    if (this.pendingProgrammaticCloseEvents > 0) {
      this.pendingProgrammaticCloseEvents -= 1;
      return;
    }
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

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { OverlayController } from '@wallet-preview/SeamsWeb/walletIframe/client/overlay/overlay-controller';
import {
  requestSurfaceIdentity,
  modalWalletIframeSurfacePresentation,
} from '@wallet-preview/SeamsWeb/walletIframe/client/surface/domain';
import {
  measuredWalletIframeSurfaceGeometry,
  isWalletIframeModalGeometry,
} from '@wallet-preview/SeamsWeb/walletIframe/client/surface/geometry';
import {
  walletIframeRequestIdFromBoundary,
  walletIframeSurfaceIdFromBoundary,
} from '@wallet-preview/core/types/walletIframeIdentity';
import type { TransactionReviewControls } from '@seams/wallet/react';

type PreviewProps = {
  render: (controls: TransactionReviewControls) => ReactNode;
  onFinish: (message: string) => void;
};

// Uses the production overlay and confirmer, with a separate fixture-only iframe.
// No wallet provider, authentication, or signing transport is created in that frame.
class PreviewSession {
  readonly iframe = document.createElement('iframe');
  readonly overlay: OverlayController;
  readonly slot: HTMLElement;
  private readonly identity = requestSurfaceIdentity({
    requestId: walletIframeRequestIdFromBoundary('prediction-preview'),
    surfaceId: walletIframeSurfaceIdFromBoundary(crypto.randomUUID()),
  });
  private phase:
    | 'mounting'
    | 'review'
    | 'review_again'
    | 'preparing'
    | 'approval'
    | 'closed' = 'mounting';
  private reviewHeight = 0;
  private approvalSize = { widthCssPx: 480, heightCssPx: 420 };
  private readonly observer: ResizeObserver;

  constructor(private readonly onFinish: PreviewProps['onFinish']) {
    this.overlay = new OverlayController({
      ensureIframe: this.ensureIframe,
      onDismiss: this.cancel,
    });
    this.slot = this.overlay.getTransactionReviewSlot();
    // Measure the React content at its final width before opening the dialog.
    this.slot.classList.add('prediction-preview-slot');
    this.slot.hidden = false;
    this.observer = new ResizeObserver(this.resize);
    this.overlay.setReviewAppearance({ theme: { id: 'preview-light', mode: 'light' } });
    window.addEventListener('message', this.receive);
    window.addEventListener('resize', this.resize);
  }

  private ensureIframe = (): HTMLIFrameElement => this.iframe;

  observe(content: HTMLElement | null): void {
    if (!content) return;
    this.observer.observe(content);
    if (this.phase !== 'mounting') return;
    this.phase = 'review';
    this.resize();
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.slot.parentElement?.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 180,
        easing: 'ease-out',
      });
    }
    content.querySelector<HTMLElement>('button')?.focus();
  }

  private resize = (): void => {
    if (this.phase === 'closed' || this.phase === 'mounting') return;
    const reviewing = this.phase !== 'approval';
    const presentation = modalWalletIframeSurfacePresentation(
      reviewing ? 'Review purchase · preview' : 'Wallet approval · preview',
    );
    const content = this.slot.firstElementChild;
    if (!content) return;
    if (reviewing && !this.slot.hidden) this.reviewHeight = content.getBoundingClientRect().height;
    const size = reviewing
      ? { widthCssPx: 480, heightCssPx: this.reviewHeight }
      : this.approvalSize;
    const geometry = measuredWalletIframeSurfaceGeometry(
      presentation,
      {
        widthCssPx: window.innerWidth,
        heightCssPx: window.innerHeight,
        offsetLeftCssPx: 0,
        offsetTopCssPx: 0,
      },
      size,
    );
    if (!isWalletIframeModalGeometry(geometry)) return;
    this.overlay.apply({
      kind: reviewing ? 'compact_transaction_review' : 'compact_request_modal',
      presentation,
      geometry,
      focusTrap: true,
      identity: this.identity,
    });
  };

  readonly continueToWallet = (): void => {
    if (this.phase === 'review_again') {
      this.phase = 'approval';
      this.resize();
      this.overlay.activateAfterReviewHandoff(this.focusWallet);
      return;
    }
    if (this.phase !== 'review') return;
    this.phase = 'preparing';
    this.iframe.src = new URL('confirmation-preview.html', window.location.href).href;
  };

  private focusWallet = (): void => {
    this.iframe.contentDocument
      ?.querySelector<HTMLElement>('.seams-confirmation-modal--hosted')
      ?.focus({ preventScroll: true });
  };

  readonly cancel = (): void => this.finish('Preview closed. Nothing was signed or sent.');
  readonly fail = (error: unknown): void =>
    this.finish(error instanceof Error ? error.message : 'Preview failed.');

  private receive = (event: MessageEvent<unknown>): void => {
    if (event.source !== this.iframe.contentWindow || event.origin !== window.location.origin)
      return;
    const data = event.data;
    if (!data || typeof data !== 'object' || !('type' in data)) return;
    if (data.type === 'preview-back' && this.phase === 'approval') {
      this.phase = 'review_again';
      this.resize();
    } else if (
      data.type === 'preview-finished' &&
      'confirmed' in data &&
      typeof data.confirmed === 'boolean'
    ) {
      this.finish(
        data.confirmed ? 'Preview approved. Nothing was signed or sent.' : 'Preview cancelled.',
      );
    } else if (
      data.type === 'preview-error' &&
      'message' in data &&
      typeof data.message === 'string'
    ) {
      this.finish(data.message);
    } else if (data.type === 'preview-measurement' && 'measurement' in data) {
      const measurement = data.measurement;
      if (
        !measurement ||
        typeof measurement !== 'object' ||
        !('widthCssPx' in measurement) ||
        !('heightCssPx' in measurement)
      )
        return;
      const { widthCssPx, heightCssPx } = measurement;
      if (
        typeof widthCssPx !== 'number' ||
        typeof heightCssPx !== 'number' ||
        !Number.isFinite(widthCssPx) ||
        !Number.isFinite(heightCssPx) ||
        widthCssPx <= 0 ||
        heightCssPx <= 0
      )
        return;
      this.approvalSize = { widthCssPx, heightCssPx };
      if (this.phase === 'preparing') {
        this.phase = 'approval';
        this.resize();
        this.overlay.activateAfterReviewHandoff(this.focusWallet);
      } else if (this.phase === 'approval') {
        this.resize();
      }
    }
  };

  private finish(message: string): void {
    if (this.phase === 'closed') return;
    this.dispose();
    this.onFinish(message);
  }

  dispose = (): void => {
    this.phase = 'closed';
    this.observer.disconnect();
    window.removeEventListener('message', this.receive);
    window.removeEventListener('resize', this.resize);
    this.overlay.dispose();
    this.iframe.remove();
  };
}

function mountPreview(
  setSession: (session: PreviewSession) => void,
  onFinish: PreviewProps['onFinish'],
) {
  const session = new PreviewSession(onFinish);
  setSession(session);
  return session.dispose;
}

export function ConfirmationPreview({ render, onFinish }: PreviewProps) {
  const [session, setSession] = useState<PreviewSession | null>(null);
  useEffect(mountPreview.bind(null, setSession, onFinish), [onFinish]);
  if (!session) return null;
  return createPortal(
    <section
      className="seams-transaction-review-content prediction-preview-content"
      ref={session.observe.bind(session)}
    >
      <p className="prediction-caption">Interactive preview · nothing will be signed or sent</p>
      <h2>Review purchase</h2>
      {render({
        continueToWallet: session.continueToWallet,
        cancel: session.cancel,
        fail: session.fail,
      })}
    </section>,
    session.slot,
  );
}

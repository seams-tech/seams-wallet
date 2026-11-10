import type { AppearanceConfigInput } from '@/core/types/seams';
import type { WalletIframeRequestId } from '@/core/types/walletIframeIdentity';
import type { ParentToChildEnvelope } from '../shared/messages';
import type { AnchoredWalletPresentation, WalletStepExit } from '../shared/walletStep';
import { AnchoredSurface, type AnchoredSurfaceOptions } from './anchoredSurface';
import type { OverlayController } from './overlay/overlay-controller';

/** What the registry needs from the router that owns the Wallet iframe. */
export type AnchoredSurfacesHost = Readonly<{
  /** The request whose card is on screen now, or null. */
  activeRequestId: () => WalletIframeRequestId | null;
  renderActive: () => void;
  overlay: () => Pick<
    OverlayController,
    'isSurfaceUnobstructed' | 'whenSurfaceGone' | 'setReviewAppearance'
  >;
  appearance: () => AppearanceConfigInput | undefined;
  post: (message: ParentToChildEnvelope) => void;
  cancelRequest: (requestId: WalletIframeRequestId) => void;
  /** Ends the request's receipt view, when it shows one. */
  closeReceipt: (requestId: WalletIframeRequestId) => void;
}>;

/** The requests whose cards show over an app element, by request. */
export class AnchoredSurfaces {
  private readonly surfaces = new Map<WalletIframeRequestId, AnchoredSurface>();

  constructor(private readonly host: AnchoredSurfacesHost) {}

  get(requestId: WalletIframeRequestId): AnchoredSurface | undefined {
    return this.surfaces.get(requestId);
  }

  /** Places the request's card over an app element until the request ends. */
  register(requestId: WalletIframeRequestId, options: AnchoredSurfaceOptions): AnchoredSurface {
    const anchored = new AnchoredSurface(options, this.renderIfActive.bind(this, requestId));
    this.surfaces.set(requestId, anchored);
    // A top-layer card's own shadow follows the Wallet's card shape.
    if (options.layer === 'top') this.host.overlay().setReviewAppearance(this.host.appearance());
    return anchored;
  }

  /**
   * A request whose card shows in the app's dialog. The Wallet host draws its chrome and holds
   * its controls until this page reports the whole card in view and uncovered.
   */
  registerRequest(
    requestId: WalletIframeRequestId,
    presentation: AnchoredWalletPresentation,
  ): AnchoredSurface {
    const anchored = this.register(requestId, {
      ...presentation,
      layer: 'top',
      chrome: presentation.chrome ?? 'none',
      view: this.viewReporter(requestId),
    });
    presentation.signal?.addEventListener(
      'abort',
      this.host.cancelRequest.bind(null, requestId),
      { once: true },
    );
    return anchored;
  }

  /** Checks the card on every frame and tells the Wallet host each change. */
  viewReporter(requestId: WalletIframeRequestId): AnchoredSurfaceOptions['view'] {
    return {
      check: () =>
        this.host.activeRequestId() === requestId && this.host.overlay().isSurfaceUnobstructed(),
      report: (unobstructed) =>
        this.host.post({ type: 'PM_SURFACE_VIEW', payload: { requestId, unobstructed } }),
    };
  }

  finish(requestId: WalletIframeRequestId, anchored: AnchoredSurface, exit: WalletStepExit): void {
    if (this.surfaces.get(requestId) === anchored) this.surfaces.delete(requestId);
    // The app shows its own result step, so an anchored card keeps no receipt on screen.
    this.host.closeReceipt(requestId);
    anchored.finish(exit, this.host.overlay().whenSurfaceGone());
  }

  private renderIfActive(requestId: WalletIframeRequestId): void {
    if (this.host.activeRequestId() === requestId) this.host.renderActive();
  }
}

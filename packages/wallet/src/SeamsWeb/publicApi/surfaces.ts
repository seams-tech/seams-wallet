import {
  parseHostedAuthMenuOpenRequest,
  type HostedAuthMenuOpenRequest,
  type HostedAuthMenuOutcome,
} from '../walletIframe/shared/messages';
import type {
  AnchoredWalletPresentation,
  WalletStepChrome,
  WalletStepEvents,
} from '../walletIframe/shared/walletStep';
import type { AuthMenuCapability } from './types';

/** A Wallet card that a call sends: a transaction confirm or a Speak-to-Sign request. */
export type WalletSurfaceSend<T> = (presentation: AnchoredWalletPresentation) => Promise<T>;

export type WalletSurfaceMountOptions<T> = WalletStepEvents &
  Readonly<{
    /** Back or Close inside the card. Defaults to none. */
    chrome?: WalletStepChrome;
    surface:
      | Readonly<{ kind: 'auth_menu'; request: HostedAuthMenuOpenRequest }>
      | Readonly<{ kind: 'transaction_confirm' | 'speak_to_sign'; send: WalletSurfaceSend<T> }>;
  }>;

export type MountedWalletSurface<T> = Readonly<{
  /** Settles when the card's call settles. */
  result: Promise<T>;
  /** Ends the card as cancelled. */
  dispose(): void;
}>;

export interface WalletSurfacesCapability {
  /**
   * Shows a Wallet card over `anchor`, as one step of the app's own dialog. The card paints in
   * the top layer and follows the anchor until it ends.
   */
  mount(
    anchor: HTMLElement,
    options: WalletSurfaceMountOptions<never> & {
      surface: Readonly<{ kind: 'auth_menu'; request: HostedAuthMenuOpenRequest }>;
    },
  ): MountedWalletSurface<HostedAuthMenuOutcome>;
  mount<T>(anchor: HTMLElement, options: WalletSurfaceMountOptions<T>): MountedWalletSurface<T>;
}

export function createWalletSurfacesCapability(
  authMenu: Pick<AuthMenuCapability, 'open' | 'cancel'>,
): WalletSurfacesCapability {
  return { mount: mountWalletSurface.bind(null, authMenu) as WalletSurfacesCapability['mount'] };
}

function mountWalletSurface<T>(
  authMenu: Pick<AuthMenuCapability, 'open' | 'cancel'>,
  anchor: HTMLElement,
  options: WalletSurfaceMountOptions<T>,
): MountedWalletSurface<T | HostedAuthMenuOutcome> {
  const { surface, chrome = 'none', ...events } = options;
  if (surface.kind === 'auth_menu') {
    const request = parseHostedAuthMenuOpenRequest({
      ...surface.request,
      ...(chrome === 'none' ? {} : { chrome }),
    });
    if (!request) throw new Error('Hosted auth-menu open request is invalid');
    return {
      result: authMenu.open(request, anchor, { ...events, layer: 'top' }),
      dispose: () => void authMenu.cancel({ authMenuSessionId: request.authMenuSessionId }),
    };
  }
  const controller = new AbortController();
  return {
    result: surface.send({
      ...events,
      kind: 'anchored',
      anchor,
      chrome,
      signal: controller.signal,
    }),
    dispose: () => controller.abort(),
  };
}

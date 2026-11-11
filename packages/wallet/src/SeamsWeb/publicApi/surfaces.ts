import {
  parseHostedAuthMenuOpenRequest,
  type HostedAuthMenuOpenRequest,
  type HostedAuthMenuOutcome,
} from '../walletIframe/shared/messages';
import type {
  AnchoredWalletPresentation,
  WalletStepChrome,
  WalletStepEvents,
  WalletStepTransition,
} from '../walletIframe/shared/walletStep';
import type { AnchoredSurfaceStep } from '../walletIframe/client/anchoredSurface';
import type { AuthMenuCapability } from './types';
import {
  runWalletModalSteps,
  type WalletModalSteps,
  type WalletModalStepsOwner,
} from './walletModalSteps';

/** A Wallet card that a call sends: a transaction confirm or a Speak-to-Sign request. */
export type WalletSurfaceSend<T> = (presentation: AnchoredWalletPresentation) => Promise<T>;

export type WalletSurfaceMountOptions<T> = WalletStepEvents &
  Readonly<{
    /** Back or Close inside the card. Defaults to none. */
    chrome?: WalletStepChrome;
    /** How long the card waits and fades. Defaults to the Wallet's own times. */
    transition?: WalletStepTransition;
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
  const { surface, chrome = 'none', ...step } = options;
  if (surface.kind === 'auth_menu') {
    const request = parseHostedAuthMenuOpenRequest({
      ...surface.request,
      ...(chrome === 'none' ? {} : { chrome }),
    });
    if (!request) throw new Error('Hosted auth-menu open request is invalid');
    return {
      result: authMenu.open(request, anchor, { ...step, layer: 'top' }),
      dispose: () => void authMenu.cancel({ authMenuSessionId: request.authMenuSessionId }),
    };
  }
  const controller = new AbortController();
  return {
    result: surface.send({
      ...step,
      kind: 'anchored',
      anchor,
      chrome,
      signal: controller.signal,
    }),
    dispose: () => controller.abort(),
  };
}

/** Shows the sign-in menu in the SDK's modal between the app's own steps. */
export type AuthMenuModalSteps = Readonly<{ steps: WalletModalSteps<HostedAuthMenuOutcome> }>;

type RawAuthMenu = Readonly<{
  open: (
    request: HostedAuthMenuOpenRequest,
    anchorElement?: HTMLElement,
    step?: AnchoredSurfaceStep,
  ) => Promise<HostedAuthMenuOutcome>;
  cancel: AuthMenuCapability['cancel'];
}>;

/** `authMenu.open`: with `{ steps }` and no anchor, the menu shows in the SDK's modal. */
export function createAuthMenuOpen(
  authMenu: RawAuthMenu,
  owner: WalletModalStepsOwner,
): AuthMenuCapability['open'] {
  return (request, anchorElement, step) => {
    if (!step || !('steps' in step)) return authMenu.open(request, anchorElement, step);
    if (anchorElement) {
      return Promise.reject(new Error('An auth menu with modal steps takes no anchor element'));
    }
    return runWalletModalSteps(owner, {
      kind: 'auth_menu',
      steps: step.steps,
      cancelled: {
        kind: 'cancelled',
        authMenuSessionId: request.authMenuSessionId,
        reason: 'close_button',
      },
      send: (presentation) => {
        const { kind: _kind, anchor, chrome, signal, ...step } = presentation;
        const mounted = mountWalletSurface(authMenu, anchor, {
          ...step,
          chrome,
          surface: { kind: 'auth_menu', request },
        });
        signal?.addEventListener('abort', mounted.dispose, { once: true });
        return mounted.result as Promise<HostedAuthMenuOutcome>;
      },
    });
  };
}

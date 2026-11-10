import {
  assertNever,
  type RequestSurfaceIdentity,
  type WalletIframeAuthMenuPresentation,
  type WalletIframeDrawerPresentation,
  type WalletIframeModalPresentation,
  type WalletIframeSurface,
  type WalletIframeSurfacePresentation,
} from './domain';
import {
  provisionalWalletIframeSurfaceGeometry,
  type WalletIframeDrawerGeometry,
  type WalletIframeModalGeometry,
  type WalletIframeSurfaceGeometry,
  type WalletIframeSurfaceViewport,
} from './geometry';
import type { HostedAuthMenuSessionId } from '../../shared/messages';
import type { AnchoredSurfaceLayer } from '../anchoredSurface';

/** The layer of a card placed over an app element, or null for a card the SDK places. */
type AnchoredLayer = { readonly anchoredLayer: AnchoredSurfaceLayer | null };

export type WalletIframeSurfaceRenderMode =
  | { kind: 'hidden' }
  | (AnchoredLayer & {
      kind: 'compact_request_modal' | 'compact_transaction_review';
      presentation: WalletIframeModalPresentation;
      geometry: WalletIframeModalGeometry;
      focusTrap: boolean;
      identity: RequestSurfaceIdentity;
      authMenuSessionId?: never;
    })
  | (AnchoredLayer & {
      kind: 'compact_request_drawer';
      presentation: WalletIframeDrawerPresentation;
      geometry: WalletIframeDrawerGeometry;
      focusTrap: true;
      identity: RequestSurfaceIdentity;
      authMenuSessionId?: never;
    })
  | (AnchoredLayer & {
      kind: 'compact_auth_menu';
      presentation: WalletIframeAuthMenuPresentation;
      geometry: WalletIframeModalGeometry;
      focusTrap: true;
      identity: RequestSurfaceIdentity;
      authMenuSessionId: HostedAuthMenuSessionId;
    });

type WalletIframeSurfaceRenderController = {
  apply(mode: WalletIframeSurfaceRenderMode): void;
};

const DEFAULT_PROVISIONAL_VIEWPORT: WalletIframeSurfaceViewport = {
  widthCssPx: 1024,
  heightCssPx: 768,
  offsetLeftCssPx: 0,
  offsetTopCssPx: 0,
};

function isModalGeometry(
  geometry: WalletIframeSurfaceGeometry,
): geometry is WalletIframeModalGeometry {
  return (
    geometry.kind === 'provisional_centered_modal' ||
    geometry.kind === 'centered_modal' ||
    geometry.kind === 'viewport_fallback'
  );
}

function isDrawerGeometry(
  geometry: WalletIframeSurfaceGeometry,
): geometry is WalletIframeDrawerGeometry {
  return (
    geometry.kind === 'provisional_bottom_drawer' ||
    geometry.kind === 'bottom_drawer' ||
    geometry.kind === 'viewport_fallback'
  );
}

function geometryForSurface(
  presentation: WalletIframeSurfacePresentation,
  geometry: WalletIframeSurfaceGeometry | undefined,
): WalletIframeSurfaceGeometry {
  return (
    geometry ?? provisionalWalletIframeSurfaceGeometry(presentation, DEFAULT_PROVISIONAL_VIEWPORT)
  );
}

function requestModalRenderMode(args: {
  presentation: WalletIframeModalPresentation;
  geometry: WalletIframeSurfaceGeometry;
  identity: RequestSurfaceIdentity;
  anchoredLayer: AnchoredSurfaceLayer | null;
}): WalletIframeSurfaceRenderMode {
  if (!isModalGeometry(args.geometry)) {
    throw new Error('Modal request surface received drawer geometry');
  }
  return {
    kind: 'compact_request_modal',
    presentation: args.presentation,
    geometry: args.geometry,
    focusTrap: true,
    identity: args.identity,
    anchoredLayer: args.anchoredLayer,
  };
}

function requestDrawerRenderMode(args: {
  presentation: WalletIframeDrawerPresentation;
  geometry: WalletIframeSurfaceGeometry;
  identity: RequestSurfaceIdentity;
  anchoredLayer: AnchoredSurfaceLayer | null;
}): WalletIframeSurfaceRenderMode {
  if (!isDrawerGeometry(args.geometry)) {
    throw new Error('Drawer request surface received modal geometry');
  }
  return {
    kind: 'compact_request_drawer',
    presentation: args.presentation,
    geometry: args.geometry,
    focusTrap: true,
    identity: args.identity,
    anchoredLayer: args.anchoredLayer,
  };
}

function authMenuRenderMode(args: {
  presentation: WalletIframeAuthMenuPresentation;
  geometry: WalletIframeSurfaceGeometry;
  identity: RequestSurfaceIdentity;
  authMenuSessionId: HostedAuthMenuSessionId;
  anchoredLayer: AnchoredSurfaceLayer | null;
}): WalletIframeSurfaceRenderMode {
  if (!isModalGeometry(args.geometry)) {
    throw new Error('Auth-menu surface received drawer geometry');
  }
  return {
    kind: 'compact_auth_menu',
    presentation: args.presentation,
    geometry: args.geometry,
    focusTrap: true,
    identity: args.identity,
    authMenuSessionId: args.authMenuSessionId,
    anchoredLayer: args.anchoredLayer,
  };
}

function renderWalletIframeSurface(
  surface: WalletIframeSurface,
  geometry: WalletIframeSurfaceGeometry | undefined,
  anchoredLayer: AnchoredSurfaceLayer | null,
): WalletIframeSurfaceRenderMode {
  if (surface.kind === 'hidden') return { kind: 'hidden' };

  const resolvedGeometry = geometryForSurface(surface.presentation, geometry);
  switch (surface.kind) {
    case 'modal_transaction_review': {
      if (!isModalGeometry(resolvedGeometry)) throw new Error('Review requires modal geometry');
      return {
        kind: 'compact_transaction_review',
        presentation: surface.presentation,
        geometry: resolvedGeometry,
        focusTrap: true,
        identity: surface.identity,
        anchoredLayer,
      };
    }
    case 'modal_registration_confirm':
    case 'modal_transaction_confirm':
    case 'modal_key_export_confirm':
    case 'modal_unlock_confirm':
    case 'modal_recovery_codes':
    case 'modal_device_link_qr':
      switch (surface.presentation.kind) {
        case 'modal':
          return requestModalRenderMode({
            presentation: surface.presentation,
            geometry: resolvedGeometry,
            identity: surface.identity,
            anchoredLayer,
          });
        case 'drawer':
          return requestDrawerRenderMode({
            presentation: surface.presentation,
            geometry: resolvedGeometry,
            identity: surface.identity,
            anchoredLayer,
          });
        default:
          return assertNever(surface.presentation);
      }
    case 'modal_auth_menu':
      return authMenuRenderMode({
        presentation: surface.presentation,
        geometry: resolvedGeometry,
        identity: surface.identity,
        authMenuSessionId: surface.authMenuSessionId,
        anchoredLayer: anchoredLayer ?? 'page',
      });
    default:
      return assertNever(surface);
  }
}

export class WalletIframeSurfaceRenderer {
  constructor(private readonly controller: WalletIframeSurfaceRenderController) {}

  render(
    surface: WalletIframeSurface,
    geometry?: WalletIframeSurfaceGeometry,
    receiptView: 'expanded' | 'toast' | null = null,
    anchoredLayer: AnchoredSurfaceLayer | null = null,
  ): void {
    if (
      receiptView &&
      surface.kind === 'modal_transaction_confirm' &&
      geometry &&
      isModalGeometry(geometry)
    ) {
      this.controller.apply({
        kind: 'compact_request_modal',
        geometry,
        focusTrap: receiptView === 'expanded',
        identity: surface.identity,
        presentation: { kind: 'modal', title: 'Transaction receipt' },
        anchoredLayer: null,
      });
      return;
    }
    this.controller.apply(renderWalletIframeSurface(surface, geometry, anchoredLayer));
  }
}

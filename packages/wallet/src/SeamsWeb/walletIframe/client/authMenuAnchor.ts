/* The hosted auth menu paints from a <body>-level dialog over an anchor element
   that the app places in its own layout. The anchor reserves the menu's space,
   shows a placeholder until the menu is measured, and then carries the ready
   attribute, so the app can reveal chrome it positions around the menu (a close
   button, a title) in the same frame as the card. */

const ANCHOR_HEIGHT_CSS_VAR = '--seams-auth-menu-height';
const PLACEHOLDER_OPACITY_CSS_VAR = '--seams-auth-menu-placeholder-opacity';
const READY_ATTRIBUTE = 'data-seams-auth-menu-ready';

export type HostedAuthMenuAnchorMetrics = {
  topCssPx: number;
  leftCssPx: number;
  layoutWidthCssPx: number;
  heightCssPx: number;
  visualScale: number;
};

export function hostedAuthMenuAnchorMetrics(
  anchor: HTMLElement | undefined,
): HostedAuthMenuAnchorMetrics | null {
  if (!anchor?.isConnected) return null;
  const rect = anchor.getBoundingClientRect();
  const layoutWidthCssPx = anchor.offsetWidth;
  if (
    !Number.isFinite(rect.top) ||
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
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

/** Reserves the measured menu height in the app's layout. */
export function publishHostedAuthMenuAnchorHeight(
  anchor: HTMLElement | undefined,
  heightCssPx: number,
): void {
  if (!anchor?.isConnected || !Number.isFinite(heightCssPx) || heightCssPx <= 0) return;
  const next = `${Math.round(heightCssPx)}px`;
  // Writing an unchanged value would still dirty layout, and this runs on every
  // scroll and resize tick.
  if (anchor.style.getPropertyValue(ANCHOR_HEIGHT_CSS_VAR) === next) return;
  anchor.style.setProperty(ANCHOR_HEIGHT_CSS_VAR, next);
}

/** The menu is measured and painted at its final size: hide the placeholder. */
export function markHostedAuthMenuAnchorReady(anchor: HTMLElement | undefined): void {
  if (!anchor) return;
  anchor.style.setProperty(PLACEHOLDER_OPACITY_CSS_VAR, '0');
  anchor.setAttribute(READY_ATTRIBUTE, 'true');
}

/** A new session waits for its menu behind the placeholder. */
export function resetHostedAuthMenuAnchor(anchor: HTMLElement): void {
  anchor.style.setProperty(PLACEHOLDER_OPACITY_CSS_VAR, '1');
  anchor.removeAttribute(READY_ATTRIBUTE);
}

/** The session ended: the menu is gone and the placeholder stays hidden. */
export function endHostedAuthMenuAnchor(anchor: HTMLElement): void {
  anchor.style.setProperty(PLACEHOLDER_OPACITY_CSS_VAR, '0');
  anchor.removeAttribute(READY_ATTRIBUTE);
}

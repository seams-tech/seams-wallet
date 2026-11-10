/* A Wallet card that an app placed in its own dialog. The card is the Wallet's own document, but
   the app's page around it could cover it or move part of it out of view. So while such a card
   shows, a click on it counts only when the whole card is in view and nothing covers it.

   Two checks hold the card:
   - The parent page reports, on every frame, whether the card's whole box is in its viewport and
     on top at each sample point (PM_SURFACE_VIEW). Until the first report, the card is held.
   - Where the browser has visibility tracking (IntersectionObserver v2), the card also checks
     itself: the browser reports whether anything covers the card or changes how it looks. A page
     cannot change that report. */

import type {
  WalletStepChrome,
  WalletSurfacePresentationWire,
  WalletSurfaceViewPayload,
} from '@/SeamsWeb/walletIframe/shared/walletStep';

const HELD_ATTRIBUTE = 'data-seams-anchored-card-held';
const CHROME_ATTRIBUTE = 'data-seams-anchored-card-chrome';
const GUARDED_EVENTS = ['click', 'pointerdown', 'pointerup', 'auxclick', 'dblclick'] as const;

type AnchoredCard = {
  readonly requestId: string;
  parentClear: boolean;
  frameClear: boolean;
};

type VisibilityEntry = IntersectionObserverEntry & { readonly isVisible?: boolean };

let active: AnchoredCard | null = null;
let observer: IntersectionObserver | null = null;
let listening = false;

function tracksVisibility(): boolean {
  return (
    typeof IntersectionObserverEntry === 'function' &&
    'isVisible' in IntersectionObserverEntry.prototype
  );
}

/** The card shows for `requestId` until the returned function runs. */
export function beginAnchoredCard(
  requestId: string,
  presentation: WalletSurfacePresentationWire,
): () => void {
  const card: AnchoredCard = {
    requestId,
    parentClear: false,
    // Without visibility tracking, the parent's report is the only check.
    frameClear: !tracksVisibility(),
  };
  active = card;
  document.documentElement.setAttribute(CHROME_ATTRIBUTE, presentation.chrome);
  listen();
  observeFrame();
  sync();
  return endAnchoredCard.bind(null, card);
}

function endAnchoredCard(card: AnchoredCard): void {
  if (active !== card) return;
  active = null;
  observer?.disconnect();
  observer = null;
  document.documentElement.removeAttribute(CHROME_ATTRIBUTE);
  sync();
}

/**
 * The Back or Close that the app asked the shown card to draw, or null for a card in the
 * Wallet's modal. The document carries it, so a separately loaded card module reads it too.
 */
export function anchoredCardChrome(): WalletStepChrome | null {
  const value = document.documentElement.getAttribute(CHROME_ATTRIBUTE);
  return value === 'back' || value === 'close' || value === 'none' ? value : null;
}

export function setAnchoredCardView(view: WalletSurfaceViewPayload): void {
  if (active?.requestId !== view.requestId) return;
  active.parentClear = view.unobstructed;
  sync();
}

/** True when a click on the Wallet's card can act. A card in the Wallet's own modal always can. */
export function anchoredCardAcceptsInput(): boolean {
  return !active || (active.parentClear && active.frameClear);
}

function sync(): void {
  document.documentElement.toggleAttribute(HELD_ATTRIBUTE, !anchoredCardAcceptsInput());
}

const holdInput = (event: Event): void => {
  if (anchoredCardAcceptsInput()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
};

/** Keyboard activation of a button arrives as a click, so the click guard covers it too. */
function listen(): void {
  if (listening) return;
  listening = true;
  for (const type of GUARDED_EVENTS) document.addEventListener(type, holdInput, true);
}

function observeFrame(): void {
  observer?.disconnect();
  observer = null;
  if (!tracksVisibility()) return;
  observer = new IntersectionObserver(onFrameVisibility, {
    threshold: [0, 1],
    // Visibility tracking requires a delay of at least 100 ms between reports.
    delay: 100,
    trackVisibility: true,
  } as IntersectionObserverInit);
  observer.observe(document.documentElement);
}

function onFrameVisibility(entries: IntersectionObserverEntry[]): void {
  const entry = entries.at(-1) as VisibilityEntry | undefined;
  if (!entry || !active) return;
  const viewport = document.documentElement;
  const box = entry.boundingClientRect;
  const shownWidth = Math.min(box.right, viewport.clientWidth) - Math.max(box.left, 0);
  const shownHeight = Math.min(box.bottom, viewport.clientHeight) - Math.max(box.top, 0);
  const seen = entry.intersectionRect;
  // The whole card is in view when the browser sees all of the frame's own viewport.
  const inView = seen.width >= shownWidth - 1 && seen.height >= shownHeight - 1 && shownWidth > 0;
  active.frameClear = entry.isVisible === true && inView;
  sync();
}

/* A Wallet card that an app placed in its own dialog. The card is the Wallet's own document, but
   the app's page around it could cover it or move part of it out of view. So while such a card
   shows, a click on it counts only when the whole card is in view and nothing covers it.

   Two checks hold the card:
   - The parent page reports, on every frame, whether the card's whole box is in its viewport and
     on top at each sample point (PM_SURFACE_VIEW). Until the first report, the card is held.
   - Where the browser has visibility tracking (IntersectionObserver v2), the card also checks
     itself: the browser reports whether anything covers the card or changes how it looks. A page
     cannot change that report. */

import {
  parseWalletStepChrome,
  type WalletStepChrome,
  type WalletStepControl,
  type WalletStepProgress,
  type WalletSurfaceControl,
  type WalletSurfacePresentationWire,
  type WalletSurfaceViewPayload,
} from '@/SeamsWeb/walletIframe/shared/walletStep';

const HELD_ATTRIBUTE = 'data-seams-anchored-card-held';
const CHROME_ATTRIBUTE = 'data-seams-anchored-card-chrome';
const MINIMIZE_ATTRIBUTE = 'data-seams-anchored-card-minimize';
const CONTROL_EVENT = 'seams-card-control';
const PROGRESS_EVENT = 'seams-card-progress';
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
  document.documentElement.toggleAttribute(MINIMIZE_ATTRIBUTE, presentation.minimize === true);
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
  document.documentElement.removeAttribute(MINIMIZE_ATTRIBUTE);
  sync();
}

/**
 * The Back, Close or both that the app asked the shown card to draw, or null for a card in the
 * Wallet's modal. The document carries it, so a separately loaded card module reads it too.
 */
export function anchoredCardChrome(): WalletStepChrome | null {
  return parseWalletStepChrome(document.documentElement.getAttribute(CHROME_ATTRIBUTE));
}

/** True when the app asked the shown card to draw Minimize. */
export function anchoredCardMinimizes(): boolean {
  return document.documentElement.hasAttribute(MINIMIZE_ATTRIBUTE);
}

/**
 * The person pressed the Back or Close that the app asked for. Call it before the card ends, so
 * the app hears which control it was. The document carries the press, so a separately loaded
 * card module can report it too.
 */
export function pressCardControl(control: WalletStepControl): void {
  document.dispatchEvent(new CustomEvent(CONTROL_EVENT, { detail: control }));
}

/**
 * A card with Minimize (`anchoredCardMinimizes()`): `true` when the person pressed Minimize, so
 * the app hides the card; `false` when the card needs the person again, so the app shows it.
 */
export function minimizeCard(minimized: boolean): void {
  document.dispatchEvent(
    new CustomEvent(CONTROL_EVENT, { detail: minimized ? 'minimize' : 'restore' }),
  );
}

/** A card with Minimize tells the app its stage, for the progress of a hidden card. */
export function reportCardProgress(progress: WalletStepProgress): void {
  document.dispatchEvent(new CustomEvent(PROGRESS_EVENT, { detail: progress }));
}

/** Where a shown card's controls and stages go. */
export type CardReporter = Readonly<{
  control: (control: WalletSurfaceControl) => void;
  progress: (progress: WalletStepProgress) => void;
}>;

/** The cards that report their controls and stages. The newest one gets each report. */
const reporters: CardReporter[] = [];

/**
 * Sends each control and stage of the card to `reporter` until the returned function runs. A
 * card that the app placed in its dialog shows above any other Wallet card, so the newest
 * reporter gets it.
 */
export function reportCardControls(reporter: CardReporter): () => void {
  if (reporters.length === 0) {
    document.addEventListener(CONTROL_EVENT, onControl);
    document.addEventListener(PROGRESS_EVENT, onProgress);
  }
  reporters.push(reporter);
  return () => {
    const index = reporters.indexOf(reporter);
    if (index >= 0) reporters.splice(index, 1);
    if (reporters.length > 0) return;
    document.removeEventListener(CONTROL_EVENT, onControl);
    document.removeEventListener(PROGRESS_EVENT, onProgress);
  };
}

function onControl(event: Event): void {
  const control: unknown = (event as CustomEvent).detail;
  if (control === 'back' || control === 'close') reporters.at(-1)?.control(control);
  // Only a card that the app gave Minimize hides and shows again.
  if ((control === 'minimize' || control === 'restore') && anchoredCardMinimizes()) {
    reporters.at(-1)?.control(control);
  }
}

function onProgress(event: Event): void {
  if (!anchoredCardMinimizes()) return;
  const progress = (event as CustomEvent<WalletStepProgress>).detail;
  reporters.at(-1)?.progress(progress);
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

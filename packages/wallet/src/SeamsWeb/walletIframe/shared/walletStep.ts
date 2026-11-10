import { asRecord, isBoolean, isNonEmptyString } from '@shared/utils/validation';

/**
 * A Wallet card can show as one step of an app's own dialog: the SDK places the card over an
 * element in the app's layout (the anchor) and tells the app what the card does. These events
 * carry the card's size, its readiness, Back and Close, and how it ended. They carry no approval
 * data: the call's own result does.
 */

/** How a Wallet card eases a new size, in the Wallet modal and in an app's dialog. */
export const WALLET_CARD_RESIZE_MS = 180;
export const WALLET_CARD_RESIZE_EASING = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

/** A control that the SDK draws inside the card, beside the card's own controls. */
export type WalletStepChrome = 'back' | 'close' | 'none';

/** The card's layout size in CSS pixels. */
export type WalletStepSize = Readonly<{ width: number; height: number }>;

/**
 * How the card ended. `completed`: the card did its job (it signed, or the person signed in).
 * `back` and `closed`: the person pressed Back or Close in the card. `cancelled`: the app or the
 * SDK ended the card. `failed`: the card ended with an error.
 */
export type WalletStepExit = Readonly<{
  kind: 'completed' | 'back' | 'closed' | 'cancelled' | 'failed';
}>;

export type WalletStepEvents = Readonly<{
  /** The card has its size and is still hidden. Size the anchor's container now. */
  onEnter?: (size: WalletStepSize) => void;
  /** The card is painted at its size. */
  onReady?: () => void;
  /** The card changes size. Runs before the new size paints. */
  onResize?: (size: WalletStepSize) => void;
  /** The card is gone. The anchor keeps the card's last size until the app changes it. */
  onExit?: (exit: WalletStepExit) => void;
  /** The person pressed Back in the card (`chrome: 'back'`). */
  onBack?: () => void;
  /** The person pressed Close in the card (`chrome: 'close'`). */
  onClose?: () => void;
}>;

export function parseWalletStepChrome(value: unknown): WalletStepChrome | null {
  return value === 'back' || value === 'close' || value === 'none' ? value : null;
}

/** The exit of a card whose own cancel ran: the chrome says which control the person pressed. */
export function walletStepExitForDismissal(chrome: WalletStepChrome): WalletStepExit {
  return { kind: chrome === 'back' ? 'back' : 'closed' };
}

/**
 * Places a Wallet card in the app's own dialog, over `anchor`. The card paints in the top layer,
 * above all app content, and needs explicit approval (`behavior: 'requireClick'`).
 */
export type AnchoredWalletPresentation = WalletStepEvents &
  Readonly<{
    kind: 'anchored';
    anchor: HTMLElement;
    /** Back or Close inside the card. Defaults to none: the card keeps only its own controls. */
    chrome?: WalletStepChrome;
    /** Aborting it ends the card as cancelled. */
    signal?: AbortSignal;
  }>;

/** Where a Wallet card shows. Without a presentation, it shows in the Wallet's own modal. */
export type WalletSurfacePresentation = Readonly<{ kind: 'modal' }> | AnchoredWalletPresentation;

/**
 * The anchored presentation on a request envelope. The Wallet host draws the chrome, and it
 * holds the card's controls until the parent reports the whole card in view and uncovered.
 */
export type WalletSurfacePresentationWire = Readonly<{
  kind: 'anchored_v1';
  chrome: WalletStepChrome;
}>;

export function parseWalletSurfacePresentationWire(
  value: unknown,
): WalletSurfacePresentationWire | null {
  const record = asRecord(value);
  const chrome = parseWalletStepChrome(record?.chrome);
  return record?.kind === 'anchored_v1' && chrome && Object.keys(record).length === 2
    ? { kind: 'anchored_v1', chrome }
    : null;
}

/** The parent's view of an anchored card: in view and uncovered, or not. */
export type WalletSurfaceViewPayload = Readonly<{ requestId: string; unobstructed: boolean }>;

export function parseWalletSurfaceViewPayload(value: unknown): WalletSurfaceViewPayload | null {
  const record = asRecord(value);
  return record && isNonEmptyString(record.requestId) && isBoolean(record.unobstructed)
    ? { requestId: record.requestId, unobstructed: record.unobstructed }
    : null;
}

/** An anchored card works only with an explicit approval in the Wallet's own card. */
export function assertAnchoredPresentation(value: unknown): AnchoredWalletPresentation {
  const presentation = (value ?? {}) as Partial<AnchoredWalletPresentation>;
  if (
    presentation.kind !== 'anchored' ||
    typeof HTMLElement === 'undefined' ||
    !(presentation.anchor instanceof HTMLElement) ||
    (presentation.chrome !== undefined && parseWalletStepChrome(presentation.chrome) === null)
  ) {
    throw new Error('An anchored presentation needs an anchor element and a valid chrome');
  }
  return presentation as AnchoredWalletPresentation;
}

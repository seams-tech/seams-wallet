import { asRecord, isBoolean, isFiniteNumber, isNonEmptyString } from '@shared/utils/validation';

/**
 * A Wallet card can show as one step of an app's own dialog: the SDK places the card over an
 * element in the app's layout (the anchor) and tells the app what the card does. These events
 * carry the card's size, its readiness, Back and Close, and how it ended. They carry no approval
 * data: the call's own result does.
 */

/** How a Wallet card eases a new size, in the Wallet modal and in an app's dialog. */
export const WALLET_CARD_RESIZE_MS = 180;
export const WALLET_CARD_RESIZE_EASING = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

/**
 * How long the transitions of a card in an app's dialog take, in milliseconds. A time that the
 * app leaves out is the Wallet's own. With reduced motion, the card shows and goes at once.
 */
export type WalletStepTransition = Readonly<{
  /**
   * The wait between `onEnter` and the card's fade-in, for a dialog that animates to the card's
   * size first. Defaults to 0: the card shows one frame after `onEnter`.
   */
  enterDelayMs?: number;
  /** The card's fade-in. `onReady` runs after it. Defaults to 150. */
  fadeInMs?: number;
  /** The card's fade-out. `onExit` runs after it. Defaults to 150. */
  fadeOutMs?: number;
}>;

export type WalletStepTransitionTimes = Required<WalletStepTransition>;

const WALLET_STEP_TRANSITION: WalletStepTransitionTimes = {
  enterDelayMs: 0,
  fadeInMs: 150,
  fadeOutMs: 150,
};

/** `onExit` waits at most this long for the fade-out, so no transition time is longer. */
export const WALLET_STEP_TRANSITION_LIMIT_MS = 1_000;

/**
 * The transition times of a card: the app's own, and the Wallet's for the rest. It throws for a
 * time that is not a number from 0 to the limit.
 */
export function walletStepTransitionTimes(
  transition: WalletStepTransition | undefined,
): WalletStepTransitionTimes {
  const times = { ...WALLET_STEP_TRANSITION };
  for (const name of Object.keys(times) as (keyof WalletStepTransitionTimes)[]) {
    const value: unknown = transition?.[name];
    if (value === undefined) continue;
    if (!isFiniteNumber(value) || value < 0 || value > WALLET_STEP_TRANSITION_LIMIT_MS) {
      throw new Error(
        `A Wallet card's ${name} must be from 0 to ${WALLET_STEP_TRANSITION_LIMIT_MS} milliseconds`,
      );
    }
    times[name] = value;
  }
  return times;
}

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
    /** How long the card waits and fades. Defaults to the Wallet's own times. */
    transition?: WalletStepTransition;
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
  walletStepTransitionTimes(presentation.transition);
  return presentation as AnchoredWalletPresentation;
}

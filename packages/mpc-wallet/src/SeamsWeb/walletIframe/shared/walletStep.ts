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

/**
 * The controls that the SDK draws inside the card, beside the card's own controls: Back in the
 * leading corner, Close in the trailing corner, both, or neither.
 */
export type WalletStepChrome = 'back' | 'close' | 'back_and_close' | 'none';

/** The chrome that draws a control. */
export type DrawnWalletStepChrome = Exclude<WalletStepChrome, 'none'>;

/** One control of the chrome: the one that the person pressed. */
export type WalletStepControl = 'back' | 'close';

/**
 * Where a card is: it waits for a press on Record or "Try again" (the microphone is off), it
 * records the sentence, it checks the recording, or it shows a result. `done` of `total` parts
 * of the check are over; both are 0 outside a check. It carries no approval data.
 */
export type WalletStepProgress = Readonly<{
  stage: 'waiting' | 'recording' | 'checking' | 'result';
  done: number;
  total: number;
}>;

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
  /** The person pressed Back in the card (`chrome: 'back'` or `'back_and_close'`). */
  onBack?: () => void;
  /** The person pressed Close in the card (`chrome: 'close'` or `'back_and_close'`). */
  onClose?: () => void;
  /**
   * The person pressed Minimize in the card (`minimize: true`). The SDK has hidden the card, and
   * the page is no longer inert; the card's work goes on. Hide the dialog around the card, and
   * call `restore` to show the card again, for example from a progress pill.
   */
  onMinimize?: (restore: () => void) => void;
  /**
   * The minimized card shows again: the app called `restore`, or the card needs the person (a
   * result, or another try). Show the dialog around the card.
   */
  onRestore?: () => void;
  /** The stage of a card with Minimize, on each change. Use it for the progress of a hidden card. */
  onProgress?: (progress: WalletStepProgress) => void;
  /**
   * The card opens. `press` presses one control of the card for the person, for an app that
   * takes commands, such as voice commands. The Wallet runs a press only while the whole card is
   * in view and uncovered, and only when the card shows that control. See `WalletStepPress`.
   */
  onControls?: (press: (control: WalletStepPress) => void) => void;
}>;

/**
 * A control that an app can press for the person. `retry` is the card's button while it starts
 * a recording: Record or "Try again". It is never another action, such as a confirmation or a
 * passkey prompt. `minimize`, `back` and `close` are the corner controls that the app asked for.
 */
export type WalletStepPress = 'retry' | 'minimize' | 'back' | 'close';

export function parseWalletStepPress(value: unknown): WalletStepPress | null {
  return value === 'retry' || value === 'minimize' || value === 'back' || value === 'close'
    ? value
    : null;
}

export function parseWalletStepChrome(value: unknown): WalletStepChrome | null {
  return value === 'none' ? value : parseDrawnWalletStepChrome(value);
}

export function parseDrawnWalletStepChrome(value: unknown): DrawnWalletStepChrome | null {
  return value === 'back' || value === 'close' || value === 'back_and_close' ? value : null;
}

/** True when the chrome draws Back. */
export function chromeHasBack(chrome: WalletStepChrome | null | undefined): boolean {
  return chrome === 'back' || chrome === 'back_and_close';
}

/** True when the chrome draws Close. */
export function chromeHasClose(chrome: WalletStepChrome | null | undefined): boolean {
  return chrome === 'close' || chrome === 'back_and_close';
}

/**
 * The exit of a card whose own cancel ran. It is the control that the person pressed. Escape and
 * the card's own cancel count as Back when the chrome draws Back, and as Close when it does not.
 */
export function walletStepExitForDismissal(
  chrome: WalletStepChrome,
  pressed: WalletStepControl | null = null,
): WalletStepExit {
  const control = pressed ?? (chromeHasBack(chrome) ? 'back' : 'close');
  return { kind: control === 'back' ? 'back' : 'closed' };
}

/**
 * A control of a card in the app's dialog: Back or Close that the person pressed, Minimize that
 * the person pressed (`minimize`), or the card's own ask to show again (`restore`).
 */
export type WalletSurfaceControl = WalletStepControl | 'minimize' | 'restore';

/** The Wallet host tells the parent which control of a card ran. */
export type WalletSurfaceControlPayload = Readonly<{
  requestId: string;
  control: WalletSurfaceControl;
}>;

function isWalletSurfaceControl(value: unknown): value is WalletSurfaceControl {
  return value === 'back' || value === 'close' || value === 'minimize' || value === 'restore';
}

export function parseWalletSurfaceControlPayload(
  value: unknown,
): WalletSurfaceControlPayload | null {
  const record = asRecord(value);
  return record &&
    Object.keys(record).length === 2 &&
    isNonEmptyString(record.requestId) &&
    isWalletSurfaceControl(record.control)
    ? { requestId: record.requestId, control: record.control }
    : null;
}

/** The Wallet host tells the parent the stage of a card with Minimize. */
export type WalletSurfaceProgressPayload = Readonly<{
  requestId: string;
  progress: WalletStepProgress;
}>;

function isCount(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0 && value <= 1_000;
}

export function parseWalletSurfaceProgressPayload(
  value: unknown,
): WalletSurfaceProgressPayload | null {
  const record = asRecord(value);
  const progress = asRecord(record?.progress);
  if (!record || !progress || Object.keys(record).length !== 2) return null;
  if (!isNonEmptyString(record.requestId) || Object.keys(progress).length !== 3) return null;
  const { stage, done, total } = progress;
  if (stage !== 'waiting' && stage !== 'recording' && stage !== 'checking' && stage !== 'result') {
    return null;
  }
  if (!isCount(done) || !isCount(total) || done > total) return null;
  return { requestId: record.requestId, progress: { stage, done, total } };
}

/**
 * Places a Wallet card in the app's own dialog, over `anchor`. The card paints in the top layer,
 * above all app content, and needs explicit approval (`behavior: 'requireClick'`).
 */
export type AnchoredWalletPresentation = WalletStepEvents &
  Readonly<{
    kind: 'anchored';
    anchor: HTMLElement;
    /** Back, Close or both inside the card. Defaults to none: the card keeps only its own controls. */
    chrome?: WalletStepChrome;
    /**
     * Minimize inside the card, beside Close, for a card whose work takes time (a Speak-to-Sign
     * check). A press hides the card and runs `onMinimize`. Defaults to false.
     */
    minimize?: boolean;
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
  /** The card draws Minimize. Only `true` is sent. */
  minimize?: true;
}>;

export function parseWalletSurfacePresentationWire(
  value: unknown,
): WalletSurfacePresentationWire | null {
  const record = asRecord(value);
  const chrome = parseWalletStepChrome(record?.chrome);
  if (record?.kind !== 'anchored_v1' || !chrome) return null;
  const keys = Object.keys(record).length;
  if (keys === 2) return { kind: 'anchored_v1', chrome };
  return keys === 3 && record.minimize === true
    ? { kind: 'anchored_v1', chrome, minimize: true }
    : null;
}

/** The wire presentation of an app's anchored card. */
export function walletSurfacePresentationWire(
  presentation: Pick<AnchoredWalletPresentation, 'chrome' | 'minimize'>,
): WalletSurfacePresentationWire {
  const chrome = presentation.chrome ?? 'none';
  return presentation.minimize === true
    ? { kind: 'anchored_v1', chrome, minimize: true }
    : { kind: 'anchored_v1', chrome };
}

/** The parent's view of an anchored card: in view and uncovered, or not. */
export type WalletSurfaceViewPayload = Readonly<{ requestId: string; unobstructed: boolean }>;

export function parseWalletSurfaceViewPayload(value: unknown): WalletSurfaceViewPayload | null {
  const record = asRecord(value);
  return record && isNonEmptyString(record.requestId) && isBoolean(record.unobstructed)
    ? { requestId: record.requestId, unobstructed: record.unobstructed }
    : null;
}

/** The parent asks the Wallet host to press one control of an anchored card for the person. */
export type WalletSurfacePressPayload = Readonly<{ requestId: string; control: WalletStepPress }>;

export function parseWalletSurfacePressPayload(value: unknown): WalletSurfacePressPayload | null {
  const record = asRecord(value);
  const control = parseWalletStepPress(record?.control);
  return record && Object.keys(record).length === 2 && isNonEmptyString(record.requestId) && control
    ? { requestId: record.requestId, control }
    : null;
}

/** An anchored card works only with an explicit approval in the Wallet's own card. */
export function assertAnchoredPresentation(value: unknown): AnchoredWalletPresentation {
  const presentation = (value ?? {}) as Partial<AnchoredWalletPresentation>;
  if (
    presentation.kind !== 'anchored' ||
    typeof HTMLElement === 'undefined' ||
    !(presentation.anchor instanceof HTMLElement) ||
    (presentation.chrome !== undefined && parseWalletStepChrome(presentation.chrome) === null) ||
    (presentation.minimize !== undefined && typeof presentation.minimize !== 'boolean')
  ) {
    throw new Error('An anchored presentation needs an anchor element and a valid chrome');
  }
  walletStepTransitionTimes(presentation.transition);
  return presentation as AnchoredWalletPresentation;
}
